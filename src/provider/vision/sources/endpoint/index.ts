import { VisionProxyClient } from '../../protocols/client';
import type { VisionDescriptionRequest, VisionDescriber, VisionProxyConfig } from '../../types';

export function createEndpointVisionDescriber(
	config: VisionProxyConfig,
	apiKey: string | undefined,
): VisionDescriber {
	return new EndpointVisionDescriber(config, apiKey);
}

class EndpointVisionDescriber implements VisionDescriber {
	readonly source = 'api-endpoint';
	private readonly client = new VisionProxyClient();

	constructor(
		private readonly config: VisionProxyConfig,
		private readonly apiKey: string | undefined,
	) {}

	get id(): string {
		return `${this.config.providerFamily}:${this.config.modelId}`;
	}

	describe(request: VisionDescriptionRequest): Promise<string> {
		return this.client.describe(this.config, this.apiKey, request);
	}
}
