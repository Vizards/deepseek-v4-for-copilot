import vscode from 'vscode';
import { getDebugMode, migrateLegacyDebugSetting } from './config';
import { CONFIG_SECTION, WALKTHROUGH_ID, WELCOME_SHOWN_KEY } from './consts';
import { t } from './i18n';
import { logger } from './logger';
import { DeepSeekChatProvider } from './provider';
import { ensureRequestDumpRoot } from './provider/debug';

let activeProvider: DeepSeekChatProvider | undefined;

export async function activate(context: vscode.ExtensionContext) {
	try {
		await migrateLegacyDebugSetting();
	} catch (error) {
		logger.warn('Failed to migrate legacy debug setting', error);
	}

	logger.info(
		`Activating extension version=${context.extension.packageJSON.version}` +
			` debugMode=${getDebugMode()}`,
	);

	// Log debugMode changes so users can trace when verbosity was toggled
	let currentDebugMode = getDebugMode();
	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration((e) => {
			if (e.affectsConfiguration(`${CONFIG_SECTION}.debugMode`)) {
				const previous = currentDebugMode;
				currentDebugMode = getDebugMode();
				logger.info(`debugMode changed: ${previous} -> ${currentDebugMode}`);
			}
		}),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('deepseek-copilot.showLogs', () => logger.show()),
		vscode.commands.registerCommand('deepseek-copilot.openRequestDumpsFolder', () =>
			openRequestDumpsFolder(context),
		),
		vscode.commands.registerCommand('deepseek-copilot.getApiKey', () =>
			vscode.env.openExternal(vscode.Uri.parse('https://platform.deepseek.com/api_keys')),
		),
		vscode.commands.registerCommand('deepseek-copilot.openSettings', () =>
			vscode.commands.executeCommand('workbench.action.openSettings', 'deepseek-copilot'),
		),
	);

	try {
		const provider = new DeepSeekChatProvider(context);
		activeProvider = provider;

		context.subscriptions.push(
			vscode.commands.registerCommand('deepseek-copilot.setApiKey', () =>
				provider.configureApiKey(),
			),
			vscode.commands.registerCommand('deepseek-copilot.clearApiKey', () => provider.clearApiKey()),
			vscode.commands.registerCommand('deepseek-copilot.setVisionModel', () =>
				provider.setVisionProxyModel(),
			),
			vscode.lm.registerLanguageModelChatProvider('deepseek', provider),
		);

		// Fix(#12): Copilot Chat caches model info in chatLanguageModels.json
		// but silently drops configurationSchema (Thinking Effort dropdown).
		// Re-firing onDidChangeLanguageModelChatInformation forces Copilot Chat
		// to re-query our provider through the full (non-cached) path.
		//
		// To avoid a race where our refresh event fires before Copilot Chat is
		// listening, we programmatically activate Copilot Chat first. We do NOT
		// use extensionDependencies because built-in extensions aren't enumerable
		// in Remote-SSH hosts (#37), which causes the hard dependency to fail.
		//
		// If Copilot Chat is unavailable (e.g. Remote-SSH without built-in
		// registration), we log a warning and proceed — Copilot Chat as a
		// built-in typically initialises before onStartupFinished anyway.
		try {
			await vscode.extensions.getExtension('github.copilot-chat')?.activate();
		} catch {
			logger.warn('Copilot Chat activation unavailable; model picker refresh may be delayed');
		}

		provider.refreshModelPicker();

		void showWelcomeIfNeeded(context, provider).catch((error) => {
			logger.warn(t('extension.welcomeFailed'), error);
		});

		logger.info(`Extension activated version=${context.extension.packageJSON.version}`);
	} catch (error) {
		activeProvider = undefined;
		logger.error('Failed to activate DeepSeek extension', error);
		void vscode.window.showErrorMessage(t('extension.activateFailed'));
		throw error;
	}
}

async function openRequestDumpsFolder(context: vscode.ExtensionContext): Promise<void> {
	try {
		const root = await ensureRequestDumpRoot(context.globalStorageUri);
		logger.info(`Opening request dumps folder: ${root.toString(true)}`);
		await vscode.commands.executeCommand('revealFileInOS', root);
	} catch (error) {
		logger.warn('Failed to open request dumps folder', error);
		void vscode.window.showErrorMessage(t('extension.openRequestDumpsFolderFailed'));
	}
}

async function showWelcomeIfNeeded(
	context: vscode.ExtensionContext,
	provider: DeepSeekChatProvider,
): Promise<void> {
	if (context.globalState.get<boolean>(WELCOME_SHOWN_KEY)) {
		return;
	}
	if (await provider.hasApiKey()) {
		await context.globalState.update(WELCOME_SHOWN_KEY, true);
		return;
	}

	await vscode.commands.executeCommand('workbench.action.openWalkthrough', WALKTHROUGH_ID, false);
	await context.globalState.update(WELCOME_SHOWN_KEY, true);
}

export async function deactivate() {
	try {
		await activeProvider?.prepareForDeactivate();
	} catch (error) {
		logger.warn(t('extension.deactivateFailed'), error);
	} finally {
		activeProvider = undefined;
		logger.info('Extension deactivated');
		logger.dispose();
	}
}
