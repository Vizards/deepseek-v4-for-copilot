import vscode from 'vscode';
import { AuthManager } from '../auth';
import { DeepSeekClient } from '../client';
import { getApiModelId, getBaseUrl, getMaxTokens } from '../config';
import { MODELS } from '../consts';
import { t } from '../i18n';
import type { DeepSeekMessage, DeepSeekRequest } from '../types';
import { convertMessages, convertTools, countMessageChars } from './convert';
import type { CacheDiagnosticsRecorder, CacheDiagnosticsRun } from './diagnostics';
import { dumpDeepSeekRequest } from './dump';
import { getConfiguredThinkingEffort, type ModelConfigurationOptions } from './models';
import type { ReplayMarkerMetadata } from './replay';
import type { ConversationSegment } from './segment';
import { resolveImageMessages } from './vision/index';

export interface PreparedChatRequest {
	client: DeepSeekClient;
	request: DeepSeekRequest;
	isThinkingModel: boolean;
	totalRequestChars: number;
	trailingToolResultIds: string[];
	cacheDiagnostics: CacheDiagnosticsRun;
	segment: ConversationSegment;
	replayMarkerMetadata: ReplayMarkerMetadata;
	visionMarkerTextChars?: number;
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
	getVisionModel: () => Promise<vscode.LanguageModelChat | undefined>;
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
	getVisionModel,
}: PrepareChatRequestOptions): Promise<PreparedChatRequest> {
	const apiKey = await authManager.getApiKey();
	if (!apiKey) {
		throw new Error(t('auth.notConfigured'));
	}

	const client = new DeepSeekClient(getBaseUrl(), apiKey);
	const modelDef = MODELS.find((m) => m.id === modelInfo.id);
	const isThinkingModel = modelDef?.capabilities.thinking ?? false;
	const thinkingEffort = getConfiguredThinkingEffort(options as ModelConfigurationOptions);
	const maxTokens = getMaxTokens();

	const visionResolution = await resolveImageMessages(messages, token, getVisionModel);
	const resolvedMessages = visionResolution.messages;
	const deepseekMessages = convertMessages(resolvedMessages, isThinkingModel);
	const tools = modelDef?.capabilities.toolCalling ? convertTools(options.tools) : undefined;

	const totalRequestChars = countMessageChars(deepseekMessages);
	const request: DeepSeekRequest = {
		model: getApiModelId(modelInfo.id),
		messages: deepseekMessages,
		stream: true,
		tools,
		tool_choice: tools && tools.length > 0 ? ('auto' as const) : undefined,
		max_tokens: maxTokens,
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
		vscodeModelId: modelInfo.id,
		isThinkingModel,
		thinkingEffort,
		maxTokens,
		inputMessages: messages,
		resolvedMessages,
		requestOptions: options,
		visionModelId: visionResolution.visionModelId,
		visionStats: visionResolution.stats,
	});

	const diagnosticsRun = cacheDiagnostics.beginRequest({
		request,
		segment,
		vscodeModelId: modelInfo.id,
		isThinkingModel,
		thinkingEffort,
		maxTokens,
		inputMessages: messages,
		resolvedMessages,
		visionModelId: visionResolution.visionModelId,
		visionStats: visionResolution.stats,
	});

	return {
		client,
		request,
		isThinkingModel,
		totalRequestChars,
		trailingToolResultIds: collectTrailingToolResultIds(deepseekMessages),
		cacheDiagnostics: diagnosticsRun,
		segment,
		replayMarkerMetadata: visionResolution.replayMarkerMetadata,
		visionMarkerTextChars: visionResolution.stats.markerVisionTextChars || undefined,
	};
}

function collectTrailingToolResultIds(messages: readonly DeepSeekMessage[]): string[] {
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
