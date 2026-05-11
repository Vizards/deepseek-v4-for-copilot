import { createHash } from 'crypto';
import { appendFileSync, mkdirSync, writeFileSync } from 'fs';
import { homedir, tmpdir } from 'os';
import { isAbsolute, join } from 'path';
import vscode from 'vscode';
import { getRequestDumpDirectory, getRequestDumpEnabled } from '../config';
import { safeStringify, toWellFormedString } from '../json';
import { logger } from '../logger';
import type { DeepSeekRequest } from '../types';
import type { VisionDescriptionCacheStats } from './vision/index';

let dumpCounter = 0;
let providerInputDumpCounter = 0;

const ACTIVATE_TOOL_PREFIX = 'activate_';
const UNKNOWN_SESSION_DIR = 'unknown-session';
const TARGET_SESSION_LOG_VARIABLE = 'VSCODE_TARGET_SESSION_LOG';
const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const SESSION_REFERENCE_SCHEMES = new Set(['vscode-chat-session', 'copilotcli', 'claude-code']);
const OBSERVATIONS_FILE = '_session-observations.jsonl';

export interface DumpDeepSeekRequestOptions {
	globalStorageUri: vscode.Uri;
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

	const session = extractSessionInfo(options.messages);
	const root = getRequestDumpRoot(options.globalStorageUri, session);

	try {
		const seq = (providerInputDumpCounter += 1);
		const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
		const basename = `deepseek-provider-input-${timestamp}-${String(seq).padStart(4, '0')}`;
		mkdirSync(root, { recursive: true });

		const inputPath = join(root, `${basename}.json`);
		const snapshot = createProviderInputSnapshot(options, timestamp, basename, session);
		writeFileSync(inputPath, safeStringify(snapshot), 'utf-8');

		const toolNames = getToolNames(options.requestOptions.tools);
		const activateToolNames = getActivateToolNames(toolNames);
		writeDumpObservation(options.globalStorageUri, {
			event: 'provider-input',
			timestamp,
			basename,
			session,
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
			`providerInputDump written: session=${session.id ?? 'unknown'} input=${inputPath} ` +
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
 * when debugMode is `requestDump`. No truncation, no hashing - you get the
 * exact JSON that will be sent to the DeepSeek API (minus the auth header).
 *
 * Files land under `<dump root>/session-<uuid>/` when Copilot exposes a session
 * id in message[0], or `<dump root>/unknown-session/` as a fallback:
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

	const session = extractSessionInfo(options.inputMessages);
	const root = getRequestDumpRoot(options.globalStorageUri, session);

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
			session,
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
			session,
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
			session,
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
			`promptDump written: session=${session.id ?? 'unknown'} request=${jsonPath} ` +
				`input=${inputPath} resolved=${resolvedPath} ` +
				`(${request.messages.length} msgs, ${request.tools?.length ?? 0} tools, ` +
				`~${(JSON.stringify(request).length / 1024).toFixed(0)} KB)`,
		);
	} catch (err) {
		// best-effort; never let a dump write break the request pipeline
		logger.warn('promptDump write failed', err);
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
	session: SessionInfo,
): object {
	const serializedMessages = options.messages.map((message, index) =>
		serializeMessage(message, index),
	);
	return {
		stage: 'provider-input',
		timestamp,
		basename,
		session,
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
	session: SessionInfo,
): object {
	const serializedMessages = messages.map((message, index) => serializeMessage(message, index));
	return {
		stage,
		timestamp,
		basename,
		session,
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
		return {
			index,
			type: 'data',
			mimeType: part.mimeType,
			byteLength: part.data.byteLength,
			dataHash: hashBytes(part.data),
			isImage: part.mimeType.toLowerCase().startsWith('image/'),
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

interface SessionInfo {
	id: string | undefined;
	ids: string[];
	directoryName: string;
	targetSessionLog: string | undefined;
	targetSessionLogLine: string | undefined;
	source: typeof TARGET_SESSION_LOG_VARIABLE | 'fallback';
	message0: {
		textChars: number;
		hash: string;
		hasTargetSessionLog: boolean;
		hasTargetSessionLogValue: boolean;
		hasSessionReferenceAttachment: boolean;
	};
	messageStats: {
		count: number;
		textChars: number;
		textHashes: string[];
		sessionReferenceAttachmentMessageIndexes: number[];
	};
	sessionReferenceAttachments: SessionReferenceAttachment[];
	relationship: {
		inferredCase:
			| 'session-reference-target'
			| 'session-reference-without-target-log'
			| 'multiple-targets'
			| 'single-target'
			| 'unknown';
		targetMatchesAttachedSession: boolean;
		targetSessionLogHasMultipleIds: boolean;
	};
}

interface SessionReferenceAttachment {
	messageIndex: number;
	uri: string;
	scheme: string | undefined;
	idText: string | undefined;
	decodedSessionId: string | undefined;
	uuidValues: string[];
}

function extractSessionInfo(
	messages: readonly vscode.LanguageModelChatRequestMessage[],
): SessionInfo {
	const messageTexts = messages.map((message) => getMessageText(message));
	const message0Text = getMessageText(messages[0]);
	const targetSessionLogInfo = extractTargetSessionLog(message0Text);
	const targetSessionLog = targetSessionLogInfo.value;
	const ids = targetSessionLog ? extractUuidValues(targetSessionLog) : [];
	const id = ids[0];
	const sessionReferenceAttachments = messageTexts.flatMap((text, messageIndex) =>
		extractSessionReferenceAttachments(text, messageIndex),
	);
	const sessionReferenceIds = sessionReferenceAttachments.flatMap((attachment) => [
		...(attachment.decodedSessionId ? [attachment.decodedSessionId] : []),
		...attachment.uuidValues,
	]);
	const targetMatchesAttachedSession = ids.some((targetId) =>
		sessionReferenceIds.includes(targetId),
	);
	const targetSessionLogHasMultipleIds = ids.length > 1;

	return {
		id,
		ids,
		directoryName: id ? `session-${id}` : UNKNOWN_SESSION_DIR,
		targetSessionLog,
		targetSessionLogLine: targetSessionLogInfo.line,
		source: id ? TARGET_SESSION_LOG_VARIABLE : 'fallback',
		message0: {
			textChars: message0Text.length,
			hash: hashString(message0Text),
			hasTargetSessionLog: targetSessionLogInfo.present,
			hasTargetSessionLogValue: targetSessionLog !== undefined,
			hasSessionReferenceAttachment: sessionReferenceAttachments.some(
				(attachment) => attachment.messageIndex === 0,
			),
		},
		messageStats: {
			count: messages.length,
			textChars: messageTexts.reduce((sum, text) => sum + text.length, 0),
			textHashes: messageTexts.map((text) => hashString(text)),
			sessionReferenceAttachmentMessageIndexes: [
				...new Set(sessionReferenceAttachments.map((attachment) => attachment.messageIndex)),
			],
		},
		sessionReferenceAttachments,
		relationship: {
			inferredCase: inferSessionCase(
				ids,
				sessionReferenceAttachments,
				targetMatchesAttachedSession,
			),
			targetMatchesAttachedSession,
			targetSessionLogHasMultipleIds,
		},
	};
}

function inferSessionCase(
	ids: readonly string[],
	sessionReferenceAttachments: readonly SessionReferenceAttachment[],
	targetMatchesAttachedSession: boolean,
): SessionInfo['relationship']['inferredCase'] {
	if (targetMatchesAttachedSession && sessionReferenceAttachments.length > 0) {
		return 'session-reference-target';
	}
	if (ids.length > 1) {
		return 'multiple-targets';
	}
	if (ids.length === 1) {
		return 'single-target';
	}
	if (sessionReferenceAttachments.length > 0) {
		return 'session-reference-without-target-log';
	}
	return 'unknown';
}

function getMessageText(message: vscode.LanguageModelChatRequestMessage | undefined): string {
	if (!message) {
		return '';
	}

	let text = '';
	for (const part of message.content) {
		if (part instanceof vscode.LanguageModelTextPart) {
			text += part.value;
		}
	}
	return text;
}

function extractTargetSessionLog(text: string): {
	present: boolean;
	line: string | undefined;
	value: string | undefined;
} {
	const marker = `${TARGET_SESSION_LOG_VARIABLE}:`;
	const line = text.split(/\r?\n/).find((entry) => entry.includes(marker));
	if (!line) {
		return { present: false, line: undefined, value: undefined };
	}

	const value = line.slice(line.indexOf(marker) + marker.length).trim();
	return { present: true, line, value: value || undefined };
}

function extractUuidValues(value: string): string[] {
	const matches = value.match(UUID_PATTERN) ?? [];
	return [...new Set(matches.map((match) => match.toLowerCase()))];
}

function extractSessionReferenceAttachments(
	text: string,
	messageIndex: number,
): SessionReferenceAttachment[] {
	const attachments: SessionReferenceAttachment[] = [];
	const attachmentPattern = /<attachment\b[^>]*>/gi;
	let match: RegExpExecArray | null;
	while ((match = attachmentPattern.exec(text)) !== null) {
		const tag = match[0];
		const uriText = extractAttributeValue(tag, 'filePath');
		if (!uriText) {
			continue;
		}
		const uri = parseUri(uriText);
		if (!uri || !SESSION_REFERENCE_SCHEMES.has(uri.scheme)) {
			continue;
		}
		const decodedSessionId = decodeSessionResourceId(uri);
		attachments.push({
			messageIndex,
			uri: uri.toString(),
			scheme: uri.scheme,
			idText: extractAttributeValue(tag, 'id'),
			decodedSessionId,
			uuidValues: extractUuidValues(uri.toString()),
		});
	}
	return attachments;
}

function extractAttributeValue(tag: string, name: string): string | undefined {
	const pattern = new RegExp(`\\b${escapeRegExp(name)}=(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');
	const match = pattern.exec(tag);
	const value = match?.[1] ?? match?.[2] ?? match?.[3];
	return value === undefined ? undefined : decodeHtmlAttribute(value);
}

function decodeHtmlAttribute(value: string): string {
	return value
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&apos;/g, "'")
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&amp;/g, '&');
}

function parseUri(value: string): vscode.Uri | undefined {
	try {
		return vscode.Uri.parse(value);
	} catch {
		return undefined;
	}
}

function decodeSessionResourceId(uri: vscode.Uri): string | undefined {
	const rawId = getLastUriPathSegment(uri);
	if (!rawId) {
		return undefined;
	}
	if (uri.scheme !== 'vscode-chat-session') {
		return rawId;
	}
	try {
		return Buffer.from(rawId, 'base64url').toString('utf8') || undefined;
	} catch {
		return undefined;
	}
}

function getLastUriPathSegment(uri: vscode.Uri): string | undefined {
	return uri.path.split('/').filter(Boolean).at(-1);
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function writeDumpObservation(globalStorageUri: vscode.Uri, observation: object): void {
	const baseRoot = getRequestDumpBaseRoot(globalStorageUri);
	mkdirSync(baseRoot, { recursive: true });
	appendFileSync(join(baseRoot, OBSERVATIONS_FILE), `${safeStringify(observation)}\n`, 'utf-8');
}

function getRequestDumpRoot(globalStorageUri: vscode.Uri, session?: SessionInfo): string {
	const baseRoot = getRequestDumpBaseRoot(globalStorageUri);
	return session ? join(baseRoot, session.directoryName) : baseRoot;
}

function getRequestDumpBaseRoot(globalStorageUri: vscode.Uri): string {
	const configuredDirectory = getRequestDumpDirectory();
	if (configuredDirectory) {
		return resolveConfiguredDirectory(configuredDirectory);
	}

	if (globalStorageUri.fsPath) {
		return join(globalStorageUri.fsPath, 'request-dumps');
	}

	return join(tmpdir(), 'deepseek-prompt-dumps');
}

function resolveConfiguredDirectory(directory: string): string {
	if (directory === '~') {
		return homedir();
	}
	if (directory.startsWith(`~/`)) {
		return join(homedir(), directory.slice(2));
	}
	if (isAbsolute(directory)) {
		return directory;
	}

	const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
	if (workspaceFolder) {
		return join(workspaceFolder.uri.fsPath, directory);
	}
	return join(homedir(), directory);
}
