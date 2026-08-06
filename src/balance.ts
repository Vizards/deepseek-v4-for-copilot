import vscode from 'vscode';
import { getBaseUrl } from './config';

export interface BalanceInfo {
	/** Single balance entry (DeepSeek returns array of these). */
	currency: string;
	total_balance: string;
	granted_balance: string;
	topped_up_balance: string;
}

export interface BalanceResponse {
	is_available: boolean;
	balance_infos: BalanceInfo[];
}

/**
 * Fetch DeepSeek user balance from the API.
 * Returns the raw response or undefined on failure.
 */
export async function fetchBalance(apiKey: string): Promise<BalanceResponse | undefined> {
	try {
		const baseUrl = getBaseUrl();
		const response = await fetch(`${baseUrl}/user/balance`, {
			headers: {
				Accept: 'application/json',
				Authorization: `Bearer ${apiKey}`,
			},
		});

		if (!response.ok) {
			void vscode.window.showWarningMessage(
				`DeepSeek balance check failed: HTTP ${response.status}`,
			);
			return undefined;
		}

		return (await response.json()) as BalanceResponse;
	} catch (error) {
		void vscode.window.showWarningMessage(
			`DeepSeek balance check failed: ${error instanceof Error ? error.message : String(error)}`,
		);
		return undefined;
	}
}
