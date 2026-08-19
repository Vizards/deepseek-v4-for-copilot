import { t } from '../../i18n';
import type { ModelDefinition, PriceCategory, PricingCurrency } from '../../types';
import { getPricingPeriod, type PricingPeriod } from './schedule';

/**
 * Textual pricing metadata for the model picker.
 *
 * Do not populate VS Code's inputCost/outputCost/cacheCost fields here. Those
 * proposed fields are numeric credits, while DeepSeek's prices are currency
 * values and change with the current billing period. infoText is the native
 * model-picker surface for this human-readable, time-dependent notice.
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
	const unitSuffix = t('model.pricing.unitSuffix');
	const remaining = formatDuration(nextTransitionAt.getTime() - now.getTime());
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

	return [`**${periodLabel}** · ${t('model.pricing.periodRemaining', remaining)}`, priceBlock].join(
		'\n',
	);
}

function formatPriceValue(value: number, currency: PricingCurrency): string {
	return `${currency === 'CNY' ? '¥' : '$'}${value}`;
}

function formatDuration(milliseconds: number): string {
	const totalMinutes = Math.max(1, Math.ceil(milliseconds / (60 * 1000)));
	const hours = Math.floor(totalMinutes / 60);
	const minutes = totalMinutes % 60;

	if (hours > 0 && minutes > 0) {
		return t(
			hours === 1
				? minutes === 1
					? 'model.pricing.duration.hourMinute'
					: 'model.pricing.duration.hourMinutes'
				: minutes === 1
					? 'model.pricing.duration.hoursMinute'
					: 'model.pricing.duration.hoursMinutes',
			hours,
			minutes,
		);
	}
	if (hours > 0) {
		return t(hours === 1 ? 'model.pricing.duration.hour' : 'model.pricing.duration.hours', hours);
	}
	return t(
		minutes === 1 ? 'model.pricing.duration.minute' : 'model.pricing.duration.minutes',
		minutes,
	);
}
