import { t } from '../../i18n';
import { safeStringify } from '../../json';
import { MAX_DIAGNOSTIC_FIELD_LENGTH, NETWORK_ERROR_CATEGORY_BY_CODE } from '../consts';
import type { NetworkErrorCategory } from '../types';

export interface NetworkErrorCauseInfo {
	code?: string;
	name?: string;
	message?: string;
	value: string;
}

export function getNetworkErrorCauseInfo(error: Error): NetworkErrorCauseInfo | undefined {
	const cause = (error as Error & { cause?: unknown }).cause;
	if (!cause) {
		return undefined;
	}

	if (cause instanceof Error) {
		const value = {
			name: cause.name,
			message: cause.message,
			...Object.fromEntries(Object.entries(cause)),
		};
		return {
			code: getStringProperty(value, 'code'),
			name: cause.name,
			message:
				cause.message && cause.message !== error.message
					? truncateSingleLine(cause.message)
					: undefined,
			value: stringifyDiagnosticCause(value),
		};
	}

	if (typeof cause === 'object') {
		return {
			code: getStringProperty(cause, 'code'),
			name: getStringProperty(cause, 'name'),
			message: truncateOptional(getStringProperty(cause, 'message')),
			value: stringifyDiagnosticCause(cause),
		};
	}

	return { message: truncateSingleLine(String(cause)), value: safeStringify(String(cause)) };
}

export function getNetworkErrorCode(info: NetworkErrorCauseInfo | undefined): string | undefined {
	return info?.code ?? info?.name;
}

export function getNetworkErrorMessage(code: string | undefined): string {
	const errorCode = code ?? 'UNKNOWN';

	switch (getNetworkErrorCategory(code)) {
		case 'dns':
			return t('error.network.dns', errorCode);
		case 'unreachable':
			return t('error.network.unreachable', errorCode);
		case 'interrupted':
			return t('error.network.interrupted', errorCode);
		case 'timeout':
			return t('error.network.timeout', errorCode);
		case 'tls':
			return t('error.network.tls', errorCode);
		case 'aborted':
			return t('error.network.aborted', errorCode);
		case 'protocol':
			return t('error.network.protocol', errorCode);
		case 'configuration':
			return t('error.network.configuration', errorCode);
		case 'generic':
			return t('error.network.generic', errorCode);
	}
}

export function getNetworkErrorCategory(code: string | undefined): NetworkErrorCategory {
	if (!code) {
		return 'generic';
	}

	if (isKnownNetworkErrorCode(code)) {
		return NETWORK_ERROR_CATEGORY_BY_CODE[code];
	}

	if (code.startsWith('ERR_TLS_') || code.startsWith('ERR_SSL_')) {
		return 'tls';
	}

	return code.startsWith('HPE_') ? 'protocol' : 'generic';
}

function isKnownNetworkErrorCode(
	code: string,
): code is keyof typeof NETWORK_ERROR_CATEGORY_BY_CODE {
	return Object.hasOwn(NETWORK_ERROR_CATEGORY_BY_CODE, code);
}

function getObjectProperty(value: unknown, key: string): unknown {
	return typeof value === 'object' && value !== null
		? (value as Record<string, unknown>)[key]
		: undefined;
}

function getStringProperty(value: unknown, key: string): string | undefined {
	const property = getObjectProperty(value, key);
	return typeof property === 'string' && property.length > 0 ? property : undefined;
}

function truncateSingleLine(value: string): string {
	const singleLine = value.replace(/\s+/gu, ' ').trim();
	return singleLine.length > MAX_DIAGNOSTIC_FIELD_LENGTH
		? `${singleLine.slice(0, MAX_DIAGNOSTIC_FIELD_LENGTH)}...`
		: singleLine;
}

function truncateOptional(value: string | undefined): string | undefined {
	return value ? truncateSingleLine(value) : undefined;
}

function stringifyDiagnosticCause(cause: unknown): string {
	try {
		return truncateSingleLine(safeStringify(cause));
	} catch {
		return safeStringify(String(cause));
	}
}
