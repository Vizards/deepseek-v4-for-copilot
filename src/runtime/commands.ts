import vscode from 'vscode';
import { CONFIG_SECTION, EXTERNAL_URLS } from '../consts';
import { t } from '../i18n';
import { logger } from '../logger';
import { ensureRequestDumpRoot } from '../provider/debug';

interface ResetTarget extends vscode.QuickPickItem {
	target: vscode.ConfigurationTarget;
}

export function registerCommands(context: vscode.ExtensionContext): void {
	context.subscriptions.push(
		vscode.commands.registerCommand('deepseek-copilot.resetBaseUrl', resetBaseUrl),
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
	);
}

async function resetBaseUrl(): Promise<void> {
	try {
		const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
		const inspection = config.inspect<string>('baseUrl');
		const hasWorkspace = Boolean(
			vscode.workspace.workspaceFile || vscode.workspace.workspaceFolders?.length,
		);
		const userValue = inspection?.globalValue;
		const workspaceValue = inspection?.workspaceValue;
		const targets: ResetTarget[] = [
			{
				label: t('settings.resetBaseUrl.user'),
				target: vscode.ConfigurationTarget.Global,
				description:
					userValue === undefined
						? t('settings.resetBaseUrl.notConfigured')
						: t('settings.resetBaseUrl.current', userValue),
				// Public inspection merges local and remote user values, hiding a possible fallback.
				detail:
					userValue === undefined
						? undefined
						: vscode.env.remoteName && workspaceValue === undefined
							? t('settings.resetBaseUrl.afterInherited')
							: t(
									'settings.resetBaseUrl.after',
									(workspaceValue ?? inspection?.defaultValue) || 'https://api.deepseek.com',
								),
			},
			// baseUrl has window scope: folder overrides do not apply in a multi-root workspace.
			...(hasWorkspace
				? [
						{
							label: t('settings.resetBaseUrl.workspace'),
							target: vscode.ConfigurationTarget.Workspace,
							description:
								workspaceValue === undefined
									? t('settings.resetBaseUrl.notConfigured')
									: t('settings.resetBaseUrl.current', workspaceValue),
							detail:
								workspaceValue === undefined
									? undefined
									: t(
											'settings.resetBaseUrl.after',
											(userValue ?? inspection?.defaultValue) || 'https://api.deepseek.com',
										),
						},
					]
				: []),
		];

		// Markdown command links do not carry the active Settings tab's scope.
		const selected = await vscode.window.showQuickPick(targets, {
			title: t('settings.resetBaseUrl.title'),
			placeHolder: t('settings.resetBaseUrl.chooseScope'),
		});
		if (!selected) {
			return;
		}

		const current = vscode.workspace.getConfiguration(CONFIG_SECTION).inspect<string>('baseUrl');
		const selectedValue =
			selected.target === vscode.ConfigurationTarget.Global
				? current?.globalValue
				: current?.workspaceValue;
		if (selectedValue === undefined) {
			return;
		}

		// Global uses VS Code's user-setting routing, including remote user overrides.
		await config.update('baseUrl', undefined, selected.target);
	} catch (error) {
		logger.warn('Failed to reset DeepSeek base URL', error);
		void vscode.window.showErrorMessage(t('settings.resetBaseUrl.failed'));
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
