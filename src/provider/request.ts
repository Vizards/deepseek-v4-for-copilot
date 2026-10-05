import vscode from 'vscode';
import { AuthManager } from '../auth';
import { createApiKeyNotConfiguredError, DeepSeekClient } from '../client';
import {
	getApiModelId,
	getBaseUrl,
	getMaxTokens,
	getRequestHeaders,
	getToolDiscoveryEnabled,
	getToolDiscoveryMaxTools,
} from '../config';
import { MODELS } from '../consts';
import { isOfficialDeepSeekBaseUrl } from '../endpoint';
import type { DeepSeekRequest } from '../types';
import { convertMessages, countMessageChars } from './convert';
import {
	dumpDeepSeekRequest,
	type CacheDiagnosticsRecorder,
	type CacheDiagnosticsRun,
} from './debug';
import { resolveRequestHeaders } from './headers';
import { getConfiguredThinkingEffort, type ModelConfigurationOptions } from './models';
import type { ReplayMarkerMetadata } from './replay';
import { classifyDeepSeekRequest, shouldForceThinkingNone, type RequestKind } from './routing';
import type { ConversationSegment } from './segment';
import { collectTrailingToolResultIds, prepareRequestTools } from './tools/request';
import { ToolCatalog, ToolDiscoveryClient, type CompletionClient } from './tools/discovery';
import {
	finalizeVisionResolutionStats,
	prepareVisionMessages,
	type VisionDescriber,
} from './vision';

export interface PreparedChatRequest {
	client: CompletionClient;
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
	storageUri?: vscode.Uri;
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
	storageUri,
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
		throw createApiKeyNotConfiguredError();
	}

	const baseUrl = getBaseUrl();
	const requestHeaders = resolveRequestHeaders(getRequestHeaders(), options, storageUri);
	let client: CompletionClient = new DeepSeekClient(baseUrl, apiKey, requestHeaders);
	const modelDef = MODELS.find((m) => m.id === modelInfo.id);
	const thinkingCapability = modelDef?.capabilities.thinking;
	const isThinkingModel = Boolean(thinkingCapability);
	const nativeImageInput = modelDef?.capabilities.nativeImageInput === true;
	const maxTokens = getMaxTokens();
	const visionResolution = await prepareVisionMessages({
		messages,
		nativeImageInput,
		token,
		getDescriber: getVisionDescriber,
	});

	const resolvedMessages = visionResolution.messages;

	const deepseekMessages = convertMessages(resolvedMessages, isThinkingModel, nativeImageInput);
	finalizeVisionResolutionStats(visionResolution.stats, deepseekMessages);
	const discoveryEnabled = getToolDiscoveryEnabled();
	let tools = prepareRequestTools(modelDef?.capabilities.toolCalling, options, discoveryEnabled);
	const maxTools = Math.min(
		getToolDiscoveryMaxTools(),
		typeof modelDef?.capabilities.toolCalling === 'number'
			? modelDef.capabilities.toolCalling
			: 128,
	);
	if (discoveryEnabled && tools && tools.length > maxTools) {
		const catalog = new ToolCatalog(tools, deepseekMessages, maxTools);
		tools = catalog.wireTools;
		client = new ToolDiscoveryClient(client, catalog);
	}

	const totalRequestChars = countMessageChars(deepseekMessages);
	const hasNativeImages =
		visionResolution.stats.imageHandlingMode === 'native' &&
		visionResolution.stats.input.forwardedImageParts +
			visionResolution.stats.tool.forwardedImageParts >
			0;
	const baseRequest: DeepSeekRequest = {
		model: getApiModelId(modelInfo.id),
		messages: deepseekMessages,
		stream: true,
		tools,
		tool_choice:
			tools && tools.length > 0
				? discoveryEnabled && options.toolMode === vscode.LanguageModelChatToolMode.Required
					? 'required'
					: 'auto'
				: undefined,
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
