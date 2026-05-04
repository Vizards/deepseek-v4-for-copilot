import vscode from 'vscode';
import type { DeepSeekToolCall, DeepSeekUsage } from '../types';
import { pruneReasoningCache, type ReasoningEntry } from './cache';
import type { CacheDiagnosticsRun } from './diagnostics';
import type { PreparedChatRequest } from './request';

interface ResponseStreamState {
	accumulatedReasoning: string;
	emittedToolCallIds: string[];
}

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

	return new Promise<void>((resolve, reject) => {
		prepared.client.streamChatCompletion(
			prepared.request,
			{
				onContent: (content: string) => {
					progress.report(new vscode.LanguageModelTextPart(content));
				},

				onThinking: (text: string) => {
					handleThinking(text, state, progress);
				},

				onToolCall: (toolCall: DeepSeekToolCall) => {
					handleToolCall(toolCall, prepared.isThinkingModel, state, progress, reasoningCache);
				},

				onError: (error: Error) => {
					reject(error);
				},

				onDone: () => {
					finalizeReasoningCache(
						prepared.isThinkingModel,
						prepared.trailingToolResults,
						state,
						reasoningCache,
						prepared.cacheDiagnostics,
					);
					resolve();
				},

				onUsage: (usage) => {
					const charsPerToken = updateCharsPerToken(
						prepared.totalRequestChars,
						usage,
						getCharsPerToken(),
					);
					setCharsPerToken(charsPerToken);
					prepared.cacheDiagnostics.onUsage(usage, charsPerToken);
				},
			},
			token,
		);
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
	isThinkingModel: boolean,
	state: ResponseStreamState,
	progress: vscode.Progress<vscode.LanguageModelResponsePart>,
	reasoningCache: Map<string, ReasoningEntry>,
): void {
	state.emittedToolCallIds.push(toolCall.id);

	if (isThinkingModel && state.accumulatedReasoning) {
		reasoningCache.set(toolCall.id, {
			text: state.accumulatedReasoning,
			timestamp: Date.now(),
		});
	}

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
	trailingToolResults: number,
	state: ResponseStreamState,
	reasoningCache: Map<string, ReasoningEntry>,
	cacheDiagnostics: CacheDiagnosticsRun,
): void {
	if (isThinkingModel && state.accumulatedReasoning && state.emittedToolCallIds.length === 0) {
		const responseMessageId = `resp_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
		reasoningCache.set(responseMessageId, {
			text: state.accumulatedReasoning,
			timestamp: Date.now(),
		});
	}

	const cacheSizeBeforePrune = reasoningCache.size;
	pruneReasoningCache(reasoningCache, false);
	const evictedReasoningEntries = Math.max(0, cacheSizeBeforePrune - reasoningCache.size);
	cacheDiagnostics.onDone({
		reasoningCacheSize: reasoningCache.size,
		evictedReasoningEntries,
		emittedToolCalls: state.emittedToolCallIds.length,
		trailingToolResults,
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
