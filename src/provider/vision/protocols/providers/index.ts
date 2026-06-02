import type { VisionProxyConfig } from '../../types';
import { anthropicMessagesAdapter } from './anthropic/messages';
import { openAIChatAdapter } from './openai/chat';
import { openAIResponsesAdapter } from './openai/responses';
import type { VisionProviderAdapter } from './types';

export function getVisionProviderAdapter(config: VisionProxyConfig): VisionProviderAdapter {
	if (config.providerFamily === 'anthropic-compatible') {
		return anthropicMessagesAdapter;
	}
	return config.apiType === 'responses' ? openAIResponsesAdapter : openAIChatAdapter;
}
