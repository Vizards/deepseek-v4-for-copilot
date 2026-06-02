import { t } from '../../../../../i18n';
import type { VisionDescriptionRequest, VisionProxyConfig } from '../../../types';
import { VisionProxyError } from '../../errors';
import type { VisionProviderAdapter } from '../types';
import { isRecord, toBase64 } from '../utils';

const DEFAULT_MAX_OUTPUT_TOKENS = 1024;

export const anthropicMessagesAdapter: VisionProviderAdapter = {
	createBody(config, request) {
		return createBody(config, request);
	},
	parseResponse(value) {
		return parseResponse(value);
	},
};

function createBody(config: VisionProxyConfig, request: VisionDescriptionRequest): object {
	return {
		max_tokens: DEFAULT_MAX_OUTPUT_TOKENS,
		...config.extraBody,
		model: config.modelId,
		messages: [
			{
				role: 'user',
				content: [
					{ type: 'text', text: request.prompt },
					...request.images.map((image) => ({
						type: 'image',
						source: {
							type: 'base64',
							media_type: image.mimeType,
							data: toBase64(image),
						},
					})),
				],
			},
		],
	};
}

function parseResponse(value: unknown): string {
	if (!isRecord(value) || !Array.isArray(value.content)) {
		throw new VisionProxyError(
			'unsupported-response',
			t('vision.proxy.error.unsupportedAnthropicResponse'),
		);
	}

	const text = value.content
		.map((block) => (isRecord(block) && block.type === 'text' ? block.text : undefined))
		.filter((item): item is string => typeof item === 'string')
		.join('')
		.trim();

	if (!text) {
		throw new VisionProxyError('empty-response', t('vision.proxy.error.emptyResponse'));
	}
	return text;
}
