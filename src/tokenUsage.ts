import vscode from 'vscode';
import { MODELS } from './consts';
import { logger } from './logger';

/**
 * Usage data returned by the DeepSeek API for a single response.
 */
export interface DeepSeekUsage {
	readonly prompt_tokens: number;
	readonly completion_tokens: number;
	readonly total_tokens: number;
	readonly prompt_cache_hit_tokens?: number;
	readonly prompt_cache_miss_tokens?: number;
}

/**
 * Per-model pricing for 1 million tokens.
 *
 * Values sourced from https://api-docs.deepseek.com/quick_start/pricing.
 * CNY rates use DeepSeek's internal billing rate of 1 USD = 3.65 CNY.
 */
export interface ModelPricing {
	cacheHitUsd: number;
	cacheHitCny: number;
	cacheMissUsd: number;
	cacheMissCny: number;
	outputUsd: number;
	outputCny: number;
}

/**
 * Hardcoded pricing table — no network calls.
 * Keys must match the model IDs in `MODELS` (./consts.ts).
 */
const PRICING: Record<string, ModelPricing> = {
	'deepseek-v4-flash': {
		cacheHitUsd: 0.028,
		cacheHitCny: 0.1022,
		cacheMissUsd: 0.140,
		cacheMissCny: 0.5110,
		outputUsd: 0.280,
		outputCny: 1.0220,
	},
	'deepseek-v4-pro': {
		cacheHitUsd: 0.145,
		cacheHitCny: 0.5293,
		cacheMissUsd: 1.740,
		cacheMissCny: 6.3510,
		outputUsd: 3.480,
		outputCny: 12.7020,
	},
};

/**
 * Token summary containing both the last request detail and cumulative
 * session totals, along with cost and pricing information.
 */
export interface TokenSummary {
	// Last request (for status bar display)
	lastPromptTokens: number;
	lastCompletionTokens: number;
	lastCacheHitTokens: number;

	// Session totals (for tooltip cumulative section)
	sessionPromptTokens: number;
	sessionCompletionTokens: number;
	sessionTotalTokens: number;
	sessionCacheHitTokens: number;

	// Cost (last request)
	lastCostUsd: number;
	lastCostCny: number;

	// Cost (session cumulative)
	sessionCostUsd: number;
	sessionCostCny: number;

	// Pricing info
	modelId: string;
	pricing: ModelPricing | null;

	// Limit
	contextLimit: number;
}

/**
 * Session-scoped token usage accumulator.
 *
 * Collects DeepSeek API `usage` data across all requests, tracking both
 * the **most recent request** (overwritten on each `add()`) and
 * **cumulative session totals** (accumulated across all calls).
 *
 * The status bar displays the last-request prompt tokens so the number
 * never exceeds the context limit under normal Copilot usage (since
 * Copilot truncates conversation history before each request).
 */
export class TokenUsageTracker {
	/** Context limit derived from the first registered model. */
	private readonly contextLimit: number;

	/** Active model ID used to look up pricing. */
	private currentModelId: string = 'deepseek-v4-flash';

	// Last request (overwritten on each add())
	private lastPromptTokens = 0;
	private lastCompletionTokens = 0;
	private lastCacheHitTokens = 0;
	private lastCostUsd = 0;
	private lastCostCny = 0;

	// Session totals (accumulated across all requests)
	private sessionPromptTokens = 0;
	private sessionCompletionTokens = 0;
	private sessionCacheHitTokens = 0;
	private sessionCostUsd = 0;
	private sessionCostCny = 0;

	/** Called after each `add()` to notify the status bar. */
	private onUpdate: (() => void) | undefined;

	constructor() {
		this.contextLimit = MODELS[0]?.maxInputTokens ?? 1_048_576;
	}

	/**
	 * Register a callback that fires after every usage update.
	 * Typically set by `createStatusBarItem` to repaint the bar.
	 */
	setOnUpdate(callback: () => void): void {
		this.onUpdate = callback;
	}

	/**
	 * Set the active model ID for cost calculation.
	 * Called at the start of each request in `provideLanguageModelChatResponse`.
	 */
	setModel(modelId: string): void {
		this.currentModelId = modelId;
	}

	/**
	 * Accumulate a single API response's usage.
	 *
	 * - Last-request fields (including costs) are **overwritten** with the current response.
	 * - Session totals are **accumulated** across all responses.
	 */
	add(usage: DeepSeekUsage): void {
		const pricing = PRICING[this.currentModelId] ?? null;
		const cacheHit = usage.prompt_cache_hit_tokens ?? 0;
		const cacheMiss = usage.prompt_tokens - cacheHit;
		const output = usage.completion_tokens;

		// Update last request (overwrite)
		this.lastPromptTokens = usage.prompt_tokens;
		this.lastCompletionTokens = usage.completion_tokens;
		this.lastCacheHitTokens = cacheHit;

		if (pricing) {
			this.lastCostUsd =
				calcCost(cacheHit, pricing.cacheHitUsd) +
				calcCost(cacheMiss, pricing.cacheMissUsd) +
				calcCost(output, pricing.outputUsd);
			this.lastCostCny =
				calcCost(cacheHit, pricing.cacheHitCny) +
				calcCost(cacheMiss, pricing.cacheMissCny) +
				calcCost(output, pricing.outputCny);
		} else {
			this.lastCostUsd = 0;
			this.lastCostCny = 0;
		}

		// Update session totals (accumulate)
		this.sessionPromptTokens += usage.prompt_tokens;
		this.sessionCompletionTokens += usage.completion_tokens;
		this.sessionCacheHitTokens += cacheHit;
		this.sessionCostUsd += this.lastCostUsd;
		this.sessionCostCny += this.lastCostCny;

		this.onUpdate?.();
	}

	/**
	 * Reset all counters (both last-request and session) to zero.
	 */
	reset(): void {
		this.lastPromptTokens = 0;
		this.lastCompletionTokens = 0;
		this.lastCacheHitTokens = 0;
		this.lastCostUsd = 0;
		this.lastCostCny = 0;
		this.sessionPromptTokens = 0;
		this.sessionCompletionTokens = 0;
		this.sessionCacheHitTokens = 0;
		this.sessionCostUsd = 0;
		this.sessionCostCny = 0;

		this.onUpdate?.();
	}

	/**
	 * Return the current summary with both last-request and session data.
	 */
	getSummary(): TokenSummary {
		const pricing = PRICING[this.currentModelId] ?? null;
		return {
			lastPromptTokens: this.lastPromptTokens,
			lastCompletionTokens: this.lastCompletionTokens,
			lastCacheHitTokens: this.lastCacheHitTokens,
			lastCostUsd: this.lastCostUsd,
			lastCostCny: this.lastCostCny,
			sessionPromptTokens: this.sessionPromptTokens,
			sessionCompletionTokens: this.sessionCompletionTokens,
			sessionTotalTokens: this.sessionPromptTokens + this.sessionCompletionTokens,
			sessionCacheHitTokens: this.sessionCacheHitTokens,
			sessionCostUsd: this.sessionCostUsd,
			sessionCostCny: this.sessionCostCny,
			modelId: this.currentModelId,
			pricing,
			contextLimit: this.contextLimit,
		};
	}

	/**
	 * Expose the context limit for external use (e.g. provider logging).
	 */
	getContextLimit(): number {
		return this.contextLimit;
	}
}

// ---- Locale-aware number formatting ----

const nf = new Intl.NumberFormat();

function fmt(n: number): string {
	return nf.format(n);
}

/**
 * Calculate cost from token count and price per 1M tokens.
 */
function calcCost(tokens: number, pricePerMillion: number): number {
	return (tokens / 1_000_000) * pricePerMillion;
}

/**
 * Format a cost value for display with appropriate precision.
 * Shows exponential notation for extremely small amounts.
 */
function fmtCost(usd: number, cny: number): string {
	const usdStr = usd < 0.000001 ? `$${usd.toExponential(2)}` : `$${usd.toFixed(6)}`;
	const cnyStr = cny < 0.000001 ? `¥${cny.toExponential(2)}` : `¥${cny.toFixed(6)}`;
	return `${usdStr}  ${cnyStr}`;
}

/**
 * Build a rich hover tooltip using MarkdownString, styled like GitHub
 * Copilot's native VS Code tooltips — clean tables, minimal formatting.
 *
 * Returns a `MarkdownString` with `isTrusted = true` so VS Code renders
 * it as interactive content that supports proper formatting.
 */
function buildTooltip(s: TokenSummary): vscode.MarkdownString {
	const md = new vscode.MarkdownString();
	md.isTrusted = true;

	// ── Header ──
	md.appendMarkdown('**🧠 DeepSeek Token Usage**\n\n');

	// ── Last Request section ──
	md.appendMarkdown('| | |\n|---|---|\n');
	md.appendMarkdown(`| **Last Request** | |\n`);
	md.appendMarkdown(`| Prompt tokens | \`${fmt(s.lastPromptTokens)}\` |\n`);
	md.appendMarkdown(`| Completion | \`${fmt(s.lastCompletionTokens)}\` |\n`);
	md.appendMarkdown(`| Cost | \`${fmtCost(s.lastCostUsd, s.lastCostCny)}\` |\n`);

	md.appendMarkdown('\n---\n\n');

	// ── This Session section ──
	md.appendMarkdown('| | |\n|---|---|\n');
	md.appendMarkdown(`| **This Session (cumulative)** | |\n`);
	md.appendMarkdown(`| Prompt tokens | \`${fmt(s.sessionPromptTokens)}\` |\n`);
	md.appendMarkdown(`| Completion | \`${fmt(s.sessionCompletionTokens)}\` |\n`);
	md.appendMarkdown(`| Total tokens | \`${fmt(s.sessionTotalTokens)}\` |\n`);
	md.appendMarkdown(`| Cost | \`${fmtCost(s.sessionCostUsd, s.sessionCostCny)}\` |\n`);

	md.appendMarkdown('\n---\n\n');

	// ── Context info ──
	md.appendMarkdown('| | |\n|---|---|\n');
	md.appendMarkdown(`| Context limit | \`${fmt(s.contextLimit)}\` |\n`);
	md.appendMarkdown(`| Cache hit tokens | \`${fmt(s.sessionCacheHitTokens)}\` |\n`);

	// ── Warning if exceeded ──
	if (s.lastPromptTokens > s.contextLimit) {
		md.appendMarkdown('\n> ⚠️ Last request exceeded context limit by ');
		md.appendMarkdown(`**${fmt(s.lastPromptTokens - s.contextLimit)}** tokens\n`);
	}

	md.appendMarkdown('\n---\n\n');

	// ── Pricing section ──
	if (s.pricing) {
		md.appendMarkdown(`_${s.modelId}_ — `);
		md.appendMarkdown(`Cache hit: \`$${s.pricing.cacheHitUsd}\`, `);
		md.appendMarkdown(`Cache miss: \`$${s.pricing.cacheMissUsd}\`, `);
		md.appendMarkdown(`Output: \`$${s.pricing.outputUsd}\` `);
		md.appendMarkdown('per 1M tokens\n');
	} else {
		md.appendMarkdown('_Pricing not available for this model_\n');
	}

	md.appendMarkdown('\n---\n\n');
	md.appendMarkdown('_Click to open DeepSeek logs_');

	return md;
}

// ---- Persistent detail view (QuickPick) ----

/**
 * Show a QuickPick with the full token usage breakdown.
 *
 * QuickPick stays open until the user explicitly dismisses it (Esc / click
 * away), providing a persistent view that complements the transient hover
 * tooltip (which closes on mouse-out from the status bar — VS Code API
 * limitation).
 */
let activeQuickPick: vscode.QuickPick<vscode.QuickPickItem> | undefined;

function showUsageQuickPick(s: TokenSummary, tracker: TokenUsageTracker): void {
	// Dispose any previously open QuickPick to avoid stacking.
	activeQuickPick?.dispose();

	const quickPick = vscode.window.createQuickPick();
	activeQuickPick = quickPick;
	quickPick.title = 'DeepSeek Token Usage';
	quickPick.placeholder = 'Token usage details — press Escape to close';
	quickPick.matchOnDescription = true;

	const exceeded = s.lastPromptTokens > s.contextLimit;
	const pct = ((s.lastPromptTokens / s.contextLimit) * 100).toFixed(1);

	const items: vscode.QuickPickItem[] = [
		// ── Last Request heading ──
		{
			label: '$(symbol-numeric)  Last Request',
			kind: vscode.QuickPickItemKind.Separator,
		},
		{
			label: `$(eye)  Prompt tokens`,
			description: `${fmt(s.lastPromptTokens)}`,
		},
		{
			label: `$(check)  Completion tokens`,
			description: `${fmt(s.lastCompletionTokens)}`,
		},
		{
			label: `$(dollar)  Cost`,
			description: `${fmtCost(s.lastCostUsd, s.lastCostCny)}`,
		},
		{
			label: `$(graph)  Context used`,
			description: `${pct}%`,
		},
	];

	// Warning item if exceeded
	if (exceeded) {
		items.push({
			label: `$(warning)  Exceeded limit by ${fmt(s.lastPromptTokens - s.contextLimit)} tokens`,
			kind: vscode.QuickPickItemKind.Separator,
		});
	}

	items.push(
		// ── Session heading ──
		{
			label: '$(history)  This Session (cumulative)',
			kind: vscode.QuickPickItemKind.Separator,
		},
		{
			label: `$(eye)  Prompt tokens`,
			description: `${fmt(s.sessionPromptTokens)}`,
		},
		{
			label: `$(check)  Completion tokens`,
			description: `${fmt(s.sessionCompletionTokens)}`,
		},
		{
			label: `$(symbol-numeric)  Total tokens`,
			description: `${fmt(s.sessionTotalTokens)}`,
		},
		{
			label: `$(dollar)  Total cost`,
			description: `${fmtCost(s.sessionCostUsd, s.sessionCostCny)}`,
		},
		{
			label: `$(database)  Cache hit tokens`,
			description: `${fmt(s.sessionCacheHitTokens)}`,
		},
		{
			label: `$(warning)  Context limit`,
			description: `${fmt(s.contextLimit)}`,
		},
	);

	// Pricing section
	if (s.pricing) {
		items.push(
			{
				label: '$(gear)  Pricing (per 1M tokens)',
				kind: vscode.QuickPickItemKind.Separator,
			},
			{
				label: `$(zap)  ${s.modelId}`,
			},
			{
				label: `Cache hit input`,
				description: `$${s.pricing.cacheHitUsd}  ¥${s.pricing.cacheHitCny}`,
			},
			{
				label: `Cache miss input`,
				description: `$${s.pricing.cacheMissUsd}  ¥${s.pricing.cacheMissCny}`,
			},
			{
				label: `Output`,
				description: `$${s.pricing.outputUsd}  ¥${s.pricing.outputCny}`,
			},
		);
	} else {
		items.push({
			label: `$(warning)  Pricing: Unknown model — not available`,
			kind: vscode.QuickPickItemKind.Separator,
		});
	}

	quickPick.items = items;

	// Footer action: reset session
	quickPick.buttons = [
		{
			iconPath: new vscode.ThemeIcon('refresh'),
			tooltip: 'Reset Session Counter',
		},
	];

	quickPick.onDidTriggerButton(() => {
		tracker.reset();
		quickPick.hide();
	});

	quickPick.onDidHide(() => {
		activeQuickPick = undefined;
		quickPick.dispose();
	});

	quickPick.show();
}

// ---- Status bar item factory ----

/**
 * Create and register a VS Code status bar item that displays the token
 * usage of the **most recent request** against the model context limit.
 *
 * The displayed number is `lastPromptTokens` (not the accumulated session
 * total), so it always stays within the context limit under normal Copilot
 * usage (since Copilot truncates conversation history before each request).
 *
 * The returned item is already pushed into `context.subscriptions` and will
 * be automatically disposed when the extension deactivates.
 */
export function createStatusBarItem(
	context: vscode.ExtensionContext,
	tracker: TokenUsageTracker,
): vscode.StatusBarItem {
	const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
	item.name = 'DeepSeek Token Usage';
	item.command = 'deepseek-copilot.showLogs';

	/** Cache the last tooltip markdown so we only reassign when content
	 *  actually changes — prevents disrupting an active hover. */
	let previousTooltipMd: string | undefined;

	function update(): void {
		const s = tracker.getSummary();

		// Hide when no tokens have been consumed yet.
		if (s.sessionTotalTokens === 0) {
			item.hide();
			return;
		}

		// Text — show last-request prompt tokens, not session total
		const exceeded = s.lastPromptTokens > s.contextLimit;
		const prefix = exceeded ? '⚠️ ' : '🧠 ';
		item.text = `${prefix}${fmt(s.lastPromptTokens)} / ${fmt(s.contextLimit)} tok`;

		// Tooltip — build MarkdownString, but only reassign when the
		// underlying markdown content differs.  Reassigning an identical
		// tooltip while the user is hovering can cause it to flicker or
		// remain visible after mouse-out.
		const newMd = buildTooltip(s);
		if (newMd.value !== previousTooltipMd) {
			item.tooltip = newMd;
			previousTooltipMd = newMd.value;
		}

		// Color — based on last-request percentage of context limit
		const pct = s.lastPromptTokens / s.contextLimit;
		if (pct >= 0.95 || exceeded) {
			item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
		} else if (pct >= 0.80) {
			item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
		} else {
			item.backgroundColor = undefined;
		}

		item.show();
	}

	// Register the click command to show the persistent QuickPick view.
	context.subscriptions.push(
		vscode.commands.registerCommand('deepseek-copilot.showTokenUsage', () => {
			showUsageQuickPick(tracker.getSummary(), tracker);
		}),
	);

	// Override the click command to show the QuickPick instead of raw logs.
	item.command = 'deepseek-copilot.showTokenUsage';

	// Wire the tracker update callback to our status bar repaint.
	tracker.setOnUpdate(() => update());

	// Initial paint (hidden state — no tokens yet).
	update();

	context.subscriptions.push(item);

	logger.info('Token usage status bar created');

	return item;
}
