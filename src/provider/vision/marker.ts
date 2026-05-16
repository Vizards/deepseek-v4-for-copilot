export type VisionMarkerTextIgnoredReason =
	| 'vision-not-object'
	| 'vision-text-not-string'
	| 'vision-text-empty';

export interface ParsedVisionMarkerMetadata {
	visionText?: string;
	visionTextIgnoredReason?: VisionMarkerTextIgnoredReason;
}

export function createVisionMarkerPayload(visionText: string | undefined): object {
	return visionText ? { vision: { text: visionText } } : {};
}

export function parseVisionMarkerMetadata(value: object): ParsedVisionMarkerMetadata {
	const vision = (value as { vision?: unknown }).vision;
	if (vision === undefined) {
		return {};
	}
	if (!vision || typeof vision !== 'object' || Array.isArray(vision)) {
		return { visionTextIgnoredReason: 'vision-not-object' };
	}

	const text = (vision as { text?: unknown }).text;
	if (typeof text !== 'string') {
		return { visionTextIgnoredReason: 'vision-text-not-string' };
	}
	if (text.length === 0) {
		return { visionTextIgnoredReason: 'vision-text-empty' };
	}

	return { visionText: text };
}
