import { t } from '../../../../../i18n';
import type { VisionDescriptionRequest, VisionProxyConfig } from '../../../types';
import { VisionProxyError } from '../../errors';
import type { VisionProviderAdapter } from '../types';
import { isRecord, toBase64 } from '../utils';

export const openAIResponsesAdapter: VisionProviderAdapter = {
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
		input: [
			{
				role: 'user',
				content: [
					{ type: 'input_text', text: request.prompt },
					...request.images.map((image) => ({
						type: 'input_image',
						detail: 'auto',
						image_url: `data:${image.mimeType};base64,${toBase64(image)}`,
					})),
				],
			},
		],
	};
}

function parseResponse(value: unknown): string {
	if (!isRecord(value)) {
		throw new VisionProxyError(
			'unsupported-response',
			t('vision.proxy.error.unsupportedOpenAIResponse'),
		);
	}

	if (typeof value.output_text === 'string' && value.output_text.trim()) {
		return value.output_text.trim();
	}

	const text = parseOutput(value.output).trim();
	if (!text) {
		throw new VisionProxyError('empty-response', t('vision.proxy.error.emptyResponse'));
	}
	return text;
}

function parseOutput(output: unknown): string {
	if (!Array.isArray(output)) {
		throw new VisionProxyError(
			'unsupported-response',
			t('vision.proxy.error.unsupportedOpenAIResponse'),
		);
	}

	return output
		.map((item) => {
			if (!isRecord(item)) {
				return undefined;
			}
			if (typeof item.text === 'string') {
				return item.text;
			}
			if (typeof item.content === 'string') {
				return item.content;
			}
			if (Array.isArray(item.content)) {
				return parseContent(item.content);
			}
			return undefined;
		})
		.filter((item): item is string => typeof item === 'string')
		.join('');
}

function parseContent(content: unknown[]): string {
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
