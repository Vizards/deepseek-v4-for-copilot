import type { VisionProxyConfig } from '../types';
import { t } from '../../../i18n';
import { VisionProxyError } from './errors';

export function resolveVisionEndpoint(config: VisionProxyConfig): URL {
	return createUrl(config.url);
}

export function validateVisionEndpointUrl(value: string): void {
	createUrl(value);
}

function createUrl(value: string): URL {
	try {
		const url = new URL(value);
		if (url.protocol !== 'http:' && url.protocol !== 'https:') {
			throw new VisionProxyError('invalid-url', t('vision.proxy.error.invalidUrlProtocol'));
		}
		return url;
	} catch (error) {
		if (error instanceof VisionProxyError) {
			throw error;
		}
		throw new VisionProxyError('invalid-url', t('vision.proxy.error.invalidUrl'), undefined, error);
	}
}
