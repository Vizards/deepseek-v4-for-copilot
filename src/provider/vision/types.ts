import type vscode from 'vscode';

export interface VisionDescriptionCacheStats {
	enabled: boolean;
	hits: number;
	misses: number;
	deduplicatedDescriptions: number;
	entries: number;
	generatedDescriptions: number;
	failedDescriptions: number;
	// Resolution fallback count, not a cache hit/miss metric.
	droppedImageParts: number;
}

export interface VisionResolutionResult {
	messages: readonly vscode.LanguageModelChatRequestMessage[];
	stats: VisionDescriptionCacheStats;
	visionModelId?: string;
}
