import vscode from 'vscode';
import { getMaxInputTokens, getMaxTokens, getMaxTokensAsOutputReserveEnabled } from '../config';
import { t } from '../i18n';
import type {
	ModelDefinition,
	PricingCurrency,
	ReasoningEffort,
	ThinkingCapability,
} from '../types';
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

export type ThinkingEffort = 'none' | ReasoningEffort;

export type ModelConfigurationOptions = vscode.ProvideLanguageModelChatResponseOptions & {
	readonly modelConfiguration?: Record<string, unknown>;
	readonly configuration?: Record<string, unknown>;
};

type ThinkingEffortConfigurationSchema = ReturnType<typeof buildThinkingEffortSchema>;

export type ModelPickerChatInformation = vscode.LanguageModelChatInformation &
	ModelCostInformation & {
		readonly isUserSelectable: boolean;
		readonly isBYOK: true;
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
	const thinkingCapability = m.capabilities.thinking;
	// `maxInputTokens` is a context window override (input + output). The
	// advertised input budget is the window minus the output reserve
	// (`maxTokens` when `maxTokensAsOutputReserve` is enabled, otherwise the
	// model maximum), mirroring how Copilot advertises its own models.
	// Copilot Chat computes auto-compact thresholds against this value, so a
	// smaller window compacts sooner.
	//
	// Advertised invariants: output ≤ input, and input + output ≤ window.
	// The output reserve is capped at half the window so that when the window
	// override is smaller than the model's maximum output, the reserve shrinks
	// and input keeps the other half instead of collapsing to 1.
	const fullWindow = m.maxInputTokens + m.maxOutputTokens;
	const window = getMaxInputTokens() ?? fullWindow;
	const configuredReserve = getMaxTokensAsOutputReserveEnabled()
		? (getMaxTokens() ?? m.maxOutputTokens)
		: m.maxOutputTokens;
	const maxOutputReserve = Math.max(1, Math.floor(window / 2));
	const outputReserve = Math.min(configuredReserve, m.maxOutputTokens, maxOutputReserve);
	const maxInputTokens = Math.max(1, window - outputReserve);
	return {
		id: m.id,
		name: m.name,
		family: m.family,
		// Include the effective limits in the version so VS Code refreshes
		// stale picker metadata after settings change.
		version: `${m.version}-${maxInputTokens}-${outputReserve}`,
		detail: hasApiKey ? modelDetail : t('auth.apiKeyRequiredDetail'),
		tooltip: hasApiKey ? modelTooltip : t('auth.apiKeyRequiredDetail'),
		statusIcon: hasApiKey ? undefined : new vscode.ThemeIcon('warning'),
		maxInputTokens,
		maxOutputTokens: outputReserve,
		isBYOK: true,
		isUserSelectable: true,
		capabilities: {
			toolCalling: m.capabilities.toolCalling,
			imageInput: m.capabilities.imageInput,
		},
		...toModelCostInfo(m, pricingCurrency),
		...(thinkingCapability
			? { configurationSchema: buildThinkingEffortSchema(thinkingCapability) }
			: {}),
	};
}

export function getConfiguredThinkingEffort(
	options: ModelConfigurationOptions,
	thinkingCapability: ThinkingCapability,
): ThinkingEffort {
	const configuredEffort =
		options.modelConfiguration?.reasoningEffort ?? options.configuration?.reasoningEffort;

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
