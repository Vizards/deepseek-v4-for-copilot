import type { DeepSeekContentPart, DeepSeekMessage } from '../types';

export interface DeepSeekContentToTextOptions {
	includeImageUrls?: boolean;
	separator?: string;
}

export function deepSeekContentToText(
	content: string | DeepSeekContentPart[] | undefined,
	options: DeepSeekContentToTextOptions = {},
): string {
	if (!content) {
		return '';
	}
	if (typeof content === 'string') {
		return content;
	}

	const includeImageUrls = options.includeImageUrls ?? false;
	const separator = options.separator ?? '';

	const parts: string[] = [];
	for (const part of content) {
		if (part.type === 'text') {
			parts.push(part.text);
			continue;
		}
		if (includeImageUrls && part.type === 'image_url') {
			parts.push(part.image_url.url);
		}
	}

	return parts.join(separator);
}

export function deepSeekMessageToText(
	message: Pick<DeepSeekMessage, 'content'>,
	options?: DeepSeekContentToTextOptions,
): string {
	return deepSeekContentToText(message.content, options);
}
