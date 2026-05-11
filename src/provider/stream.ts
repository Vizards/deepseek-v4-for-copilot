import vscode from 'vscode';
import type { DeepSeekToolCall, DeepSeekUsage } from '../types';
import {
	createPostToolReasoningKey,
	createToolReasoningKey,
	pruneReasoningCache,
	type ReasoningEntry,
} from './cache';
import { observeCancellationToken, type CacheDiagnosticsRun } from './diagnostics';
import type { PreparedChatRequest } from './request';

interface ResponseStreamState {
	accumulatedReasoning: string;
	emittedToolCallIds: string[];
}

const COPILOT_USAGE_DATA_PART_MIME = 'usage';

export interface StreamChatCompletionOptions {
	prepared: PreparedChatRequest;
	progress: vscode.Progress<vscode.LanguageModelResponsePart>;
	token: vscode.CancellationToken;
	reasoningCache: Map<string, ReasoningEntry>;
	getCharsPerToken: () => number;
	setCharsPerToken: (charsPerToken: number) => void;
}

export function streamChatCompletion({
	prepared,
	progress,
	token,
	reasoningCache,
	getCharsPerToken,
	setCharsPerToken,
}: StreamChatCompletionOptions): Promise<void> {
	const state: ResponseStreamState = {
		accumulatedReasoning: '',
		emittedToolCallIds: [],
	};
	const cancelListener = observeCancellationToken(token, prepared.cacheDiagnostics, () => {
		cacheEmittedToolCallReasoningOnCancellation(prepared.isThinkingModel, state, reasoningCache);
	});

	return prepared.client
		.streamChatCompletion(
			prepared.request,
			{
				onContent: (content: string) => {
					progress.report(new vscode.LanguageModelTextPart(content));
				},

				onThinking: (text: string) => {
					handleThinking(text, state, progress);
				},

				onToolCall: (toolCall: DeepSeekToolCall) => {
					handleToolCall(toolCall, state, progress);
				},

				onError: (error: Error) => {
					throw error;
				},

				onDone: () => {
					finalizeReasoningCache(
						prepared.isThinkingModel,
						prepared.trailingToolResultIds,
						state,
						reasoningCache,
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
		.finally(() => {
			cancelListener.dispose();
		});
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
	reasoningCache: Map<string, ReasoningEntry>,
	cacheDiagnostics: CacheDiagnosticsRun,
): void {
	if (isThinkingModel && state.accumulatedReasoning) {
		const entry: ReasoningEntry = {
			text: state.accumulatedReasoning,
			timestamp: Date.now(),
		};
		if (state.emittedToolCallIds.length > 0) {
			for (const toolCallId of state.emittedToolCallIds) {
				reasoningCache.set(createToolReasoningKey(toolCallId), entry);
			}
		} else if (trailingToolResultIds.length > 0) {
			reasoningCache.set(createPostToolReasoningKey(trailingToolResultIds), entry);
		}
	}

	const cacheSizeBeforePrune = reasoningCache.size;
	pruneReasoningCache(reasoningCache, false);
	const evictedReasoningEntries = Math.max(0, cacheSizeBeforePrune - reasoningCache.size);
	cacheDiagnostics.onDone({
		reasoningCacheSize: reasoningCache.size,
		evictedReasoningEntries,
		emittedToolCalls: state.emittedToolCallIds.length,
		trailingToolResults: trailingToolResultIds.length,
	});
}

function cacheEmittedToolCallReasoningOnCancellation(
	isThinkingModel: boolean,
	state: ResponseStreamState,
	reasoningCache: Map<string, ReasoningEntry>,
): void {
	if (!isThinkingModel || !state.accumulatedReasoning || state.emittedToolCallIds.length === 0) {
		return;
	}

	const entry: ReasoningEntry = {
		text: state.accumulatedReasoning,
		timestamp: Date.now(),
	};
	for (const toolCallId of state.emittedToolCallIds) {
		reasoningCache.set(createToolReasoningKey(toolCallId), entry);
	}
	pruneReasoningCache(reasoningCache, false);
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
