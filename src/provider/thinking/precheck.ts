import { DeepSeekRequestError } from '../../client/error';
import { OFFICIAL_DEEPSEEK_API_HOST } from '../../client/consts';
import { logger } from '../../logger';
import type { DeepSeekRequest } from '../../types';
import type { ThinkingEffort } from '../models';
import { toOpenAICompatibleMaxRetryRequest, toOpenAICompatibleReasoningRequest } from './shape';
import type { ChatCompletionRequestBody } from './types';

const LOG_PREFIX = '[reasoning-effort-compat]';
const openAICompatibleEffortEndpoints = new Set<string>();

export interface ThinkingCompatibilityPrecheck {
	readonly initialRequest: ChatCompletionRequestBody;
	createRetryAttempt(error: unknown): ThinkingCompatibilityRetryAttempt | undefined;
}

export interface ThinkingCompatibilityRetryAttempt {
	readonly request: ChatCompletionRequestBody;
	readonly strategy: ThinkingCompatibilityRetryStrategy;
	readonly sourceStatus: number;
	logStart(): void;
	logFailure(error: unknown): void;
	recordSuccess(): void;
}

export type ThinkingCompatibilityRetryStrategy = 'max-to-xhigh';

export function createThinkingCompatibilityPrecheck(options: {
	baseUrl: string;
	request: DeepSeekRequest;
	isThinkingModel: boolean;
	thinkingEffort: ThinkingEffort;
}): ThinkingCompatibilityPrecheck {
	const endpointKey = getSessionCacheKey(options.baseUrl);
	const initialRequest = createInitialRequest({
		...options,
		endpointKey,
	});

	return {
		initialRequest,
		createRetryAttempt: (error) =>
			createRetryAttempt({
				...options,
				endpointKey,
				initialRequest,
				error,
			}),
	};
}

function createInitialRequest(options: {
	baseUrl: string;
	request: DeepSeekRequest;
	isThinkingModel: boolean;
	thinkingEffort: ThinkingEffort;
	endpointKey: string;
}): ChatCompletionRequestBody {
	if (!options.isThinkingModel) {
		return options.request;
	}
	if (openAICompatibleEffortEndpoints.has(options.endpointKey)) {
		const request = toOpenAICompatibleReasoningRequest(options.request, options.thinkingEffort);
		logger.info(
			`${LOG_PREFIX} precheck-cache-hit endpoint=${options.endpointKey}` +
				` effort=${options.thinkingEffort}` +
				` mappedEffort=${request.reasoning_effort}` +
				` removedThinking=true`,
		);
		return request;
	}
	return options.request;
}

function createRetryAttempt(options: {
	baseUrl: string;
	request: DeepSeekRequest;
	thinkingEffort: ThinkingEffort;
	endpointKey: string;
	initialRequest: ChatCompletionRequestBody;
	error: unknown;
}): ThinkingCompatibilityRetryAttempt | undefined {
	const failure = getHttpFailure(options.error);
	if (!failure || openAICompatibleEffortEndpoints.has(options.endpointKey)) {
		return undefined;
	}
	if (
		options.thinkingEffort === 'max' &&
		options.initialRequest.reasoning_effort === 'max' &&
		!isOfficialDeepSeekEndpoint(options.baseUrl) &&
		isRetryableThinkingHttpFailure(failure)
	) {
		return createMaxToXHighAttempt(options, failure);
	}
	return undefined;
}

function createMaxToXHighAttempt(
	options: {
		request: DeepSeekRequest;
		endpointKey: string;
	},
	failure: HttpFailure,
): ThinkingCompatibilityRetryAttempt {
	const retryRequest = toOpenAICompatibleMaxRetryRequest(options.request);
	return {
		request: retryRequest,
		strategy: 'max-to-xhigh',
		sourceStatus: failure.status,
		logStart: () => {
			logger.info(
				`${LOG_PREFIX} precheck-retry-start endpoint=${options.endpointKey}` +
					` status=${failure.status} effort=max->xhigh removedThinking=true`,
			);
		},
		logFailure: (error) => {
			logger.info(
				`${LOG_PREFIX} precheck-retry-failed endpoint=${options.endpointKey}` +
					` status=${getHttpFailure(error)?.status ?? 'unknown'}`,
			);
		},
		recordSuccess: () => {
			openAICompatibleEffortEndpoints.add(options.endpointKey);
			logger.info(
				`${LOG_PREFIX} precheck-retry-success endpoint=${options.endpointKey}` +
					` sessionCache=openai-compatible-effort`,
			);
		},
	};
}

interface HttpFailure {
	status: number;
}

function getHttpFailure(error: unknown): HttpFailure | undefined {
	if (!(error instanceof DeepSeekRequestError) || error.kind !== 'http') {
		return undefined;
	}
	return {
		status: error.status ?? 0,
	};
}

function isRetryableThinkingHttpFailure(failure: HttpFailure): boolean {
	return failure.status === 400;
}

function getSessionCacheKey(baseUrl: string): string {
	try {
		const url = new URL(baseUrl);
		const port = url.port ? `:${url.port}` : '';
		const pathname = url.pathname.replace(/\/+$/u, '');
		return `${url.protocol.toLowerCase()}//${url.hostname.toLowerCase()}${port}${pathname}`;
	} catch {
		return baseUrl.trim().replace(/\/+$/u, '');
	}
}

function isOfficialDeepSeekEndpoint(baseUrl: string): boolean {
	try {
		return new URL(baseUrl).hostname.toLowerCase() === OFFICIAL_DEEPSEEK_API_HOST;
	} catch {
		return false;
	}
}
