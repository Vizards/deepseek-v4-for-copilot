import type { DeepSeekRequest } from '../../types';
import type { ThinkingEffort } from '../models';

export type DeepSeekNativeReasoningEffort = Exclude<ThinkingEffort, 'none'>;

export type OpenAICompatibleReasoningEffort = Extract<ThinkingEffort, 'none' | 'high'> | 'xhigh';

export type OpenAICompatibleReasoningRequest = Omit<
	DeepSeekRequest,
	'thinking' | 'reasoning_effort'
> & {
	thinking?: never;
	reasoning_effort?: OpenAICompatibleReasoningEffort;
};

export type ChatCompletionRequestBody = DeepSeekRequest | OpenAICompatibleReasoningRequest;
