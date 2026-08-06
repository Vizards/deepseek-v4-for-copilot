export const OFFICIAL_DEEPSEEK_API_HOST = 'api.deepseek.com';
export const NOVITA_API_HOST = 'api.novita.ai';

export function isOfficialDeepSeekBaseUrl(baseUrl: string): boolean {
	return getBaseUrlHostname(baseUrl) === OFFICIAL_DEEPSEEK_API_HOST;
}

export function isNovitaBaseUrl(baseUrl: string): boolean {
	return getBaseUrlHostname(baseUrl) === NOVITA_API_HOST;
}

function getBaseUrlHostname(baseUrl: string): string | undefined {
	try {
		return new URL(baseUrl).hostname.toLowerCase();
	} catch {
		return undefined;
	}
}

export function normalizeBaseUrl(baseUrl: string): string {
	return baseUrl.trim().replace(/\/+$/u, '');
}
