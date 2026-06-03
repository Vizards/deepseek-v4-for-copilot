import vscode from 'vscode';
import { t } from '../i18n';
import type { ModelDefinition, PricingCurrency } from '../types';
import { toModelCostInfo, type ModelCostInformation } from './pricing/costs';

/**
 * NOTE: Non-public API surface.
 *
 * The fields below (`configurationSchema` on chat info, cost metadata,
 * `modelConfiguration` on response options, plus `isUserSelectable` / `statusIcon`)
 * are not part of the stable `vscode.LanguageModelChat*` typings yet. They are
 * the same shape currently consumed by GitHub Copilot Chat to render model picker
 * metadata and per-model configuration controls.
 */

export type ThinkingEffort = 'none' | 'high' | 'max';

export type ModelConfigurationOptions = vscode.ProvideLanguageModelChatResponseOptions & {
	readonly modelConfiguration?: Record<string, unknown>;
	readonly configuration?: Record<string, unknown>;
};

type ThinkingEffortConfigurationSchema = ReturnType<typeof buildThinkingEffortSchema>;

export type ModelPickerChatInformation = vscode.LanguageModelChatInformation &
	ModelCostInformation & {
		readonly isUserSelectable: boolean;
		readonly statusIcon?: vscode.ThemeIcon;
		readonly configurationSchema?: ThinkingEffortConfigurationSchema;
	};

export function toChatInfo(
	m: ModelDefinition,
	hasApiKey: boolean,
	pricingCurrency?: PricingCurrency,
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
		maxInputTokens: m.maxInputTokens,
		maxOutputTokens: m.maxOutputTokens,
		isUserSelectable: true,
		capabilities: {
			toolCalling: m.capabilities.toolCalling,
			imageInput: m.capabilities.imageInput,
		},
		...toModelCostInfo(m, pricingCurrency),
		...(m.capabilities.thinking ? { configurationSchema: buildThinkingEffortSchema() } : {}),
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

function buildThinkingEffortSchema() {
	return {
		properties: {
			reasoningEffort: {
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
			},
		},
	} as const;
}

function resolveModelText(m: ModelDefinition, field: 'detail' | 'tooltip'): string | undefined {
	const suffix = m.id.startsWith('deepseek-v4-') ? m.id.slice('deepseek-v4-'.length) : m.id;
	const key = `model.${suffix}.${field}`;
	const translated = t(key);
	return translated !== key ? translated : undefined;
}
