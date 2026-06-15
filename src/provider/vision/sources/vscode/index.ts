import vscode from 'vscode';
import { t } from '../../../../i18n';
import { logVSCodeVisionModelNotFound, logVSCodeVisionModelSelected } from '../../log';
import { DEFAULT_VISION_MODEL_ID, IMAGE_DESCRIPTION_PROMPT } from '../../consts';
import type {
	VisionDescriptionRequest,
	VisionDescriber,
	VisionLanguageModelOption,
} from '../../types';
import { getVSCodeVisionTargetChatSessionType } from './model';

const EXCLUDED_VISION_MODEL_IDS = new Set(['copilot-utility', 'copilot-utility-small']);
const EXCLUDED_VISION_MODEL_VENDORS = new Set(['deepseek', 'claude-code', 'copilotcli']);
const EXCLUDED_VISION_TARGET_CHAT_SESSION_TYPES = new Set(['claude-code', 'copilotcli']);
const VSCODE_VISION_MODEL_KEY_SEPARATOR = '/';

type LanguageModelPricingInfo = {
	readonly pricing?: unknown;
	readonly inputCost?: unknown;
	readonly outputCost?: unknown;
	readonly cacheCost?: unknown;
	readonly longContextInputCost?: unknown;
	readonly longContextOutputCost?: unknown;
	readonly longContextCacheCost?: unknown;
	readonly priceCategory?: unknown;
};

export function createVSCodeLanguageModelVisionDescriberGetter(): {
	get: () => Promise<VisionDescriber | undefined>;
	reset: () => void;
} {
	let describer: VisionDescriber | undefined;
	let describerPromise: Promise<VisionDescriber | undefined> | undefined;
	let generation = 0;

	return {
		async get() {
			if (describer) {
				return describer;
			}
			if (describerPromise) {
				return describerPromise;
			}

			const requestGeneration = generation;
			const currentPromise = (async () => {
				const models = await listVSCodeVisionModels();
				const configuredKey = getConfiguredVisionModelKey();
				if (requestGeneration !== generation) {
					return undefined;
				}
				const model = pickPreferredVSCodeVisionModel(models, configuredKey);
				if (model) {
					logVSCodeVisionModelSelected(model);
					describer = new VSCodeLanguageModelVisionDescriber(model);
					return describer;
				}
				logVSCodeVisionModelNotFound(configuredKey ?? DEFAULT_VISION_MODEL_ID);
				return undefined;
			})();
			describerPromise = currentPromise;

			try {
				const result = await currentPromise;
				if (
					result === undefined &&
					requestGeneration === generation &&
					describerPromise === currentPromise
				) {
					describerPromise = undefined;
				}
				return result;
			} catch (error) {
				if (requestGeneration === generation && describerPromise === currentPromise) {
					describerPromise = undefined;
				}
				throw error;
			}
		},

		reset() {
			generation += 1;
			describer = undefined;
			describerPromise = undefined;
		},
	};
}

export class VSCodeLanguageModelVisionDescriber implements VisionDescriber {
	readonly source = 'vscode-lm';

	constructor(private readonly model: vscode.LanguageModelChat) {}

	get id(): string {
		return this.model.id;
	}

	async describe(request: VisionDescriptionRequest): Promise<string> {
		const visionMsg = vscode.LanguageModelChatMessage.User([
			...request.images.map(
				(image) => new vscode.LanguageModelDataPart(image.data, image.mimeType),
			),
			new vscode.LanguageModelTextPart(request.prompt),
		] as (vscode.LanguageModelDataPart | vscode.LanguageModelTextPart)[]);

		const response = await this.model.sendRequest([visionMsg], {}, request.token);
		let description = '';
		for await (const chunk of response.stream) {
			if (chunk instanceof vscode.LanguageModelTextPart) {
				description += chunk.value;
			}
		}
		return description.trim();
	}
}

export function getVisionPrompt(): string {
	const config = vscode.workspace.getConfiguration('deepseek-copilot');
	return (
		config.get<string>('visionPrompt', IMAGE_DESCRIPTION_PROMPT).trim() || IMAGE_DESCRIPTION_PROMPT
	);
}

export function getConfiguredVisionModelKey(): string | undefined {
	const config = vscode.workspace.getConfiguration('deepseek-copilot');
	const key = config.get<string>('visionModel', '');
	return key.trim() || undefined;
}

export function getDefaultVisionModelId(): string {
	return DEFAULT_VISION_MODEL_ID;
}

export async function saveVSCodeVisionModelKey(key: string): Promise<void> {
	const normalizedKey = await normalizeVSCodeVisionModelKeyForSave(key);
	if (!normalizedKey) {
		throw new Error(t('vision.panel.error.required', t('vision.panel.source.vscodeLm')));
	}
	const config = vscode.workspace.getConfiguration('deepseek-copilot');
	await config.update('visionModel', normalizedKey, vscode.ConfigurationTarget.Global);
}

export async function listVSCodeVisionModelOptions(): Promise<VisionLanguageModelOption[]> {
	const models = await listVSCodeVisionModels();
	return models.map((model) => {
		const costDescription = formatLanguageModelCost(model);
		return {
			key: getVSCodeVisionModelKey(model),
			id: model.id,
			vendor: model.vendor,
			name: model.name,
			family: model.family,
			version: model.version,
			label: `${model.name && model.name !== model.id ? `${model.name} (${model.id})` : model.id} - ${model.vendor}`,
			description: `${model.vendor}${model.family ? ` / ${model.family}` : ''}`,
			...(costDescription ? { costDescription } : {}),
		};
	});
}

export function pickPreferredVSCodeVisionModelKey(
	options: readonly VisionLanguageModelOption[],
	configuredKey: string | undefined,
): string | undefined {
	if (configuredKey) {
		const configured = pickConfiguredVSCodeVisionModelEntry(options, configuredKey);
		if (configured) {
			return configured.key;
		}
	}
	const preferred = options.find((model) => model.id === DEFAULT_VISION_MODEL_ID);
	if (preferred) {
		return preferred.key;
	}
	return options[0]?.key;
}

async function listVSCodeVisionModels(): Promise<vscode.LanguageModelChat[]> {
	const allModels = await vscode.lm.selectChatModels();
	return allModels.filter(isVSCodeVisionModel);
}

function pickPreferredVSCodeVisionModel(
	models: readonly vscode.LanguageModelChat[],
	configuredKey: string | undefined,
): vscode.LanguageModelChat | undefined {
	if (configuredKey) {
		const configured = pickConfiguredVSCodeVisionModelEntry(models, configuredKey);
		if (configured) {
			return configured;
		}
	}

	const preferred = models.find((model) => model.id === DEFAULT_VISION_MODEL_ID);
	if (preferred) {
		return preferred;
	}
	return models[0];
}

function isVSCodeVisionModel(model: vscode.LanguageModelChat): boolean {
	return (
		!EXCLUDED_VISION_MODEL_VENDORS.has(model.vendor) &&
		!EXCLUDED_VISION_MODEL_IDS.has(model.id) &&
		!EXCLUDED_VISION_TARGET_CHAT_SESSION_TYPES.has(
			getVSCodeVisionTargetChatSessionType(model) ?? '',
		) &&
		getSupportsImageToText(model)
	);
}

function getVSCodeVisionModelKey(model: Pick<vscode.LanguageModelChat, 'vendor' | 'id'>): string {
	return `${model.vendor}${VSCODE_VISION_MODEL_KEY_SEPARATOR}${model.id}`;
}

async function normalizeVSCodeVisionModelKeyForSave(key: string): Promise<string | undefined> {
	const trimmed = key.trim();
	if (!trimmed) {
		return undefined;
	}
	const model = pickConfiguredVSCodeVisionModelEntry(await listVSCodeVisionModels(), trimmed);
	if (!model) {
		throw new Error(t('vision.notFound', trimmed));
	}
	return getVSCodeVisionModelKey(model);
}

function pickConfiguredVSCodeVisionModelEntry<T extends { id: string; vendor: string }>(
	models: readonly T[],
	configuredKey: string,
): T | undefined {
	const legacyId = configuredKey.trim();
	const parsed = parseVSCodeVisionModelKey(configuredKey);
	if (!parsed) {
		return legacyId ? pickLegacyVSCodeVisionModelById(models, legacyId) : undefined;
	}
	if (parsed.vendor) {
		const exact = models.find((model) => model.vendor === parsed.vendor && model.id === parsed.id);
		// VS Code model ids are opaque and may contain "/", so preserve legacy bare-id
		// settings by retrying the whole value when no provider-qualified key matches.
		return exact ?? pickLegacyVSCodeVisionModelById(models, legacyId);
	}
	return pickLegacyVSCodeVisionModelById(models, parsed.id);
}

function pickLegacyVSCodeVisionModelById<T extends { id: string; vendor: string }>(
	models: readonly T[],
	id: string,
): T | undefined {
	const matches = models.filter((model) => model.id === id);
	return matches.find((model) => model.vendor === 'copilot') ?? matches[0];
}

function parseVSCodeVisionModelKey(
	value: string,
): { vendor: string | undefined; id: string } | undefined {
	const trimmed = value.trim();
	if (!trimmed) {
		return undefined;
	}
	const separatorIndex = trimmed.indexOf(VSCODE_VISION_MODEL_KEY_SEPARATOR);
	if (separatorIndex <= 0) {
		return { vendor: undefined, id: trimmed };
	}
	const vendor = trimmed.slice(0, separatorIndex).trim();
	const id = trimmed.slice(separatorIndex + VSCODE_VISION_MODEL_KEY_SEPARATOR.length).trim();
	return vendor && id ? { vendor, id } : undefined;
}

function getSupportsImageToText(model: vscode.LanguageModelChat): boolean {
	const capabilities = (
		model as {
			capabilities?: { supportsImageToText?: boolean; imageInput?: boolean };
		}
	).capabilities;
	// VS Code providers declare imageInput, while selected LanguageModelChat
	// instances expose it as supportsImageToText in VS Code 1.116+.
	return capabilities?.supportsImageToText === true || capabilities?.imageInput === true;
}

function formatLanguageModelCost(model: vscode.LanguageModelChat): string | undefined {
	const pricingInfo = model as vscode.LanguageModelChat & LanguageModelPricingInfo;
	const costParts = formatCostParts(
		toFiniteNumber(pricingInfo.inputCost),
		toFiniteNumber(pricingInfo.cacheCost),
		toFiniteNumber(pricingInfo.outputCost),
	);
	const priceCategory = formatPriceCategory(asString(pricingInfo.priceCategory));
	if (costParts) {
		const parts = [t('vision.panel.cost.tokenCost', costParts)];
		if (priceCategory) {
			parts.push(priceCategory);
		}

		const longContextCostParts = formatCostParts(
			toFiniteNumber(pricingInfo.longContextInputCost),
			toFiniteNumber(pricingInfo.longContextCacheCost),
			toFiniteNumber(pricingInfo.longContextOutputCost),
		);
		if (longContextCostParts) {
			parts.push(t('vision.panel.cost.longContextTokenCost', longContextCostParts));
		}
		return parts.join(' · ');
	}

	if (priceCategory) {
		return priceCategory;
	}

	const pricing = asString(pricingInfo.pricing);
	return pricing ? t('vision.panel.cost.pricing', pricing) : undefined;
}

function formatCostParts(
	inputCost: number | undefined,
	cacheCost: number | undefined,
	outputCost: number | undefined,
): string | undefined {
	const parts: string[] = [];
	if (inputCost !== undefined) {
		parts.push(t('vision.panel.cost.input', inputCost));
	}
	if (cacheCost !== undefined) {
		parts.push(t('vision.panel.cost.cachedInput', cacheCost));
	}
	if (outputCost !== undefined) {
		parts.push(t('vision.panel.cost.output', outputCost));
	}
	return parts.length > 0 ? parts.join(', ') : undefined;
}

function formatPriceCategory(priceCategory: string | undefined): string | undefined {
	switch (priceCategory) {
		case 'low':
			return t('vision.panel.cost.category.low');
		case 'medium':
			return t('vision.panel.cost.category.medium');
		case 'high':
			return t('vision.panel.cost.category.high');
		case 'very_high':
			return t('vision.panel.cost.category.veryHigh');
		default:
			return priceCategory ? t('vision.panel.cost.category.named', priceCategory) : undefined;
	}
}

function toFiniteNumber(value: unknown): number | undefined {
	return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function asString(value: unknown): string | undefined {
	return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
