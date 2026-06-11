import vscode from 'vscode';
import { AuthManager } from '../../auth';
import { getBaseUrl } from '../../config';
import { isOfficialDeepSeekBaseUrl, normalizeBaseUrl } from '../../endpoint';
import { logger } from '../../logger';
import type { PricingCurrency } from '../../types';

const CACHE_KEY = 'deepseek-copilot.balanceCurrency.cache';
const BALANCE_TIMEOUT_MS = 5000;

interface CachedBalanceCurrency {
	readonly version: 1;
	readonly currency: PricingCurrency;
	readonly baseUrl: string;
}

interface DeepSeekBalanceInfo {
	readonly currency?: unknown;
	readonly total_balance?: unknown;
	readonly topped_up_balance?: unknown;
}

interface DeepSeekBalanceResponse {
	readonly balance_infos?: unknown;
}

export class BalanceCurrencyResolver {
	private inFlight: Promise<void> | undefined;
	private controller: AbortController | undefined;
	private generation = 0;
	private resolved: CachedBalanceCurrency | undefined;

	constructor(
		private readonly context: vscode.ExtensionContext,
		private readonly authManager: AuthManager,
		private readonly onDidChangeCurrency: () => void,
	) {}

	getDisplayCurrency(): PricingCurrency | undefined {
		const baseUrl = normalizeBaseUrl(getBaseUrl());
		if (!isOfficialDeepSeekBaseUrl(baseUrl)) {
			return undefined;
		}

		if (this.resolved?.baseUrl === baseUrl) {
			return this.resolved.currency;
		}

		const cached = this.readCache();
		if (cached?.baseUrl === baseUrl) {
			return cached.currency;
		}

		return getLocaleFallbackCurrency();
	}

	refreshInBackground(): void {
		if (this.inFlight || !this.needsRefresh()) {
			return;
		}

		const controller = new AbortController();
		const generation = this.generation;
		const refresh = this.refreshFromBalance(controller, generation)
			.catch((error) => {
				if (!(isAbortError(error) && generation !== this.generation)) {
					logger.warn('Failed to refresh DeepSeek balance currency', error);
				}
			})
			.finally(() => {
				if (this.inFlight === refresh) {
					this.inFlight = undefined;
				}
				if (this.controller === controller) {
					this.controller = undefined;
				}
			});
		this.controller = controller;
		this.inFlight = refresh;
	}

	async invalidate(): Promise<void> {
		this.generation++;
		this.controller?.abort();
		await this.inFlight;
		this.resolved = undefined;
		await this.context.globalState.update(CACHE_KEY, undefined);
	}

	private needsRefresh(): boolean {
		const baseUrl = normalizeBaseUrl(getBaseUrl());
		if (!isOfficialDeepSeekBaseUrl(baseUrl)) {
			return false;
		}

		if (this.resolved?.baseUrl === baseUrl || this.readCache()?.baseUrl === baseUrl) {
			return false;
		}

		return true;
	}

	private async refreshFromBalance(controller: AbortController, generation: number): Promise<void> {
		const baseUrl = normalizeBaseUrl(getBaseUrl());
		if (!isOfficialDeepSeekBaseUrl(baseUrl)) {
			return;
		}

		const apiKey = await this.authManager.getApiKey();
		if (!apiKey) {
			return;
		}

		const currency = await fetchBalanceCurrency(baseUrl, apiKey, controller);
		if (!currency || controller.signal.aborted || generation !== this.generation) {
			return;
		}

		const previous = this.resolved ?? this.readCache();
		this.resolved = { version: 1, currency, baseUrl };
		await this.context.globalState.update(CACHE_KEY, this.resolved);
		if (previous?.baseUrl !== baseUrl || previous.currency !== currency) {
			this.onDidChangeCurrency();
		}
	}

	private readCache(): CachedBalanceCurrency | undefined {
		const value = this.context.globalState.get<unknown>(CACHE_KEY);
		if (!isCachedBalanceCurrency(value)) {
			return undefined;
		}
		return value;
	}
}

function getLocaleFallbackCurrency(): PricingCurrency {
	return vscode.env.language.toLowerCase().startsWith('zh') ? 'CNY' : 'USD';
}

function getBalanceUrl(baseUrl: string): string {
	return new URL('/user/balance', baseUrl).toString();
}

async function fetchBalanceCurrency(
	baseUrl: string,
	apiKey: string,
	controller: AbortController,
): Promise<PricingCurrency | undefined> {
	const timeout = setTimeout(() => controller.abort(), BALANCE_TIMEOUT_MS);

	try {
		const balanceUrl = getBalanceUrl(baseUrl);
		const response = await fetch(balanceUrl, {
			method: 'GET',
			headers: { Authorization: `Bearer ${apiKey}` },
			signal: controller.signal,
		});

		if (!response.ok) {
			logger.debug(`DeepSeek balance request failed with HTTP ${response.status}`);
			return undefined;
		}

		const data = (await response.json()) as DeepSeekBalanceResponse;
		return chooseBalanceCurrency(data);
	} finally {
		clearTimeout(timeout);
	}
}

function chooseBalanceCurrency(data: DeepSeekBalanceResponse): PricingCurrency | undefined {
	if (!Array.isArray(data.balance_infos)) {
		return undefined;
	}

	const infos = data.balance_infos.filter(isDeepSeekBalanceInfo);
	return (
		findCurrencyByPositiveBalance(infos, 'topped_up_balance') ??
		findCurrencyByPositiveBalance(infos, 'total_balance') ??
		infos.map((info) => parsePricingCurrency(info.currency)).find(Boolean)
	);
}

function findCurrencyByPositiveBalance(
	infos: readonly DeepSeekBalanceInfo[],
	key: 'total_balance' | 'topped_up_balance',
): PricingCurrency | undefined {
	for (const info of infos) {
		const currency = parsePricingCurrency(info.currency);
		if (currency && Number(info[key]) > 0) {
			return currency;
		}
	}
	return undefined;
}

function parsePricingCurrency(value: unknown): PricingCurrency | undefined {
	return value === 'USD' || value === 'CNY' ? value : undefined;
}

function isDeepSeekBalanceInfo(value: unknown): value is DeepSeekBalanceInfo {
	return typeof value === 'object' && value !== null;
}

function isAbortError(value: unknown): boolean {
	return value instanceof Error && value.name === 'AbortError';
}

function isCachedBalanceCurrency(value: unknown): value is CachedBalanceCurrency {
	if (typeof value !== 'object' || value === null) {
		return false;
	}

	const cache = value as CachedBalanceCurrency;
	return (
		cache.version === 1 &&
		parsePricingCurrency(cache.currency) !== undefined &&
		typeof cache.baseUrl === 'string'
	);
}
