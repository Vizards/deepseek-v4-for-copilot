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
 * Accumulated token summary for the current session.
 */
export interface TokenSummary {
	promptTokens: number;
	completionTokens: number;
	totalTokens: number;
	cacheHitTokens: number;
	cacheMissTokens: number;
}

/**
 * Session-scoped token usage accumulator.
 *
 * Collects DeepSeek API `usage` data across all requests and provides
 * running totals consumed by the status bar display.
 */
export class TokenUsageTracker {
	private promptTokens = 0;
	private completionTokens = 0;
	private cacheHitTokens = 0;
	private cacheMissTokens = 0;

	/** Called after each `add()` to notify the status bar. */
	private onUpdate: (() => void) | undefined;

	/**
	 * Register a callback that fires after every usage update.
	 * Typically set by `createStatusBarItem` to repaint the bar.
	 */
	setOnUpdate(callback: () => void): void {
		this.onUpdate = callback;
	}

	/**
	 * Accumulate a single API response's usage into the session totals.
	 */
	add(usage: DeepSeekUsage): void {
		this.promptTokens += usage.prompt_tokens;
		this.completionTokens += usage.completion_tokens;
		this.cacheHitTokens += usage.prompt_cache_hit_tokens ?? 0;
		this.cacheMissTokens += usage.prompt_cache_miss_tokens ?? 0;

		this.onUpdate?.();
	}

	/**
	 * Reset all session counters to zero.
	 */
	reset(): void {
		this.promptTokens = 0;
		this.completionTokens = 0;
		this.cacheHitTokens = 0;
		this.cacheMissTokens = 0;

		this.onUpdate?.();
	}

	/**
	 * Return the current accumulated totals.
	 */
	getSummary(): TokenSummary {
		return {
			promptTokens: this.promptTokens,
			completionTokens: this.completionTokens,
			totalTokens: this.promptTokens + this.completionTokens,
			cacheHitTokens: this.cacheHitTokens,
			cacheMissTokens: this.cacheMissTokens,
		};
	}
}

// ---- Locale-aware number formatting ----

const nf = new Intl.NumberFormat();

function fmt(n: number): string {
	return nf.format(n);
}

// ---- Status bar item factory ----

/**
 * Determine the warning threshold colour for the status bar based on
 * total (prompt + completion) usage relative to the model context limit.
 *
 * We use the first model's `maxInputTokens` (all current models share the
 * same 1,048,576 limit) as the reference ceiling.
 */
const CONTEXT_LIMIT = MODELS[0]?.maxInputTokens ?? 1_048_576;

/**
 * Create and register a VS Code status bar item that displays the current
 * session's token usage.
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

	function update(): void {
		const s = tracker.getSummary();

		// Hide when no tokens have been consumed yet.
		if (s.totalTokens === 0) {
			item.hide();
			return;
		}

		item.text = `🧠 ${fmt(s.totalTokens)} / ${fmt(CONTEXT_LIMIT)} tok`;

		item.tooltip = new vscode.MarkdownString(
			[
				'**DeepSeek Token Usage (this session)**',
				'',
				`| | |`,
				`|---|---:|`,
				`| Prompt tokens | ${fmt(s.promptTokens)} |`,
				`| Completion tokens | ${fmt(s.completionTokens)} |`,
				`| **Total tokens** | **${fmt(s.totalTokens)}** |`,
				`| | |`,
				`| Context limit | ${fmt(CONTEXT_LIMIT)} |`,
				`| Cache hit tokens | ${fmt(s.cacheHitTokens)} |`,
			].join('\n'),
		);
		item.tooltip.isTrusted = true;

		// Color thresholds
		const ratio = s.totalTokens / CONTEXT_LIMIT;
		if (ratio > 0.95) {
			item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
		} else if (ratio > 0.80) {
			item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
		} else {
			item.backgroundColor = undefined;
		}

		item.show();
	}

	// Wire the tracker update callback to our status bar repaint.
	tracker.setOnUpdate(() => update());

	// Initial paint (hidden state — no tokens yet).
	update();

	context.subscriptions.push(item);

	logger.info('Token usage status bar created');

	return item;
}
