import { getBaseUrl } from '../../config';
import { normalizeBaseUrl } from '../../endpoint';

const BALANCE_TIMEOUT_MS = 8000;

export interface BalanceEntry {
	readonly currency: string;
	readonly total_balance: string;
	readonly topped_up_balance: string;
	readonly granted_balance: string;
}

export interface BalanceResult {
	readonly is_available: boolean;
	readonly entries: BalanceEntry[];
}

export async function fetchBalance(apiKey: string): Promise<BalanceResult> {
	const baseUrl = normalizeBaseUrl(getBaseUrl());
	const url = new URL('/user/balance', baseUrl).toString();
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), BALANCE_TIMEOUT_MS);

	try {
		const response = await fetch(url, {
			method: 'GET',
			headers: { Authorization: `Bearer ${apiKey}` },
			signal: controller.signal,
		});

		if (!response.ok) {
			throw new Error(`HTTP ${response.status}`);
		}

		const data = (await response.json()) as { is_available?: unknown; balance_infos?: unknown };
		const entries: BalanceEntry[] = [];

		if (Array.isArray(data.balance_infos)) {
			for (const info of data.balance_infos) {
				if (typeof info === 'object' && info !== null) {
					const i = info as Record<string, unknown>;
					entries.push({
						currency: String(i.currency ?? ''),
						total_balance: String(i.total_balance ?? '0'),
						topped_up_balance: String(i.topped_up_balance ?? '0'),
						granted_balance: String(i.granted_balance ?? '0'),
					});
				}
			}
		}

		return { is_available: Boolean(data.is_available), entries };
	} finally {
		clearTimeout(timeout);
	}
}
