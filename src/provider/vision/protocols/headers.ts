import type { VisionProxyConfig } from '../types';
import { t } from '../../../i18n';
import { VisionProxyError } from './errors';

export function normalizeCustomHeaders(headers: unknown): Record<string, string> | undefined {
	if (headers === undefined || headers === null) {
		return undefined;
	}
	if (typeof headers !== 'object' || Array.isArray(headers)) {
		throw new VisionProxyError(
			'invalid-custom-headers',
			t('vision.proxy.error.customHeadersObject'),
		);
	}

	const normalized: Record<string, string> = {};
	for (const [rawName, rawValue] of Object.entries(headers)) {
		const name = rawName.trim();
		if (!name) {
			throw new VisionProxyError(
				'invalid-custom-headers',
				t('vision.proxy.error.customHeaderNameEmpty'),
			);
		}
		if (!isValidHeaderName(name)) {
			throw new VisionProxyError(
				'invalid-custom-headers',
				t('vision.proxy.error.customHeaderNameInvalid', name),
			);
		}
		if (typeof rawValue !== 'string') {
			throw new VisionProxyError(
				'invalid-custom-headers',
				t('vision.proxy.error.customHeaderValueString', name),
			);
		}
		const value = rawValue.trim();
		if (!value) {
			continue;
		}
		if (!isValidHeaderValue(value)) {
			throw new VisionProxyError(
				'invalid-custom-headers',
				t('vision.proxy.error.customHeaderValueInvalid', name),
			);
		}
		setHeader(normalized, name, value);
	}

	return Object.keys(normalized).length > 0 ? normalized : undefined;
}

export function createProviderHeaders(
	config: VisionProxyConfig,
	apiKey: string | undefined,
): Record<string, string> {
	const headers: Record<string, string> = {
		'content-type': 'application/json',
	};

	if (config.providerFamily === 'anthropic-compatible') {
		headers['anthropic-version'] = '2023-06-01';
		if (apiKey) {
			headers['x-api-key'] = apiKey;
		}
	} else if (apiKey) {
		headers.authorization = `Bearer ${apiKey}`;
	}

	for (const [name, value] of Object.entries(config.headers ?? {})) {
		setHeader(headers, name, value);
	}

	return headers;
}

function setHeader(headers: Record<string, string>, name: string, value: string): void {
	const lowerName = name.toLowerCase();
	for (const existingName of Object.keys(headers)) {
		if (existingName.toLowerCase() === lowerName) {
			delete headers[existingName];
		}
	}
	headers[name] = value;
}

function isValidHeaderName(name: string): boolean {
	return /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/u.test(name);
}

function isValidHeaderValue(value: string): boolean {
	return !/[\r\n]/u.test(value);
}
