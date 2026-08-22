import vscode from 'vscode';
import * as crypto from 'crypto';
import { AuthManager } from '../auth';
import { DeepSeekClient } from '../client';
import { getApiModelId, getBaseUrl, getCacheExpiresSeconds, getFilesApiEnabled, getMaxTokens } from '../config';
import { MODELS } from '../consts';
import { isOfficialDeepSeekBaseUrl } from '../endpoint';
import { t } from '../i18n';
import type { DeepSeekMessage, DeepSeekRequest } from '../types';
import { convertMessages, countMessageChars } from './convert';
import {
	dumpDeepSeekRequest,
	type CacheDiagnosticsRecorder,
	type CacheDiagnosticsRun,
} from './debug';
import { ensureFileId } from './vision/filesApi';
import { getConfiguredThinkingEffort, type ModelConfigurationOptions } from './models';
import type { ReplayMarkerMetadata } from './replay';
import { classifyDeepSeekRequest, shouldForceThinkingNone, type RequestKind } from './routing';
import type { ConversationSegment } from './segment';
import { collectTrailingToolResultIds, prepareRequestTools } from './tools/request';
import type { VisionResolutionResult, VisionResolutionStats } from './vision';
import { resolveImageMessages, type VisionDescriber } from './vision';

export interface PreparedChatRequest {
	client: DeepSeekClient;
	request: DeepSeekRequest;
	isThinkingModel: boolean;
	totalRequestChars: number;
	hasNativeImages: boolean;
	trailingToolResultIds: string[];
	cacheDiagnostics: CacheDiagnosticsRun;
	requestKind: RequestKind;
	segment: ConversationSegment;
	replayMarkerMetadata: ReplayMarkerMetadata;
	visionMarkerTextChars?: number;
	initialResponseNotice?: string;
}

export interface PrepareChatRequestOptions {
	authManager: AuthManager;
	globalStorageUri: vscode.Uri;
	modelInfo: vscode.LanguageModelChatInformation;
	segment: ConversationSegment;
	messages: readonly vscode.LanguageModelChatRequestMessage[];
	options: vscode.ProvideLanguageModelChatResponseOptions;
	token: vscode.CancellationToken;
	cacheDiagnostics: CacheDiagnosticsRecorder;
	getVisionDescriber: () => Promise<VisionDescriber | undefined>;
}

export async function prepareChatRequest({
	authManager,
	globalStorageUri,
	modelInfo,
	segment,
	messages,
	options,
	token,
	cacheDiagnostics,
	getVisionDescriber,
}: PrepareChatRequestOptions): Promise<PreparedChatRequest> {
	const apiKey = await authManager.getApiKey();
	if (!apiKey) {
		throw new Error(t('auth.notConfigured'));
	}

	const baseUrl = getBaseUrl();
	const client = new DeepSeekClient(baseUrl, apiKey);
	const modelDef = MODELS.find((m) => m.id === modelInfo.id);
	const thinkingCapability = modelDef?.capabilities.thinking;
	const isThinkingModel = Boolean(thinkingCapability);
	const nativeImageInput = modelDef?.capabilities.nativeImageInput === true;
	const maxTokens = getMaxTokens();

	// Experimental Files API route: enabled only when the user opts in, the model
	// declares visionNative (Files API capability), and the endpoint is official.
	const filesApiEnabled = getFilesApiEnabled();
	const filesApiAvailable =
		modelDef?.capabilities.visionNative === true && isOfficialDeepSeekBaseUrl(baseUrl);

	let filesApiFileIdByHash: Map<string, string> | undefined;
	let effectiveFilesApi = false;
	if (filesApiEnabled && filesApiAvailable && nativeImageInput) {
		try {
			filesApiFileIdByHash = await uploadNativeImages(globalStorageUri, apiKey, baseUrl, messages);
			effectiveFilesApi = true;
		} catch (error) {
			// Upload failed — fall back to the base64 native route so the
			// conversation is not interrupted. Log the reason for diagnosis.
			console.warn('[deepseek-copilot] Files API upload failed, falling back to base64 native vision', error);
			filesApiFileIdByHash = undefined;
			effectiveFilesApi = false;
		}
	}

	// Flash/Pro are declared as non-native vision models and therefore resolve
	// image inputs through the configured/default proxy route (Vision Exp in auto mode).
	const visionResolution: VisionResolutionResult = nativeImageInput
		? createNativeVisionResolution(messages)
		: await resolveImageMessages(messages, token, getVisionDescriber);

	const resolvedMessages = visionResolution.messages;

	const deepseekMessages = convertMessages(resolvedMessages, isThinkingModel, nativeImageInput, {
		filesApiFileIdByHash: effectiveFilesApi ? filesApiFileIdByHash : undefined,
	});
	if (nativeImageInput) {
		// For native-image models, count images after conversion so diagnostics reflect
		// what is actually forwarded in the DeepSeek payload.
		visionResolution.stats.forwardedImageParts = countNativeForwardedImageParts(deepseekMessages);
		visionResolution.stats.droppedImageParts = Math.max(
			0,
			visionResolution.stats.inputImageParts - visionResolution.stats.forwardedImageParts,
		);
	}
	const tools = prepareRequestTools(modelDef?.capabilities.toolCalling, options);

	const totalRequestChars = countMessageChars(deepseekMessages);
	const hasNativeImages = hasNativeImageParts(deepseekMessages);
	const baseRequest: DeepSeekRequest = {
		model: getApiModelId(modelInfo.id),
		messages: deepseekMessages,
		stream: true,
		tools,
		tool_choice: tools && tools.length > 0 ? ('auto' as const) : undefined,
		max_tokens: maxTokens,
	};
	const requestKind = classifyDeepSeekRequest({
		request: baseRequest,
		inputMessages: messages,
	});
	const configuredThinkingEffort = thinkingCapability
		? getConfiguredThinkingEffort(options as ModelConfigurationOptions, thinkingCapability)
		: 'none';
	// Only force helper requests into disabled thinking on the official API.
	// Custom endpoints keep their configured effort to preserve pre-#137 request shape.
	const forceNoneThinking =
		shouldForceThinkingNone(requestKind) && isOfficialDeepSeekBaseUrl(baseUrl);
	const thinkingEffort = forceNoneThinking ? 'none' : configuredThinkingEffort;
	const request: DeepSeekRequest = {
		...baseRequest,
		...(isThinkingModel
			? {
					thinking: {
						type: thinkingEffort === 'none' ? ('disabled' as const) : ('enabled' as const),
					},
					...(thinkingEffort === 'none' ? {} : { reasoning_effort: thinkingEffort }),
				}
			: {}),
	};
	dumpDeepSeekRequest(request, {
		globalStorageUri,
		segment,
		requestKind,
		vscodeModelId: modelInfo.id,
		isThinkingModel,
		thinkingEffort,
		maxTokens,
		inputMessages: messages,
		resolvedMessages,
		requestOptions: options,
		visionModelId: visionResolution.visionModelId,
		visionProxySource: visionResolution.visionProxySource,
		visionStats: visionResolution.stats,
	});

	const diagnosticsRun = cacheDiagnostics.beginRequest({
		request,
		segment,
		requestKind,
		vscodeModelId: modelInfo.id,
		isThinkingModel,
		thinkingEffort,
		maxTokens,
		inputMessages: messages,
		resolvedMessages,
		visionModelId: visionResolution.visionModelId,
		visionProxySource: visionResolution.visionProxySource,
		visionStats: visionResolution.stats,
	});

	return {
		client,
		request,
		isThinkingModel,
		totalRequestChars,
		hasNativeImages,
		trailingToolResultIds: collectTrailingToolResultIds(deepseekMessages),
		cacheDiagnostics: diagnosticsRun,
		requestKind,
		segment,
		replayMarkerMetadata: visionResolution.replayMarkerMetadata,
		visionMarkerTextChars: visionResolution.stats.markerVisionTextChars || undefined,
		initialResponseNotice: visionResolution.initialResponseNotice,
	};
}

function hasNativeImageParts(messages: DeepSeekMessage[]): boolean {
	for (const message of messages) {
		if (typeof message.content === 'string') {
			continue;
		}
		for (const part of message.content) {
			if (part.type === 'image_url' || part.type === 'file') {
				return true;
			}
		}
	}
	return false;
}

/**
 * Build a lightweight resolution result for native-image models.
 * Native mode does not run proxy description, but still records input image
 * counts/bytes so diagnostics are no longer reported as all-zero.
 */
function createNativeVisionResolution(
	messages: readonly vscode.LanguageModelChatRequestMessage[],
): VisionResolutionResult {
	const stats = createNativeVisionResolutionStats();
	for (const message of messages) {
		let imagePartsInMessage = 0;
		for (const part of message.content) {
			if (part instanceof vscode.LanguageModelDataPart && part.mimeType.startsWith('image/')) {
				imagePartsInMessage += 1;
				stats.inputImageBytes += part.data.byteLength;
			}
		}
		if (imagePartsInMessage > 0) {
			stats.inputImageMessages += 1;
			stats.inputImageParts += imagePartsInMessage;
		}
	}

	if (stats.inputImageParts > 0) {
		stats.imageHandlingMode = 'native';
	}

	return {
		messages,
		stats,
		replayMarkerMetadata: {},
	};
}

/** Create a zeroed stats object that matches VisionResolutionStats shape. */
function createNativeVisionResolutionStats(): VisionResolutionStats {
	return {
		imageHandlingMode: 'none',
		inputImageParts: 0,
		inputImageMessages: 0,
		inputImageBytes: 0,
		currentImageMessages: 0,
		generatedImageMessages: 0,
		replayedImageMessages: 0,
		omittedImageMessages: 0,
		unavailableImageMessages: 0,
		failedImageMessages: 0,
		forwardedImageParts: 0,
		droppedImageParts: 0,
		markerVisionTextChars: 0,
		invalidMarkerVisionMetadata: 0,
	};
}

/** Count native image parts that survived conversion into image_url/file content. */
function countNativeForwardedImageParts(messages: readonly DeepSeekMessage[]): number {
	let total = 0;
	for (const message of messages) {
		if (typeof message.content === 'string') {
			continue;
		}
		for (const part of message.content) {
			if (part.type === 'image_url' || part.type === 'file') {
				total += 1;
			}
		}
	}
	return total;
}
/**
 * Experimental Files API route: scan all image parts in the conversation, upload
 * each unique image to the DeepSeek Files API, and return a map from the image's
 * sha256 content hash to the resulting file_id. Deduped by content hash so the
 * same image only uploads once per request.
 */
async function uploadNativeImages(
        globalStorageUri: vscode.Uri,
        apiKey: string,
        baseUrl: string,
        messages: readonly vscode.LanguageModelChatRequestMessage[],
): Promise<Map<string, string>> {
        const fileIdByHash = new Map<string, string>();

        for (const message of messages) {
                for (const part of message.content) {
                        if (isImageDataPart(part)) {
                                const hash = hashBytes(part.data);
                                if (!fileIdByHash.has(hash)) {
                                        const fileId = await ensureFileId(
                                                globalStorageUri,
                                                apiKey,
                                                baseUrl,
                                                part.data,
                                                part.mimeType,
                                                getCacheExpiresSeconds(),
                                        );
                                        fileIdByHash.set(hash, fileId);
                                }
                        }
                }
        }

        return fileIdByHash;
}

function isImageDataPart(part: unknown): part is vscode.LanguageModelDataPart {
        return part instanceof vscode.LanguageModelDataPart && part.mimeType.startsWith('image/');
}

function hashBytes(data: Uint8Array): string {
        return crypto.createHash('sha256').update(data).digest('hex');
}