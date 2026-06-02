import type vscode from 'vscode';
import { t } from '../../../../i18n';
import type {
	VisionProxyApiType,
	VisionProxyConfig,
	VisionProxyProviderFamily,
	VisionProxySource,
} from '../../types';
import { VisionProxyError } from '../../protocols/errors';
import { normalizeCustomHeaders } from '../../protocols/headers';
import { validateVisionEndpointUrl } from '../../protocols/url';

export const VISION_PROXY_CONFIG_KEY = 'deepseek-copilot.visionProxy.config';
export const VISION_PROXY_SOURCE_KEY = 'deepseek-copilot.visionProxy.source';
export const VISION_PROXY_API_KEY_SECRET = 'deepseek-copilot.visionProxy.apiKey';

const PROTECTED_EXTRA_BODY_KEYS = new Set(['model', 'messages', 'input', 'stream']);

export class VisionProxyConfigStore {
	constructor(private readonly context: vscode.ExtensionContext) {}

	getConfig(): VisionProxyConfig | undefined {
		const rawConfig = this.context.globalState.get<unknown>(VISION_PROXY_CONFIG_KEY);
		if (rawConfig === undefined) {
			return undefined;
		}
		return normalizeVisionProxyConfig(rawConfig);
	}

	saveConfig(config: VisionProxyConfig): Thenable<void> {
		return this.context.globalState.update(
			VISION_PROXY_CONFIG_KEY,
			normalizeVisionProxyConfig(config),
		);
	}

	getSource(): VisionProxySource | undefined {
		return normalizeVisionProxySource(
			this.context.globalState.get<unknown>(VISION_PROXY_SOURCE_KEY),
		);
	}

	saveSource(source: VisionProxySource): Thenable<void> {
		return this.context.globalState.update(VISION_PROXY_SOURCE_KEY, source);
	}

	getApiKey(): Thenable<string | undefined> {
		return this.context.secrets.get(VISION_PROXY_API_KEY_SECRET);
	}

	setApiKey(apiKey: string): Thenable<void> {
		return this.context.secrets.store(VISION_PROXY_API_KEY_SECRET, apiKey.trim());
	}

	deleteApiKey(): Thenable<void> {
		return this.context.secrets.delete(VISION_PROXY_API_KEY_SECRET);
	}

	async hasApiKey(): Promise<boolean> {
		const apiKey = await this.getApiKey();
		return Boolean(apiKey?.trim());
	}
}

export function normalizeVisionProxyConfig(value: unknown): VisionProxyConfig {
	if (!isRecord(value)) {
		throw new VisionProxyError(
			'missing-configuration',
			t('vision.proxy.error.configurationInvalid'),
		);
	}

	const providerFamily = normalizeProviderFamily(value.providerFamily);
	const url = normalizeRequiredString(value.url, t('vision.panel.field.endpointUrl'));
	validateVisionEndpointUrl(url);
	const apiType = normalizeApiType(providerFamily, value.apiType);
	const modelId = normalizeRequiredString(value.modelId, t('vision.panel.field.modelId'));
	const headers = normalizeCustomHeaders(value.headers);
	const extraBody = normalizeExtraBody(value.extraBody);

	return {
		providerFamily,
		apiType,
		url,
		modelId,
		headers,
		extraBody,
		updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : Date.now(),
	};
}

export function normalizeVisionProxySource(value: unknown): VisionProxySource | undefined {
	if (value === 'api-endpoint' || value === 'vscode-lm') {
		return value;
	}
	return undefined;
}

function normalizeProviderFamily(value: unknown): VisionProxyProviderFamily {
	if (value === 'anthropic-compatible' || value === 'openai-compatible') {
		return value;
	}
	throw new VisionProxyError(
		'missing-configuration',
		t('vision.proxy.error.providerFamilyInvalid'),
	);
}

function normalizeApiType(
	providerFamily: VisionProxyProviderFamily,
	value: unknown,
): VisionProxyApiType {
	if (providerFamily === 'anthropic-compatible') {
		return 'messages';
	}
	if (value === 'chat-completions' || value === 'responses') {
		return value;
	}
	throw new VisionProxyError('missing-configuration', t('vision.proxy.error.apiTypeInvalid'));
}

function normalizeRequiredString(value: unknown, label: string): string {
	const text = normalizeString(value);
	if (!text) {
		throw new VisionProxyError(
			'missing-configuration',
			t('vision.proxy.error.fieldRequired', label),
		);
	}
	return text;
}

function normalizeString(value: unknown): string {
	return typeof value === 'string' ? value.trim() : '';
}

function normalizeExtraBody(value: unknown): Record<string, unknown> | undefined {
	if (value === undefined || value === null) {
		return undefined;
	}
	if (!isRecord(value)) {
		throw new VisionProxyError('missing-configuration', t('vision.proxy.error.extraBodyObject'));
	}

	const normalized: Record<string, unknown> = {};
	for (const [key, entryValue] of Object.entries(value)) {
		if (PROTECTED_EXTRA_BODY_KEYS.has(key)) {
			throw new VisionProxyError(
				'missing-configuration',
				t('vision.proxy.error.extraBodyProtectedKey', key),
			);
		}
		normalized[key] = entryValue;
	}

	return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
