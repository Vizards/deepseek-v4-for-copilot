import * as vscode from 'vscode';
import { ContextDisplay, type UsageSnapshot } from './context-display';
import { t } from './i18n';
import { logger } from './logger';
import { DeepSeekChatProvider } from './provider';

const WELCOME_SHOWN_KEY = 'deepseek-copilot.welcomeShown';
const WALKTHROUGH_ID = 'Vizards.deepseek-v4-for-copilot#deepseekGettingStarted';

let activeProvider: DeepSeekChatProvider | undefined;
let contextDisplay: ContextDisplay | undefined;

export function activate(context: vscode.ExtensionContext) {
	logger.info('Activating extension');

	contextDisplay = new ContextDisplay(context);

	context.subscriptions.push(
		vscode.commands.registerCommand('deepseek-copilot.showLogs', () => logger.show()),
		vscode.commands.registerCommand('deepseek-copilot.getApiKey', () =>
			vscode.env.openExternal(vscode.Uri.parse('https://platform.deepseek.com/api_keys')),
		),
		vscode.commands.registerCommand('deepseek-copilot.openSettings', () =>
			vscode.commands.executeCommand('workbench.action.openSettings', 'deepseek-copilot'),
		),
		vscode.commands.registerCommand('deepseek-copilot.showContextDetails', () =>
			logger.show(),
		),
	);

	try {
		const provider = new DeepSeekChatProvider(context);

		// 将 API 用量数据传递给上下文显示器
		provider.onUsageUpdate((modelId: string, thinkingEffort: string, usage: UsageSnapshot) => {
			contextDisplay?.update(modelId, thinkingEffort, usage);
		});

		activeProvider = provider;

		context.subscriptions.push(
			vscode.commands.registerCommand('deepseek-copilot.setApiKey', () =>
				provider.configureApiKey(),
			),
			vscode.commands.registerCommand('deepseek-copilot.clearApiKey', () =>
				provider.clearApiKey(),
			),
			vscode.commands.registerCommand('deepseek-copilot.setVisionModel', () =>
				provider.setVisionProxyModel(),
			),
			vscode.lm.registerLanguageModelChatProvider('deepseek', provider),
		);

		void showWelcomeIfNeeded(context, provider).catch((error) => {
			logger.warn(t('extension.welcomeFailed'), error);
		});

		logger.info('Extension activated');
	} catch (error) {
		activeProvider = undefined;
		logger.error('Failed to activate DeepSeek extension', error);
		void vscode.window.showErrorMessage(t('extension.activateFailed'));
		throw error;
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

	await vscode.commands.executeCommand(
		'workbench.action.openWalkthrough',
		WALKTHROUGH_ID,
		false,
	);
	await context.globalState.update(WELCOME_SHOWN_KEY, true);
}

export async function deactivate() {
	try {
		await activeProvider?.prepareForDeactivate();
	} catch (error) {
		logger.warn(t('extension.deactivateFailed'), error);
	} finally {
		contextDisplay = undefined;
		activeProvider = undefined;
		logger.info('Extension deactivated');
		logger.dispose();
	}
}
