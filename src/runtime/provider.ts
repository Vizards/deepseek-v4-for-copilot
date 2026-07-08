import vscode from 'vscode';
import { logger } from '../logger';
import { DnovaChatProvider } from '../provider';

export async function registerProvider(
	context: vscode.ExtensionContext,
): Promise<DnovaChatProvider> {
	const provider = new DnovaChatProvider(context);

	context.subscriptions.push(
		vscode.commands.registerCommand('dnova-copilot.setApiKey', () => provider.configureApiKey()),
		vscode.commands.registerCommand('dnova-copilot.clearApiKey', () => provider.clearApiKey()),
		vscode.lm.registerLanguageModelChatProvider('dnova', provider),
	);

	// Copilot Chat can serve cached model info without configurationSchema.
	// Activate it first so this refresh reaches a live listener and re-queries the provider.
	await activateCopilotChat();
	provider.refreshModelPicker();

	return provider;
}

async function activateCopilotChat(): Promise<void> {
	try {
		await vscode.extensions.getExtension('github.copilot-chat')?.activate();
	} catch (error) {
		logger.warn('Copilot Chat activation unavailable; model picker refresh may be delayed', error);
	}
}
