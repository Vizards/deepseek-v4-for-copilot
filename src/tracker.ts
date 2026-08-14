import vscode from 'vscode';
import { MODELS } from './consts';
import type { DeepSeekUsage, ModelDefinition } from './types';

/**
 * Persistent session token tracker.
 * Survives VS Code restarts via globalState. Resets daily.
 */
export interface SessionTokens {
	inputTokens: number;
	outputTokens: number;
	requestCount: number;
	/** Estimated cost in USD based on model pricing. */
	costUsd: number;
}

export interface SessionRequest {
	timestamp: number;
	modelId: string;
	modelName: string;
	inputTokens: number;
	outputTokens: number;
	costUsd: number;
}

// Conversation-level grouping intentionally omitted: it would require a stable
// chat/session id from the provider API. Revisit when microsoft/vscode#305853 lands
// and exposes session identity to provideLanguageModelChatResponse().

export interface DailyTokens extends SessionTokens {
	date: string; // YYYY-MM-DD
}

interface PersistedState {
	date: string;
	tokens: SessionTokens;
	requests: SessionRequest[];
	history: DailyTokens[];
}

const STORAGE_KEY = 'deepseek-copilot.tokenTracker';

const emptySession = (): SessionTokens => ({
	inputTokens: 0,
	outputTokens: 0,
	requestCount: 0,
	costUsd: 0,
});

let context: vscode.ExtensionContext | undefined;
let session: SessionTokens = emptySession();
let requests: SessionRequest[] = [];
let history: DailyTokens[] = [];
let date: string = today();

// Build pricing lookup from MODELS const
const pricingMap = new Map<string, { inputPerM: number; outputPerM: number }>();
for (const m of MODELS as ModelDefinition[]) {
	const usd = m.pricing?.USD;
	if (usd) {
		pricingMap.set(m.id, { inputPerM: usd.cacheMissInput, outputPerM: usd.output });
	}
}

function today(): string {
	return new Date().toISOString().slice(0, 10);
}

function calcCost(inputTokens: number, outputTokens: number, modelId: string): number {
	const p = pricingMap.get(modelId);
	if (!p) return 0;
	return (inputTokens / 1_000_000) * p.inputPerM + (outputTokens / 1_000_000) * p.outputPerM;
}

function findModelName(modelId: string): string {
	const m = (MODELS as ModelDefinition[]).find((m) => m.id === modelId);
	return m?.name ?? modelId;
}

function persist(): void {
	if (!context) return;
	const state: PersistedState = {
		date,
		tokens: { ...session },
		requests: [...requests],
		history: [...history],
	};
	void context.globalState.update(STORAGE_KEY, state);
}

export function initTracker(ctx: vscode.ExtensionContext): void {
	context = ctx;
	const saved = ctx.globalState.get<PersistedState>(STORAGE_KEY);
	if (saved?.date === today()) {
		session = saved.tokens ?? emptySession();
		requests = saved.requests ?? [];
		history = saved.history ?? [];
		date = saved.date ?? today();
	} else {
		// New day: save yesterday to history
		if (saved && (saved.tokens?.requestCount ?? 0) > 0) {
			history = [...(saved.history ?? []), { date: saved.date, ...saved.tokens }];
		} else if (saved?.history) {
			history = saved.history;
		}
		session = emptySession();
		requests = [];
		date = today();
		persist();
	}
}

export function clearTracker(): void {
	session = emptySession();
	requests = [];
	history = [];
	date = today();
	if (context) {
		void context.globalState.update(STORAGE_KEY, undefined);
	}
}

export function recordUsage(usage: DeepSeekUsage, modelId?: string): void {
	// Detect date change mid-session
	const d = today();
	if (d !== date) {
		if (session.requestCount > 0) {
			history.push({ date, ...session });
		}
		session = emptySession();
		requests = [];
		date = d;
	}

	const input = usage.prompt_tokens ?? 0;
	const output = usage.completion_tokens ?? 0;
	const cost = modelId ? calcCost(input, output, modelId) : 0;

	session.inputTokens += input;
	session.outputTokens += output;
	session.requestCount += 1;
	session.costUsd += cost;

	requests.push({
		timestamp: Date.now(),
		modelId: modelId ?? 'unknown',
		modelName: findModelName(modelId ?? 'unknown'),
		inputTokens: input,
		outputTokens: output,
		costUsd: cost,
	});

	persist();
}

export function getSessionTokens(): Readonly<SessionTokens> {
	return session;
}

export function getSessionRequests(): readonly SessionRequest[] {
	return requests;
}

export function getDailyHistory(): readonly DailyTokens[] {
	// Include today if there's activity
	const all = [...history];
	if (session.requestCount > 0) {
		all.push({ date, ...session });
	}
	return all;
}

export interface ModelUsage {
	modelId: string;
	modelName: string;
	requestCount: number;
	inputTokens: number;
	outputTokens: number;
	costUsd: number;
}

export function getUsageByModel(): readonly ModelUsage[] {
	const groups = new Map<string, ModelUsage>();
	for (const req of requests) {
		const existing = groups.get(req.modelId);
		if (existing) {
			existing.requestCount += 1;
			existing.inputTokens += req.inputTokens;
			existing.outputTokens += req.outputTokens;
			existing.costUsd += req.costUsd;
		} else {
			groups.set(req.modelId, {
				modelId: req.modelId,
				modelName: req.modelName,
				requestCount: 1,
				inputTokens: req.inputTokens,
				outputTokens: req.outputTokens,
				costUsd: req.costUsd,
			});
		}
	}
	return [...groups.values()];
}
