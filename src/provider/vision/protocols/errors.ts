import { MAX_DIAGNOSTIC_FIELD_LENGTH } from '../../../client/consts';
import { getNetworkErrorCauseInfo, getNetworkErrorCode } from '../../../client/error/network';
import { t } from '../../../i18n';
import { safeStringify } from '../../../json';
import type { VisionProxyApiType, VisionProxyProviderFamily } from '../types';

export type VisionProxyErrorCode =
	| 'missing-configuration'
	| 'invalid-custom-headers'
	| 'invalid-url'
	| 'http-auth'
	| 'http-not-found'
	| 'http-payload-too-large'
	| 'http-rate-limited'
	| 'http-provider'
	| 'timeout'
	| 'cancelled'
	| 'empty-response'
	| 'unsupported-response'
	| 'network';

export interface VisionProxyRequestDiagnostics {
	phase: 'describe';
	providerFamily: VisionProxyProviderFamily;
	apiType: VisionProxyApiType;
	modelId: string;
	endpoint?: URL;
	timeoutMs?: number;
	hasApiKey?: boolean;
	headerNames?: readonly string[];
	imageCount?: number;
	imageBytes?: number;
	promptChars?: number;
	bodyBytes?: number;
}

export class VisionProxyError extends Error {
	constructor(
		readonly code: VisionProxyErrorCode,
		message: string,
		readonly status?: number,
		readonly cause?: unknown,
		readonly diagnosticMessage: string = joinDiagnosticParts(
			status !== undefined ? `kind=http` : `kind=vision`,
			status === undefined ? `code=${code}` : undefined,
			status !== undefined ? `status=${status}` : undefined,
			cause ? `cause=${formatDiagnosticValue(cause)}` : undefined,
		),
	) {
		super(message);
		this.name = 'VisionProxyError';
	}
}

export async function createHttpVisionProxyError(
	response: Response,
	context: VisionProxyRequestDiagnostics,
): Promise<VisionProxyError> {
	const responseText = await response.text();
	const serverMessage = extractServerMessage(responseText);
	const target = context.endpoint
		? `${context.endpoint.host}${context.endpoint.pathname}`
		: 'unknown';
	const status = response.status;

	if (status === 401 || status === 403) {
		return new VisionProxyError(
			'http-auth',
			t('vision.proxy.error.auth', status),
			status,
			undefined,
			createHttpDiagnosticMessage('http-auth', response, context, serverMessage, responseText),
		);
	}
	if (status === 404) {
		return new VisionProxyError(
			'http-not-found',
			t('vision.proxy.error.notFound', target),
			status,
			undefined,
			createHttpDiagnosticMessage('http-not-found', response, context, serverMessage, responseText),
		);
	}
	if (status === 413) {
		return new VisionProxyError(
			'http-payload-too-large',
			t('vision.proxy.error.payloadTooLarge', status),
			status,
			undefined,
			createHttpDiagnosticMessage(
				'http-payload-too-large',
				response,
				context,
				serverMessage,
				responseText,
			),
		);
	}
	if (status === 429) {
		return new VisionProxyError(
			'http-rate-limited',
			t('vision.proxy.error.rateLimited', status),
			status,
			undefined,
			createHttpDiagnosticMessage(
				'http-rate-limited',
				response,
				context,
				serverMessage,
				responseText,
			),
		);
	}
	if (status >= 500) {
		return new VisionProxyError(
			'http-provider',
			t('vision.proxy.error.providerUnavailable', status),
			status,
			undefined,
			createHttpDiagnosticMessage('http-provider', response, context, serverMessage, responseText),
		);
	}
	return new VisionProxyError(
		'http-provider',
		t('vision.proxy.error.requestFailed', status),
		status,
		undefined,
		createHttpDiagnosticMessage('http-provider', response, context, serverMessage, responseText),
	);
}

export function createVisionProxyRequestError(
	code: VisionProxyErrorCode,
	message: string,
	context: VisionProxyRequestDiagnostics,
	cause?: unknown,
): VisionProxyError {
	return new VisionProxyError(
		code,
		message,
		undefined,
		cause,
		createDiagnosticMessage(code, context, cause),
	);
}

export function addVisionProxyDiagnostics(
	error: VisionProxyError,
	context: VisionProxyRequestDiagnostics,
): VisionProxyError {
	const enhanced = new VisionProxyError(
		error.code,
		error.message,
		error.status,
		error.cause,
		createDiagnosticMessage(error.code, context, error.cause, error.status),
	);
	enhanced.stack = error.stack;
	return enhanced;
}

export function formatVisionProxyError(error: unknown): string {
	if (error instanceof VisionProxyError) {
		return error.stack ? `${error.diagnosticMessage}\n${error.stack}` : error.diagnosticMessage;
	}
	if (error instanceof Error) {
		const message = joinDiagnosticParts(
			`kind=unknown`,
			`message=${safeDiagnosticString(error.message)}`,
			error.cause !== undefined ? `cause=${formatDiagnosticCause(error.cause)}` : undefined,
		);
		return error.stack ? `${message}\n${error.stack}` : message;
	}
	return joinDiagnosticParts(`kind=unknown`, `value=${formatDiagnosticValue(error)}`);
}

export function getVisionProxyErrorDisplayCode(error: unknown): string {
	if (error instanceof VisionProxyError) {
		if (error.status !== undefined) {
			return String(error.status);
		}

		const causeInfo =
			error.cause instanceof Error && !(error.cause instanceof VisionProxyError)
				? getNetworkErrorCauseInfo(error.cause)
				: undefined;
		return getNetworkErrorCode(causeInfo) ?? getFallbackVisionProxyErrorCode(error.code);
	}

	if (error instanceof Error) {
		return getNetworkErrorCode(getNetworkErrorCauseInfo(error)) ?? 'UNKNOWN';
	}

	return 'UNKNOWN';
}

export function formatVisionProxyDisplayMessage(errorCode: string, errorMessage: string): string {
	const normalizedErrorCode = normalizeVisionProxyDisplayCode(errorCode);
	return `[${normalizedErrorCode}] ${stripTrailingErrorCode(errorMessage, normalizedErrorCode)}`;
}

export function formatVisionProxyErrorCode(code: VisionProxyErrorCode): string {
	return code.toUpperCase().replaceAll('-', '_');
}

export function isVisionProxyError(error: unknown): error is VisionProxyError {
	return error instanceof VisionProxyError;
}

function createHttpDiagnosticMessage(
	code: VisionProxyErrorCode,
	response: Response,
	context: VisionProxyRequestDiagnostics,
	serverMessage: string | undefined,
	responseText: string,
): string {
	return joinDiagnosticParts(
		createDiagnosticMessage(code, context, undefined, response.status),
		`statusText=${safeDiagnosticString(response.statusText || 'unknown')}`,
		serverMessage ? `serverMessage=${safeDiagnosticString(serverMessage)}` : undefined,
		responseText && responseText !== serverMessage
			? `body=${safeDiagnosticString(responseText)}`
			: undefined,
	);
}

function createDiagnosticMessage(
	code: VisionProxyErrorCode,
	context: VisionProxyRequestDiagnostics,
	cause?: unknown,
	status?: number,
): string {
	const kind = getDiagnosticKind(code, status);
	const causeInfo = cause instanceof Error ? getNetworkErrorCauseInfo(cause) : undefined;
	const networkCode = getNetworkErrorCode(causeInfo);
	return joinDiagnosticParts(
		`kind=${kind}`,
		kind === 'network' ? `code=${networkCode ?? getFallbackNetworkCode(code)}` : undefined,
		status !== undefined ? `status=${status}` : undefined,
		`phase=${context.phase}`,
		`providerFamily=${safeDiagnosticString(context.providerFamily)}`,
		`apiType=${safeDiagnosticString(context.apiType)}`,
		`model=${safeDiagnosticString(context.modelId)}`,
		context.endpoint ? `endpoint=${safeDiagnosticString(context.endpoint.toString())}` : undefined,
		context.timeoutMs !== undefined ? `timeoutMs=${context.timeoutMs}` : undefined,
		context.hasApiKey !== undefined ? `hasApiKey=${context.hasApiKey}` : undefined,
		context.headerNames ? `headerNames=${formatDiagnosticValue(context.headerNames)}` : undefined,
		context.imageCount !== undefined ? `imageCount=${context.imageCount}` : undefined,
		context.imageBytes !== undefined ? `imageBytes=${context.imageBytes}` : undefined,
		context.promptChars !== undefined ? `promptChars=${context.promptChars}` : undefined,
		context.bodyBytes !== undefined ? `bodyBytes=${context.bodyBytes}` : undefined,
		cause instanceof Error ? `message=${safeDiagnosticString(cause.message)}` : undefined,
		cause ? `cause=${formatDiagnosticCause(cause)}` : undefined,
	);
}

function getDiagnosticKind(
	code: VisionProxyErrorCode,
	status: number | undefined,
): 'http' | 'network' | 'cancelled' | 'vision' {
	if (status !== undefined || code.startsWith('http-')) {
		return 'http';
	}
	if (code === 'network' || code === 'timeout') {
		return 'network';
	}
	if (code === 'cancelled') {
		return 'cancelled';
	}
	return 'vision';
}

function getFallbackNetworkCode(code: VisionProxyErrorCode): string {
	return code === 'timeout' ? 'TIMEOUT' : 'UNKNOWN';
}

function getFallbackVisionProxyErrorCode(code: VisionProxyErrorCode): string {
	return code === 'network' || code === 'timeout'
		? getFallbackNetworkCode(code)
		: formatVisionProxyErrorCode(code);
}

function normalizeVisionProxyDisplayCode(errorCode: string): string {
	return errorCode.replace(/[\r\n[\]]/gu, '').trim() || 'UNKNOWN';
}

function stripTrailingErrorCode(errorMessage: string, errorCode: string): string {
	const escapedErrorCode = escapeRegExp(errorCode);
	return errorMessage.replace(new RegExp(`\\s*\\(${escapedErrorCode}\\)([。.]?)$`, 'u'), '$1');
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function extractServerMessage(responseText: string): string | undefined {
	if (!responseText) {
		return undefined;
	}
	try {
		const parsed = JSON.parse(responseText) as unknown;
		return findServerMessage(parsed);
	} catch {
		return truncateSingleLine(responseText);
	}
}

function findServerMessage(value: unknown): string | undefined {
	if (typeof value === 'string') {
		return truncateSingleLine(value);
	}
	if (!isRecord(value)) {
		return undefined;
	}

	const direct = getStringProperty(value, 'message') ?? getStringProperty(value, 'detail');
	if (direct) {
		return truncateSingleLine(direct);
	}

	const error = value.error;
	if (isRecord(error)) {
		const nested = getStringProperty(error, 'message') ?? getStringProperty(error, 'detail');
		if (nested) {
			return truncateSingleLine(nested);
		}
	}

	return undefined;
}

function formatDiagnosticCause(cause: unknown): string {
	if (cause instanceof Error) {
		return (
			getNetworkErrorCauseInfo(cause)?.value ??
			formatDiagnosticValue({
				name: cause.name,
				message: cause.message,
				...Object.fromEntries(Object.entries(cause)),
			})
		);
	}
	return formatDiagnosticValue(cause);
}

function formatDiagnosticValue(value: unknown): string {
	try {
		return truncateSingleLine(safeStringify(value));
	} catch {
		return safeDiagnosticString(String(value));
	}
}

function safeDiagnosticString(value: string): string {
	return safeStringify(truncateSingleLine(value));
}

function truncateSingleLine(value: string): string {
	const singleLine = value.replace(/\s+/gu, ' ').trim();
	return singleLine.length > MAX_DIAGNOSTIC_FIELD_LENGTH
		? `${singleLine.slice(0, MAX_DIAGNOSTIC_FIELD_LENGTH)}...`
		: singleLine;
}

function getStringProperty(value: Record<string, unknown>, key: string): string | undefined {
	const property = value[key];
	return typeof property === 'string' && property.length > 0 ? property : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function joinDiagnosticParts(...parts: (string | undefined)[]): string {
	return parts.filter(Boolean).join(' ');
}
