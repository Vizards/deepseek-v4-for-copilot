export interface ReplayMarkerParseResult {
	valid: boolean;
	segmentId?: string;
	visionText?: string;
	visionTextIgnoredReason?: VisionMarkerTextIgnoredReason;
	reasoningText?: string;
	reasoningTextIgnoredReason?: ReasoningMarkerTextIgnoredReason;
	legacySegmentOnly?: boolean;
	payloadFormat?: ReplayMarkerPayloadFormat;
	error?: string;
}

export interface LocatedReplayMarker {
	partIndex: number;
	marker: ReplayMarkerParseResult;
}

export type ReplayMarkerPayloadFormat = 'json-base64url' | 'raw-json' | 'raw-uuid';

export type VisionMarkerTextIgnoredReason =
	| 'vision-not-object'
	| 'vision-text-not-string'
	| 'vision-text-empty';

export type ReasoningMarkerTextIgnoredReason =
	| 'reasoning-not-object'
	| 'reasoning-text-not-string'
	| 'reasoning-text-empty';

export interface ReplayMarkerMetadata {
	visionText?: string;
	reasoningText?: string;
}
