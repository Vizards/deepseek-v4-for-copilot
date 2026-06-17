import vscode from 'vscode';
import { t } from '../i18n';
import type { ModelDefinition, PricingCurrency } from '../types';
import { toModelCostInfo, type ModelCostInformation } from './pricing/costs';

/**
 * NOTE: Non-public API surface.
 *
 * The fields below (`configurationSchema` on chat info, cost metadata,
 * `modelConfiguration` on response options, plus `isBYOK` / `isUserSelectable` /
 * `statusIcon`)
 * are not part of the stable `vscode.LanguageModelChat*` typings yet. They are
 * the same shape currently consumed by GitHub Copilot Chat to render model picker
 * metadata and per-model configuration controls.
 */

export type ThinkingEffort = 'none' | 'high' | 'max';

export type ContextSize = 200000 | 1000000;

export type ModelConfigurationOptions = vscode.ProvideLanguageModelChatResponseOptions & {
	readonly modelConfiguration?: Record<string, unknown>;
	readonly configuration?: Record<string, unknown>;
};

type ModelConfigurationSchema = ReturnType<typeof buildModelConfigurationSchema>;

export type ModelPickerChatInformation = vscode.LanguageModelChatInformation &
	ModelCostInformation & {
		readonly isUserSelectable: boolean;
		readonly isBYOK: true;
		readonly statusIcon?: vscode.ThemeIcon;
		readonly configurationSchema?: ModelConfigurationSchema;
	};

export function toChatInfo(
	m: ModelDefinition,
	hasApiKey: boolean,
	pricingCurrency?: PricingCurrency,
	contextSize?: number,
): ModelPickerChatInformation {
	const modelDetail = resolveModelText(m, 'detail') ?? m.detail;
	const modelTooltip = resolveModelText(m, 'tooltip');
	return {
		id: m.id,
		name: m.name,
		family: m.family,
		version: m.version,
		detail: hasApiKey ? modelDetail : t('auth.apiKeyRequiredDetail'),
		tooltip: hasApiKey ? modelTooltip : t('auth.apiKeyRequiredDetail'),
		statusIcon: hasApiKey ? undefined : new vscode.ThemeIcon('warning'),
		...resolveContextWindow(m, contextSize),
		isBYOK: true,
		isUserSelectable: true,
		capabilities: {
			toolCalling: m.capabilities.toolCalling,
			imageInput: m.capabilities.imageInput,
		},
		...toModelCostInfo(m, pricingCurrency),
		...(hasApiKey ? { configurationSchema: buildModelConfigurationSchema(m) } : {}),
	};
}

export function getConfiguredThinkingEffort(options: ModelConfigurationOptions): ThinkingEffort {
	const configuredEffort =
		options.modelConfiguration?.reasoningEffort ?? options.configuration?.reasoningEffort;

	if (configuredEffort === 'none') {
		return 'none';
	}

	if (configuredEffort === 'high') {
		return 'high';
	}

	return configuredEffort === 'max' ? 'max' : 'high';
}

/**
 * Token split for the selectable 200K context window.
 *
 * VS Code/Copilot derives the displayed context window from
 * `maxInputTokens + maxOutputTokens`, so each selectable window must split its
 * *total* budget into input + output. The default 1M window keeps the
 * accounting fixed in #71 (655,360 + 393,216 = 1,048,576 = DeepSeek's official
 * combined input+output limit). The 200K option mirrors that same 5:3
 * input:output reservation, scaled to a 200,000-token total, so the reported
 * window stays honest (~200K) instead of input + a separate output reservation.
 */
const CONTEXT_WINDOW_200K = { maxInputTokens: 125000, maxOutputTokens: 75000 } as const;

/**
 * Resolve the (input, output) token split for the selected context window.
 * Unknown / unset values fall back to the model's own metadata, which encodes
 * DeepSeek's official 1M (input + output) window.
 */
function resolveContextWindow(
	m: ModelDefinition,
	contextSize?: number,
): { maxInputTokens: number; maxOutputTokens: number } {
	if (contextSize === 200000) {
		return { ...CONTEXT_WINDOW_200K };
	}
	return { maxInputTokens: m.maxInputTokens, maxOutputTokens: m.maxOutputTokens };
}

/**
 * Read the context size selected by the user via the model-picker dropdown.
 * Falls back to the VS Code setting when the dropdown hasn't been used yet.
 */
export function getConfiguredContextSize(options: ModelConfigurationOptions): ContextSize {
	const configured =
		options.modelConfiguration?.contextSize ?? options.configuration?.contextSize;
	if (configured === 200000) {
		return 200000;
	}
	return 1000000;
}

function buildModelConfigurationSchema(m: ModelDefinition) {
	const properties: Record<string, unknown> = {};

	if (m.capabilities.thinking) {
		properties.reasoningEffort = {
			type: 'string',
			title: t('status.thinking'),
			enum: ['none', 'high', 'max'],
			enumItemLabels: [t('thinking.none'), t('thinking.high'), t('thinking.max')],
			enumDescriptions: [
				t('thinking.none.desc'),
				t('thinking.high.desc'),
				t('thinking.max.desc'),
			],
			default: 'high',
			group: 'navigation',
		};
	}

	properties.contextSize = {
		type: 'number',
		title: t('contextSize.title'),
		enum: [200000, 1000000],
		enumItemLabels: [t('contextSize.200k'), t('contextSize.1m')],
		enumDescriptions: [t('contextSize.200k.desc'), t('contextSize.1m.desc')],
		default: 1000000,
		group: 'tokens',
	};

	return { properties } as const;
}

function resolveModelText(m: ModelDefinition, field: 'detail' | 'tooltip'): string | undefined {
	const suffix = m.id.startsWith('deepseek-v4-') ? m.id.slice('deepseek-v4-'.length) : m.id;
	const key = `model.${suffix}.${field}`;
	const translated = t(key);
	return translated !== key ? translated : undefined;
}
