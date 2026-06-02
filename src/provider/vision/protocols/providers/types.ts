import type { VisionDescriptionRequest, VisionProxyConfig } from '../../types';

export interface VisionProviderAdapter {
	createBody(config: VisionProxyConfig, request: VisionDescriptionRequest): object;
	parseResponse(value: unknown): string;
}
