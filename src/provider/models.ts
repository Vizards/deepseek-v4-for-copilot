import vscode from 'vscode';
import { t } from '../i18n';
import type {
	ModelDefinition,
	PricingCurrency,
	ReasoningEffort,
	ThinkingCapability,
} from '../types';
import { toModelPricingInfo, type ModelPricingInformation } from './pricing/costs';
import { getModelRetirementNotice } from './retirement';

/**
 * NOTE: Non-public API surface.
 *
 * The fields below (`configurationSchema` on chat info, pricing metadata,
 * `modelConfiguration` on response options, plus `isBYOK` / `isUserSelectable` /
 * `statusIcon` / `warningText`)
 * are not part of the stable `vscode.LanguageModelChat*` typings yet. They are
 * the same shape currently consumed by GitHub Copilot Chat to render model picker
 * metadata and per-model configuration controls.
 */

export type ThinkingEffort = 'none' | ReasoningEffort;

export type ModelConfigurationOptions = vscode.ProvideLanguageModelChatResponseOptions & {
	readonly modelOptions?: Record<string, unknown>;
	readonly modelConfiguration?: Record<string, unknown>;
	readonly configuration?: Record<string, unknown>;
};

type ThinkingEffortConfigurationSchema = ReturnType<typeof buildThinkingEffortSchema>;

export type ModelPickerChatInformation = vscode.LanguageModelChatInformation &
	ModelPricingInformation & {
		readonly isUserSelectable: boolean;
		readonly isBYOK: true;
		readonly statusIcon?: vscode.ThemeIcon;
		readonly warningText?: Readonly<Record<string, string>>;
		readonly configurationSchema?: ThinkingEffortConfigurationSchema;
	};

export function toChatInfo(
	m: ModelDefinition,
	hasApiKey: boolean,
	pricingCurrency?: PricingCurrency,
	now = new Date(),
	usesOfficialModel = true,
): ModelPickerChatInformation {
	const retirement = getModelRetirementNotice(m.id, usesOfficialModel);
	const modelDetail = resolveModelText(m, 'detail') ?? m.detail;
	const modelTooltip = resolveModelText(m, 'tooltip');
	const thinkingCapability = m.capabilities.thinking;
	return {
		id: m.id,
		name: m.name,
		family: m.family,
		version: m.version,
		detail: hasApiKey ? modelDetail : t('auth.apiKeyRequiredDetail'),
		tooltip: hasApiKey ? modelTooltip : t('auth.apiKeyRequiredDetail'),
		statusIcon: !hasApiKey || retirement ? new vscode.ThemeIcon('warning') : undefined,
		...(retirement ? { warningText: { [retirement.code]: retirement.message } } : {}),
		maxInputTokens: m.maxInputTokens,
		maxOutputTokens: m.maxOutputTokens,
		isBYOK: true,
		isUserSelectable: true,
		capabilities: {
			toolCalling: m.capabilities.toolCalling,
			imageInput: m.capabilities.imageInput,
		},
		...toModelPricingInfo(
			m,
			pricingCurrency,
			now,
			usesOfficialModel && (retirement?.showPricing ?? true),
		),
		...(thinkingCapability
			? { configurationSchema: buildThinkingEffortSchema(thinkingCapability) }
			: {}),
	};
}

export function getConfiguredThinkingEffort(
	options: ModelConfigurationOptions,
	thinkingCapability: ThinkingCapability,
): ThinkingEffort {
	// Prefer request-scoped overrides first so an internal proxy pass can force a
	// specific effort without mutating the persisted user model configuration.
	const configuredEffort =
		options.modelOptions?.reasoningEffort ??
		options.modelConfiguration?.reasoningEffort ??
		options.configuration?.reasoningEffort;

	if (configuredEffort === 'none' && thinkingCapability.canDisable) {
		return 'none';
	}

	if (isSupportedReasoningEffort(configuredEffort, thinkingCapability)) {
		return configuredEffort;
	}

	return thinkingCapability.defaultEffort;
}

function buildThinkingEffortSchema(thinkingCapability: ThinkingCapability) {
	const efforts: ThinkingEffort[] = [
		...(thinkingCapability.canDisable ? (['none'] as const) : []),
		...thinkingCapability.supportedEfforts,
	];

	return {
		properties: {
			reasoningEffort: {
				type: 'string',
				title: t('status.thinking'),
				enum: efforts,
				enumItemLabels: efforts.map((effort) => t(`thinking.${effort}`)),
				enumDescriptions: efforts.map((effort) => t(`thinking.${effort}.desc`)),
				default: thinkingCapability.defaultEffort,
				group: 'navigation',
			},
		},
	} as const;
}

function isSupportedReasoningEffort(
	value: unknown,
	thinkingCapability: ThinkingCapability,
): value is ReasoningEffort {
	return thinkingCapability.supportedEfforts.some((effort) => effort === value);
}

function resolveModelText(m: ModelDefinition, field: 'detail' | 'tooltip'): string | undefined {
	const suffix = m.id.startsWith('deepseek-v4-') ? m.id.slice('deepseek-v4-'.length) : m.id;
	const key = `model.${suffix}.${field}`;
	const translated = t(key);
	return translated !== key ? translated : undefined;
}
