import type vscode from 'vscode';
import { t } from '../../i18n';
import { safeStringify } from '../../json';
import { logger } from '../../logger';
import { formatVisionProxyError } from './protocols/errors';
import { getVSCodeVisionTargetChatSessionType } from './sources/vscode/model';
import type { VisionProxyConfig } from './types';

export function showVisionLogs(): void {
	logger.show();
}

export function logVSCodeVisionModelSelected(model: vscode.LanguageModelChat): void {
	logger.info(
		`${t('vision.proxyUsing', model.id)} selected=${formatVSCodeVisionModelIdentity(model)}`,
	);
}

export function logVSCodeVisionModelNotFound(modelId: string): void {
	logger.warn(t('vision.notFound', modelId));
}

export function logVisionApiEndpointSelected(modelId: string): void {
	logger.info(`Vision proxy: ${modelId} source=api-endpoint`);
}

export function logInvalidVisionProxyApiEndpointConfig(
	source: string | undefined,
	explicitApiEndpointSource: boolean,
	error: unknown,
): void {
	logger.warn(
		`Invalid vision proxy API endpoint configuration; source=${source ?? 'unset'} fallback=${explicitApiEndpointSource ? 'none' : 'vscode-lm'}`,
		error,
	);
}

export function logVisionProxyUnavailable(): void {
	logger.warn(t('vision.unavailable'));
}

export function logVisionProxyDescribeFailed(error: unknown): void {
	logger.error(t('vision.proxyError'), formatVisionProxyError(error));
}

export function logVisionProxyTestSucceeded(
	config: VisionProxyConfig,
	apiKey: string | undefined,
	description: string,
): void {
	logger.info(
		'Vision proxy test succeeded:',
		formatVisionProxyTestDiagnostics(config, apiKey, description),
	);
}

export function logVisionProxyTestFailed(error: unknown): void {
	logger.error('Vision proxy test failed:', formatVisionProxyError(error));
}

function formatVSCodeVisionModelIdentity(model: vscode.LanguageModelChat): string {
	return [
		formatLogField('id', model.id),
		formatLogField('vendor', model.vendor),
		formatLogField('name', model.name),
		formatLogField('family', model.family),
		formatLogField('version', model.version),
		formatLogField('targetChatSessionType', getVSCodeVisionTargetChatSessionType(model)),
	].join(' ');
}

function formatLogField(name: string, value: unknown): string {
	return `${name}=${formatLogValue(value)}`;
}

function formatLogValue(value: unknown): string {
	const text = asString(value);
	return text ? JSON.stringify(text) : 'n/a';
}

function formatVisionProxyTestDiagnostics(
	config: VisionProxyConfig,
	apiKey: string | undefined,
	description: string,
): string {
	return joinDiagnosticParts(
		`kind=vision`,
		`phase=describe`,
		`providerFamily=${safeStringify(config.providerFamily)}`,
		`apiType=${safeStringify(config.apiType)}`,
		`model=${safeStringify(config.modelId)}`,
		`endpoint=${safeStringify(config.url)}`,
		`hasApiKey=${Boolean(apiKey?.trim())}`,
		`responseChars=${description.length}`,
		config.headers ? `headerNames=${safeStringify(Object.keys(config.headers).sort())}` : undefined,
	);
}

function joinDiagnosticParts(...parts: (string | undefined)[]): string {
	return parts.filter(Boolean).join(' ');
}

function asString(value: unknown): string | undefined {
	return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
