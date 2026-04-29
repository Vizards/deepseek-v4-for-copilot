import vscode from 'vscode';
import { AuthManager } from '../auth';
import { DeepSeekClient } from '../client';
import { getApiModelId, getBaseUrl, getMaxTokens } from '../config';
import { API_KEY_REQUIRED_DETAIL, MODELS, THINKING_EFFORT_CONFIGURATION_SCHEMA } from '../consts';
import { logger } from '../logger';
import type { DeepSeekToolCall, ModelDefinition } from '../types';
import { type ReasoningEntry, pruneReasoningCache } from './cache';
import { convertMessages, convertTools, countMessageChars } from './convert';
import { createVisionModelGetter, resolveImageMessages, setVisionProxyModel } from './vision';

/**
 * NOTE: Non-public API surface.
 *
 * The fields below (`configurationSchema` on chat info, `modelConfiguration`
 * on response options, plus `isUserSelectable` / `statusIcon`) are not part
 * of the stable `vscode.LanguageModelChat*` typings yet. They are the same
 * shape currently consumed by GitHub Copilot Chat to render a per-model
 * config dropdown in the model picker (see Copilot Chat's built-in
 * providers, e.g. its OpenAI/Anthropic providers using `reasoningEffort`).
 *
 * If/when VS Code stabilizes these as proposed API, switch to the official
 * types and drop the casts below.
 */

type ThinkingEffort = 'none' | 'high' | 'max';

/**
 * Non-public: Copilot Chat passes the user's per-model picker selections
 * back to providers via `modelConfiguration` (newer hosts) / `configuration`
 * (older hosts) on the response options. Both names are checked at runtime.
 */
type ModelConfigurationOptions = vscode.ProvideLanguageModelChatResponseOptions & {
	readonly modelConfiguration?: Record<string, unknown>;
	readonly configuration?: Record<string, unknown>;
};

/**
 * Non-public: extra fields on `LanguageModelChatInformation` consumed by the
 * Copilot Chat model picker — `isUserSelectable` controls picker visibility,
 * `statusIcon` renders a leading icon (e.g. warning when key missing), and
 * `configurationSchema` declares the per-model dropdown schema.
 */
type ModelPickerChatInformation = vscode.LanguageModelChatInformation & {
	readonly isUserSelectable: boolean;
	readonly statusIcon?: vscode.ThemeIcon;
	readonly configurationSchema?: typeof THINKING_EFFORT_CONFIGURATION_SCHEMA;
};

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

				if (
					e.affectsConfiguration('deepseek-copilot.visionModel') ||
					e.affectsConfiguration('deepseek-copilot.visionFallbackIds')
				) {
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
		vscode.window.showInformationMessage('DeepSeek API key removed.');
	}

	async hasApiKey(): Promise<boolean> {
		return this.authManager.hasApiKey();
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

	/** See provider/vision.ts */
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
		const apiKey = await this.authManager.getApiKey();
		if (!apiKey) {
			throw new Error(
				'DeepSeek API key not configured. Run "DeepSeek: Set API Key" from the Command Palette.',
			);
		}

		const baseUrl = getBaseUrl();
		const client = new DeepSeekClient(baseUrl, apiKey);

		const modelDef = MODELS.find((m) => m.id === modelInfo.id);
		const isThinkingModel = modelDef?.capabilities.thinking ?? false;
		const thinkingEffort = getConfiguredThinkingEffort(options as ModelConfigurationOptions);
		const maxTokens = getMaxTokens();

		// Heuristic: detect conversation start to clear stale cache.
		if (messages.length <= 2) {
			pruneReasoningCache(this.reasoningCache, true);
		}

		// Vision proxy: resolve images → text descriptions before sending to DeepSeek
		const resolvedMessages = await resolveImageMessages(messages, token, () => this.vision.get());
		const deepseekMessages = convertMessages(
			resolvedMessages,
			isThinkingModel,
			this.reasoningCache,
		);
		const tools = modelDef?.capabilities.toolCalling ? convertTools(options.tools) : undefined;

		const totalRequestChars = countMessageChars(deepseekMessages);

		let accumulatedReasoning = '';
		const pendingToolCallIds: string[] = [];
		let responseMessageId: string | undefined;

		return new Promise<void>((resolve, reject) => {
			client.streamChatCompletion(
				{
					model: getApiModelId(modelInfo.id),
					messages: deepseekMessages,
					stream: true,
					tools,
					tool_choice: tools && tools.length > 0 ? 'auto' : undefined,
					max_tokens: maxTokens,
					...(isThinkingModel
						? {
								thinking: {
									type: thinkingEffort === 'none' ? ('disabled' as const) : ('enabled' as const),
								},
								...(thinkingEffort === 'none' ? {} : { reasoning_effort: thinkingEffort }),
							}
						: {}),
				},
				{
					onContent: (content: string) => {
						progress.report(new vscode.LanguageModelTextPart(content));
					},

					onThinking: (text: string) => {
						accumulatedReasoning += text;

						// LanguageModelThinkingPart is a proposed API — the class
						// exists at runtime in both stable and Insiders, but the
						// stable vscode.d.ts doesn't include it. The .d.ts
						// augmentation in the project root provides type safety.
						progress.report(
							new vscode.LanguageModelThinkingPart(
								text,
							) as unknown as vscode.LanguageModelResponsePart,
						);
					},

					onToolCall: (toolCall: DeepSeekToolCall) => {
						pendingToolCallIds.push(toolCall.id);

						// Cache reasoning keyed by tool_call ID
						if (isThinkingModel && accumulatedReasoning) {
							this.reasoningCache.set(toolCall.id, {
								text: accumulatedReasoning,
								timestamp: Date.now(),
							});
						}

						try {
							const args = JSON.parse(toolCall.function.arguments);
							progress.report(
								new vscode.LanguageModelToolCallPart(toolCall.id, toolCall.function.name, args),
							);
						} catch {
							progress.report(
								new vscode.LanguageModelToolCallPart(toolCall.id, toolCall.function.name, {}),
							);
						}
					},

					onError: (error: Error) => {
						reject(error);
					},

					onDone: () => {
						// Cache reasoning for the final response (non-tool-call case).
						if (isThinkingModel && accumulatedReasoning && pendingToolCallIds.length === 0) {
							responseMessageId = `resp_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
							this.reasoningCache.set(responseMessageId, {
								text: accumulatedReasoning,
								timestamp: Date.now(),
							});
						}

						pruneReasoningCache(this.reasoningCache, false);
						resolve();
					},

					onUsage: (usage) => {
						// Calibrate chars-per-token ratio from real API usage data.
						if (totalRequestChars > 0 && usage.prompt_tokens > 0) {
							const observedRatio = totalRequestChars / usage.prompt_tokens;
							this.charsPerToken = this.charsPerToken * 0.7 + observedRatio * 0.3;
						}

						// Log KV cache hit stats for observability.
						const cacheHit = usage.prompt_cache_hit_tokens ?? 0;
						const cacheMiss = usage.prompt_cache_miss_tokens ?? 0;
						const cacheTotal = cacheHit + cacheMiss;
						const hitRate = cacheTotal > 0 ? ((cacheHit / cacheTotal) * 100).toFixed(0) : 'n/a';
						logger.info(
							`tokens: prompt=${usage.prompt_tokens} completion=${usage.completion_tokens}` +
								` | cache: hit=${cacheHit} miss=${cacheMiss} rate=${hitRate}%` +
								` | chars/tok=${this.charsPerToken.toFixed(2)}`,
						);
					},
				},
				token,
			);
		});
	}

	async provideTokenCount(
		_modelInfo: vscode.LanguageModelChatInformation,
		text: string | vscode.LanguageModelChatRequestMessage,
		_token: vscode.CancellationToken,
	): Promise<number> {
		if (typeof text === 'string') {
			return Math.max(1, Math.ceil(text.length / this.charsPerToken));
		}

		if (!text?.content || !Array.isArray(text.content)) {
			return 1;
		}

		let total = 0;
		for (const part of text.content) {
			if (part instanceof vscode.LanguageModelTextPart) {
				total += part.value.length;
			}
		}
		return Math.max(1, Math.ceil(total / this.charsPerToken));
	}
}

// ---- Helpers ----

function toChatInfo(m: ModelDefinition, hasApiKey: boolean): ModelPickerChatInformation {
	return {
		id: m.id,
		name: m.name,
		family: m.family,
		version: m.version,
		detail: hasApiKey ? m.detail : API_KEY_REQUIRED_DETAIL,
		tooltip: hasApiKey ? undefined : API_KEY_REQUIRED_DETAIL,
		statusIcon: hasApiKey ? undefined : new vscode.ThemeIcon('warning'),
		maxInputTokens: m.maxInputTokens,
		maxOutputTokens: m.maxOutputTokens,
		isUserSelectable: true,
		capabilities: {
			toolCalling: m.capabilities.toolCalling,
			imageInput: m.capabilities.imageInput,
		},
		...(m.capabilities.thinking
			? { configurationSchema: THINKING_EFFORT_CONFIGURATION_SCHEMA }
			: {}),
	};
}

function getConfiguredThinkingEffort(options: ModelConfigurationOptions): ThinkingEffort {
	const configuredEffort =
		options.modelConfiguration?.reasoningEffort ?? options.configuration?.reasoningEffort;

	if (configuredEffort === 'none') {
		return 'none';
	}

	if (configuredEffort === 'high') {
		return 'high';
	}

	return configuredEffort === 'max' ? 'max' : 'high';
}
