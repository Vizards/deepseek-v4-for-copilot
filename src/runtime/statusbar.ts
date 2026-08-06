import vscode from 'vscode';
import { AuthManager } from '../auth';
import { getBalanceRefreshIntervalMs } from '../config';
import { t } from '../i18n';
import { fetchBalance } from '../provider/pricing/balance';

const DISPLAY_ENABLED_KEY = 'deepseek-copilot.balanceDisplayEnabled';

function currencySymbol(currency: string): string {
	if (currency === 'CNY') return '¥';
	if (currency === 'USD') return '$';
	return '';
}

export class BalanceStatusBar {
	private readonly context: vscode.ExtensionContext;
	private readonly item: vscode.StatusBarItem;
	private readonly auth: AuthManager;
	private timer: ReturnType<typeof setInterval> | undefined;

	constructor(context: vscode.ExtensionContext) {
		this.context = context;
		this.auth = new AuthManager(context);
		this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
		this.item.command = 'deepseek-copilot.refreshBalance';
		context.subscriptions.push(
			this.item,
			{ dispose: () => this.dispose() },
			vscode.commands.registerCommand('deepseek-copilot.refreshBalance', () =>
				void this.refresh(),
			),
			vscode.commands.registerCommand('deepseek-copilot.toggleBalanceDisplay', () =>
				void this.toggleDisplay(),
			),
			vscode.workspace.onDidChangeConfiguration((e) => {
				if (e.affectsConfiguration('deepseek-copilot.balanceRefreshInterval')) {
					this.restartTimer();
				}
			}),
		);

		if (this.isDisplayEnabled()) {
			void this.refresh();
			this.startTimer();
		}
	}

	private isDisplayEnabled(): boolean {
		return this.context.globalState.get<boolean>(DISPLAY_ENABLED_KEY, true);
	}

	private startTimer(): void {
		const intervalMs = getBalanceRefreshIntervalMs();
		if (intervalMs > 0) {
			this.timer = setInterval(() => void this.refresh(), intervalMs);
		}
	}

	private restartTimer(): void {
		if (this.timer !== undefined) {
			clearInterval(this.timer);
			this.timer = undefined;
		}
		if (this.isDisplayEnabled()) {
			this.startTimer();
		}
	}

	private dispose(): void {
		if (this.timer !== undefined) {
			clearInterval(this.timer);
			this.timer = undefined;
		}
	}

	private async toggleDisplay(): Promise<void> {
		const enabling = !this.isDisplayEnabled();
		await this.context.globalState.update(DISPLAY_ENABLED_KEY, enabling);

		if (enabling) {
			void this.refresh();
			this.startTimer();
			void vscode.window.showInformationMessage(t('balance.display.enabled'));
		} else {
			if (this.timer !== undefined) {
				clearInterval(this.timer);
				this.timer = undefined;
			}
			this.item.hide();
			void vscode.window.showInformationMessage(t('balance.display.disabled'));
		}
	}

	private async refresh(): Promise<void> {
		if (!this.isDisplayEnabled()) {
			return;
		}

		const apiKey = await this.auth.getApiKey();
		if (!apiKey) {
			this.item.hide();
			return;
		}

		try {
			const result = await fetchBalance(apiKey);
			if (!result.entries.length) {
				this.item.hide();
				return;
			}

			const primary = result.entries[0];
			const symbol = currencySymbol(primary.currency);
			this.item.text = t('balance.statusBar.text', symbol, primary.total_balance);
			this.item.tooltip = result.entries
				.map((e) =>
					t('balance.entry', e.currency, e.total_balance, e.topped_up_balance, e.granted_balance),
				)
				.join('\n');
			this.item.show();
		} catch {
			this.item.hide();
		}
	}
}
