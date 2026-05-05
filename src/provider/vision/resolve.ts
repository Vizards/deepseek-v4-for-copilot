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
	// Avoid starting proxy work for requests that were already cancelled.
	if (token.isCancellationRequested) {
		return IMAGE_DESCRIPTION_UNAVAILABLE;
	}
	const pendingDescription = getPendingDescription(cacheKey);
	if (pendingDescription) {
		stats.deduplicatedDescriptions += 1;
		const description = await resolvePendingDescription(pendingDescription, stats, false, token);
		return description === undefined
			? IMAGE_DESCRIPTION_UNAVAILABLE
			: createImageDescriptionText(description);
	}

	stats.misses += 1;
	const pendingDescriptionRequest = createPendingDescriptionRequest(
		cacheKey,
		part,
		visionModel,
		visionPrompt,
	);
	rememberPendingDescription(cacheKey, pendingDescriptionRequest);
	const description = await resolvePendingDescription(
		pendingDescriptionRequest,
		stats,
		true,
		token,
	);
	if (description !== undefined) {
		return createImageDescriptionText(description);
	}
	return IMAGE_DESCRIPTION_UNAVAILABLE;
}

function createPendingDescriptionRequest(
	cacheKey: string,
	part: vscode.LanguageModelDataPart,
	visionModel: vscode.LanguageModelChat,
	visionPrompt: string,
): Promise<string> {
	return describeImagePart(part, visionModel, visionPrompt).then(
		(description) => {
			if (description.length > 0) {
				rememberDescription(cacheKey, description);
			}
			return description;
		},
		(err: unknown) => {
			logger.error(t('vision.proxyError'), err);
			throw err;
		},
	);
}

async function resolvePendingDescription(
	pending: Promise<string>,
	stats: VisionDescriptionCacheStats,
	countProxyResult: boolean,
	token: vscode.CancellationToken,
): Promise<string | undefined> {
	// Stats are request-local: joiners count de-dupe, while the miss creator
	// records the proxy outcome only if it remains active until that outcome.
	try {
		const result = await waitForDescription(pending, token);
		if (result.cancelled) {
			return undefined;
		}
		if (result.description.length === 0) {
			if (countProxyResult) {
				stats.failedDescriptions += 1;
			}
			return undefined;
		}
		if (countProxyResult) {
			stats.generatedDescriptions += 1;
		}
		return result.description;
	} catch {
		if (countProxyResult) {
			stats.failedDescriptions += 1;
		}
		return undefined;
	}
}

function waitForDescription(
	description: Promise<string>,
	token: vscode.CancellationToken,
): Promise<{ cancelled: true } | { cancelled: false; description: string }> {
	if (token.isCancellationRequested) {
		return Promise.resolve({ cancelled: true });
	}

	return new Promise((resolve, reject) => {
		let cancellation: vscode.Disposable | undefined;
		const cleanup = () => cancellation?.dispose();
		cancellation = token.onCancellationRequested(() => {
			cleanup();
			resolve({ cancelled: true });
		});
		description.then(
			(value) => {
				cleanup();
				resolve({ cancelled: false, description: value });
			},
			(err: unknown) => {
				cleanup();
				reject(err);
			},
		);
	});
}

async function describeImagePart(
	part: vscode.LanguageModelDataPart,
	visionModel: vscode.LanguageModelChat,
	visionPrompt: string,
): Promise<string> {
	const visionMsg = vscode.LanguageModelChatMessage.User([
		part,
		new vscode.LanguageModelTextPart(visionPrompt),
	] as (vscode.LanguageModelDataPart | vscode.LanguageModelTextPart)[]);

	// Keep the shared proxy request independent from individual caller cancellation.
	const tokenSource = new vscode.CancellationTokenSource();
	try {
		const response = await visionModel.sendRequest([visionMsg], {}, tokenSource.token);
		let description = '';
		for await (const chunk of response.stream) {
			if (chunk instanceof vscode.LanguageModelTextPart) {
				description += chunk.value;
			}
		}

		return description.trim();
	} finally {
		tokenSource.dispose();
	}
}

function createImageDescriptionText(description: string): string {
	return `[Image Description: ${description}]`;
}

function isImageDataPart(part: unknown): part is vscode.LanguageModelDataPart {
	return part instanceof vscode.LanguageModelDataPart && part.mimeType.startsWith('image/');
}
