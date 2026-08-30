import type { DeepSeekMessage } from '../../types';
import type { VisionResolutionStats } from './types';

export function createVisionResolutionStats(): VisionResolutionStats {
	return {
		imageHandlingMode: 'none',
		input: {
			imageParts: 0,
			imageMessages: 0,
			imageBytes: 0,
			imageMimes: [],
			forwardedImageParts: 0,
			droppedImageParts: 0,
		},
		tool: {
			imageParts: 0,
			imageBytes: 0,
			imageMimes: [],
			resultsWithImages: 0,
			forwardedImageParts: 0,
			droppedImageParts: 0,
		},
		currentImageMessages: 0,
		generatedImageMessages: 0,
		replayedImageMessages: 0,
		omittedImageMessages: 0,
		unavailableImageMessages: 0,
		failedImageMessages: 0,
		markerVisionTextChars: 0,
		invalidMarkerVisionMetadata: 0,
	};
}

/** Reconcile native-image counters against the final DeepSeek payload. */
export function finalizeVisionResolutionStats(
	stats: VisionResolutionStats,
	messages: readonly DeepSeekMessage[],
): void {
	if (stats.imageHandlingMode !== 'native') {
		return;
	}

	let forwardedInputImageParts = 0;
	let forwardedToolImageParts = 0;
	for (const message of messages) {
		if (typeof message.content === 'string') {
			continue;
		}
		for (const part of message.content) {
			if (part.type !== 'image_url') {
				continue;
			}
			if (message.role === 'tool') {
				forwardedToolImageParts += 1;
			} else {
				forwardedInputImageParts += 1;
			}
		}
	}

	stats.input.forwardedImageParts = forwardedInputImageParts;
	stats.input.droppedImageParts = Math.max(0, stats.input.imageParts - forwardedInputImageParts);
	stats.tool.forwardedImageParts = forwardedToolImageParts;
	stats.tool.droppedImageParts = Math.max(0, stats.tool.imageParts - forwardedToolImageParts);
}
