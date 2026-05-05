import vscode from 'vscode';
import { DEFAULT_VISION_MODEL_ID, IMAGE_DESCRIPTION_PROMPT } from '../../consts';
import { t } from '../../i18n';
import { logger } from '../../logger';

/**
 * Get the vision proxy model. Cached after first lookup.
 * Uses the configured model ID, or defaults to DEFAULT_VISION_MODEL_ID.
 */
export function createVisionModelGetter(): {
	get: () => Promise<vscode.LanguageModelChat | undefined>;
	reset: () => void;
} {
	let visionModel: vscode.LanguageModelChat | undefined;
	let visionModelPromise: Promise<vscode.LanguageModelChat | undefined> | undefined;

	return {
		async get() {
			if (visionModel) {
				return visionModel;
			}
			if (visionModelPromise) {
				return visionModelPromise;
			}

			visionModelPromise = (async () => {
				const id = getConfiguredVisionModelId() ?? DEFAULT_VISION_MODEL_ID;
				const models = await vscode.lm.selectChatModels({ id });
				if (models.length > 0) {
					logger.info(t('vision.proxyUsing', models[0].id));
					visionModel = models[0];
					return models[0];
				}
				logger.warn(t('vision.notFound', id));
				return undefined;
			})();

			return visionModelPromise;
		},

		reset() {
			visionModel = undefined;
			visionModelPromise = undefined;
		},
	};
}

/**
 * Let the user pick which model to use for describing image attachments.
 */
export async function setVisionProxyModel(): Promise<void> {
	const allModels = await vscode.lm.selectChatModels();
	const candidates = allModels.filter((m) => m.vendor !== 'deepseek');

	if (candidates.length === 0) {
		vscode.window.showInformationMessage(t('vision.noModel'));
		return;
	}

	const currentId = getConfiguredVisionModelId();

	const items = candidates.map((m) => ({
		label: m.id,
		description: t('vision.vendorLabel', m.vendor),
		detail: m.id === currentId ? t('vision.current') : undefined,
	}));

	const picked = await vscode.window.showQuickPick(items, {
		placeHolder: t('vision.pickPlaceholder', DEFAULT_VISION_MODEL_ID),
		matchOnDescription: true,
	});

	if (picked) {
		const config = vscode.workspace.getConfiguration('deepseek-copilot');
		await config.update('visionModel', picked.label, vscode.ConfigurationTarget.Global);
	}
}

export function getVisionPrompt(): string {
	const config = vscode.workspace.getConfiguration('deepseek-copilot');
	return (
		config.get<string>('visionPrompt', IMAGE_DESCRIPTION_PROMPT).trim() || IMAGE_DESCRIPTION_PROMPT
	);
}

function getConfiguredVisionModelId(): string | undefined {
	const config = vscode.workspace.getConfiguration('deepseek-copilot');
	const id = config.get<string>('visionModel', '');
	return id.trim() || undefined;
}
