import { existsSync, readFileSync } from 'fs';
import { extname } from 'path';
import vscode from 'vscode';
import { safeStringify } from '../json';
import type {
	DeepSeekContentPart,
	DeepSeekMessage,
	DeepSeekTool,
	DeepSeekToolCall,
} from '../types';
import { parseFirstReplayMarker } from './replay';

interface ToolCallMetadata {
	name: string;
	input: unknown;
}

interface ToolResultImage {
	mimeType: string;
	data: Uint8Array;
}

interface CollectedToolResult {
	callId: string;
	content: string;
	images: ToolResultImage[];
}

const TOOL_RESULT_IMAGE_MESSAGE =
	'The previous tool result includes the following image(s). Use them as the actual visual content from the tool result.';

const IMAGE_EXTENSION_MIME_TYPES: Readonly<Record<string, string>> = {
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.gif': 'image/gif',
	'.webp': 'image/webp',
};

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
	const toolCallMetadataByCallId = new Map<string, ToolCallMetadata>();

	for (const message of messages) {
		const role = mapRole(message.role);

		let content = '';
		const nativeVisionContentParts: DeepSeekContentPart[] = [];
		let thinkingContent = '';
		const toolCalls: DeepSeekToolCall[] = [];
		const toolResults: CollectedToolResult[] = [];

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
				toolCallMetadataByCallId.set(part.callId, {
					name: part.name,
					input: part.input,
				});
				toolCalls.push({
					id: part.callId,
					type: 'function',
					function: {
						name: part.name,
						arguments: safeStringify(part.input),
					},
				});
			} else if (part instanceof vscode.LanguageModelToolResultPart) {
				const collected = collectToolResultContent(
					part,
					nativeImageInput ? toolCallMetadataByCallId.get(part.callId) : undefined,
					nativeImageInput,
				);
				toolResults.push({
					callId: part.callId,
					content:
						collected.text || (collected.images.length === 0 ? safeStringify(part.content) : ''),
					images: collected.images,
				});
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

		// Tool result messages follow their associated assistant message.
		for (const tr of toolResults) {
			result.push({
				role: 'tool',
				content: tr.content,
				tool_call_id: tr.callId,
			});
		}

		// DeepSeek only accepts images in user messages, so tool-result image
		// bytes are forwarded as a multimodal user message after the tool result.
		const toolResultImages = toolResults.flatMap((tr) => tr.images);
		if (nativeImageInput && toolResultImages.length > 0) {
			result.push(createToolResultImageMessage(toolResultImages));
		}
	}

	return result;
}

function isImageDataPart(part: unknown): part is vscode.LanguageModelDataPart {
	return part instanceof vscode.LanguageModelDataPart && part.mimeType.startsWith('image/');
}

function toImageDataUrl(part: vscode.LanguageModelDataPart): string {
	return toImageDataUrlFromImage({ mimeType: part.mimeType, data: part.data });
}

function toImageDataUrlFromImage(image: ToolResultImage): string {
	return `data:${image.mimeType};base64,${Buffer.from(image.data).toString('base64')}`;
}

function collectToolResultContent(
	part: vscode.LanguageModelToolResultPart,
	toolCallMetadata: ToolCallMetadata | undefined,
	includeImages: boolean,
): { text: string; images: ToolResultImage[] } {
	let text = '';
	const images: ToolResultImage[] = [];

	for (const item of part.content) {
		if (item instanceof vscode.LanguageModelTextPart) {
			text += item.value;
		} else if (includeImages && isImageDataPart(item)) {
			images.push({
				mimeType: item.mimeType,
				data: item.data,
			});
		}
	}

	if (includeImages && images.length === 0) {
		const image = readImageFromToolCall(toolCallMetadata);
		if (image) {
			images.push(image);
		}
	}

	return { text, images };
}

function createToolResultImageMessage(images: readonly ToolResultImage[]): DeepSeekMessage {
	return {
		role: 'user',
		content: [
			{
				type: 'text',
				text: TOOL_RESULT_IMAGE_MESSAGE,
			},
			...images.map((image) => ({
				type: 'image_url' as const,
				image_url: {
					url: toImageDataUrlFromImage(image),
				},
			})),
		],
	};
}

function readImageFromToolCall(
	metadata: ToolCallMetadata | undefined,
): ToolResultImage | undefined {
	if (!metadata || !isImageToolCall(metadata)) {
		return undefined;
	}

	for (const candidate of getImagePathCandidates(metadata.input)) {
		try {
			const filePath = toFsPath(candidate);
			const mimeType = getImageMimeType(filePath);
			if (!mimeType || !existsSync(filePath)) {
				continue;
			}
			return {
				mimeType,
				data: readFileSync(filePath),
			};
		} catch {
			// Ignore unreadable/non-file candidates and try the next one.
		}
	}

	return undefined;
}

function isImageToolCall(metadata: ToolCallMetadata): boolean {
	const name = metadata.name.toLowerCase();
	if (name.includes('image') || name.includes('screenshot')) {
		return true;
	}

	if (metadata.input && typeof metadata.input === 'object' && !Array.isArray(metadata.input)) {
		const input = metadata.input as Record<string, unknown>;
		return typeof input.imagePath === 'string' || typeof input.image_path === 'string';
	}

	return false;
}

function getImagePathCandidates(input: unknown): string[] {
	if (!input || typeof input !== 'object' || Array.isArray(input)) {
		return [];
	}

	const candidates: string[] = [];
	for (const key of ['filePath', 'file_path', 'path', 'imagePath', 'image_path', 'uri']) {
		const value = (input as Record<string, unknown>)[key];
		if (typeof value === 'string' && value.trim().length > 0) {
			candidates.push(value.trim());
		}
	}
	return candidates;
}

function toFsPath(candidate: string): string {
	if (/^file:/i.test(candidate)) {
		try {
			return vscode.Uri.parse(candidate).fsPath;
		} catch {
			return candidate;
		}
	}
	return candidate;
}

function getImageMimeType(filePath: string): string | undefined {
	return IMAGE_EXTENSION_MIME_TYPES[extname(filePath).toLowerCase()];
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
			parameters: tool.inputSchema as Record<string, unknown> | undefined,
		},
	}));
}

/**
 * Count total characters across all messages to calibrate chars-per-token ratio.
 */
export function countMessageChars(messages: DeepSeekMessage[]): number {
	let total = 0;
	for (const msg of messages) {
		total += getMessageContentChars(msg.content);
		total += msg.reasoning_content?.length ?? 0;
		if (msg.tool_calls) {
			for (const tc of msg.tool_calls) {
				total += tc.function?.name?.length ?? 0;
				total += tc.function?.arguments?.length ?? 0;
			}
		}
	}
	return total;
}

function getMessageContentChars(content: DeepSeekMessage['content']): number {
	if (typeof content === 'string') {
		return content.length;
	}

	let total = 0;
	for (const part of content) {
		if (part.type === 'text') {
			total += part.text.length;
		} else if (part.type === 'image_url') {
			// Do not count base64 URL chars. Native-image requests are excluded from
			// adaptive charsPerToken updates, and image cost is handled separately.
			total += 0;
		}
	}
	return total;
}
