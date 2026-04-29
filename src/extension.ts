import vscode from 'vscode';
import { WALKTHROUGH_ID, WELCOME_SHOWN_KEY } from './consts';
import { logger } from './logger';
import { DeepSeekChatProvider } from './provider';

let activeProvider: DeepSeekChatProvider | undefined;

export function activate(context: vscode.ExtensionContext) {
	logger.info('Activating extension');

	context.subscriptions.push(
		vscode.commands.registerCommand('deepseek-copilot.showLogs', () => logger.show()),
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

		void showWelcomeIfNeeded(context, provider).catch((error) => {
			logger.warn('Failed to show DeepSeek welcome prompt', error);
		});

		logger.info('Extension activated');
	} catch (error) {
		activeProvider = undefined;
		logger.error('Failed to activate DeepSeek extension', error);
		void vscode.window.showErrorMessage(
			'DeepSeek failed to activate. Run "DeepSeek: Show Logs" for details.',
		);
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

	await vscode.commands.executeCommand('workbench.action.openWalkthrough', WALKTHROUGH_ID, false);
	await context.globalState.update(WELCOME_SHOWN_KEY, true);
}

export async function deactivate() {
	try {
		await activeProvider?.prepareForDeactivate();
	} catch (error) {
		logger.warn('Failed to prepare DeepSeek provider for deactivate', error);
	} finally {
		activeProvider = undefined;
		logger.info('Extension deactivated');
		logger.dispose();
	}
}
