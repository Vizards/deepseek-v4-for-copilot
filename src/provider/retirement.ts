import { t } from '../i18n';

// Official API routing changes at 12:00 Beijing time. This also coincides
// with a peak/off-peak boundary handled by the existing pricing refresh timer.
const PRO_RETIREMENT_AT = Date.parse('2026-09-14T12:00:00+08:00');
const LEGACY_MODEL_IDS = new Set([
	'deepseek-v4-flash',
	'deepseek-v4-pro',
	'deepseek-v4-flash-vision-exp',
]);

interface ModelRetirementNotice {
	code: 'model_pending_deprecation' | 'model_deprecated';
	message: string;
	showPricing: boolean;
}

/** Presentation only: never changes model selection or request conversion. */
export function getModelRetirementNotice(
	modelId: string,
	usesOfficialModel: boolean,
	now: Date,
): ModelRetirementNotice | undefined {
	if (!LEGACY_MODEL_IDS.has(modelId)) {
		return undefined;
	}

	// A custom endpoint or mapped ID may still serve the original model.
	if (!usesOfficialModel) {
		return {
			code: 'model_deprecated',
			message: t('model.retirement.custom'),
			showPricing: false,
		};
	}

	if (modelId === 'deepseek-v4-pro' && now.getTime() < PRO_RETIREMENT_AT) {
		return {
			code: 'model_pending_deprecation',
			message: t('model.retirement.proPending'),
			showPricing: true,
		};
	}

	return {
		code: 'model_deprecated',
		message: t(
			modelId === 'deepseek-v4-pro'
				? 'model.retirement.proRetired'
				: 'model.retirement.flashRetired',
		),
		showPricing: false,
	};
}
