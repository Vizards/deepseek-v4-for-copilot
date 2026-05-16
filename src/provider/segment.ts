import { randomUUID } from 'crypto';
import vscode from 'vscode';
import { MODELS } from '../consts';
import { safeStringify } from '../json';
import {
	createVisionMarkerPayload,
	parseVisionMarkerMetadata,
	type VisionMarkerTextIgnoredReason,
} from './vision/marker';

export const SEGMENT_MARKER_MIME = 'stateful_marker';

const SEGMENT_MARKER_MODEL_ID = 'deepseek-copilot';
const SEGMENT_MARKER_PREFIXES = new Set([
	SEGMENT_MARKER_MODEL_ID,
	...MODELS.map((model) => model.id),
]);
const ENCODED_JSON_MARKER_PREFIX = 'json:';
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+={0,2}$/;

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
	visionText?: string;
	visionTextIgnoredReason?: VisionMarkerTextIgnoredReason;
	error?: string;
}

export interface SegmentMarkerMetadata {
	visionText?: string;
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

export function createSegmentMarkerPart(
	segmentId: string,
	metadata: SegmentMarkerMetadata = {},
): vscode.LanguageModelDataPart {
	const payload = encodeSegmentMarkerJson({
		segmentId,
		...createVisionMarkerPayload(metadata.visionText),
	});
	return new vscode.LanguageModelDataPart(
		new TextEncoder().encode(`${SEGMENT_MARKER_MODEL_ID}\\${payload}`),
		SEGMENT_MARKER_MIME,
	);
}

export function parseSegmentMarkerData(data: Uint8Array): SegmentMarkerParseResult {
	const decoded = new TextDecoder().decode(data);
	const separatorIndex = decoded.indexOf('\\');
	if (separatorIndex < 0) {
		return { valid: false, error: 'marker-prefix-missing' };
	}

	const markerPrefix = decoded.slice(0, separatorIndex);
	if (!SEGMENT_MARKER_PREFIXES.has(markerPrefix)) {
		return { valid: false, error: 'marker-prefix-mismatch' };
	}

	const markerPayload = decoded.slice(separatorIndex + 1);

	const decodedPayload = decodeSegmentMarkerPayload(markerPayload);
	if (!decodedPayload.valid) {
		return { valid: false, error: decodedPayload.error };
	}
	const payload = decodedPayload.value;

	if (isValidSegmentId(payload)) {
		return { valid: true, segmentId: payload.toLowerCase() };
	}

	try {
		const value = JSON.parse(payload) as unknown;
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

		const vision = parseVisionMarkerMetadata(value);
		return {
			valid: true,
			segmentId: segmentId.toLowerCase(),
			...vision,
		};
	} catch {
		return { valid: false, error: 'marker-json-invalid' };
	}
}

function encodeSegmentMarkerJson(value: object): string {
	const json = safeStringify(value);
	return `${ENCODED_JSON_MARKER_PREFIX}${Buffer.from(json, 'utf8').toString('base64url')}`;
}

function decodeSegmentMarkerPayload(
	markerPayload: string,
): { valid: true; value: string } | { valid: false; error: string } {
	if (!markerPayload.startsWith(ENCODED_JSON_MARKER_PREFIX)) {
		return { valid: true, value: markerPayload };
	}

	const encodedPayload = markerPayload.slice(ENCODED_JSON_MARKER_PREFIX.length);
	if (!encodedPayload || !BASE64URL_PATTERN.test(encodedPayload)) {
		return { valid: false, error: 'marker-json-base64-invalid' };
	}

	try {
		return { valid: true, value: Buffer.from(encodedPayload, 'base64url').toString('utf8') };
	} catch {
		return { valid: false, error: 'marker-json-base64-invalid' };
	}
}

export function isValidSegmentId(value: string): boolean {
	return UUID_PATTERN.test(value);
}
