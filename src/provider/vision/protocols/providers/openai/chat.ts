import { t } from '../../../../../i18n';
import type { VisionDescriptionRequest, VisionProxyConfig } from '../../../types';
import { VisionProxyError } from '../../errors';
import type { VisionProviderAdapter } from '../types';
import { isRecord, toBase64 } from '../utils';

export const openAIChatAdapter: VisionProviderAdapter = {
	createBody(config, request) {
		return createBody(config, request);
	},
	parseResponse(value) {
		return parseResponse(value);
	},
};

function createBody(config: VisionProxyConfig, request: VisionDescriptionRequest): object {
	return {
		...config.extraBody,
		model: config.modelId,
		messages: [
			{
				role: 'user',
				content: [
					{ type: 'text', text: request.prompt },
					...request.images.map((image) => ({
						type: 'image_url',
						image_url: {
							url: `data:${image.mimeType};base64,${toBase64(image)}`,
						},
					})),
				],
			},
		],
	};
}

function parseResponse(value: unknown): string {
	if (!isRecord(value) || !Array.isArray(value.choices)) {
		throw new VisionProxyError(
			'unsupported-response',
			t('vision.proxy.error.unsupportedOpenAIResponse'),
		);
	}

	const choice = value.choices[0];
	const message = isRecord(choice) ? choice.message : undefined;
	const content = isRecord(message) ? message.content : undefined;
	const text = parseContent(content).trim();

	if (!text) {
		throw new VisionProxyError('empty-response', t('vision.proxy.error.emptyResponse'));
	}
	return text;
}

function parseContent(content: unknown): string {
	if (typeof content === 'string') {
		return content;
	}
	if (!Array.isArray(content)) {
		throw new VisionProxyError(
			'unsupported-response',
			t('vision.proxy.error.unsupportedOpenAIContent'),
		);
	}
	return content
		.map((block) => {
			if (!isRecord(block)) {
				return undefined;
			}
			if (typeof block.text === 'string') {
				return block.text;
			}
			if (typeof block.content === 'string') {
				return block.content;
			}
			return undefined;
		})
		.filter((item): item is string => typeof item === 'string')
		.join('');
}
