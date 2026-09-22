import { t } from '../i18n';

const LEGACY_FLASH_MODEL_IDS = new Set(['deepseek-v4-flash', 'deepseek-v4-flash-vision-exp']);

interface ModelRetirementNotice {
	code: 'model_deprecated';
	message: string;
	showPricing: boolean;
}

/** Presentation only: never changes model selection or request conversion. */
export function getModelRetirementNotice(
	modelId: string,
	usesOfficialModel: boolean,
): ModelRetirementNotice | undefined {
	if (!LEGACY_FLASH_MODEL_IDS.has(modelId)) {
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

	return {
		code: 'model_deprecated',
		message: t('model.retirement.flashRetired'),
		showPricing: false,
	};
}
