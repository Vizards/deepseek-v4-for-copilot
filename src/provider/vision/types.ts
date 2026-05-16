import type vscode from 'vscode';
import type { SegmentMarkerMetadata } from '../segment';

export interface VisionResolutionStats {
	inputImageParts: number;
	inputImageMessages: number;
	currentImageMessages: number;
	generatedImageMessages: number;
	replayedImageMessages: number;
	omittedImageMessages: number;
	unavailableImageMessages: number;
	failedImageMessages: number;
	droppedImageParts: number;
	markerVisionTextChars: number;
	invalidMarkerVisionMetadata: number;
}

export interface VisionResolutionResult {
	messages: readonly vscode.LanguageModelChatRequestMessage[];
	stats: VisionResolutionStats;
	segmentMarkerMetadata: SegmentMarkerMetadata;
	visionModelId?: string;
	markerVisionTextChars?: number;
}
