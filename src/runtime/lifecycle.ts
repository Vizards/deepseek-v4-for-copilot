import vscode from 'vscode';
import { t } from '../i18n';
import { logger } from '../logger';
import { registerActionUrls } from './actions';
import { registerCommands } from './commands';
import { initializeDiagnostics } from './diagnostics';
import { registerProvider } from './provider';
import { showWelcomeIfNeeded } from './welcome';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
	await initializeDiagnostics(context);
	registerCommands(context);
	registerActionUrls(context);

	try {
		const provider = registerProvider(context);

		void showWelcomeIfNeeded(context, provider).catch((error) => {
			logger.warn(t('extension.welcomeFailed'), error);
		});

		logger.info(`Extension activated version=${context.extension.packageJSON.version}`);
	} catch (error) {
		logger.error('Failed to activate DeepSeek extension', error);
		void vscode.window.showErrorMessage(t('extension.activateFailed'));
		throw error;
	}
}

export function deactivate(): void {
	// VS Code closes extension-host RPC before deactivation; only release local resources here.
	logger.info('Extension deactivated');
	logger.dispose();
}
