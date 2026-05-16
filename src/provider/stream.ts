import vscode from 'vscode';
import { logger } from '../logger';
import type { DeepSeekToolCall, DeepSeekUsage } from '../types';
import type { ReasoningRecorder } from './cache';
import {
	observeCancellationToken,
	type CacheDiagnosticsRun,
	type SegmentMarkerReportTrigger,
} from './diagnostics';
import type { PreparedChatRequest } from './request';
import { createSegmentMarkerPart } from './segment';

interface ResponseStreamState {
	accumulatedReasoning: string;
	emittedToolCallIds: string[];
	segmentMarkerReported: boolean;
}

const COPILOT_USAGE_DATA_PART_MIME = 'usage';

export interface StreamChatCompletionOptions {
	prepared: PreparedChatRequest;
	progress: vscode.Progress<vscode.LanguageModelResponsePart>;
	token: vscode.CancellationToken;
	reasoningRecorder: ReasoningRecorder;
	getCharsPerToken: () => number;
	setCharsPerToken: (charsPerToken: number) => void;
}

export function streamChatCompletion({
	prepared,
	progress,
	token,
	reasoningRecorder,
	getCharsPerToken,
	setCharsPerToken,
}: StreamChatCompletionOptions): Promise<void> {
	const state: ResponseStreamState = {
		accumulatedReasoning: '',
		emittedToolCallIds: [],
		segmentMarkerReported: false,
	};
	const cancelListener = observeCancellationToken(token, prepared.cacheDiagnostics, () => {
		cacheEmittedToolCallReasoningOnCancellation(prepared.isThinkingModel, state, reasoningRecorder);
	});

	return prepared.client
		.streamChatCompletion(
			prepared.request,
			{
				onContent: (content: string) => {
					reportConversationSegmentMarkerOnce(prepared, progress, state, 'first-assistant-part');
					progress.report(new vscode.LanguageModelTextPart(content));
				},

				onThinking: (text: string) => {
					reportConversationSegmentMarkerOnce(prepared, progress, state, 'first-assistant-part');
					handleThinking(text, state, progress);
				},

				onToolCall: (toolCall: DeepSeekToolCall) => {
					reportConversationSegmentMarkerOnce(prepared, progress, state, 'first-assistant-part');
					handleToolCall(toolCall, state, progress);
				},

				onError: (error: Error) => {
					throw error;
				},

				onDone: () => {
					reportConversationSegmentMarkerOnce(prepared, progress, state, 'done');
					finalizeReasoningCache(
						prepared.isThinkingModel,
						prepared.trailingToolResultIds,
						state,
						reasoningRecorder,
						prepared.cacheDiagnostics,
					);
				},

				onUsage: (usage) => {
					const charsPerToken = updateCharsPerToken(
						prepared.totalRequestChars,
						usage,
						getCharsPerToken(),
					);
					setCharsPerToken(charsPerToken);
					prepared.cacheDiagnostics.onUsage(usage, charsPerToken);
					reportCopilotContextUsage(progress, usage);
				},
			},
			token,
		)
		.then(undefined, (error) => {
			reportSkippedSegmentMarkerIfNeeded(
				prepared,
				state,
				token.isCancellationRequested ? 'cancelled' : 'stream-error',
				error,
			);
			throw error;
		})
		.then(() => {
			if (token.isCancellationRequested) {
				reportSkippedSegmentMarkerIfNeeded(prepared, state, 'cancelled');
			}
		})
		.finally(() => {
			cancelListener.dispose();
		});
}

function reportConversationSegmentMarkerOnce(
	prepared: PreparedChatRequest,
	progress: vscode.Progress<vscode.LanguageModelResponsePart>,
	state: ResponseStreamState,
	trigger: SegmentMarkerReportTrigger,
): void {
	if (state.segmentMarkerReported) {
		return;
	}
	state.segmentMarkerReported = true;
	reportConversationSegmentMarker(prepared, progress, trigger);
}

function reportSkippedSegmentMarkerIfNeeded(
	prepared: PreparedChatRequest,
	state: ResponseStreamState,
	reason: 'cancelled' | 'stream-error',
	error?: unknown,
): void {
	if (state.segmentMarkerReported) {
		return;
	}
	state.segmentMarkerReported = true;
	prepared.cacheDiagnostics.onSegmentMarkerReport({
		segment: prepared.segment,
		status: 'skipped',
		reason,
		visionTextChars: prepared.visionMarkerTextChars,
		error,
	});
}

function reportConversationSegmentMarker(
	prepared: PreparedChatRequest,
	progress: vscode.Progress<vscode.LanguageModelResponsePart>,
	trigger: SegmentMarkerReportTrigger,
): void {
	try {
		const markerPart = createSegmentMarkerPart(
			prepared.segment.segmentId,
			prepared.segmentMarkerMetadata,
		);
		progress.report(markerPart);
		prepared.cacheDiagnostics.onSegmentMarkerReport({
			segment: prepared.segment,
			status: 'reported',
			trigger,
			markerBytes: markerPart.data.byteLength,
			visionTextChars: prepared.visionMarkerTextChars,
		});
	} catch (error) {
		prepared.cacheDiagnostics.onSegmentMarkerReport({
			segment: prepared.segment,
			status: 'failed',
			trigger,
			visionTextChars: prepared.visionMarkerTextChars,
			error,
		});
		logger.warn('Failed to report conversation segment marker', error);
	}
}

function handleThinking(
	text: string,
	state: ResponseStreamState,
	progress: vscode.Progress<vscode.LanguageModelResponsePart>,
): void {
	state.accumulatedReasoning += text;

	// LanguageModelThinkingPart is a proposed API; the project root augmentation provides types.
	progress.report(
		new vscode.LanguageModelThinkingPart(text) as unknown as vscode.LanguageModelResponsePart,
	);
}

function handleToolCall(
	toolCall: DeepSeekToolCall,
	state: ResponseStreamState,
	progress: vscode.Progress<vscode.LanguageModelResponsePart>,
): void {
	state.emittedToolCallIds.push(toolCall.id);

	try {
		const args = JSON.parse(toolCall.function.arguments);
		progress.report(
			new vscode.LanguageModelToolCallPart(toolCall.id, toolCall.function.name, args),
		);
	} catch {
		progress.report(new vscode.LanguageModelToolCallPart(toolCall.id, toolCall.function.name, {}));
	}
}

function finalizeReasoningCache(
	isThinkingModel: boolean,
	trailingToolResultIds: readonly string[],
	state: ResponseStreamState,
	reasoningRecorder: ReasoningRecorder,
	cacheDiagnostics: CacheDiagnosticsRun,
): void {
	if (isThinkingModel && state.accumulatedReasoning) {
		if (state.emittedToolCallIds.length > 0) {
			reasoningRecorder.recordToolCallReasoning(
				state.emittedToolCallIds,
				state.accumulatedReasoning,
			);
		} else if (trailingToolResultIds.length > 0) {
			reasoningRecorder.recordPostToolReasoning(trailingToolResultIds, state.accumulatedReasoning);
		}
	}

	const pruneResult = reasoningRecorder.prune();
	cacheDiagnostics.onDone({
		reasoningCacheSize: reasoningRecorder.size,
		evictedReasoningEntries: pruneResult.removed,
		emittedToolCalls: state.emittedToolCallIds.length,
		trailingToolResults: trailingToolResultIds.length,
	});
}

function cacheEmittedToolCallReasoningOnCancellation(
	isThinkingModel: boolean,
	state: ResponseStreamState,
	reasoningRecorder: ReasoningRecorder,
): void {
	if (!isThinkingModel || !state.accumulatedReasoning || state.emittedToolCallIds.length === 0) {
		return;
	}

	reasoningRecorder.recordToolCallReasoning(state.emittedToolCallIds, state.accumulatedReasoning);
	reasoningRecorder.prune();
}

function updateCharsPerToken(
	totalRequestChars: number,
	usage: DeepSeekUsage,
	charsPerToken: number,
): number {
	if (totalRequestChars > 0 && usage.prompt_tokens > 0) {
		const observedRatio = totalRequestChars / usage.prompt_tokens;
		return charsPerToken * 0.7 + observedRatio * 0.3;
	}
	return charsPerToken;
}

function reportCopilotContextUsage(
	progress: vscode.Progress<vscode.LanguageModelResponsePart>,
	usage: DeepSeekUsage,
): void {
	const data = {
		prompt_tokens: usage.prompt_tokens,
		completion_tokens: usage.completion_tokens,
		total_tokens: usage.total_tokens,
		prompt_tokens_details: {
			cached_tokens: usage.prompt_cache_hit_tokens ?? 0,
		},
	};

	progress.report(
		new vscode.LanguageModelDataPart(
			new TextEncoder().encode(JSON.stringify(data)),
			COPILOT_USAGE_DATA_PART_MIME,
		),
	);
}
