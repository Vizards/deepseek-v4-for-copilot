import { randomUUID } from 'crypto';
import vscode from 'vscode';
import { createUserFacingError } from '../client';
import { logger } from '../logger';
import type { DeepSeekToolCall, DeepSeekUsage } from '../types';
import {
	observeCancellationToken,
	type CacheDiagnosticsRun,
	type ReplayMarkerReportTrigger,
} from './debug';
import {
	createReplayMarkerPart,
	hasReplayMarkerMetadata,
	type ReplayMarkerMetadata,
} from './replay';
import type { PreparedChatRequest } from './request';
import { formatRequestLogLine, type RequestKind } from './routing';

interface ResponseStreamState {
	accumulatedReasoning: string;
	pendingReasoningText: string;
	reasoningRunId: string | undefined;
	emittedToolCallIds: string[];
	initialResponseNoticeReported: boolean;
	replayMarkerReported: boolean;
}

const COPILOT_USAGE_DATA_PART_MIME = 'usage';

/**
 * Buffered reasoning characters before a part is reported. Parts in one run
 * share an id and merge in the chat model, so this only reduces progress events.
 */
const REASONING_FLUSH_CHARS = 256;

export interface StreamChatCompletionOptions {
	prepared: PreparedChatRequest;
	progress: vscode.Progress<vscode.LanguageModelResponsePart>;
	token: vscode.CancellationToken;
	initialResponseNotice?: string;
	getCharsPerToken: () => number;
	setCharsPerToken: (charsPerToken: number) => void;
}

export function streamChatCompletion({
	prepared,
	progress,
	token,
	initialResponseNotice,
	getCharsPerToken,
	setCharsPerToken,
}: StreamChatCompletionOptions): Promise<void> {
	const state: ResponseStreamState = {
		accumulatedReasoning: '',
		pendingReasoningText: '',
		reasoningRunId: undefined,
		emittedToolCallIds: [],
		initialResponseNoticeReported: false,
		replayMarkerReported: false,
	};
	const cancelListener = observeCancellationToken(token, prepared.cacheDiagnostics);

	return prepared.client
		.streamChatCompletion(
			prepared.request,
			{
				onContent: (content: string) => {
					// Close the run before any other part, so the buffered tail keeps its id.
					endReasoningRun(state, progress);
					reportInitialResponseNoticeOnce(progress, state, initialResponseNotice);
					progress.report(new vscode.LanguageModelTextPart(content));
				},

				onThinking: (text: string) => {
					reportInitialResponseNoticeOnce(progress, state, initialResponseNotice);
					handleThinking(text, state, progress);
				},

				onToolCall: (toolCall: DeepSeekToolCall) => {
					endReasoningRun(state, progress);
					reportInitialResponseNoticeOnce(progress, state, initialResponseNotice);
					handleToolCall(toolCall, state, progress);
				},

				onError: (error: Error) => {
					endReasoningRun(state, progress);
					throw createUserFacingError(error);
				},

				onDone: () => {
					endReasoningRun(state, progress);
					reportReplayMarkerOnce(prepared, progress, state, 'done');
					finalizeReplayDiagnostics(
						prepared.trailingToolResultIds,
						state,
						prepared.cacheDiagnostics,
					);
				},

				onUsage: (usage) => {
					// Usage is reported last; close the run so its tail is not orphaned after it.
					endReasoningRun(state, progress);
					const charsPerToken = prepared.hasNativeImages
						? getCharsPerToken()
						: updateCharsPerToken(prepared.totalRequestChars, usage, getCharsPerToken());
					if (!prepared.hasNativeImages) {
						setCharsPerToken(charsPerToken);
					}
					prepared.cacheDiagnostics.onUsage(usage, charsPerToken);
					reportCopilotContextUsage(progress, usage, prepared.requestKind);
				},
			},
			token,
		)
		.then(undefined, (error) => {
			reportSkippedReplayMarkerIfNeeded(
				prepared,
				state,
				token.isCancellationRequested ? 'cancelled' : 'stream-error',
				error,
			);
			throw error;
		})
		.then(() => {
			if (token.isCancellationRequested) {
				reportSkippedReplayMarkerIfNeeded(prepared, state, 'cancelled');
			}
		})
		.finally(() => {
			cancelListener.dispose();
		});
}

function reportInitialResponseNoticeOnce(
	progress: vscode.Progress<vscode.LanguageModelResponsePart>,
	state: ResponseStreamState,
	initialResponseNotice: string | undefined,
): void {
	if (!initialResponseNotice || state.initialResponseNoticeReported) {
		return;
	}
	state.initialResponseNoticeReported = true;
	progress.report(new vscode.LanguageModelTextPart(initialResponseNotice));
}

function reportReplayMarkerOnce(
	prepared: PreparedChatRequest,
	progress: vscode.Progress<vscode.LanguageModelResponsePart>,
	state: ResponseStreamState,
	trigger: ReplayMarkerReportTrigger,
): void {
	if (state.replayMarkerReported) {
		return;
	}
	state.replayMarkerReported = true;
	reportReplayMarker(prepared, progress, state, trigger);
}

function reportSkippedReplayMarkerIfNeeded(
	prepared: PreparedChatRequest,
	state: ResponseStreamState,
	reason: 'cancelled' | 'stream-error',
	error?: unknown,
): void {
	if (state.replayMarkerReported) {
		return;
	}
	state.replayMarkerReported = true;
	prepared.cacheDiagnostics.onReplayMarkerReport({
		status: 'skipped',
		reason,
		visionTextChars: prepared.visionMarkerTextChars,
		reasoningTextChars: state.accumulatedReasoning.length || undefined,
		error,
	});
}

function reportReplayMarker(
	prepared: PreparedChatRequest,
	progress: vscode.Progress<vscode.LanguageModelResponsePart>,
	state: ResponseStreamState,
	trigger: ReplayMarkerReportTrigger,
): void {
	const metadata = getReplayMarkerMetadata(prepared, state);
	if (!hasReplayMarkerMetadata(metadata)) {
		prepared.cacheDiagnostics.onReplayMarkerReport({
			status: 'skipped',
			trigger,
			reason: 'no-replay-data',
			visionTextChars: prepared.visionMarkerTextChars,
			reasoningTextChars: state.accumulatedReasoning.length || undefined,
		});
		return;
	}

	try {
		const markerPart = createReplayMarkerPart(metadata);
		progress.report(markerPart);
		prepared.cacheDiagnostics.onReplayMarkerReport({
			status: 'reported',
			trigger,
			markerBytes: markerPart.data.byteLength,
			visionTextChars: prepared.visionMarkerTextChars,
			reasoningTextChars: state.accumulatedReasoning.length || undefined,
		});
	} catch (error) {
		prepared.cacheDiagnostics.onReplayMarkerReport({
			status: 'failed',
			trigger,
			visionTextChars: prepared.visionMarkerTextChars,
			reasoningTextChars: state.accumulatedReasoning.length || undefined,
			error,
		});
		logger.warn(
			formatRequestLogLine(prepared.requestKind, 'Failed to report replay marker'),
			error,
		);
	}
}

function getReplayMarkerMetadata(
	prepared: PreparedChatRequest,
	state: ResponseStreamState,
): ReplayMarkerMetadata {
	return {
		...prepared.replayMarkerMetadata,
		reasoningText: state.accumulatedReasoning || undefined,
	};
}

function handleThinking(
	text: string,
	state: ResponseStreamState,
	progress: vscode.Progress<vscode.LanguageModelResponsePart>,
): void {
	state.accumulatedReasoning += text;
	state.pendingReasoningText += text;

	// Report the first delta of a run at once so reasoning appears immediately.
	if (
		state.reasoningRunId === undefined ||
		state.pendingReasoningText.length >= REASONING_FLUSH_CHARS
	) {
		reportReasoningRun(state, progress);
	}
}

/**
 * Report buffered reasoning as one part of the active run.
 *
 * The chat model merges consecutive thinking parts only while their ids match,
 * and it treats an id-less part as anonymous. Without an id, the chat renderer
 * stamps its own onto the part, which splits one reasoning burst into a part
 * per delta. Sharing one id across the run keeps the burst whole.
 */
function reportReasoningRun(
	state: ResponseStreamState,
	progress: vscode.Progress<vscode.LanguageModelResponsePart>,
): void {
	const text = state.pendingReasoningText;
	if (!text) {
		return;
	}

	state.pendingReasoningText = '';
	state.reasoningRunId ??= randomUUID();

	// LanguageModelThinkingPart is a proposed API; the project root augmentation provides types.
	progress.report(
		new vscode.LanguageModelThinkingPart(
			text,
			state.reasoningRunId,
		) as unknown as vscode.LanguageModelResponsePart,
	);
}

/**
 * End the active reasoning run, reporting anything still buffered.
 *
 * Never throws: the close runs ahead of content, tool calls, usage, and the
 * replay marker, and a failed report must not skip any of them. The id is
 * cleared even on failure so a later run cannot merge into a dead one.
 */
function endReasoningRun(
	state: ResponseStreamState,
	progress: vscode.Progress<vscode.LanguageModelResponsePart>,
): void {
	try {
		reportReasoningRun(state, progress);
	} catch (error) {
		try {
			logger.warn('Failed to report buffered reasoning', error);
		} catch {
			// The run close must not throw, even when logging is unavailable.
		}
	} finally {
		state.reasoningRunId = undefined;
	}
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

function finalizeReplayDiagnostics(
	trailingToolResultIds: readonly string[],
	state: ResponseStreamState,
	cacheDiagnostics: CacheDiagnosticsRun,
): void {
	cacheDiagnostics.onDone({
		reasoningTextChars: state.accumulatedReasoning.length,
		emittedToolCalls: state.emittedToolCallIds.length,
		trailingToolResults: trailingToolResultIds.length,
	});
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
	requestKind: RequestKind,
): void {
	const data = {
		prompt_tokens: usage.prompt_tokens,
		completion_tokens: usage.completion_tokens,
		total_tokens: usage.total_tokens,
		prompt_tokens_details: {
			cached_tokens: usage.prompt_cache_hit_tokens ?? 0,
		},
	};

	try {
		progress.report(
			new vscode.LanguageModelDataPart(
				new TextEncoder().encode(JSON.stringify(data)),
				COPILOT_USAGE_DATA_PART_MIME,
			),
		);
	} catch (error) {
		logger.warn(formatRequestLogLine(requestKind, 'Failed to report usage data'), error);
	}
}
