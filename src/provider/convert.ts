import vscode from 'vscode';
import { COPILOT_USAGE_DATA_PART_MIME, HOST_CACHE_CONTROL_DATA_PART_MIME } from '../consts';
import { safeStringify } from '../json';
import { logger } from '../logger';
import type {
	DeepSeekContentPart,
	DeepSeekMessage,
	DeepSeekTool,
	DeepSeekToolCall,
} from '../types';
import { parseFirstReplayMarker, REPLAY_MARKER_MIME } from './replay';
import {
	isImageDataPart,
	normalizeToolResult,
	type NormalizedToolResult,
} from './vision/normalize';

/**
 * Convert VS Code chat messages to DeepSeek format.
 * Injects marker-replayed reasoning_content for assistant messages.
 */
export function convertMessages(
	messages: readonly vscode.LanguageModelChatRequestMessage[],
	isThinkingModel: boolean,
	nativeImageInput: boolean,
): DeepSeekMessage[] {
	const result: DeepSeekMessage[] = [];

	for (const message of messages) {
		const role = mapRole(message.role);

		let content = '';
		const nativeVisionContentParts: DeepSeekContentPart[] = [];
		let thinkingContent = '';
		const toolCalls: DeepSeekToolCall[] = [];
		const toolResults: NormalizedToolResult[] = [];

		for (const part of message.content) {
			if (part instanceof vscode.LanguageModelTextPart) {
				content += part.value;
				if (nativeImageInput && role === 'user') {
					nativeVisionContentParts.push({
						type: 'text',
						text: part.value,
					});
				}
			} else if (nativeImageInput && role === 'user' && isImageDataPart(part)) {
				nativeVisionContentParts.push({
					type: 'image_url',
					image_url: {
						url: toImageDataUrl(part),
					},
				});
			} else if (isLanguageModelThinkingPart(part)) {
				thinkingContent += normalizeThinkingPartText(part.value);
			} else if (part instanceof vscode.LanguageModelToolCallPart) {
				toolCalls.push({
					id: part.callId,
					type: 'function',
					function: {
						name: part.name,
						arguments: safeStringify(part.input),
					},
				});
			} else if (part instanceof vscode.LanguageModelToolResultPart) {
				toolResults.push(normalizeToolResult(part));
			} else {
				reportUnconsumedPart(part);
			}
		}

		if (role === 'assistant') {
			if (content || toolCalls.length > 0) {
				const replayMarker = isThinkingModel ? parseFirstReplayMarker(message) : undefined;
				const msg: DeepSeekMessage = {
					role: 'assistant' as const,
					content: content || '',
				};

				if (toolCalls.length > 0) {
					msg.tool_calls = toolCalls;
				}

				if (isThinkingModel) {
					msg.reasoning_content = getReasoningContent(replayMarker, thinkingContent);
				}

				result.push(msg);
			}
		} else {
			if (nativeImageInput && role === 'user' && nativeVisionContentParts.length > 0) {
				result.push({
					role: 'user',
					content: nativeVisionContentParts,
				});
			} else if (content) {
				result.push({
					role: role as 'user' | 'assistant',
					content: content,
				});
			}
		}

		// Tool result messages follow their associated assistant message
		for (const tr of toolResults) {
			result.push({
				role: 'tool',
				content: convertToolResultContent(tr, nativeImageInput),
				tool_call_id: tr.callId,
			});
		}
	}

	return result;
}

function toImageDataUrl(part: { mimeType: string; data: Uint8Array }): string {
	return `data:${part.mimeType};base64,${Buffer.from(part.data).toString('base64')}`;
}

function convertToolResultContent(
	toolResult: NormalizedToolResult,
	nativeImageInput: boolean,
): DeepSeekMessage['content'] {
	const hasImages = toolResult.parts.some((part) => part.type === 'image');
	if (!nativeImageInput || !hasImages) {
		const text = toolResult.parts
			.filter((part) => part.type === 'text')
			.map((part) => part.text)
			.join('');
		if (text) {
			return text;
		}

		// Do not stringify image bytes into a text-only model request. Preserve the
		// existing fallback for genuinely non-image tool-result content.
		const fallbackContent = hasImages
			? toolResult.parts.filter((part) => part.type === 'other').map((part) => part.value)
			: toolResult.originalContent;
		return fallbackContent.length > 0 ? safeStringify(fallbackContent) : '';
	}

	const content: DeepSeekContentPart[] = [];
	for (const part of toolResult.parts) {
		if (part.type === 'text') {
			content.push({ type: 'text', text: part.text });
		} else if (part.type === 'image') {
			content.push({
				type: 'image_url',
				image_url: { url: toImageDataUrl(part) },
			});
		}
	}
	return content;
}

function getReasoningContent(
	replayMarker: ReturnType<typeof parseFirstReplayMarker>,
	thinkingContent: string,
): string {
	if (replayMarker?.valid && replayMarker.reasoningText) {
		return replayMarker.reasoningText;
	}
	return thinkingContent;
}

function isLanguageModelThinkingPart(part: unknown): part is vscode.LanguageModelThinkingPart {
	return (
		typeof vscode.LanguageModelThinkingPart === 'function' &&
		part instanceof vscode.LanguageModelThinkingPart
	);
}

function normalizeThinkingPartText(value: string | string[]): string {
	return Array.isArray(value) ? value.join('') : value;
}

function mapRole(role: vscode.LanguageModelChatMessageRole): 'user' | 'assistant' {
	switch (role) {
		case vscode.LanguageModelChatMessageRole.User:
			return 'user';
		case vscode.LanguageModelChatMessageRole.Assistant:
			return 'assistant';
		default:
			return 'user';
	}
}

/**
 * Convert VS Code tool definitions to DeepSeek format.
 */
export function convertTools(
	tools: readonly vscode.LanguageModelChatTool[] | undefined,
): DeepSeekTool[] | undefined {
	if (!tools || tools.length === 0) {
		return undefined;
	}

	return tools.map((tool) => ({
		type: 'function' as const,
		function: {
			name: tool.name,
			description: tool.description,
			// Some compatible endpoints require an explicit schema for tools without parameters.
			parameters: (tool.inputSchema ?? { type: 'object', properties: {} }) as Record<
				string,
				unknown
			>,
		},
	}));
}

const reportedUnconsumedPartKinds = new Set<string>();

/**
 * Describes a part that no branch of convertMessages consumed, or returns undefined when the
 * request is not meant to carry the part. Replay markers are read separately by
 * parseFirstReplayMarker, and the two host tags arrive on ordinary requests.
 */
function describeUnconsumedPart(part: unknown): { key: string; label: string } | undefined {
	if (part instanceof vscode.LanguageModelDataPart) {
		if (part.mimeType === REPLAY_MARKER_MIME) {
			return undefined;
		}
		// The part arrives untyped here, so a missing mime type stays reportable instead of
		// throwing before the warning is written.
		const mimeType = typeof part.mimeType === 'string' ? part.mimeType.toLowerCase() : '';
		// The usage part is written by this provider on every response and comes back with
		// the next request, so dropping it is expected and not worth reporting.
		if (mimeType === COPILOT_USAGE_DATA_PART_MIME) {
			return undefined;
		}
		// The host attaches this one for its own prompt caching, so it arrives on ordinary
		// requests and its absence from the payload is not a loss the reader can act on.
		if (mimeType === HOST_CACHE_CONTROL_DATA_PART_MIME) {
			return undefined;
		}
		if (!mimeType) {
			// Outside the mime: namespace, so no real mime type can collide with this kind.
			return { key: 'mime-type-missing', label: 'data part with no mime type' };
		}
		return { key: `mime:${mimeType}`, label: `data part type "${part.mimeType}"` };
	}
	const name =
		part && typeof part === 'object'
			? ((part as { constructor?: { name?: string } }).constructor?.name ?? 'object')
			: typeof part;
	return { key: `part:${name}`, label: `part type ${name}` };
}

function reportUnconsumedPart(part: unknown): void {
	// Runs inside the message loop, so nothing here may abort the conversion: the descriptor
	// reads an untyped part and can throw on one the host has never sent before.
	try {
		const descriptor = describeUnconsumedPart(part);
		// One report per kind keeps a repeated attachment from flooding the log.
		if (!descriptor || reportedUnconsumedPartKinds.has(descriptor.key)) {
			return;
		}
		const written = logger.warn(
			`Dropped ${descriptor.label}; no converter branch carries it into the request.`,
		);
		if (!written) {
			// The channel refused the line, so the kind stays unmarked and a later request retries.
			return;
		}
		reportedUnconsumedPartKinds.add(descriptor.key);
	} catch {
		// Reporting one dropped part is never worth failing the request that carries it.
	}
}
