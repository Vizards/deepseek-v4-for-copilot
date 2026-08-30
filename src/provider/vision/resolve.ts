import vscode from 'vscode';
import { toWellFormedString } from '../../json';
import { parseFirstReplayMarker } from '../replay';
import { createVisionDescriptionSession } from './description';
import { isImageDataPart, type VisionInputSummary } from './normalize';
import { resolveToolResultImages } from './resolve-tool';
import type {
	VisionDescriber,
	VisionImagePart,
	VisionResolutionResult,
	VisionResolutionStats,
} from './types';
/**
 * Resolve image parts without treating image bytes as persistent identity.
 * Historical images replay marker-carried text; only the current tail user
 * image message and actual tool-result image data parts are sent to the proxy.
 */
export async function resolveImageMessages(
	messages: readonly vscode.LanguageModelChatRequestMessage[],
	summary: VisionInputSummary,
	stats: VisionResolutionStats,
	token: vscode.CancellationToken,
	getDescriber: () => Promise<VisionDescriber | undefined>,
): Promise<VisionResolutionResult> {
	if (summary.inputImageParts + summary.toolResultImageParts === 0) {
		return { messages, stats, replayMarkerMetadata: {} };
	}
	const session = createVisionDescriptionSession(stats, token, getDescriber);

	const markerBindings = createVisionMarkerBindings(messages, stats);
	const currentImageMessageIndex = findCurrentImageMessageIndex(messages);
	const result: vscode.LanguageModelChatRequestMessage[] = [];
	let markerVisionText: string | undefined;

	for (const [messageIndex, message] of messages.entries()) {
		const imageParts =
			message.role === vscode.LanguageModelChatMessageRole.User ? getImageParts(message) : [];
		if (imageParts.length === 0) {
			result.push(message as vscode.LanguageModelChatRequestMessage);
			continue;
		}

		const nonImageParts = getNonImageParts(message);
		const replayText = markerBindings.get(messageIndex);
		if (replayText) {
			stats.replayedImageMessages += 1;
			stats.input.droppedImageParts += imageParts.length;
			result.push(
				createResolvedMessage(message, [
					...nonImageParts,
					new vscode.LanguageModelTextPart(replayText),
				]),
			);
			continue;
		}

		if (messageIndex === currentImageMessageIndex) {
			stats.currentImageMessages += 1;
			const visionText = createVisionReplayText(
				await session.describe(imageParts.map(toVisionImagePart), 'input'),
				nonImageParts,
			);
			markerVisionText = visionText;
			stats.markerVisionTextChars = visionText.length;
			result.push(
				createResolvedMessage(message, [
					...nonImageParts,
					new vscode.LanguageModelTextPart(visionText),
				]),
			);
			continue;
		}

		stats.omittedImageMessages += 1;
		stats.input.droppedImageParts += imageParts.length;
		result.push(createResolvedMessage(message, nonImageParts));
	}
	const resolvedMessages = await resolveToolResultImages(result, session);
	const sessionMetadata = session.getMetadata();

	return {
		messages: resolvedMessages,
		stats,
		replayMarkerMetadata: markerVisionText ? { visionText: markerVisionText } : {},
		...sessionMetadata,
	};
}

function createVisionMarkerBindings(
	messages: readonly vscode.LanguageModelChatRequestMessage[],
	stats: VisionResolutionStats,
): Map<number, string> {
	const bindings = new Map<number, string>();
	const boundUserMessages = new Set<number>();

	for (const [messageIndex, message] of messages.entries()) {
		if (message.role !== vscode.LanguageModelChatMessageRole.Assistant) {
			continue;
		}

		const visionText = findAssistantVisionText(message, stats);
		if (!visionText) {
			continue;
		}

		for (let userIndex = messageIndex - 1; userIndex >= 0; userIndex -= 1) {
			if (boundUserMessages.has(userIndex)) {
				continue;
			}
			const candidate = messages[userIndex];
			if (candidate.role !== vscode.LanguageModelChatMessageRole.User) {
				continue;
			}
			if (getImageParts(candidate).length === 0) {
				continue;
			}

			bindings.set(userIndex, visionText);
			boundUserMessages.add(userIndex);
			break;
		}
	}

	return bindings;
}

function findAssistantVisionText(
	message: vscode.LanguageModelChatRequestMessage,
	stats: VisionResolutionStats,
): string | undefined {
	const marker = parseFirstReplayMarker(message);
	if (!marker) {
		return undefined;
	}
	if (!marker.valid) {
		stats.invalidMarkerVisionMetadata += 1;
		return undefined;
	}
	if (marker.visionText) {
		return marker.visionText;
	}
	if (marker.visionTextIgnoredReason) {
		stats.invalidMarkerVisionMetadata += 1;
	}

	return undefined;
}

function findCurrentImageMessageIndex(
	messages: readonly vscode.LanguageModelChatRequestMessage[],
): number | undefined {
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index];
		if (message.role === vscode.LanguageModelChatMessageRole.Assistant) {
			return undefined;
		}
		if (message.role !== vscode.LanguageModelChatMessageRole.User) {
			continue;
		}
		if (getImageParts(message).length > 0) {
			return index;
		}
	}
	return undefined;
}

function createVisionReplayText(
	visionText: string,
	nonImageParts: readonly vscode.LanguageModelInputPart[],
): string {
	const separatedText = hasNonEmptyTextPart(nonImageParts) ? `\n\n${visionText}` : visionText;
	return toWellFormedString(separatedText);
}

function createResolvedMessage(
	message: vscode.LanguageModelChatRequestMessage,
	content: readonly vscode.LanguageModelInputPart[],
): vscode.LanguageModelChatRequestMessage {
	return {
		role: message.role,
		content,
		name: message.name,
	} as unknown as vscode.LanguageModelChatRequestMessage;
}

function getImageParts(
	message: vscode.LanguageModelChatRequestMessage,
): vscode.LanguageModelDataPart[] {
	return (message.content as readonly vscode.LanguageModelInputPart[]).filter(isImageDataPart);
}

function getNonImageParts(
	message: vscode.LanguageModelChatRequestMessage,
): vscode.LanguageModelInputPart[] {
	return (message.content as readonly vscode.LanguageModelInputPart[]).filter(
		(part) => !isImageDataPart(part),
	);
}

function hasNonEmptyTextPart(parts: readonly vscode.LanguageModelInputPart[]): boolean {
	return parts.some(
		(part) => part instanceof vscode.LanguageModelTextPart && part.value.trim().length > 0,
	);
}

function toVisionImagePart(part: vscode.LanguageModelDataPart): VisionImagePart {
	return {
		mimeType: part.mimeType,
		data: part.data,
	};
}
