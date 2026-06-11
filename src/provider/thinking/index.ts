export {
	createThinkingCompatibilityPrecheck,
	type ThinkingCompatibilityPrecheck,
	type ThinkingCompatibilityRetryAttempt,
	type ThinkingCompatibilityRetryStrategy,
} from './precheck';
export {
	toDeepSeekNativeReasoningRequest,
	toOpenAICompatibleMaxRetryRequest,
	toOpenAICompatibleReasoningEffort,
	toOpenAICompatibleReasoningRequest,
} from './shape';
export type {
	ChatCompletionRequestBody,
	OpenAICompatibleReasoningEffort,
	OpenAICompatibleReasoningRequest,
} from './types';
