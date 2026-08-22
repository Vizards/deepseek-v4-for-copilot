import vscode from 'vscode';
import { DeepSeekInlineCompletionProvider } from '../completion/provider';

export function registerCompletion(context: vscode.ExtensionContext): void {
	context.subscriptions.push(
		vscode.languages.registerInlineCompletionItemProvider(
			{ pattern: '**' },
			new DeepSeekInlineCompletionProvider(context),
		),
	);
}
