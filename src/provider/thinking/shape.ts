import type { DeepSeekRequest } from '../../types';
import type { ThinkingEffort } from '../models';
import type {
	DeepSeekNativeReasoningEffort,
	OpenAICompatibleReasoningEffort,
	OpenAICompatibleReasoningRequest,
} from './types';

export function toOpenAICompatibleMaxRetryRequest(
	request: DeepSeekRequest,
): OpenAICompatibleReasoningRequest {
	return toOpenAICompatibleReasoningRequest(request, 'max');
}

export function toOpenAICompatibleReasoningRequest(
	request: DeepSeekRequest,
	effort: ThinkingEffort,
): OpenAICompatibleReasoningRequest {
	const { thinking: _thinking, reasoning_effort: _reasoningEffort, ...rest } = request;
	return {
		...rest,
		reasoning_effort: toOpenAICompatibleReasoningEffort(effort),
	};
}

export function toDeepSeekNativeReasoningRequest(
	request: DeepSeekRequest,
	effort: ThinkingEffort,
): DeepSeekRequest {
	const nativeRequest: DeepSeekRequest = {
		...request,
		thinking: { type: effort === 'none' ? 'disabled' : 'enabled' },
	};
	if (effort === 'none') {
		delete nativeRequest.reasoning_effort;
	} else {
		nativeRequest.reasoning_effort = effort as DeepSeekNativeReasoningEffort;
	}
	return nativeRequest;
}

export function toOpenAICompatibleReasoningEffort(
	effort: ThinkingEffort,
): OpenAICompatibleReasoningEffort {
	return effort === 'max' ? 'xhigh' : effort;
}
