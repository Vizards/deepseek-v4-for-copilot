import vscode from 'vscode';
import { normalizeToolResult } from './normalize';
import type { VisionDescriptionSession } from './description';

type ChatMessageContentPart = vscode.LanguageModelChatRequestMessage['content'][number];

/** Replace actual tool-result image data parts with proxy descriptions in place. */
export async function resolveToolResultImages(
	messages: readonly vscode.LanguageModelChatRequestMessage[],
	session: VisionDescriptionSession,
): Promise<readonly vscode.LanguageModelChatRequestMessage[]> {
	let messagesChanged = false;
	const resolvedMessages: vscode.LanguageModelChatRequestMessage[] = [];

	for (const message of messages) {
		if (message.role !== vscode.LanguageModelChatMessageRole.User) {
			resolvedMessages.push(message);
			continue;
		}

		let messageChanged = false;
		const content: ChatMessageContentPart[] = [];
		for (const part of message.content) {
			if (!(part instanceof vscode.LanguageModelToolResultPart)) {
				content.push(part);
				continue;
			}

			const resolvedPart = await resolveToolResultPart(part, session);
			content.push(resolvedPart);
			if (resolvedPart !== part) {
				messageChanged = true;
			}
		}

		if (!messageChanged) {
			resolvedMessages.push(message);
			continue;
		}

		messagesChanged = true;
		resolvedMessages.push({
			role: message.role,
			content,
			name: message.name,
		} as vscode.LanguageModelChatRequestMessage);
	}

	return messagesChanged ? resolvedMessages : messages;
}

async function resolveToolResultPart(
	part: vscode.LanguageModelToolResultPart,
	session: VisionDescriptionSession,
): Promise<vscode.LanguageModelToolResultPart> {
	const normalized = normalizeToolResult(part);
	if (!normalized.parts.some((item) => item.type === 'image')) {
		return part;
	}

	const content: vscode.LanguageModelToolResultPart['content'] = [];
	for (const item of normalized.parts) {
		if (item.type === 'text') {
			content.push(new vscode.LanguageModelTextPart(item.text));
		} else if (item.type === 'image') {
			const description = await session.describe(
				[{ mimeType: item.mimeType, data: item.data }],
				'tool',
			);
			content.push(new vscode.LanguageModelTextPart(description));
		} else {
			content.push(item.value);
		}
	}

	return new vscode.LanguageModelToolResultPart(normalized.callId, content);
}
