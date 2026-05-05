import vscode from 'vscode';
import { AuthManager } from '../auth';
import { MODELS } from '../consts';
import { t } from '../i18n';
import { logger } from '../logger';
import type { ReasoningEntry } from './cache';
import { createCacheDiagnosticsRecorder } from './diagnostics';
import { toChatInfo } from './models';
import { prepareChatRequest } from './request';
import { streamChatCompletion } from './stream';
import { estimateTokenCount } from './tokens';
import { createVisionModelGetter, setVisionProxyModel } from './vision/index';

/**
 * DeepSeek Chat Provider — implements vscode.LanguageModelChatProvider so
 * DeepSeek V4 models appear directly in the Copilot Chat model picker.
 */
export class DeepSeekChatProvider implements vscode.LanguageModelChatProvider {
	private readonly authManager: AuthManager;
	private readonly onDidChangeLanguageModelChatInformationEmitter = new vscode.EventEmitter<void>();
	private isActive = true;

	readonly onDidChangeLanguageModelChatInformation =
		this.onDidChangeLanguageModelChatInformationEmitter.event;

	/** reasoning text → tool_call IDs cache. */
	private readonly reasoningCache = new Map<string, ReasoningEntry>();
	private readonly cacheDiagnostics = createCacheDiagnosticsRecorder();

	/** Vision proxy: resolver + cached model. */
	private readonly vision = createVisionModelGetter();

	/**
	 * Adaptive chars-per-token ratio, calibrated from actual usage data.
	 * Updated via exponential moving average each time the API reports real token counts.
	 */
	private charsPerToken = 4.0;

	constructor(context: vscode.ExtensionContext) {
		this.authManager = new AuthManager(context);

		context.subscriptions.push(
			this.onDidChangeLanguageModelChatInformationEmitter,
			// Settings-based fallback API key + vision model changes.
			vscode.workspace.onDidChangeConfiguration((e) => {
				if (e.affectsConfiguration('deepseek-copilot.apiKey')) {
					this.onDidChangeLanguageModelChatInformationEmitter.fire();
				}

				if (e.affectsConfiguration('deepseek-copilot.visionModel')) {
					this.vision.reset();
				}
			}),
			// Multi-window: SecretStorage changes don't fire onDidChangeConfiguration.
			// When another window sets/clears the API key, refresh this window's
			// model picker so the warning state stays in sync.
			context.secrets.onDidChange((e) => {
				if (e.key === 'deepseek-copilot.apiKey') {
					this.onDidChangeLanguageModelChatInformationEmitter.fire();
				}
			}),
		);
	}

	// ---- Public commands ----

	async configureApiKey(): Promise<void> {
		const saved = await this.authManager.promptForApiKey();
		if (saved) {
			this.onDidChangeLanguageModelChatInformationEmitter.fire();
		}
	}

	async clearApiKey(): Promise<void> {
		await this.authManager.deleteApiKey();
		this.onDidChangeLanguageModelChatInformationEmitter.fire();
		vscode.window.showInformationMessage(t('auth.removed'));
	}

	async hasApiKey(): Promise<boolean> {
		return this.authManager.hasApiKey();
	}

	/** Force Copilot Chat to re-query model information (including configurationSchema). */
	refreshModelPicker(): void {
		this.onDidChangeLanguageModelChatInformationEmitter.fire();
	}

	async prepareForDeactivate(): Promise<void> {
		this.isActive = false;
		this.onDidChangeLanguageModelChatInformationEmitter.fire();

		// Force the host to re-pull `provideLanguageModelChatInformation` synchronously
		// before the extension unloads. With `isActive = false` we now return [],
		// which makes Copilot Chat drop DeepSeek models from the picker immediately
		// instead of leaving stale entries behind after deactivate. The returned
		// model list itself is unused — we only call this for its side effect.
		try {
			await vscode.lm.selectChatModels({ vendor: 'deepseek' });
		} catch (error) {
			logger.warn('Failed to refresh DeepSeek models during deactivate', error);
		}
	}

	/** See provider/vision */
	async setVisionProxyModel(): Promise<void> {
		await setVisionProxyModel();
	}

	// ---- LanguageModelChatProvider ----

	async provideLanguageModelChatInformation(
		_options: vscode.PrepareLanguageModelChatModelOptions,
		_token: vscode.CancellationToken,
	): Promise<vscode.LanguageModelChatInformation[]> {
		if (!this.isActive) {
			return [];
		}

		const hasKey = await this.authManager.hasApiKey();
		return MODELS.map((model) => toChatInfo(model, hasKey));
	}

	async provideLanguageModelChatResponse(
		modelInfo: vscode.LanguageModelChatInformation,
		messages: readonly vscode.LanguageModelChatRequestMessage[],
		options: vscode.ProvideLanguageModelChatResponseOptions,
		progress: vscode.Progress<vscode.LanguageModelResponsePart>,
		token: vscode.CancellationToken,
	): Promise<void> {
		const prepared = await prepareChatRequest({
			authManager: this.authManager,
			modelInfo,
			messages,
			options,
			token,
			reasoningCache: this.reasoningCache,
			cacheDiagnostics: this.cacheDiagnostics,
			getVisionModel: () => this.vision.get(),
		});

		return streamChatCompletion({
			prepared,
			progress,
			token,
			reasoningCache: this.reasoningCache,
			getCharsPerToken: () => this.charsPerToken,
			setCharsPerToken: (charsPerToken) => {
				this.charsPerToken = charsPerToken;
			},
		});
	}

	async provideTokenCount(
		_modelInfo: vscode.LanguageModelChatInformation,
		text: string | vscode.LanguageModelChatRequestMessage,
		_token: vscode.CancellationToken,
	): Promise<number> {
		return estimateTokenCount(text, this.charsPerToken);
	}
}
