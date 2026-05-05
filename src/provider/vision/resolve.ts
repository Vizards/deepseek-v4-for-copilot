import vscode from 'vscode';
import { IMAGE_DESCRIPTION_UNAVAILABLE } from '../../consts';
import { t } from '../../i18n';
import { logger } from '../../logger';
import {
	createVisionDescriptionCacheKey,
	createVisionDescriptionCacheStats,
	finalizeVisionDescriptionCacheStats,
	getCachedDescription,
	getPendingDescription,
	rememberDescription,
	rememberPendingDescription,
} from './cache';
import { getVisionPrompt } from './model';
import type { VisionDescriptionCacheStats, VisionResolutionResult } from './types';

/**
 * Resolve any image parts in user messages by forwarding them to a vision
 * model and replacing them with text descriptions. This lets text-only models
 * like DeepSeek effectively "see" images.
 */
export async function resolveImageMessages(
	messages: readonly vscode.LanguageModelChatRequestMessage[],
	token: vscode.CancellationToken,
	getModel: () => Promise<vscode.LanguageModelChat | undefined>,
): Promise<VisionResolutionResult> {
	const stats = createVisionDescriptionCacheStats();
	const hasImages = messages.some((m) => m.content.some((p) => isImageDataPart(p)));
	if (!hasImages) {
		return { messages, stats: finalizeVisionDescriptionCacheStats(stats) };
	}

	const visionModel = await getModel();
	if (!visionModel) {
		logger.warn(t('vision.unavailable'));
		const resolvedMessages = messages.map((m) => {
			const filtered = (m.content as readonly vscode.LanguageModelInputPart[]).filter(
				(p) => !isImageDataPart(p),
			);
			stats.droppedImageParts += m.content.length - filtered.length;
			return {
				role: m.role,
				content: filtered,
			} as unknown as vscode.LanguageModelChatRequestMessage;
		});
		return { messages: resolvedMessages, stats: finalizeVisionDescriptionCacheStats(stats) };
	}

	const visionPrompt = getVisionPrompt();
	const result: vscode.LanguageModelChatRequestMessage[] = [];

	for (const message of messages) {
		const resolvedParts: vscode.LanguageModelInputPart[] = [];
		let resolvedImageParts = 0;

		for (const part of message.content as readonly vscode.LanguageModelInputPart[]) {
			if (!isImageDataPart(part)) {
				resolvedParts.push(part);
				continue;
			}

			resolvedImageParts += 1;
			const description = await resolveImageDescription(
				part,
				visionModel,
				visionPrompt,
				stats,
				token,
			);
			resolvedParts.push(new vscode.LanguageModelTextPart(description));
		}

		if (resolvedImageParts === 0) {
			result.push(message as vscode.LanguageModelChatRequestMessage);
			continue;
		}

		result.push({
			role: message.role,
			content: resolvedParts,
		} as unknown as vscode.LanguageModelChatRequestMessage);
	}

	return {
		messages: result,
		stats: finalizeVisionDescriptionCacheStats(stats),
		visionModelId: visionModel.id,
	};
}

async function resolveImageDescription(
	part: vscode.LanguageModelDataPart,
	visionModel: vscode.LanguageModelChat,
	visionPrompt: string,
	stats: VisionDescriptionCacheStats,
	token: vscode.CancellationToken,
): Promise<string> {
	const cacheKey = createVisionDescriptionCacheKey(part, visionModel.id, visionPrompt);
	const cachedDescription = getCachedDescription(cacheKey);
	if (cachedDescription !== undefined) {
		stats.hits += 1;
		return createImageDescriptionText(cachedDescription);
	}
	const pendingDescription = getPendingDescription(cacheKey);
	if (pendingDescription) {
		stats.hits += 1;
		const description = await resolveDescription(pendingDescription, stats, false);
		return description === undefined
			? IMAGE_DESCRIPTION_UNAVAILABLE
			: createImageDescriptionText(description);
	}

	stats.misses += 1;
	const pendingDescriptionRequest = describeImagePart(part, visionModel, visionPrompt, token);
	rememberPendingDescription(cacheKey, pendingDescriptionRequest);
	const description = await resolveDescription(pendingDescriptionRequest, stats, true);
	if (description !== undefined) {
		rememberDescription(cacheKey, description);
		stats.generatedDescriptions += 1;
		return createImageDescriptionText(description);
	}
	return IMAGE_DESCRIPTION_UNAVAILABLE;
}

async function resolveDescription(
	description: Promise<string>,
	stats: VisionDescriptionCacheStats,
	logError: boolean,
): Promise<string | undefined> {
	try {
		const resolvedDescription = await description;
		if (resolvedDescription.length === 0) {
			stats.failedDescriptions += 1;
			return undefined;
		}
		return resolvedDescription;
	} catch (err) {
		stats.failedDescriptions += 1;
		if (logError) {
			logger.error(t('vision.proxyError'), err);
		}
		return undefined;
	}
}

async function describeImagePart(
	part: vscode.LanguageModelDataPart,
	visionModel: vscode.LanguageModelChat,
	visionPrompt: string,
	token: vscode.CancellationToken,
): Promise<string> {
	const visionMsg = vscode.LanguageModelChatMessage.User([
		part,
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

function createImageDescriptionText(description: string): string {
	return `[Image Description: ${description}]`;
}

function isImageDataPart(part: unknown): part is vscode.LanguageModelDataPart {
	return part instanceof vscode.LanguageModelDataPart && part.mimeType.startsWith('image/');
}
