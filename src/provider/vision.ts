import vscode from 'vscode';
import { DEFAULT_VISION_MODEL_ID, IMAGE_DESCRIPTION_PROMPT } from '../consts';
import { logger } from '../logger';

/**
 * Resolve any image parts in user messages by forwarding them to a vision
 * model and replacing them with text descriptions. This lets text-only models
 * like DeepSeek effectively "see" images.
 */
export async function resolveImageMessages(
	messages: readonly vscode.LanguageModelChatRequestMessage[],
	token: vscode.CancellationToken,
	getModel: () => Promise<vscode.LanguageModelChat | undefined>,
): Promise<readonly vscode.LanguageModelChatRequestMessage[]> {
	const hasImages = messages.some((m) => m.content.some((p) => isImageDataPart(p)));
	if (!hasImages) {
		return messages;
	}

	const visionModel = await getModel();
	if (!visionModel) {
		logger.warn('No vision model available; images will be dropped.');
		return messages.map((m) => {
			const filtered = (m.content as readonly vscode.LanguageModelInputPart[]).filter(
				(p) => !isImageDataPart(p),
			);
			return {
				role: m.role,
				content: filtered,
			} as unknown as vscode.LanguageModelChatRequestMessage;
		});
	}

	const result: vscode.LanguageModelChatRequestMessage[] = [];

	for (const message of messages) {
		const imageParts: vscode.LanguageModelDataPart[] = [];
		const otherParts: vscode.LanguageModelInputPart[] = [];

		for (const part of message.content as readonly vscode.LanguageModelInputPart[]) {
			if (isImageDataPart(part)) {
				imageParts.push(part);
			} else {
				otherParts.push(part);
			}
		}

		if (imageParts.length === 0) {
			result.push(message as vscode.LanguageModelChatRequestMessage);
			continue;
		}

		try {
			const visionMsg = vscode.LanguageModelChatMessage.User([
				...imageParts,
				new vscode.LanguageModelTextPart(getVisionPrompt()),
			] as (vscode.LanguageModelDataPart | vscode.LanguageModelTextPart)[]);

			const response = await visionModel.sendRequest([visionMsg], {}, token);
			let description = '';
			for await (const chunk of response.stream) {
				if (chunk instanceof vscode.LanguageModelTextPart) {
					description += chunk.value;
				}
			}

			otherParts.push(
				new vscode.LanguageModelTextPart(`[Image Description: ${description.trim()}]`),
			);
		} catch (err) {
			logger.error('Vision proxy error:', err);
			otherParts.push(new vscode.LanguageModelTextPart('[Image: unable to describe]'));
		}

		result.push({
			role: message.role,
			content: otherParts,
		} as unknown as vscode.LanguageModelChatRequestMessage);
	}

	return result;
}

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
					logger.info(`Using vision proxy model: ${models[0].id}`);
					visionModel = models[0];
					return models[0];
				}
				logger.warn(`Vision model "${id}" not found.`);
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
		vscode.window.showInformationMessage(
			'No language models available in your VS Code environment.',
		);
		return;
	}

	const currentId = getConfiguredVisionModelId();

	const items = candidates.map((m) => ({
		label: m.id,
		description: `vendor: ${m.vendor}`,
		detail: m.id === currentId ? '✓ current' : undefined,
	}));

	const picked = await vscode.window.showQuickPick(items, {
		placeHolder: `Pick a model to describe image attachments (default: ${DEFAULT_VISION_MODEL_ID})`,
		matchOnDescription: true,
	});

	if (picked) {
		const config = vscode.workspace.getConfiguration('deepseek-copilot');
		await config.update('visionModel', picked.label, vscode.ConfigurationTarget.Global);
	}
}

function getConfiguredVisionModelId(): string | undefined {
	const config = vscode.workspace.getConfiguration('deepseek-copilot');
	const id = config.get<string>('visionModel', '');
	return id.trim() || undefined;
}

function isImageDataPart(part: unknown): part is vscode.LanguageModelDataPart {
	return part instanceof vscode.LanguageModelDataPart && part.mimeType.startsWith('image/');
}

function getVisionPrompt(): string {
	const config = vscode.workspace.getConfiguration('deepseek-copilot');
	return (
		config.get<string>('visionPrompt', IMAGE_DESCRIPTION_PROMPT).trim() || IMAGE_DESCRIPTION_PROMPT
	);
}
