import { spawnSync } from 'node:child_process';
import vscode from 'vscode';
import { t } from '../i18n';
import { logger } from '../logger';
import { DeepSeekChatProvider } from '../provider';
import {
    getDeepSeekTariffState,
    getDeepSeekTariffStatusText,
    getNextDeepSeekTariffTransition,
    refreshDeepSeekTariffWindowsFromPricingPage,
} from '../tariff';
import { registerActionUrls } from './actions';
import { registerCommands } from './commands';
import { initializeDiagnostics } from './diagnostics';
import { registerProvider } from './provider';
import { showWelcomeIfNeeded } from './welcome';

let activeProvider: DeepSeekChatProvider | undefined;
let lastTransitionWarningKey: string | undefined;
let lastTransitionFiredKey: string | undefined;

function playTariffWarningAudio(): void {
	if (process.platform === 'win32') {
		spawnSync('powershell', [
			'-NoProfile',
			'-Command',
			'[Console]::Beep(880, 180)',
		], {
			stdio: 'ignore',
			windowsHide: true,
		});
		return;
	}
	process.stdout.write('\u0007');
}

function playTariffTransitionAudio(): void {
	if (process.platform === 'win32') {
		spawnSync('powershell', [
			'-NoProfile',
			'-Command',
			'[Console]::Beep(880, 220); Start-Sleep -Milliseconds 80; [Console]::Beep(1040, 260)',
		], {
			stdio: 'ignore',
			windowsHide: true,
		});
		return;
	}
	process.stdout.write('\u0007\u0007');
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
	await initializeDiagnostics(context);
	registerCommands(context);
	registerActionUrls(context);

	const tariffStatusItem = vscode.window.createStatusBarItem(
		vscode.StatusBarAlignment.Right,
		100,
	);
	tariffStatusItem.name = 'DeepSeek Tariff';
	tariffStatusItem.command = 'deepseek-copilot.openSettings';
	context.subscriptions.push(tariffStatusItem);

	const updateTariffStatus = () => {
		const now = new Date();
		const state = getDeepSeekTariffState(now);
		const config = vscode.workspace.getConfiguration('deepseek-copilot');
		const warningThresholdMinutes = config.get<number>('tariff.transitionWarningMinutes', 5);
		const warningThresholdMs = Math.max(1, warningThresholdMinutes) * 60 * 1000;
		const nextTransition = getNextDeepSeekTariffTransition(now);
		const warningWindowActive =
			nextTransition !== undefined &&
			nextTransition.remainingMs <= warningThresholdMs &&
			nextTransition.remainingMs > 0;
		const transitionHappenedNow =
			nextTransition !== undefined && nextTransition.remainingMs <= 1000 && nextTransition.remainingMs >= 0;
		const warningPrefix = warningWindowActive ? '$(alert) ' : '';
		const statusLabel = state === 'peak' ? '$(flame)' : '$(pulse)';
		tariffStatusItem.text = `${warningPrefix}${statusLabel} DeepSeek: ${getDeepSeekTariffStatusText()}`;
		tariffStatusItem.backgroundColor = warningWindowActive
			? new vscode.ThemeColor('statusBarItem.warningBackground')
			: transitionHappenedNow
				? new vscode.ThemeColor('statusBarItem.prominentBackground')
				: undefined;
		tariffStatusItem.color = warningWindowActive
			? new vscode.ThemeColor('statusBarItem.warningForeground')
			: transitionHappenedNow
				? new vscode.ThemeColor('statusBarItem.prominentForeground')
				: undefined;
		tariffStatusItem.tooltip = `DeepSeek model tariff: ${state === 'peak' ? 'Peak pricing is active (2x)' : 'Off-peak pricing is active (1/2 price)'} for the selected DeepSeek model.`;
		tariffStatusItem.show();

		if (!warningWindowActive && !transitionHappenedNow) {
			lastTransitionWarningKey = undefined;
			lastTransitionFiredKey = undefined;
			return;
		}

		const key = `${nextTransition.at.toISOString()}-${nextTransition.from}->${nextTransition.to}`;
		if (warningWindowActive) {
			if (lastTransitionWarningKey === key) {
				return;
			}
			lastTransitionWarningKey = key;
			const alertsEnabled = config.get<boolean>('tariff.transitionAlerts', true);
			if (!alertsEnabled) {
				return;
			}
			const audioEnabled = config.get<boolean>('tariff.transitionAudio', true);
			const direction = nextTransition.to === 'peak' ? 'on-peak' : 'off-peak';
			const remainingMinutes = Math.max(1, Math.ceil(nextTransition.remainingMs / 60000));
			void vscode.window.showWarningMessage(
				`DeepSeek tariff change in ${remainingMinutes} minute${remainingMinutes === 1 ? '' : 's'}: ${direction} begins at ${nextTransition.at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZone: 'UTC', hour12: false })} UTC.`,
			);
			if (audioEnabled) {
				playTariffWarningAudio();
			}
			return;
		}

		if (transitionHappenedNow && lastTransitionFiredKey !== key) {
			lastTransitionFiredKey = key;
			const alertsEnabled = config.get<boolean>('tariff.transitionAlerts', true);
			const audioEnabled = config.get<boolean>('tariff.transitionAudio', true);
			const direction = nextTransition.to === 'peak' ? 'on-peak' : 'off-peak';
			if (alertsEnabled) {
				void vscode.window.showInformationMessage(
					`DeepSeek tariff transition: ${direction} has started. Current mode is ${nextTransition.to.toUpperCase()}.`,
				);
			}
			if (audioEnabled) {
				playTariffTransitionAudio();
			}
		}
	};

	updateTariffStatus();
	const timer = setInterval(updateTariffStatus, 1000);
	context.subscriptions.push({ dispose: () => clearInterval(timer) });

	const refreshTariffSchedule = () =>
		void refreshDeepSeekTariffWindowsFromPricingPage(
			'https://api-docs.deepseek.com/quick_start/pricing',
			context.globalState,
		).then((windows) => {
			const previous = context.globalState.get<{ windows: typeof windows; footnote?: string }>(
				'deepseek-copilot.tariff.schedule',
			);
			if (previous && previous.windows && previous.windows.length > 0) {
				const changed = !previous.windows.every((window, index) => {
					const next = windows[index];
					return next && window.startHourUtc === next.startHourUtc && window.endHourUtc === next.endHourUtc;
				});
				if (changed) {
					logger.info(`DeepSeek tariff schedule changed, refreshed windows=${JSON.stringify(windows)}`);
				}
			}
		}).catch((error) => {
			logger.warn('Failed to refresh DeepSeek tariff schedule from pricing page', error);
		});
	refreshTariffSchedule();
	const tariffRefreshTimer = setInterval(refreshTariffSchedule, 60 * 60 * 1000);
	context.subscriptions.push({ dispose: () => clearInterval(tariffRefreshTimer) });

	try {
		const provider = await registerProvider(context);
		activeProvider = provider;

		void showWelcomeIfNeeded(context, provider).catch((error) => {
			logger.warn(t('extension.welcomeFailed'), error);
		});

		logger.info(`Extension activated version=${context.extension.packageJSON.version}`);
	} catch (error) {
		activeProvider = undefined;
		logger.error('Failed to activate DeepSeek extension', error);
		void vscode.window.showErrorMessage(t('extension.activateFailed'));
		throw error;
	}
}

export async function deactivate(): Promise<void> {
	try {
		await activeProvider?.prepareForDeactivate();
	} catch (error) {
		logger.warn(t('extension.deactivateFailed'), error);
	} finally {
		activeProvider = undefined;
		logger.info('Extension deactivated');
		logger.dispose();
	}
}
