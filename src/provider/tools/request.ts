import type vscode from 'vscode';
import type { DeepSeekMessage, DeepSeekTool } from '../../types';
import { convertTools } from '../convert';

export function prepareRequestTools(
	toolCallingCapability: boolean | undefined,
	options: vscode.ProvideLanguageModelChatResponseOptions,
): DeepSeekTool[] | undefined {
	return toolCallingCapability ? convertTools(options.tools) : undefined;
}

export function collectTrailingToolResultIds(messages: readonly DeepSeekMessage[]): string[] {
	const trailingToolResultIds: string[] = [];
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index];
		if (message.role !== 'tool' || !message.tool_call_id) {
			break;
		}
		trailingToolResultIds.push(message.tool_call_id);
	}
	return trailingToolResultIds.reverse();
}
