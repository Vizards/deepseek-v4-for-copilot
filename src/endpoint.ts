export const OFFICIAL_DEEPSEEK_API_HOST = 'api.deepseek.com';

/** OrcaRouter model gateway host (OpenAI-compatible). */
export const ORCAROUTER_API_HOST = 'api.orcarouter.ai';

/** OrcaRouter OpenAI-compatible endpoint used by the `orcarouter` provider. */
export const ORCAROUTER_API_BASE = 'https://api.orcarouter.ai/v1';

export function isOfficialDeepSeekBaseUrl(baseUrl: string): boolean {
	try {
		return new URL(baseUrl).hostname.toLowerCase() === OFFICIAL_DEEPSEEK_API_HOST;
	} catch {
		return false;
	}
}

export function isOrcaRouterBaseUrl(baseUrl: string): boolean {
	try {
		return new URL(baseUrl).hostname.toLowerCase() === ORCAROUTER_API_HOST;
	} catch {
		return false;
	}
}

export function normalizeBaseUrl(baseUrl: string): string {
	return baseUrl.trim().replace(/\/+$/u, '');
}
