import vscode from 'vscode';
import { t } from '../../i18n';
import { toWellFormedString } from '../../json';
import { logger } from '../../logger';
import { parseSegmentMarkerData, SEGMENT_MARKER_MIME } from '../segment';
import {
	IMAGE_DESCRIPTION_PREFIX,
	IMAGE_DESCRIPTION_SUFFIX,
	IMAGE_DESCRIPTION_UNAVAILABLE,
} from './consts';
import { getVisionPrompt } from './model';
import type { VisionResolutionResult, VisionResolutionStats } from './types';

/**
 * Resolve image parts without treating image bytes as persistent identity.
 * Historical images replay marker-carried text; only the current tail user
 * image message is sent to the vision proxy.
 */
export async function resolveImageMessages(
	messages: readonly vscode.LanguageModelChatRequestMessage[],
	token: vscode.CancellationToken,
	getModel: () => Promise<vscode.LanguageModelChat | undefined>,
	segmentId: string,
): Promise<VisionResolutionResult> {
	const stats = createVisionResolutionStats();
	collectInputImageStats(messages, stats);
	if (stats.inputImageParts === 0) {
		return { messages, stats, segmentMarkerMetadata: {} };
	}

	const markerBindings = createVisionMarkerBindings(messages, segmentId, stats);
	const currentImageMessageIndex = findCurrentImageMessageIndex(messages);
	const result: vscode.LanguageModelChatRequestMessage[] = [];
	let visionModel: vscode.LanguageModelChat | undefined;
	let visionModelRequested = false;
	let markerVisionText: string | undefined;

	for (const [messageIndex, message] of messages.entries()) {
		const imageParts = getImageParts(message);
		if (imageParts.length === 0) {
			result.push(message as vscode.LanguageModelChatRequestMessage);
			continue;
		}

		const nonImageParts = getNonImageParts(message);
		const replayText = markerBindings.get(messageIndex);
		if (replayText) {
			stats.replayedImageMessages += 1;
			stats.droppedImageParts += imageParts.length;
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
			if (!visionModelRequested) {
				visionModelRequested = true;
				visionModel = await getModel();
			}
			const visionText = await resolveCurrentVisionText(
				imageParts,
				nonImageParts,
				visionModel,
				stats,
				token,
			);
			markerVisionText = visionText;
			stats.markerVisionTextChars = visionText.length;
			stats.droppedImageParts += imageParts.length;
			result.push(
				createResolvedMessage(message, [
					...nonImageParts,
					new vscode.LanguageModelTextPart(visionText),
				]),
			);
			continue;
		}

		stats.omittedImageMessages += 1;
		stats.droppedImageParts += imageParts.length;
		result.push(createResolvedMessage(message, nonImageParts));
	}

	return {
		messages: result,
		stats,
		segmentMarkerMetadata: { visionText: markerVisionText },
		visionModelId: visionModel?.id,
	};
}

function createVisionResolutionStats(): VisionResolutionStats {
	return {
		inputImageParts: 0,
		inputImageMessages: 0,
		currentImageMessages: 0,
		generatedImageMessages: 0,
		replayedImageMessages: 0,
		omittedImageMessages: 0,
		unavailableImageMessages: 0,
		failedImageMessages: 0,
		droppedImageParts: 0,
		markerVisionTextChars: 0,
		invalidMarkerVisionMetadata: 0,
	};
}

function collectInputImageStats(
	messages: readonly vscode.LanguageModelChatRequestMessage[],
	stats: VisionResolutionStats,
): void {
	for (const message of messages) {
		const imageParts = getImageParts(message).length;
		if (imageParts === 0) {
			continue;
		}
		stats.inputImageMessages += 1;
		stats.inputImageParts += imageParts;
	}
}

function createVisionMarkerBindings(
	messages: readonly vscode.LanguageModelChatRequestMessage[],
	segmentId: string,
	stats: VisionResolutionStats,
): Map<number, string> {
	const bindings = new Map<number, string>();
	const boundUserMessages = new Set<number>();

	for (const [messageIndex, message] of messages.entries()) {
		if (message.role !== vscode.LanguageModelChatMessageRole.Assistant) {
			continue;
		}

		const visionText = findAssistantVisionText(message, segmentId, stats);
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
	segmentId: string,
	stats: VisionResolutionStats,
): string | undefined {
	for (let partIndex = message.content.length - 1; partIndex >= 0; partIndex -= 1) {
		const part = message.content[partIndex];
		if (!(part instanceof vscode.LanguageModelDataPart) || part.mimeType !== SEGMENT_MARKER_MIME) {
			continue;
		}

		const marker = parseSegmentMarkerData(part.data);
		if (!marker.valid || marker.segmentId !== segmentId) {
			continue;
		}
		if (marker.visionText) {
			return marker.visionText;
		}
		if (marker.visionTextIgnoredReason) {
			stats.invalidMarkerVisionMetadata += 1;
		}
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

async function resolveCurrentVisionText(
	imageParts: readonly vscode.LanguageModelDataPart[],
	nonImageParts: readonly vscode.LanguageModelInputPart[],
	visionModel: vscode.LanguageModelChat | undefined,
	stats: VisionResolutionStats,
	token: vscode.CancellationToken,
): Promise<string> {
	if (!visionModel || token.isCancellationRequested) {
		if (!visionModel) {
			logger.warn(t('vision.unavailable'));
		}
		stats.unavailableImageMessages += 1;
		return createVisionReplayText(IMAGE_DESCRIPTION_UNAVAILABLE, nonImageParts);
	}

	try {
		const description = await describeImageParts(imageParts, visionModel, getVisionPrompt(), token);
		if (description.length === 0) {
			stats.failedImageMessages += 1;
			return createVisionReplayText(IMAGE_DESCRIPTION_UNAVAILABLE, nonImageParts);
		}

		stats.generatedImageMessages += 1;
		return createVisionReplayText(createImageDescriptionText(description), nonImageParts);
	} catch (error) {
		logger.error(t('vision.proxyError'), error);
		stats.failedImageMessages += 1;
		return createVisionReplayText(IMAGE_DESCRIPTION_UNAVAILABLE, nonImageParts);
	}
}

async function describeImageParts(
	parts: readonly vscode.LanguageModelDataPart[],
	visionModel: vscode.LanguageModelChat,
	visionPrompt: string,
	token: vscode.CancellationToken,
): Promise<string> {
	const visionMsg = vscode.LanguageModelChatMessage.User([
		...parts,
		new vscode.LanguageModelTextPart(visionPrompt),
	] as (vscode.LanguageModelDataPart | vscode.LanguageModelTextPart)[]);

	const response = await visionModel.sendRequest([visionMsg], {}, token);
	let description = '';
	for await (const chunk of response.stream) {
		if (chunk instanceof vscode.LanguageModelTextPart) {
			description += chunk.value;
		}
	}
	return description.trim();
}

function createVisionReplayText(
	visionText: string,
	nonImageParts: readonly vscode.LanguageModelInputPart[],
): string {
	const separatedText = hasNonEmptyTextPart(nonImageParts) ? `\n\n${visionText}` : visionText;
	return toWellFormedString(separatedText);
}

function createImageDescriptionText(description: string): string {
	return IMAGE_DESCRIPTION_PREFIX + description + IMAGE_DESCRIPTION_SUFFIX;
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

function isImageDataPart(part: unknown): part is vscode.LanguageModelDataPart {
	return part instanceof vscode.LanguageModelDataPart && part.mimeType.startsWith('image/');
}
