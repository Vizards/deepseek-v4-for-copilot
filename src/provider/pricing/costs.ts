import vscode from 'vscode';
import { t } from '../../i18n';
import type { ModelDefinition, PriceCategory, PricingCurrency } from '../../types';
import { getPricingPeriod, type PricingPeriod } from './schedule';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Textual pricing metadata for the model picker.
 *
 * VS Code forwards infoText from extension providers starting in 1.135.
 * Earlier supported hosts ignore it, intentionally degrading to no detailed
 * pricing notice while leaving the models usable. Do not restore formatted
 * currency strings as a compatibility fallback: the credit-based model picker
 * accepts only numbers in inputCost/outputCost/cacheCost and renders strings as
 * Unknown.
 */
export interface ModelPricingInformation {
	readonly infoText?: Readonly<Record<string, string>>;
	readonly priceCategory?: PriceCategory;
}

export function toModelPricingInfo(
	model: ModelDefinition,
	currency: PricingCurrency | undefined,
	now = new Date(),
	showPricingNotice = true,
): ModelPricingInformation {
	if (!currency || !showPricingNotice) {
		return {};
	}

	const pricingSchedule = model.pricing?.[currency];
	if (!pricingSchedule) {
		return {};
	}

	const period = getPricingPeriod(now);
	const pricing = pricingSchedule[period.period];
	return {
		...(model.priceCategory ? { priceCategory: model.priceCategory } : {}),
		infoText: {
			pricing: formatPricingNotice(period.period, pricing, currency, now, period.nextTransitionAt),
		},
	};
}

function formatPricingNotice(
	period: PricingPeriod,
	pricing: { cacheHitInput: number; cacheMissInput: number; output: number },
	currency: PricingCurrency,
	now: Date,
	nextTransitionAt: Date,
): string {
	const periodLabel = t(
		period === 'peak' ? 'model.pricing.currentPeak' : 'model.pricing.currentOffPeak',
	);
	const nextPeriod = period === 'peak' ? 'offPeak' : 'peak';
	const nextPeriodLabel = t(
		nextPeriod === 'peak' ? 'model.pricing.currentPeak' : 'model.pricing.currentOffPeak',
	);
	const unitSuffix = t('model.pricing.unitSuffix');
	const transitionTime = formatTransitionTime(now, nextTransitionAt);
	const priceRows = [
		{
			label: t('model.pricing.inputLabel'),
			value: `${formatPriceValue(pricing.cacheMissInput, currency)}${unitSuffix}`,
		},
		{
			label: t('model.pricing.cacheHitInputLabel'),
			value: `${formatPriceValue(pricing.cacheHitInput, currency)}${unitSuffix}`,
		},
		{
			label: t('model.pricing.outputLabel'),
			value: `${formatPriceValue(pricing.output, currency)}${unitSuffix}`,
		},
	];
	const priceLines = priceRows.map(({ label, value }) => `${label}: ${value}`).join('\n');
	const priceBlock = ['```bash', priceLines, '```'].join('\n');

	const transitionNotice = t('model.pricing.periodStarts', nextPeriodLabel, transitionTime);
	return [`**${periodLabel}** · ${transitionNotice}`, priceBlock].join('\n');
}

function formatPriceValue(value: number, currency: PricingCurrency): string {
	return `${currency === 'CNY' ? '¥' : '$'}${value}`;
}

function formatTransitionTime(now: Date, nextTransitionAt: Date): string {
	const locale = getPricingLocale();
	const time = new Intl.DateTimeFormat(locale, {
		hour: '2-digit',
		minute: '2-digit',
		hourCycle: 'h23',
	}).format(nextTransitionAt);
	const dayDifference = getLocalDayNumber(nextTransitionAt) - getLocalDayNumber(now);

	if (dayDifference === 0) {
		return t('model.pricing.transitionTime.today', time);
	}
	if (dayDifference === 1) {
		return t('model.pricing.transitionTime.tomorrow', time);
	}

	const weekday = new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(nextTransitionAt);
	return t('model.pricing.transitionTime.weekday', weekday, time);
}

function getLocalDayNumber(date: Date): number {
	return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY_MS;
}

function getPricingLocale(): 'en-US' | 'zh-CN' {
	return vscode.env.language.toLowerCase() === 'zh-cn' ? 'zh-CN' : 'en-US';
}
