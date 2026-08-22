import vscode from 'vscode';
import { AuthManager } from '../auth';
import { EXTERNAL_URLS } from '../consts';
import { t } from '../i18n';
import { logger } from '../logger';
import { ensureRequestDumpRoot } from '../provider/debug';
import { fetchBalance } from '../provider/pricing/balance';

export function registerCommands(context: vscode.ExtensionContext): void {
	context.subscriptions.push(
		vscode.commands.registerCommand('deepseek-copilot.showLogs', () => logger.show()),
		vscode.commands.registerCommand('deepseek-copilot.openRequestDumpsFolder', () =>
			openRequestDumpsFolder(context),
		),
		vscode.commands.registerCommand('deepseek-copilot.getApiKey', () =>
			vscode.env.openExternal(vscode.Uri.parse(EXTERNAL_URLS.deepseek.apiKeys)),
		),
		vscode.commands.registerCommand('deepseek-copilot.openSettings', () =>
			vscode.commands.executeCommand('workbench.action.openSettings', 'deepseek-copilot'),
		),
		vscode.commands.registerCommand('deepseek-copilot.checkBalance', () =>
			checkBalance(context),
		),
	);
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

async function checkBalance(context: vscode.ExtensionContext): Promise<void> {
	const auth = new AuthManager(context);
	const apiKey = await auth.getApiKey();
	if (!apiKey) {
		void vscode.window.showWarningMessage(t('balance.noApiKey'));
		return;
	}

	try {
		const result = await vscode.window.withProgress(
			{ location: vscode.ProgressLocation.Notification, title: t('balance.checking') },
			() => fetchBalance(apiKey),
		);

		if (!result.entries.length) {
			void vscode.window.showWarningMessage(t('balance.unavailable'));
			return;
		}

		const formatted = result.entries
			.map((e) => t('balance.entry', e.currency, e.total_balance, e.topped_up_balance, e.granted_balance))
			.join('  |  ');

		void vscode.window.showInformationMessage(t('balance.result', formatted));
	} catch (error) {
		void vscode.window.showErrorMessage(t('balance.fetchError', String(error)));
	}
}
