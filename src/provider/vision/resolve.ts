import vscode from 'vscode';
import { t } from '../../i18n';
import { toWellFormedString } from '../../json';
import { parseFirstReplayMarker } from '../replay';
import { createVisionProxyFailureNotice, createVisionProxyMissingNotice } from '../tools/notices';
import {
	formatVisionProxyErrorCode,
	getVisionProxyErrorDisplayCode,
	isVisionProxyError,
} from './protocols/errors';
import {
	IMAGE_DESCRIPTION_PREFIX,
	IMAGE_DESCRIPTION_SUFFIX,
	IMAGE_DESCRIPTION_UNAVAILABLE,
} from './consts';
import type {
	VisionDescriber,
	VisionImagePart,
	VisionResolutionResult,
	VisionResolutionStats,
} from './types';
import { getVisionPrompt } from './sources/vscode';
import { logVisionProxyDescribeFailed, logVisionProxyUnavailable } from './log';

interface CurrentVisionResolution {
	text: string;
	failureNotice?: string;
}

/**
 * Resolve image parts without treating image bytes as persistent identity.
 * Historical images replay marker-carried text; only the current tail user
 * image message is sent to the vision proxy.
 */
export async function resolveImageMessages(
	messages: readonly vscode.LanguageModelChatRequestMessage[],
	token: vscode.CancellationToken,
	getDescriber: () => Promise<VisionDescriber | undefined>,
): Promise<VisionResolutionResult> {
	const stats = createVisionResolutionStats();
	collectInputImageStats(messages, stats);
	if (stats.inputImageParts === 0) {
		return { messages, stats, replayMarkerMetadata: {} };
	}

	const markerBindings = createVisionMarkerBindings(messages, stats);
	const currentImageMessageIndex = findCurrentImageMessageIndex(messages);
	const result: vscode.LanguageModelChatRequestMessage[] = [];
	let visionDescriber: VisionDescriber | undefined;
	let visionDescriberRequested = false;
	let missingVisionProxy = false;
	let visionFailureNotice: string | undefined;
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
			if (!visionDescriberRequested) {
				visionDescriberRequested = true;
				visionDescriber = await getDescriber();
			}
			const visionResolution = await resolveCurrentVisionText(
				imageParts,
				nonImageParts,
				visionDescriber,
				stats,
				token,
			);
			const visionText = visionResolution.text;
			if (!visionDescriber && !token.isCancellationRequested) {
				missingVisionProxy = true;
			}
			visionFailureNotice ??= visionResolution.failureNotice;
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
		replayMarkerMetadata: { visionText: markerVisionText },
		visionModelId: visionDescriber?.id,
		visionProxySource: visionDescriber?.source,
		initialResponseNotice: missingVisionProxy
			? createVisionProxyMissingNotice()
			: visionFailureNotice,
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

async function resolveCurrentVisionText(
	imageParts: readonly vscode.LanguageModelDataPart[],
	nonImageParts: readonly vscode.LanguageModelInputPart[],
	visionDescriber: VisionDescriber | undefined,
	stats: VisionResolutionStats,
	token: vscode.CancellationToken,
): Promise<CurrentVisionResolution> {
	if (!visionDescriber || token.isCancellationRequested) {
		if (!visionDescriber) {
			logVisionProxyUnavailable();
		}
		stats.unavailableImageMessages += 1;
		return { text: createVisionReplayText(IMAGE_DESCRIPTION_UNAVAILABLE, nonImageParts) };
	}

	try {
		const description = await visionDescriber.describe({
			prompt: getVisionPrompt(),
			images: imageParts.map(toVisionImagePart),
			token,
		});
		if (description.length === 0) {
			stats.failedImageMessages += 1;
			return createFailedVisionResolution(
				formatVisionProxyErrorCode('empty-response'),
				t('vision.proxy.error.emptyResponse'),
				nonImageParts,
			);
		}

		stats.generatedImageMessages += 1;
		return { text: createVisionReplayText(createImageDescriptionText(description), nonImageParts) };
	} catch (error) {
		logVisionProxyDescribeFailed(error);
		stats.failedImageMessages += 1;
		return createFailedVisionResolution(
			getVisionProxyErrorDisplayCode(error),
			formatVisionProxyErrorMessage(error),
			nonImageParts,
		);
	}
}

function createFailedVisionResolution(
	errorCode: string,
	errorMessage: string,
	nonImageParts: readonly vscode.LanguageModelInputPart[],
): CurrentVisionResolution {
	return {
		text: createVisionReplayText(IMAGE_DESCRIPTION_UNAVAILABLE, nonImageParts),
		failureNotice: createVisionProxyFailureNotice(errorCode, errorMessage),
	};
}

function formatVisionProxyErrorMessage(error: unknown): string {
	if (isVisionProxyError(error)) {
		return error.message;
	}
	return t('vision.proxy.error.requestFailed', t('vision.proxy.error.unknown'));
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

function toVisionImagePart(part: vscode.LanguageModelDataPart): VisionImagePart {
	return {
		mimeType: part.mimeType,
		data: part.data,
	};
}
