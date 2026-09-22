import vscode from 'vscode';
import { logger } from '../logger';
import { DeepSeekChatProvider } from '../provider';

export function registerProvider(context: vscode.ExtensionContext): DeepSeekChatProvider {
	const provider = new DeepSeekChatProvider(context);

	context.subscriptions.push(
		vscode.commands.registerCommand('deepseek-copilot.setApiKey', () => provider.configureApiKey()),
		vscode.commands.registerCommand('deepseek-copilot.clearApiKey', () => provider.clearApiKey()),
		vscode.commands.registerCommand('deepseek-copilot.setVisionModel', () =>
			provider.setVisionModel(),
		),
		vscode.lm.registerLanguageModelChatProvider('deepseek', provider),
	);

	// Make models discoverable without waiting for Copilot, which may itself be waiting for BYOK.
	provider.refreshModelPicker();
	context.subscriptions.push(refreshModelsAfterCopilotActivation(provider));

	return provider;
}

function refreshModelsAfterCopilotActivation(provider: DeepSeekChatProvider): vscode.Disposable {
	let disposed = false;

	// Keep the post-activation refresh to replace cached model info missing configurationSchema.
	Promise.resolve(vscode.extensions.getExtension('github.copilot-chat')?.activate())
		.then(() => {
			if (!disposed) {
				provider.refreshModelPicker();
			}
		})
		.catch((error) => {
			if (!disposed) {
				logger.warn('Failed to activate Copilot Chat or refresh model information', error);
			}
		});

	// Ignore late activation results after this extension is disposed.
	return new vscode.Disposable(() => {
		disposed = true;
	});
}
