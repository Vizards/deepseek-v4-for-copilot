import type { ModelDefinition, PriceCategory, PricingCurrency } from '../../types';

/**
 * VS Code's proposed cost fields are documented as numeric credits, but the
 * current Copilot UI renders them textually. We intentionally pass formatted
 * currency labels here so BYOK prices appear in the native cost slots.
 * If a future UI parses these fields numerically, expect NaN or missing costs;
 * remove the formatted fields from this one mapping point when that happens.
 *
 * Mapping:
 * - inputCost  <- cacheMissInput, the representative non-cached input price.
 * - cacheCost  <- cacheHitInput, shown separately as the cached-input tier.
 * - outputCost <- output.
 *
 * priceCategory is emitted only together with concrete official pricing; incomplete
 * pricing intentionally suppresses all cost metadata.
 */
export interface ModelCostInformation {
	readonly inputCost?: string;
	readonly outputCost?: string;
	readonly cacheCost?: string;
	readonly priceCategory?: PriceCategory;
}

export function toModelCostInfo(
	model: ModelDefinition,
	currency?: PricingCurrency,
): ModelCostInformation {
	if (!currency) {
		return {};
	}

	const pricing = model.pricing?.[currency];
	if (!pricing) {
		return {};
	}

	return {
		...(model.priceCategory ? { priceCategory: model.priceCategory } : {}),
		inputCost: formatPriceValue(pricing.cacheMissInput, currency),
		outputCost: formatPriceValue(pricing.output, currency),
		cacheCost: formatPriceValue(pricing.cacheHitInput, currency),
	};
}

function formatPriceValue(value: number, currency: PricingCurrency): string {
	return `${currency === 'CNY' ? '¥' : '$'}${value}`;
}
