import { createHash } from 'crypto';
import { appendFile, mkdir, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import vscode from 'vscode';
import { getRequestDumpEnabled } from '../../config';
import { LANGUAGE_MODEL_CHAT_SYSTEM_ROLE } from '../../consts';
import { safeStringify, toWellFormedString } from '../../json';
import { logger } from '../../logger';
import type { DeepSeekMessage, DeepSeekRequest } from '../../types';
import {
	classifyDeepSeekRequest,
	classifyProviderRequest,
	formatModelFields,
	formatRequestLogLine,
	type RequestKind,
} from '../routing';
import { parseReplayMarkerData, REPLAY_MARKER_MIME } from '../replay';
import type { ConversationSegment } from '../segment';
import { ACTIVATE_TOOL_PREFIX } from '../tools/consts';
import type { VisionProxySource, VisionResolutionStats } from '../vision';

let dumpCounter = 0;
let providerInputDumpCounter = 0;
let dumpWriteQueue: Promise<void> = Promise.resolve();

const REQUEST_OBSERVATIONS_FILE = '_request-observations.jsonl';
const HASH_WINDOW_CHARS = 2_048;

type DumpEvent = 'provider-input' | 'deepseek-request';
type DumpStage = 'provider-input' | 'input' | 'resolved';

interface DumpContext {
	root: string;
	timestamp: string;
	basename: string;
	requestKind: RequestKind;
}

interface ProviderInputDumpPaths {
	directory: string;
	providerInput: string;
}

interface RequestDumpPaths {
	directory: string;
	input: string;
	resolved: string;
	request: string;
	msg0?: string;
}

interface ToolSummary {
	toolCount: number;
	toolNames: string[];
	activateToolCount: number;
	activateToolNames: string[];
}

interface CustomizationsSummary {
	customizationsUpdateCountInHistory: number;
	latestUserMessageIndex: number | null;
	latestUserHasCustomizationsUpdate: boolean;
}

interface HostSettingsSummary {
	copilotFreezeCustomizationsIndex: boolean | 'unknown';
	chatUtilityModel: string | 'unknown';
	chatUtilitySmallModel: string | 'unknown';
	chatPlanAgentDefaultModel: string | 'unknown';
	chatExploreAgentDefaultModel: string | 'unknown';
	copilotAskAgentModel: string | 'unknown';
	copilotImplementAgentModel: string | 'unknown';
	copilotExploreAgentModel: string | 'unknown';
}

type ProviderRequestOptions = vscode.ProvideLanguageModelChatResponseOptions & {
	readonly requestInitiator?: unknown;
	readonly modelConfiguration?: unknown;
};

interface SystemPromptSummary extends CustomizationsSummary {
	messageIndex: number | null;
	role: string | null;
	chars: number;
	lines: number;
	hash: string | null;
	headHash: string | null;
	tailHash: string | null;
	hasInstructionsTag: boolean;
	hasSkillsTag: boolean;
	hasAgentsTag: boolean;
	skillTagCount: number;
	agentTagCount: number;
}

export interface DumpDeepSeekRequestOptions {
	globalStorageUri: vscode.Uri;
	segment: ConversationSegment;
	requestKind?: RequestKind;
	vscodeModelId: string;
	isThinkingModel: boolean;
	thinkingEffort: string;
	maxTokens: number | undefined;
	inputMessages: readonly vscode.LanguageModelChatRequestMessage[];
	resolvedMessages: readonly vscode.LanguageModelChatRequestMessage[];
	requestOptions: vscode.ProvideLanguageModelChatResponseOptions;
	visionModelId?: string;
	visionProxySource?: VisionProxySource;
	visionStats?: VisionResolutionStats;
}

export interface DumpProviderInputOptions {
	globalStorageUri: vscode.Uri;
	segment: ConversationSegment;
	requestKind?: RequestKind;
	modelInfo: vscode.LanguageModelChatInformation;
	messages: readonly vscode.LanguageModelChatRequestMessage[];
	requestOptions: vscode.ProvideLanguageModelChatResponseOptions;
}

/**
 * Dump the raw LanguageModelChatProvider input before any request preparation.
 * This captures the first observable `options.tools` list, including any
 * `activate_*` virtual tools, even if the provider later short-circuits.
 */
export function dumpProviderInput(options: DumpProviderInputOptions): void {
	if (!getRequestDumpEnabled()) return;

	const requestKind =
		options.requestKind ??
		classifyProviderRequest({
			messages: options.messages,
			tools: options.requestOptions.tools,
		});
	const context = createDumpContext(
		options.globalStorageUri,
		options.segment,
		'deepseek-provider-input',
		(providerInputDumpCounter += 1),
		requestKind,
	);
	const paths = createProviderInputDumpPaths(context);
	const toolSummary = summarizeTools(options.requestOptions.tools);

	enqueueDumpWrite(formatRequestLogLine(requestKind, 'providerInputDump'), async () => {
		await mkdir(context.root, { recursive: true });
		await writeJsonFile(paths.providerInput, createProviderInputSnapshot(options, context));

		await writeDumpObservation(
			options.globalStorageUri,
			createDumpObservation({
				event: 'provider-input',
				context,
				segment: options.segment,
				paths,
				model: {
					vscodeModelId: options.modelInfo.id,
				},
				requestKind,
				requestOptions: options.requestOptions,
				messages: options.messages,
				toolSummary,
			}),
		);
		logProviderInputDump(options, paths, toolSummary, requestKind);
	});
}

/**
 * Dump the FULL DeepSeek request payload (messages + tools) to disk verbatim
 * when debugMode is `verbose`. No truncation, no hashing - you get the
 * exact JSON that will be sent to the DeepSeek API (minus the auth header).
 *
 * Files land under `<dump root>/<conversationSegmentId>/` so marker replay and
 * cache-lineage changes are easy to inspect across provider calls:
 *   deepseek-request-<timestamp>-NNNN.input.json     — VS Code input snapshot
 *   deepseek-request-<timestamp>-NNNN.resolved.json  — post-vision VS Code snapshot
 *   deepseek-request-<timestamp>-NNNN.json           — full request body
 *   deepseek-request-<timestamp>-NNNN.msg0.txt       — messages[0] content (system prompt)
 */
export function dumpDeepSeekRequest(
	request: DeepSeekRequest,
	options: DumpDeepSeekRequestOptions,
): void {
	if (!getRequestDumpEnabled()) return;

	const requestKind =
		options.requestKind ??
		classifyDeepSeekRequest({
			request,
			inputMessages: options.inputMessages,
		});
	const context = createDumpContext(
		options.globalStorageUri,
		options.segment,
		'deepseek-request',
		(dumpCounter += 1),
		requestKind,
	);
	const msg0 = request.messages[0];
	const paths = createRequestDumpPaths(context, Boolean(msg0));
	const toolSummary = summarizeTools(options.requestOptions.tools);

	enqueueDumpWrite(formatRequestLogLine(requestKind, 'requestDump'), async () => {
		await mkdir(context.root, { recursive: true });
		await writeJsonFile(
			paths.input,
			createPipelineSnapshot('input', request, options.inputMessages, options, context),
		);
		await writeJsonFile(
			paths.resolved,
			createPipelineSnapshot('resolved', request, options.resolvedMessages, options, context),
		);

		const requestJson = await writeJsonFile(paths.request, request, (value) =>
			JSON.stringify(value, null, 2),
		);

		if (msg0 && paths.msg0) {
			await writeTextFile(paths.msg0, msg0.content);
		}

		await writeDumpObservation(
			options.globalStorageUri,
			createDumpObservation({
				event: 'deepseek-request',
				context,
				segment: options.segment,
				paths,
				model: {
					vscodeModelId: options.vscodeModelId,
					apiModelId: request.model === options.vscodeModelId ? undefined : request.model,
				},
				requestKind,
				requestOptions: options.requestOptions,
				messages: options.inputMessages,
				toolSummary,
			}),
		);
		logRequestDump(request, options, paths, requestJson.length, requestKind);
	});
}

export async function ensureRequestDumpRoot(globalStorageUri: vscode.Uri): Promise<vscode.Uri> {
	const root = getRequestDumpBaseRootUri(globalStorageUri);
	await mkdir(root.fsPath, { recursive: true });
	return root;
}

function createDumpContext(
	globalStorageUri: vscode.Uri,
	segment: ConversationSegment,
	prefix: string,
	seq: number,
	requestKind: RequestKind,
): DumpContext {
	const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
	return {
		root: getRequestDumpRoot(globalStorageUri, segment),
		timestamp,
		basename: `${prefix}-${timestamp}-${String(seq).padStart(4, '0')}`,
		requestKind,
	};
}

function createProviderInputDumpPaths(context: DumpContext): ProviderInputDumpPaths {
	return {
		directory: context.root,
		providerInput: join(context.root, `${context.basename}.json`),
	};
}

function createRequestDumpPaths(context: DumpContext, hasMsg0: boolean): RequestDumpPaths {
	return {
		directory: context.root,
		input: join(context.root, `${context.basename}.input.json`),
		resolved: join(context.root, `${context.basename}.resolved.json`),
		request: join(context.root, `${context.basename}.json`),
		msg0: hasMsg0 ? join(context.root, `${context.basename}.msg0.txt`) : undefined,
	};
}

function createDumpObservation(options: {
	event: DumpEvent;
	context: DumpContext;
	segment: ConversationSegment;
	paths: ProviderInputDumpPaths | RequestDumpPaths;
	model: object;
	requestKind: RequestKind;
	requestOptions: vscode.ProvideLanguageModelChatResponseOptions;
	messages: readonly vscode.LanguageModelChatRequestMessage[];
	toolSummary: ToolSummary;
}): object {
	return {
		event: options.event,
		timestamp: options.context.timestamp,
		basename: options.context.basename,
		segment: options.segment,
		paths: options.paths,
		model: options.model,
		requestKind: options.requestKind,
		options: summarizeRequestOptions(options.requestOptions),
		hostSettings: summarizeHostSettings(),
		systemPromptSummary: summarizeVscodeSystemPrompt(options.messages),
		messageStats: summarizeMessagesFromInput(options.messages),
		toolStats: options.toolSummary,
	};
}

function createProviderInputSnapshot(
	options: DumpProviderInputOptions,
	context: DumpContext,
): object {
	return createDumpSnapshot({
		stage: 'provider-input',
		context,
		segment: options.segment,
		requestKind: context.requestKind,
		model: {
			vscodeModelId: options.modelInfo.id,
			name: options.modelInfo.name,
			family: options.modelInfo.family,
			version: options.modelInfo.version,
			maxInputTokens: options.modelInfo.maxInputTokens,
			maxOutputTokens: options.modelInfo.maxOutputTokens,
			capabilities: sanitizeJsonValue(options.modelInfo.capabilities),
		},
		messages: options.messages,
		requestOptions: options.requestOptions,
	});
}

function createPipelineSnapshot(
	stage: 'input' | 'resolved',
	request: DeepSeekRequest,
	messages: readonly vscode.LanguageModelChatRequestMessage[],
	options: DumpDeepSeekRequestOptions,
	context: DumpContext,
): object {
	return createDumpSnapshot({
		stage,
		context,
		segment: options.segment,
		requestKind: context.requestKind,
		model: {
			vscodeModelId: options.vscodeModelId,
			apiModelId: request.model === options.vscodeModelId ? undefined : request.model,
			isThinkingModel: options.isThinkingModel,
			thinkingEffort: options.thinkingEffort,
			maxTokens: options.maxTokens ?? null,
		},
		vision:
			stage === 'resolved'
				? {
						modelId: options.visionModelId ?? null,
						source: options.visionProxySource ?? null,
						stats: options.visionStats ?? null,
					}
				: undefined,
		deepSeekPromptSummary: summarizeDeepSeekSystemPrompt(request.messages),
		messages,
		requestOptions: options.requestOptions,
	});
}

function createDumpSnapshot(options: {
	stage: DumpStage;
	context: DumpContext;
	segment: ConversationSegment;
	requestKind: RequestKind;
	model: object;
	vision?: object;
	deepSeekPromptSummary?: SystemPromptSummary;
	messages: readonly vscode.LanguageModelChatRequestMessage[];
	requestOptions: vscode.ProvideLanguageModelChatResponseOptions;
}): object {
	const serializedMessages = options.messages.map((message, index) =>
		serializeMessage(message, index),
	);
	return {
		stage: options.stage,
		timestamp: options.context.timestamp,
		basename: options.context.basename,
		segment: options.segment,
		requestKind: options.requestKind,
		model: options.model,
		options: summarizeRequestOptions(options.requestOptions),
		hostSettings: summarizeHostSettings(),
		vision: options.vision,
		systemPromptSummary: summarizeVscodeSystemPrompt(options.messages),
		deepSeekPromptSummary: options.deepSeekPromptSummary,
		messageStats: summarizeMessages(serializedMessages),
		messages: serializedMessages,
		toolStats: summarizeTools(options.requestOptions.tools),
		tools: serializeTools(options.requestOptions.tools),
	};
}

interface SerializedMessage {
	index: number;
	role: string;
	name: string | undefined;
	contentPartCount: number;
	contentTextChars: number;
	contentDataBytes: number;
	contentParts: SerializedContentPart[];
}

type SerializedContentPart =
	| {
			index: number;
			type: 'text';
			value: string;
			chars: number;
			hash: string;
	  }
	| {
			index: number;
			type: 'toolCall';
			callId: string;
			name: string;
			input: unknown;
			inputJsonChars: number;
			inputHash: string;
	  }
	| {
			index: number;
			type: 'toolResult';
			callId: string;
			contentPartCount: number;
			contentParts: SerializedContentPart[];
	  }
	| {
			index: number;
			type: 'promptTsx';
			value: unknown;
			valueJsonChars: number;
			valueHash: string;
	  }
	| {
			index: number;
			type: 'data';
			mimeType: string;
			byteLength: number;
			dataHash: string;
			isImage: boolean;
			replayMarker?: {
				valid: boolean;
				segmentId?: string;
				payloadFormat?: string;
				legacySegmentOnly?: boolean;
				visionTextChars?: number;
				visionTextHash?: string;
				visionTextIgnoredReason?: string;
				reasoningTextChars?: number;
				reasoningTextHash?: string;
				reasoningTextIgnoredReason?: string;
				error?: string;
			};
	  }
	| {
			index: number;
			type: 'unknown';
			constructorName: string | undefined;
			value: unknown;
			valueJsonChars: number;
			valueHash: string;
	  };

function serializeMessage(
	message: vscode.LanguageModelChatRequestMessage,
	index: number,
): SerializedMessage {
	const contentParts = message.content.map((part, partIndex) =>
		serializeContentPart(part, partIndex),
	);
	return {
		index,
		role: formatRole(message.role),
		name: message.name,
		contentPartCount: contentParts.length,
		contentTextChars: contentParts.reduce((sum, part) => sum + getContentPartTextChars(part), 0),
		contentDataBytes: contentParts.reduce((sum, part) => sum + getContentPartDataBytes(part), 0),
		contentParts,
	};
}

function serializeContentPart(part: unknown, index: number): SerializedContentPart {
	if (part instanceof vscode.LanguageModelTextPart) {
		const value = toWellFormedString(part.value);
		return {
			index,
			type: 'text',
			value,
			chars: value.length,
			hash: hashString(value),
		};
	}

	if (part instanceof vscode.LanguageModelToolCallPart) {
		const input = sanitizeJsonValue(part.input);
		const inputJson = safeStringify(input);
		return {
			index,
			type: 'toolCall',
			callId: part.callId,
			name: part.name,
			input,
			inputJsonChars: inputJson.length,
			inputHash: hashString(inputJson),
		};
	}

	if (part instanceof vscode.LanguageModelToolResultPart) {
		return {
			index,
			type: 'toolResult',
			callId: part.callId,
			contentPartCount: part.content.length,
			contentParts: part.content.map((item, itemIndex) => serializeContentPart(item, itemIndex)),
		};
	}

	if (part instanceof vscode.LanguageModelPromptTsxPart) {
		const value = sanitizeJsonValue(part.value);
		const valueJson = safeStringify(value);
		return {
			index,
			type: 'promptTsx',
			value,
			valueJsonChars: valueJson.length,
			valueHash: hashString(valueJson),
		};
	}

	if (part instanceof vscode.LanguageModelDataPart) {
		const replayMarker =
			part.mimeType === REPLAY_MARKER_MIME
				? summarizeReplayMarker(parseReplayMarkerData(part.data))
				: undefined;
		return {
			index,
			type: 'data',
			mimeType: part.mimeType,
			byteLength: part.data.byteLength,
			dataHash: hashBytes(part.data),
			isImage: part.mimeType.toLowerCase().startsWith('image/'),
			replayMarker,
		};
	}

	const value = sanitizeJsonValue(part);
	const valueJson = safeStringify(value);
	return {
		index,
		type: 'unknown',
		constructorName: getConstructorName(part),
		value,
		valueJsonChars: valueJson.length,
		valueHash: hashString(valueJson),
	};
}

function summarizeReplayMarker(marker: ReturnType<typeof parseReplayMarkerData>): {
	valid: boolean;
	segmentId?: string;
	payloadFormat?: string;
	legacySegmentOnly?: boolean;
	visionTextChars?: number;
	visionTextHash?: string;
	visionTextIgnoredReason?: string;
	reasoningTextChars?: number;
	reasoningTextHash?: string;
	reasoningTextIgnoredReason?: string;
	error?: string;
} {
	return {
		valid: marker.valid,
		segmentId: marker.segmentId,
		payloadFormat: marker.payloadFormat,
		legacySegmentOnly: marker.legacySegmentOnly,
		visionTextChars: marker.visionText?.length,
		visionTextHash: marker.visionText ? hashString(marker.visionText) : undefined,
		visionTextIgnoredReason: marker.visionTextIgnoredReason,
		reasoningTextChars: marker.reasoningText?.length,
		reasoningTextHash: marker.reasoningText ? hashString(marker.reasoningText) : undefined,
		reasoningTextIgnoredReason: marker.reasoningTextIgnoredReason,
		error: marker.error,
	};
}

function serializeTools(
	tools: readonly vscode.LanguageModelChatTool[] | undefined,
): object[] | undefined {
	return tools?.map((tool, index) => {
		const inputSchema = sanitizeJsonValue(tool.inputSchema);
		const inputSchemaJson = safeStringify(inputSchema);
		return {
			index,
			name: tool.name,
			description: tool.description,
			inputSchema,
			inputSchemaJsonChars: inputSchemaJson.length,
			inputSchemaHash: hashString(inputSchemaJson),
		};
	});
}

function summarizeMessages(messages: readonly SerializedMessage[]): object {
	const roleCounts: Record<string, number> = {};
	let textChars = 0;
	let dataBytes = 0;
	let toolCallParts = 0;
	let toolResultParts = 0;
	let dataParts = 0;
	let imageParts = 0;

	for (const message of messages) {
		roleCounts[message.role] = (roleCounts[message.role] ?? 0) + 1;
		textChars += message.contentTextChars;
		dataBytes += message.contentDataBytes;
		for (const part of flattenContentParts(message.contentParts)) {
			if (part.type === 'toolCall') toolCallParts += 1;
			if (part.type === 'toolResult') toolResultParts += 1;
			if (part.type === 'data') {
				dataParts += 1;
				if (part.isImage) imageParts += 1;
			}
		}
	}

	return {
		messageCount: messages.length,
		roleCounts,
		textChars,
		dataBytes,
		toolCallParts,
		toolResultParts,
		dataParts,
		imageParts,
	};
}

function summarizeMessagesFromInput(
	messages: readonly vscode.LanguageModelChatRequestMessage[],
): object {
	return summarizeMessages(messages.map((message, index) => serializeMessage(message, index)));
}

function summarizeVscodeSystemPrompt(
	messages: readonly vscode.LanguageModelChatRequestMessage[],
): SystemPromptSummary {
	const message = messages[0];
	const customizations = summarizeVscodeCustomizations(messages);
	if (!message) {
		return createSystemPromptSummary(null, null, '', customizations);
	}

	return createSystemPromptSummary(
		0,
		formatRole(message.role),
		getVscodeMessageText(message),
		customizations,
	);
}

function summarizeDeepSeekSystemPrompt(messages: readonly DeepSeekMessage[]): SystemPromptSummary {
	const message = messages[0];
	const customizations = summarizeDeepSeekCustomizations(messages);
	if (!message) {
		return createSystemPromptSummary(null, null, '', customizations);
	}

	return createSystemPromptSummary(0, message.role, message.content ?? '', customizations);
}

function createSystemPromptSummary(
	messageIndex: number | null,
	role: string | null,
	text: string,
	customizations: CustomizationsSummary,
): SystemPromptSummary {
	return {
		messageIndex,
		role,
		chars: text.length,
		lines: countLines(text),
		hash: messageIndex === null ? null : hashString(text),
		headHash: messageIndex === null ? null : hashString(text.slice(0, HASH_WINDOW_CHARS)),
		tailHash: messageIndex === null ? null : hashString(text.slice(-HASH_WINDOW_CHARS)),
		hasInstructionsTag: text.includes('<instructions>'),
		hasSkillsTag: text.includes('<skills>'),
		hasAgentsTag: text.includes('<agents>'),
		skillTagCount: countLiteral(text, '<skill>'),
		agentTagCount: countLiteral(text, '<agent>'),
		...customizations,
	};
}

function summarizeVscodeCustomizations(
	messages: readonly vscode.LanguageModelChatRequestMessage[],
): CustomizationsSummary {
	let customizationsUpdateCountInHistory = 0;
	let latestUserMessageIndex: number | null = null;
	let latestUserHasCustomizationsUpdate = false;

	for (const [index, message] of messages.entries()) {
		const text = getVscodeMessageText(message);
		customizationsUpdateCountInHistory += countLiteral(text, '<customizationsUpdate>');
		if (message.role === vscode.LanguageModelChatMessageRole.User) {
			latestUserMessageIndex = index;
			latestUserHasCustomizationsUpdate = text.includes('<customizationsUpdate>');
		}
	}

	return {
		customizationsUpdateCountInHistory,
		latestUserMessageIndex,
		latestUserHasCustomizationsUpdate,
	};
}

function summarizeDeepSeekCustomizations(
	messages: readonly DeepSeekMessage[],
): CustomizationsSummary {
	let customizationsUpdateCountInHistory = 0;
	let latestUserMessageIndex: number | null = null;
	let latestUserHasCustomizationsUpdate = false;

	for (const [index, message] of messages.entries()) {
		const text = message.content ?? '';
		customizationsUpdateCountInHistory += countLiteral(text, '<customizationsUpdate>');
		if (message.role === 'user') {
			latestUserMessageIndex = index;
			latestUserHasCustomizationsUpdate = text.includes('<customizationsUpdate>');
		}
	}

	return {
		customizationsUpdateCountInHistory,
		latestUserMessageIndex,
		latestUserHasCustomizationsUpdate,
	};
}

function summarizeHostSettings(): HostSettingsSummary {
	return {
		copilotFreezeCustomizationsIndex: getBooleanSetting(
			'github.copilot.chat',
			'freezeCustomizationsIndex',
		),
		chatUtilityModel: getStringSetting('chat', 'utilityModel'),
		chatUtilitySmallModel: getStringSetting('chat', 'utilitySmallModel'),
		chatPlanAgentDefaultModel: getStringSetting('chat', 'planAgent.defaultModel'),
		chatExploreAgentDefaultModel: getStringSetting('chat', 'exploreAgent.defaultModel'),
		copilotAskAgentModel: getStringSetting('github.copilot.chat', 'askAgent.model'),
		copilotImplementAgentModel: getStringSetting('github.copilot.chat', 'implementAgent.model'),
		copilotExploreAgentModel: getStringSetting('github.copilot.chat', 'exploreAgent.model'),
	};
}

function getVscodeMessageText(message: vscode.LanguageModelChatRequestMessage): string {
	let text = '';
	for (const part of message.content) {
		if (part instanceof vscode.LanguageModelTextPart) {
			text += part.value;
		}
	}
	return text;
}

function getBooleanSetting(section: string, key: string): boolean | 'unknown' {
	const value = vscode.workspace.getConfiguration(section).get<unknown>(key);
	return typeof value === 'boolean' ? value : 'unknown';
}

function getStringSetting(section: string, key: string): string | 'unknown' {
	const value = vscode.workspace.getConfiguration(section).get<unknown>(key);
	return typeof value === 'string' ? value : 'unknown';
}

function summarizeTools(tools: readonly vscode.LanguageModelChatTool[] | undefined): ToolSummary {
	const toolNames = getToolNames(tools);
	const activateToolNames = getActivateToolNames(toolNames);
	return {
		toolCount: toolNames.length,
		toolNames,
		activateToolCount: activateToolNames.length,
		activateToolNames,
	};
}

function summarizeRequestOptions(options: vscode.ProvideLanguageModelChatResponseOptions): object {
	const providerOptions = options as ProviderRequestOptions;
	const modelOptions = sanitizeJsonValue(options.modelOptions);
	const modelConfiguration = sanitizeJsonValue(providerOptions.modelConfiguration);
	return {
		optionKeys: Object.keys(options).sort(),
		requestInitiator: sanitizeJsonValue(providerOptions.requestInitiator),
		toolMode: formatToolMode(options.toolMode),
		modelOptions,
		modelOptionsKeys: getObjectKeys(modelOptions),
		modelConfiguration,
		modelConfigurationKeys: getObjectKeys(modelConfiguration),
	};
}

function getObjectKeys(value: unknown): string[] | undefined {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return undefined;
	}
	return Object.keys(value).sort();
}

function getToolNames(tools: readonly vscode.LanguageModelChatTool[] | undefined): string[] {
	return tools?.map((tool) => tool.name) ?? [];
}

function getActivateToolNames(toolNames: readonly string[]): string[] {
	return toolNames.filter((name) => name.startsWith(ACTIVATE_TOOL_PREFIX));
}

function formatActivateToolNames(toolNames: readonly string[]): string {
	if (toolNames.length === 0) {
		return '';
	}
	const shown = toolNames.slice(0, 5).join(',');
	const suffix = toolNames.length > 5 ? `,+${toolNames.length - 5}` : '';
	return ` names=${shown}${suffix}`;
}

function getContentPartTextChars(part: SerializedContentPart): number {
	if (part.type === 'text') return part.chars;
	if (part.type === 'toolResult') {
		return part.contentParts.reduce((sum, item) => sum + getContentPartTextChars(item), 0);
	}
	return 0;
}

function getContentPartDataBytes(part: SerializedContentPart): number {
	if (part.type === 'data') return part.byteLength;
	if (part.type === 'toolResult') {
		return part.contentParts.reduce((sum, item) => sum + getContentPartDataBytes(item), 0);
	}
	return 0;
}

function flattenContentParts(parts: readonly SerializedContentPart[]): SerializedContentPart[] {
	const flattened: SerializedContentPart[] = [];
	for (const part of parts) {
		flattened.push(part);
		if (part.type === 'toolResult') {
			flattened.push(...flattenContentParts(part.contentParts));
		}
	}
	return flattened;
}

function formatRole(role: vscode.LanguageModelChatMessageRole): string {
	if (role === vscode.LanguageModelChatMessageRole.User) return 'user';
	if (role === vscode.LanguageModelChatMessageRole.Assistant) return 'assistant';
	if (role === LANGUAGE_MODEL_CHAT_SYSTEM_ROLE) return 'system';
	return String(role);
}

function formatToolMode(mode: vscode.LanguageModelChatToolMode): string {
	if (mode === vscode.LanguageModelChatToolMode.Auto) return 'auto';
	if (mode === vscode.LanguageModelChatToolMode.Required) return 'required';
	return String(mode);
}

function sanitizeJsonValue(value: unknown): unknown {
	const seen = new WeakSet<object>();
	return JSON.parse(
		JSON.stringify(value, (_key, entryValue: unknown) => {
			if (typeof entryValue === 'string') {
				return toWellFormedString(entryValue);
			}
			if (typeof entryValue === 'bigint') {
				return `${entryValue.toString()}n`;
			}
			if (entryValue instanceof Uint8Array) {
				return {
					type: 'Uint8Array',
					byteLength: entryValue.byteLength,
					sha256: hashBytes(entryValue),
				};
			}
			if (entryValue && typeof entryValue === 'object') {
				if (seen.has(entryValue)) {
					return '[Circular]';
				}
				seen.add(entryValue);
			}
			return entryValue;
		}) ?? 'null',
	) as unknown;
}

function getConstructorName(value: unknown): string | undefined {
	if (!value || typeof value !== 'object') {
		return undefined;
	}
	const constructorName = (value as { constructor?: { name?: string } }).constructor?.name;
	return constructorName || undefined;
}

function hashString(value: string): string {
	return createHash('sha256').update(value).digest('hex');
}

function hashBytes(value: Uint8Array): string {
	return createHash('sha256').update(value).digest('hex');
}

function countLines(value: string): number {
	if (!value) {
		return 0;
	}
	return value.split('\n').length;
}

function countLiteral(value: string, literal: string): number {
	if (!value || !literal) {
		return 0;
	}

	let count = 0;
	let index = 0;
	while (true) {
		index = value.indexOf(literal, index);
		if (index < 0) {
			break;
		}
		count += 1;
		index += literal.length;
	}
	return count;
}

async function writeJsonFile<T>(
	filePath: string,
	value: T,
	stringify: (value: T) => string = safeStringify,
): Promise<string> {
	const content = stringify(value);
	await writeFile(filePath, content, 'utf-8');
	return content;
}

async function writeTextFile(filePath: string, content: string): Promise<void> {
	await writeFile(filePath, content, 'utf-8');
}

async function writeDumpObservation(
	globalStorageUri: vscode.Uri,
	observation: object,
): Promise<void> {
	const baseRoot = getRequestDumpBaseRoot(globalStorageUri);
	await mkdir(baseRoot, { recursive: true });
	await appendFile(
		join(baseRoot, REQUEST_OBSERVATIONS_FILE),
		`${safeStringify(observation)}\n`,
		'utf-8',
	);
}

function enqueueDumpWrite(label: string, write: () => Promise<void>): void {
	dumpWriteQueue = dumpWriteQueue.then(write, write).catch((err) => {
		logger.warn(`${label} write failed`, err);
	});
}

function formatFileUri(fsPath: string): string {
	return vscode.Uri.file(fsPath).toString();
}

function logProviderInputDump(
	options: DumpProviderInputOptions,
	paths: ProviderInputDumpPaths,
	toolSummary: ToolSummary,
	requestKind: RequestKind,
): void {
	const systemPromptSummary = summarizeVscodeSystemPrompt(options.messages);
	logger.debug(
		formatRequestLogLine(
			requestKind,
			`providerInputDump written: ${formatDumpSegment(options.segment)}` +
				` ${formatModelFields(options.modelInfo.id)}` +
				` input=${formatFileUri(paths.providerInput)} ` +
				`(${options.messages.length} msgs, ${toolSummary.toolCount} tools, ` +
				`activateTools=${toolSummary.activateToolCount}${formatActivateToolNames(
					toolSummary.activateToolNames,
				)}) ` +
				formatHostSettingsSummary(summarizeHostSettings()) +
				` ${formatSystemPromptSummary(systemPromptSummary)}`,
		),
	);
}

function logRequestDump(
	request: DeepSeekRequest,
	options: DumpDeepSeekRequestOptions,
	paths: RequestDumpPaths,
	requestJsonLength: number,
	requestKind: RequestKind,
): void {
	const systemPromptSummary = summarizeDeepSeekSystemPrompt(request.messages);
	logger.debug(
		formatRequestLogLine(
			requestKind,
			`requestDump written: ${formatDumpSegment(options.segment)}` +
				` ${formatModelFields(options.vscodeModelId, request.model)}` +
				` request=${formatFileUri(paths.request)} ` +
				`input=${formatFileUri(paths.input)} resolved=${formatFileUri(paths.resolved)} ` +
				`(${request.messages.length} msgs, ${request.tools?.length ?? 0} tools, ` +
				`~${(requestJsonLength / 1024).toFixed(0)} KB) ` +
				formatHostSettingsSummary(summarizeHostSettings()) +
				` ${formatSystemPromptSummary(systemPromptSummary)}`,
		),
	);
}

function formatDumpSegment(segment: ConversationSegment): string {
	if (segment.reason === 'markerFound') {
		return `dumpSegment=${segment.segmentId} legacySegmentMarker=found`;
	}
	if (segment.reason === 'markerInvalid') {
		const markerLocation =
			segment.markerMessageIndex === undefined || segment.markerPartIndex === undefined
				? ''
				: ` at=message#${segment.markerMessageIndex}:part#${segment.markerPartIndex}`;
		const markerError = segment.markerError ? ` error=${segment.markerError}` : '';
		return `dumpSegment=${segment.segmentId} legacySegmentMarker=invalid${markerLocation}${markerError}`;
	}
	return `dumpSegment=${segment.segmentId}`;
}

function formatHostSettingsSummary(settings: HostSettingsSummary): string {
	return (
		`hostFreezeCustomizationsIndex=${settings.copilotFreezeCustomizationsIndex}` +
		` chatUtilityModel=${formatSettingValue(settings.chatUtilityModel)}` +
		` chatUtilitySmallModel=${formatSettingValue(settings.chatUtilitySmallModel)}` +
		` chatPlanAgentDefaultModel=${formatSettingValue(settings.chatPlanAgentDefaultModel)}` +
		` chatExploreAgentDefaultModel=${formatSettingValue(settings.chatExploreAgentDefaultModel)}` +
		` copilotAskAgentModel=${formatSettingValue(settings.copilotAskAgentModel)}` +
		` copilotImplementAgentModel=${formatSettingValue(settings.copilotImplementAgentModel)}` +
		` copilotExploreAgentModel=${formatSettingValue(settings.copilotExploreAgentModel)}`
	);
}

function formatSettingValue(value: string | 'unknown'): string {
	if (value === '') return 'empty';
	if (value === 'unknown') return 'unknown';
	return safeStringify(value);
}

function formatSystemPromptSummary(summary: SystemPromptSummary): string {
	if (summary.messageIndex === null) {
		return 'systemPrompt=none';
	}

	return (
		`systemPrompt#${summary.messageIndex}:${summary.role}` +
		`:chars=${summary.chars}` +
		`:lines=${summary.lines}` +
		`:hash=${formatShortHash(summary.hash)}` +
		`:skills=${formatBoolean(summary.hasSkillsTag)}(${summary.skillTagCount})` +
		`:agents=${formatBoolean(summary.hasAgentsTag)}(${summary.agentTagCount})` +
		`:customizationsUpdate=${summary.customizationsUpdateCountInHistory}` +
		`:latestUser#${summary.latestUserMessageIndex ?? 'none'}=` +
		formatBoolean(summary.latestUserHasCustomizationsUpdate)
	);
}

function formatShortHash(value: string | null): string {
	return value ? value.slice(0, 12) : 'none';
}

function formatBoolean(value: boolean): 'yes' | 'no' {
	return value ? 'yes' : 'no';
}

function getRequestDumpRoot(globalStorageUri: vscode.Uri, segment?: ConversationSegment): string {
	const baseRoot = getRequestDumpBaseRoot(globalStorageUri);
	return segment ? join(baseRoot, segment.segmentId) : baseRoot;
}

function getRequestDumpBaseRoot(globalStorageUri: vscode.Uri): string {
	return getRequestDumpBaseRootUri(globalStorageUri).fsPath;
}

function getRequestDumpBaseRootUri(globalStorageUri: vscode.Uri): vscode.Uri {
	if (globalStorageUri.fsPath) {
		return vscode.Uri.joinPath(globalStorageUri, 'request-dumps');
	}

	return vscode.Uri.file(join(tmpdir(), 'deepseek-request-dumps'));
}
