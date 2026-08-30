import vscode from 'vscode';
import { collectVisionInputSummary } from './normalize';
import { resolveImageMessages } from './resolve';
import { createVisionResolutionStats } from './stats';
import type { VisionDescriber, VisionResolutionResult, VisionResolutionStats } from './types';

export interface PrepareVisionMessagesOptions {
	messages: readonly vscode.LanguageModelChatRequestMessage[];
	nativeImageInput: boolean;
	token: vscode.CancellationToken;
	getDescriber: () => Promise<VisionDescriber | undefined>;
}

/** Resolve the provider input through the selected native/proxy vision route. */
export async function prepareVisionMessages({
	messages,
	nativeImageInput,
	token,
	getDescriber,
}: PrepareVisionMessagesOptions): Promise<VisionResolutionResult> {
	const summary = collectVisionInputSummary(messages);
	const stats = createVisionResolutionStats();
	applyVisionInputSummary(stats, summary, nativeImageInput);
	const resolution = nativeImageInput
		? createNativeVisionResolution(messages, stats)
		: await resolveImageMessages(messages, summary, stats, token, getDescriber);
	return resolution;
}

function createNativeVisionResolution(
	messages: readonly vscode.LanguageModelChatRequestMessage[],
	stats: VisionResolutionStats,
): VisionResolutionResult {
	return {
		messages,
		stats,
		replayMarkerMetadata: {},
	};
}

function applyVisionInputSummary(
	stats: VisionResolutionStats,
	summary: ReturnType<typeof collectVisionInputSummary>,
	nativeImageInput: boolean,
): void {
	stats.input.imageParts = summary.inputImageParts;
	stats.input.imageMessages = summary.inputImageMessages;
	stats.input.imageBytes = summary.inputImageBytes;
	stats.input.imageMimes = summary.inputImageMimes;
	stats.tool.imageParts = summary.toolResultImageParts;
	stats.tool.imageBytes = summary.toolResultImageBytes;
	stats.tool.imageMimes = summary.toolResultImageMimes;
	stats.tool.resultsWithImages = summary.toolResultsWithImages;

	if (summary.inputImageParts + summary.toolResultImageParts > 0) {
		stats.imageHandlingMode = nativeImageInput ? 'native' : 'proxy';
	}
}
