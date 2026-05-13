import { randomUUID } from 'crypto';
import vscode from 'vscode';

export const SEGMENT_MARKER_MIME = 'stateful_marker';

const SEGMENT_MARKER_MODEL_ID = 'deepseek-copilot';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type SegmentResolveReason = 'markerFound' | 'markerMissing' | 'markerInvalid';

export interface ConversationSegment {
	segmentId: string;
	reason: SegmentResolveReason;
	markerMessageIndex?: number;
	markerPartIndex?: number;
	markerError?: string;
}

export interface SegmentMarkerParseResult {
	valid: boolean;
	segmentId?: string;
	error?: string;
}

export function resolveConversationSegment(
	messages: readonly vscode.LanguageModelChatRequestMessage[],
): ConversationSegment {
	for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
		const message = messages[messageIndex];
		if (message.role !== vscode.LanguageModelChatMessageRole.Assistant) {
			continue;
		}

		for (let partIndex = message.content.length - 1; partIndex >= 0; partIndex -= 1) {
			const part = message.content[partIndex];
			if (!(part instanceof vscode.LanguageModelDataPart)) {
				continue;
			}
			if (part.mimeType !== SEGMENT_MARKER_MIME) {
				continue;
			}

			const marker = parseSegmentMarkerData(part.data);
			if (marker.valid && marker.segmentId) {
				return {
					segmentId: marker.segmentId,
					reason: 'markerFound',
					markerMessageIndex: messageIndex,
					markerPartIndex: partIndex,
				};
			}

			return {
				segmentId: randomUUID(),
				reason: 'markerInvalid',
				markerMessageIndex: messageIndex,
				markerPartIndex: partIndex,
				markerError: marker.error ?? 'unknown-marker-error',
			};
		}
	}

	return {
		segmentId: randomUUID(),
		reason: 'markerMissing',
	};
}

export function createSegmentMarkerPart(segmentId: string): vscode.LanguageModelDataPart {
	const payload = JSON.stringify({ segmentId });
	return new vscode.LanguageModelDataPart(
		new TextEncoder().encode(`${SEGMENT_MARKER_MODEL_ID}\\${payload}`),
		SEGMENT_MARKER_MIME,
	);
}

export function parseSegmentMarkerData(data: Uint8Array): SegmentMarkerParseResult {
	const decoded = new TextDecoder().decode(data);
	const separatorIndex = decoded.indexOf('\\');
	const markerPayload = separatorIndex >= 0 ? decoded.slice(separatorIndex + 1) : decoded;

	if (isValidSegmentId(markerPayload)) {
		return { valid: true, segmentId: markerPayload.toLowerCase() };
	}

	try {
		const value = JSON.parse(markerPayload) as unknown;
		if (!value || typeof value !== 'object' || Array.isArray(value)) {
			return { valid: false, error: 'marker-payload-not-object' };
		}

		const segmentId = (value as { segmentId?: unknown }).segmentId;
		if (typeof segmentId !== 'string') {
			return { valid: false, error: 'segment-id-not-string' };
		}
		if (!isValidSegmentId(segmentId)) {
			return { valid: false, error: 'segment-id-not-uuid' };
		}

		return { valid: true, segmentId: segmentId.toLowerCase() };
	} catch {
		return { valid: false, error: 'marker-json-invalid' };
	}
}

export function isValidSegmentId(value: string): boolean {
	return UUID_PATTERN.test(value);
}
