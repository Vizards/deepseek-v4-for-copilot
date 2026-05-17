import type vscode from 'vscode';
import type { ReplayMarkerMetadata } from '../replay';

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
	replayMarkerMetadata: ReplayMarkerMetadata;
	visionModelId?: string;
}
