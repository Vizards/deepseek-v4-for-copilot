import vscode from 'vscode';
import { setErrorActionUrl, type ErrorActionUrls } from '../client';
import { CONFIGURE_API_KEY_URI_PATH, SHOW_LOGS_URI_PATH } from '../consts';
import { logger } from '../logger';

interface ActionUrlDefinition {
	key: keyof ErrorActionUrls;
	path: string;
	handle: () => void | Thenable<unknown>;
	resolveFailureMessage: string;
}

const ACTION_URLS: readonly ActionUrlDefinition[] = [
	{
		key: 'configureApiKey',
		path: CONFIGURE_API_KEY_URI_PATH,
		handle: () => vscode.commands.executeCommand('deepseek-copilot.setApiKey'),
		resolveFailureMessage: 'Failed to resolve DeepSeek set API key URI',
	},
	{
		key: 'showLogs',
		path: SHOW_LOGS_URI_PATH,
		handle: () => logger.show(),
		resolveFailureMessage: 'Failed to resolve DeepSeek show logs URI',
	},
];

export function registerActionUrls(context: vscode.ExtensionContext): void {
	context.subscriptions.push(
		vscode.window.registerUriHandler({
			handleUri(uri) {
				const action = ACTION_URLS.find((item) => item.path === uri.path);
				if (action) {
					void Promise.resolve(action.handle()).catch((error) => {
						logger.warn(`Failed to handle DeepSeek URI action: ${uri.path}`, error);
					});
					return;
				}
				logger.warn(`Unhandled DeepSeek URI: ${uri.toString(true)}`);
			},
		}),
	);

	for (const action of ACTION_URLS) {
		resolveActionUrl(context, action);
	}
}

function resolveActionUrl(context: vscode.ExtensionContext, action: ActionUrlDefinition): void {
	const rawUri = vscode.Uri.from({
		scheme: vscode.env.uriScheme,
		authority: context.extension.id,
		path: action.path,
	});
	setErrorActionUrl(action.key, rawUri.toString());

	void vscode.env.asExternalUri(rawUri).then(
		(uri) => setErrorActionUrl(action.key, uri.toString()),
		(error) => logger.warn(action.resolveFailureMessage, error),
	);
}
