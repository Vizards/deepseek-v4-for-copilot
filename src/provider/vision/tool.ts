import vscode from 'vscode';
import { normalizeToolResult } from './normalize';
import { parseFirstReplayMarker } from '../replay';
import type { ToolVisionReplayEntry } from '../replay/types';
import type { VisionDescriptionSession } from './description';

type ChatMessageContentPart = vscode.LanguageModelChatRequestMessage['content'][number];
type ToolVisionReplayIndex = Map<string, [number, ToolVisionReplayEntry][]>;

/** Replace actual tool-result image data parts with proxy descriptions in place. */
export async function resolveToolResultImages(
	messages: readonly vscode.LanguageModelChatRequestMessage[],
	session: VisionDescriptionSession,
) {
	const replayIndex: ToolVisionReplayIndex = new Map();
	for (const [messageIndex, message] of messages.entries()) {
		if (message.role !== vscode.LanguageModelChatMessageRole.Assistant) {
			continue;
		}
		for (const entry of parseFirstReplayMarker(message)?.toolVision ?? []) {
			const entries = replayIndex.get(entry.callId) ?? [];
			entries.push([messageIndex, entry]);
			replayIndex.set(entry.callId, entries);
		}
	}
	const replayEntries: ToolVisionReplayEntry[] = [];
	let messagesChanged = false;
	const resolvedMessages: vscode.LanguageModelChatRequestMessage[] = [];

	for (const [messageIndex, message] of messages.entries()) {
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

			const resolvedPart = await resolveToolResultPart(
				part,
				messageIndex,
				replayIndex,
				session,
				replayEntries,
			);
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

	return {
		messages: messagesChanged ? resolvedMessages : messages,
		replayEntries,
	};
}

async function resolveToolResultPart(
	part: vscode.LanguageModelToolResultPart,
	messageIndex: number,
	replayIndex: ToolVisionReplayIndex,
	session: VisionDescriptionSession,
	replayEntries: ToolVisionReplayEntry[],
) {
	const normalized = normalizeToolResult(part);
	const imagePartCount = normalized.parts.filter((item) => item.type === 'image').length;
	const replayEntry = replayIndex
		.get(normalized.callId)
		?.find(([markerIndex]) => markerIndex > messageIndex)?.[1];
	if (replayEntry && (imagePartCount === 0 || imagePartCount === replayEntry.imageParts)) {
		return new vscode.LanguageModelToolResultPart(normalized.callId, [
			new vscode.LanguageModelTextPart(replayEntry.resolvedContent),
		]);
	}
	if (imagePartCount === 0) {
		return part;
	}

	const content: vscode.LanguageModelToolResultPart['content'] = [];
	let resolvedContent = '';
	for (const item of normalized.parts) {
		if (item.type === 'text') {
			content.push(new vscode.LanguageModelTextPart(item.text));
			resolvedContent += item.text;
		} else if (item.type === 'image') {
			const description = await session.describe(
				[{ mimeType: item.mimeType, data: item.data }],
				'tool',
			);
			content.push(new vscode.LanguageModelTextPart(description));
			resolvedContent += description;
		} else {
			content.push(item.value);
		}
	}

	replayEntries.push({ callId: normalized.callId, resolvedContent, imageParts: imagePartCount });
	return new vscode.LanguageModelToolResultPart(normalized.callId, content);
}
