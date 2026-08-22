import vscode from 'vscode';
import { AuthManager } from '../auth';
import { EXTERNAL_URLS } from '../consts';
import { getBaseUrl } from '../config';
import { t } from '../i18n';
import { logger } from '../logger';
import { ensureRequestDumpRoot } from '../provider/debug';
import { clearCloudFiles } from '../provider/vision/filesApi';

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
		vscode.commands.registerCommand('deepseek-copilot.clearCloudCache', () =>
			clearCloudCacheCommand(context),
		),
	);
}

/**
 * 清空 DeepSeek Files API 云端缓存（永久删除所有已上传文件）。
 * 破坏性操作，先弹确认框，再执行。
 */
async function clearCloudCacheCommand(context: vscode.ExtensionContext): Promise<void> {
	const authManager = new AuthManager(context);
	const apiKey = await authManager.getApiKey();
	if (!apiKey) {
		void vscode.window.showWarningMessage(t('cloudCache.noApiKey'));
		return;
	}

	const choice = await vscode.window.showWarningMessage(
		t('cloudCache.clearConfirm'),
		{ modal: true },
		t('cloudCache.clearConfirmAction'),
	);
	if (choice !== t('cloudCache.clearConfirmAction')) {
		return;
	}

	const baseUrl = getBaseUrl();
	try {
		vscode.window.withProgress(
			{ location: vscode.ProgressLocation.Notification, title: t('cloudCache.clearing') },
			async () => {
				const deleted = await clearCloudFiles(apiKey, baseUrl);
				logger.info(`Cleared ${deleted} cloud cache file(s)`);
				void vscode.window.showInformationMessage(
					t('cloudCache.cleared', String(deleted)),
				);
			},
		);
	} catch (error) {
		logger.warn('Failed to clear cloud cache', error);
		void vscode.window.showErrorMessage(t('cloudCache.clearFailed'));
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
