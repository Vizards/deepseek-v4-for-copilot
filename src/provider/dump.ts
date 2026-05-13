import { createHash } from 'crypto';
import { appendFileSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import vscode from 'vscode';
import { getRequestDumpEnabled } from '../config';
import { safeStringify, toWellFormedString } from '../json';
import { logger } from '../logger';
import type { DeepSeekRequest } from '../types';
import { parseSegmentMarkerData, SEGMENT_MARKER_MIME, type ConversationSegment } from './segment';
import type { VisionDescriptionCacheStats } from './vision/index';

let dumpCounter = 0;
let providerInputDumpCounter = 0;

const ACTIVATE_TOOL_PREFIX = 'activate_';
const REQUEST_OBSERVATIONS_FILE = '_request-observations.jsonl';

export interface DumpDeepSeekRequestOptions {
	globalStorageUri: vscode.Uri;
	segment: ConversationSegment;
	vscodeModelId: string;
	isThinkingModel: boolean;
	thinkingEffort: string;
	maxTokens: number | undefined;
	inputMessages: readonly vscode.LanguageModelChatRequestMessage[];
	resolvedMessages: readonly vscode.LanguageModelChatRequestMessage[];
	requestOptions: vscode.ProvideLanguageModelChatResponseOptions;
	visionModelId?: string;
	visionCacheStats?: VisionDescriptionCacheStats;
}

export interface DumpProviderInputOptions {
	globalStorageUri: vscode.Uri;
	segment: ConversationSegment;
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

	const root = getRequestDumpRoot(options.globalStorageUri, options.segment);

	try {
		const seq = (providerInputDumpCounter += 1);
		const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
		const basename = `deepseek-provider-input-${timestamp}-${String(seq).padStart(4, '0')}`;
		mkdirSync(root, { recursive: true });

		const inputPath = join(root, `${basename}.json`);
		const snapshot = createProviderInputSnapshot(options, timestamp, basename);
		writeFileSync(inputPath, safeStringify(snapshot), 'utf-8');

		const toolNames = getToolNames(options.requestOptions.tools);
		const activateToolNames = getActivateToolNames(toolNames);
		writeDumpObservation(options.globalStorageUri, {
			event: 'provider-input',
			timestamp,
			basename,
			segment: options.segment,
			paths: {
				directory: root,
				providerInput: inputPath,
			},
			model: {
				vscodeModelId: options.modelInfo.id,
			},
			options: summarizeRequestOptions(options.requestOptions),
			messageStats: summarizeMessagesFromInput(options.messages),
			toolStats: summarizeTools(options.requestOptions.tools),
		});
		logger.info(
			`providerInputDump written: segment=${options.segment.segmentId}` +
				` reason=${options.segment.reason} input=${inputPath} ` +
				`(${options.messages.length} msgs, ${toolNames.length} tools, ` +
				`activateTools=${activateToolNames.length}${formatActivateToolNames(activateToolNames)})`,
		);
	} catch (err) {
		// best-effort; never let a dump write break the request pipeline
		logger.warn('providerInputDump write failed', err);
	}
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

	const root = getRequestDumpRoot(options.globalStorageUri, options.segment);

	try {
		const seq = (dumpCounter += 1);
		const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
		const basename = `deepseek-request-${timestamp}-${String(seq).padStart(4, '0')}`;
		mkdirSync(root, { recursive: true });

		const inputPath = join(root, `${basename}.input.json`);
		const inputSnapshot = createPipelineSnapshot(
			'input',
			timestamp,
			basename,
			request,
			options.inputMessages,
			options,
		);
		writeFileSync(inputPath, safeStringify(inputSnapshot), 'utf-8');

		const resolvedPath = join(root, `${basename}.resolved.json`);
		const resolvedSnapshot = createPipelineSnapshot(
			'resolved',
			timestamp,
			basename,
			request,
			options.resolvedMessages,
			options,
		);
		writeFileSync(resolvedPath, safeStringify(resolvedSnapshot), 'utf-8');

		// Full request JSON
		const jsonPath = join(root, `${basename}.json`);
		writeFileSync(jsonPath, JSON.stringify(request, null, 2), 'utf-8');

		// messages[0] sidecar — so you can check whether the system prompt changed
		const msg0 = request.messages[0];
		if (msg0) {
			const msg0Path = join(root, `${basename}.msg0.txt`);
			writeFileSync(msg0Path, msg0.content, 'utf-8');
		}

		writeDumpObservation(options.globalStorageUri, {
			event: 'deepseek-request',
			timestamp,
			basename,
			segment: options.segment,
			paths: {
				directory: root,
				input: inputPath,
				resolved: resolvedPath,
				request: jsonPath,
				msg0: msg0 ? join(root, `${basename}.msg0.txt`) : undefined,
			},
			model: {
				vscodeModelId: options.vscodeModelId,
				apiModelId: request.model,
			},
			options: summarizeRequestOptions(options.requestOptions),
			messageStats: summarizeMessagesFromInput(options.inputMessages),
			toolStats: summarizeTools(options.requestOptions.tools),
		});
		logger.info(
			`requestDump written: segment=${options.segment.segmentId}` +
				` reason=${options.segment.reason} request=${jsonPath} ` +
				`input=${inputPath} resolved=${resolvedPath} ` +
				`(${request.messages.length} msgs, ${request.tools?.length ?? 0} tools, ` +
				`~${(JSON.stringify(request).length / 1024).toFixed(0)} KB)`,
		);
	} catch (err) {
		// best-effort; never let a dump write break the request pipeline
		logger.warn('requestDump write failed', err);
	}
}

export function ensureRequestDumpRoot(globalStorageUri: vscode.Uri): string {
	const root = getRequestDumpRoot(globalStorageUri);
	mkdirSync(root, { recursive: true });
	return root;
}

function createProviderInputSnapshot(
	options: DumpProviderInputOptions,
	timestamp: string,
	basename: string,
): object {
	const serializedMessages = options.messages.map((message, index) =>
		serializeMessage(message, index),
	);
	return {
		stage: 'provider-input',
		timestamp,
		basename,
		segment: options.segment,
		model: {
			vscodeModelId: options.modelInfo.id,
			name: options.modelInfo.name,
			family: options.modelInfo.family,
			version: options.modelInfo.version,
			maxInputTokens: options.modelInfo.maxInputTokens,
			maxOutputTokens: options.modelInfo.maxOutputTokens,
			capabilities: sanitizeJsonValue(options.modelInfo.capabilities),
		},
		options: summarizeRequestOptions(options.requestOptions),
		messageStats: summarizeMessages(serializedMessages),
		messages: serializedMessages,
		toolStats: summarizeTools(options.requestOptions.tools),
		tools: serializeTools(options.requestOptions.tools),
	};
}

function createPipelineSnapshot(
	stage: 'input' | 'resolved',
	timestamp: string,
	basename: string,
	request: DeepSeekRequest,
	messages: readonly vscode.LanguageModelChatRequestMessage[],
	options: DumpDeepSeekRequestOptions,
): object {
	const serializedMessages = messages.map((message, index) => serializeMessage(message, index));
	return {
		stage,
		timestamp,
		basename,
		segment: options.segment,
		model: {
			vscodeModelId: options.vscodeModelId,
			apiModelId: request.model,
			isThinkingModel: options.isThinkingModel,
			thinkingEffort: options.thinkingEffort,
			maxTokens: options.maxTokens ?? null,
		},
		options: summarizeRequestOptions(options.requestOptions),
		vision:
			stage === 'resolved'
				? {
						modelId: options.visionModelId ?? null,
						stats: options.visionCacheStats ?? null,
					}
				: undefined,
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
			segmentMarker?: {
				valid: boolean;
				segmentId?: string;
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
		return {
			index,
			type: 'text',
			value: toWellFormedString(part.value),
			chars: part.value.length,
			hash: hashString(part.value),
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
		const segmentMarker =
			part.mimeType === SEGMENT_MARKER_MIME ? parseSegmentMarkerData(part.data) : undefined;
		return {
			index,
			type: 'data',
			mimeType: part.mimeType,
			byteLength: part.data.byteLength,
			dataHash: hashBytes(part.data),
			isImage: part.mimeType.toLowerCase().startsWith('image/'),
			segmentMarker,
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

function summarizeTools(tools: readonly vscode.LanguageModelChatTool[] | undefined): object {
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
	const modelOptions = sanitizeJsonValue(options.modelOptions);
	return {
		optionKeys: Object.keys(options).sort(),
		toolMode: formatToolMode(options.toolMode),
		modelOptions,
		modelOptionsKeys: getObjectKeys(modelOptions),
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

function writeDumpObservation(globalStorageUri: vscode.Uri, observation: object): void {
	const baseRoot = getRequestDumpBaseRoot(globalStorageUri);
	mkdirSync(baseRoot, { recursive: true });
	appendFileSync(
		join(baseRoot, REQUEST_OBSERVATIONS_FILE),
		`${safeStringify(observation)}\n`,
		'utf-8',
	);
}

function getRequestDumpRoot(globalStorageUri: vscode.Uri, segment?: ConversationSegment): string {
	const baseRoot = getRequestDumpBaseRoot(globalStorageUri);
	return segment ? join(baseRoot, segment.segmentId) : baseRoot;
}

function getRequestDumpBaseRoot(globalStorageUri: vscode.Uri): string {
	if (globalStorageUri.fsPath) {
		return join(globalStorageUri.fsPath, 'request-dumps');
	}

	return join(tmpdir(), 'deepseek-request-dumps');
}
