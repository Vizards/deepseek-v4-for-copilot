import * as vscode from 'vscode';
import { t } from './i18n';

/**
 * 上下文显示 —— 类似 Copilot 的状态栏上下文指示器。
 *
 * 状态栏：`$(chip) V4 Pro ▓▓▓░░ 45%`（5段进度条 + 百分比）
 * Tooltip：完整用量面板含10段进度条
 * 会话持久化：关闭 VS Code 重开自动恢复上次用量
 */

const STATE_KEY = 'deepseek-copilot.contextState';

/** 1M 上下文窗口 */
const CTX_MAX = 1_048_576;

/** 状态栏进度条段数（紧凑） */
const BAR_SM = 5;

/** Tooltip / 详细面板进度条段数 */
const BAR_LG = 10;

export interface UsageSnapshot {
	promptTokens: number;
	completionTokens: number;
	totalTokens: number;
	cacheHitTokens: number;
	cacheMissTokens: number;
	charsPerToken: number;
}

export interface ContextState {
	lastModelId: string;
	lastThinkingEffort: string;
	lastUsage: UsageSnapshot | null;
}

// ---- 工具函数 ----

function fmtNum(n: number): string {
	if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
	if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
	return String(n);
}

function fmtPct(hit: number, miss: number): string {
	const t = hit + miss;
	return t > 0 ? ((hit / t) * 100).toFixed(0) + '%' : '—';
}

/** 进度条：█（实心）+ ░（空） */
function bar(used: number, max: number, segs: number): string {
	const f = Math.round(Math.min(used / max, 1) * segs);
	return '█'.repeat(f) + '░'.repeat(segs - f);
}

export class ContextDisplay {
	private readonly item: vscode.StatusBarItem;
	private readonly store: vscode.Memento;
	private state: ContextState = {
		lastModelId: 'deepseek',
		lastThinkingEffort: 'high',
		lastUsage: null,
	};

	constructor(context: vscode.ExtensionContext) {
		this.store = context.globalState;
		context.subscriptions.push(this);

		this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99);
		this.item.name = 'DeepSeek Context';
		// 点击状态栏 → 打开 DeepSeek 输出日志
		this.item.command = 'deepseek-copilot.showLogs';

		this.restore();
	}

	dispose(): void {
		this.save();
		this.item.dispose();
	}

	/** 新 API 用量数据到来 */
	update(modelId: string, thinkingEffort: string, usage: UsageSnapshot): void {
		this.state = { lastModelId: modelId, lastThinkingEffort: thinkingEffort, lastUsage: usage };
		this.save();
		this.refresh();
	}

	// ---- 持久化 ----

	private save(): void {
		try { void this.store.update(STATE_KEY, this.state); } catch { /* noop */ }
	}

	private restore(): void {
		try {
			const s = this.store.get<ContextState>(STATE_KEY);
			if (s?.lastUsage) this.state = s;
		} catch { /* noop */ }
		this.refresh();
	}

	// ---- 渲染 ----

	private refresh(): void {
		const u = this.state.lastUsage;
		const name = alias(this.state.lastModelId);

		if (!u) {
			this.item.text = `$(chip) ${name}`;
			this.item.tooltip = t('status.noData');
			this.item.show();
			return;
		}

		const ratio = Math.min(u.promptTokens / CTX_MAX, 1);
		const pct = Math.round(ratio * 100);
		const compactBar = bar(u.promptTokens, CTX_MAX, BAR_SM);

		this.item.text = `$(chip) ${name} ${compactBar} ${pct}%`;
		this.item.tooltip = this.buildTooltip();
		this.item.show();
	}

	private buildTooltip(): vscode.MarkdownString {
		const u = this.state.lastUsage!;
		const ratio = Math.min(u.promptTokens / CTX_MAX, 1);
		const pct = Math.round(ratio * 100);
		// 纯 █ / ░，不用 code fence
		const fullBar = '█'.repeat(Math.round(ratio * BAR_LG)) + '░'.repeat(Math.max(0, BAR_LG - Math.round(ratio * BAR_LG)));

		const md = new vscode.MarkdownString();
		md.isTrusted = true;
		md.supportHtml = false;

		md.appendMarkdown(`**${alias(this.state.lastModelId)}** · *${thinkLabel(this.state.lastThinkingEffort)}*\n\n`);
		// 进度条：加粗纯文本
		md.appendMarkdown(`**${fullBar}  ${pct}%**\n\n`);
		// 用量摘要
		md.appendMarkdown(`*${fmtNum(u.promptTokens)} / ${fmtNum(CTX_MAX)}  ${t('status.promptTokens')}*\n\n`);

		const kv = (k: string, v: string) => `- **${k}**: \`${v}\`  \n`;

		md.appendMarkdown(kv(t('status.promptTokens'),     u.promptTokens.toLocaleString()));
		md.appendMarkdown(kv(t('status.completionTokens'), u.completionTokens.toLocaleString()));
		md.appendMarkdown(kv(t('status.totalTokens'),      u.totalTokens.toLocaleString()));
		md.appendMarkdown(kv(t('status.cacheHit'),         u.cacheHitTokens.toLocaleString()));
		md.appendMarkdown(kv(t('status.cacheMiss'),        u.cacheMissTokens.toLocaleString()));
		md.appendMarkdown(kv(t('status.cacheRate'),        fmtPct(u.cacheHitTokens, u.cacheMissTokens)));
		md.appendMarkdown(kv(t('status.charsPerToken'),    u.charsPerToken.toFixed(2)));

		md.appendMarkdown(`\n---\n\n*${t('status.clickForDetail')}*`);
		return md;
	}

}

/** 模型简称 */
function alias(id: string): string {
	if (id === 'deepseek-v4-pro') return 'V4 Pro';
	if (id === 'deepseek-v4-flash') return 'V4 Flash';
	return id;
}

/** 思考模式标签 */
function thinkLabel(effort: string): string {
	if (effort === 'none') return t('thinking.none');
	if (effort === 'max') return t('thinking.max');
	return t('thinking.high');
}
