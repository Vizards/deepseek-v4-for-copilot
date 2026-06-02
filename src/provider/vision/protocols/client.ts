import type { CancellationToken } from 'vscode';
import {
	getNetworkErrorCategory,
	getNetworkErrorCauseInfo,
	getNetworkErrorCode,
} from '../../../client/error/network';
import { t } from '../../../i18n';
import { safeStringify } from '../../../json';
import type { VisionDescriptionRequest, VisionProxyConfig } from '../types';
import {
	addVisionProxyDiagnostics,
	createHttpVisionProxyError,
	createVisionProxyRequestError,
	VisionProxyError,
	type VisionProxyRequestDiagnostics,
} from './errors';
import { createProviderHeaders } from './headers';
import { getVisionProviderAdapter } from './providers';
import { resolveVisionEndpoint } from './url';

const DEFAULT_TIMEOUT_MS = 30_000;

export class VisionProxyClient {
	async describe(
		config: VisionProxyConfig,
		apiKey: string | undefined,
		request: VisionDescriptionRequest,
	): Promise<string> {
		if (request.token.isCancellationRequested) {
			throw new VisionProxyError('cancelled', t('vision.proxy.error.cancelled'));
		}

		const endpoint = resolveVisionEndpoint(config);
		const adapter = getVisionProviderAdapter(config);
		const body = adapter.createBody(config, request);
		const headers = createProviderHeaders(config, apiKey?.trim() || undefined);
		const context = createVisionProxyRequestDiagnostics(
			'describe',
			config,
			endpoint,
			headers,
			request,
			apiKey,
		);
		const responseValue = await postJson(endpoint, {
			context,
			headers,
			body,
			timeoutMs: DEFAULT_TIMEOUT_MS,
			token: request.token,
		});

		try {
			return adapter.parseResponse(responseValue);
		} catch (error) {
			if (error instanceof VisionProxyError) {
				throw addVisionProxyDiagnostics(error, context);
			}
			throw error;
		}
	}
}

async function postJson(
	endpoint: URL,
	options: {
		context: VisionProxyRequestDiagnostics;
		headers: Record<string, string>;
		body: object;
		timeoutMs: number;
		token: CancellationToken;
	},
): Promise<unknown> {
	return postJsonRequest(endpoint, options, async (response) => {
		const responseText = await response.text();
		try {
			return JSON.parse(responseText) as unknown;
		} catch (error) {
			throw createVisionProxyRequestError(
				'unsupported-response',
				getUnsupportedResponseMessage(options.context),
				options.context,
				error,
			);
		}
	});
}

async function postJsonRequest<T>(
	endpoint: URL,
	options: {
		context: VisionProxyRequestDiagnostics;
		headers: Record<string, string>;
		body: object;
		timeoutMs: number;
		token: CancellationToken;
	},
	readResponse: (response: Response) => Promise<T>,
): Promise<T> {
	const controller = new AbortController();
	let timeoutReached = false;
	const timeout = setTimeout(() => {
		timeoutReached = true;
		controller.abort();
	}, options.timeoutMs);
	const cancelListener = options.token.onCancellationRequested(() => {
		controller.abort();
	});

	try {
		const bodyText = safeStringify(options.body);
		options.context.bodyBytes = Buffer.byteLength(bodyText, 'utf8');
		const response = await fetch(endpoint, {
			method: 'POST',
			headers: options.headers,
			body: bodyText,
			signal: controller.signal,
		});

		if (!response.ok) {
			throw await createHttpVisionProxyError(response, options.context);
		}
		return await readResponse(response);
	} catch (error) {
		if (options.token.isCancellationRequested) {
			throw createVisionProxyRequestError(
				'cancelled',
				t('vision.proxy.error.cancelled'),
				options.context,
				error,
			);
		}
		if (timeoutReached) {
			throw createVisionProxyRequestError(
				'timeout',
				t('vision.proxy.error.timeout'),
				options.context,
				error,
			);
		}
		if (error instanceof VisionProxyError) {
			throw error;
		}
		if (isAbortError(error)) {
			throw createVisionProxyNetworkError(error, options.context, 'aborted');
		}
		throw createVisionProxyNetworkError(error, options.context);
	} finally {
		clearTimeout(timeout);
		cancelListener.dispose();
	}
}

function createVisionProxyNetworkError(
	error: unknown,
	context: VisionProxyRequestDiagnostics,
	forcedCategory?: ReturnType<typeof getNetworkErrorCategory>,
): VisionProxyError {
	const causeInfo = error instanceof Error ? getNetworkErrorCauseInfo(error) : undefined;
	const code = getNetworkErrorCode(causeInfo);
	const category = forcedCategory ?? getNetworkErrorCategory(code);
	const displayCode = code ?? 'UNKNOWN';
	if (category === 'timeout') {
		return createVisionProxyRequestError(
			'timeout',
			t('vision.proxy.error.network.timeout', displayCode),
			context,
			error,
		);
	}
	return createVisionProxyRequestError(
		'network',
		t(`vision.proxy.error.network.${category}`, displayCode),
		context,
		error,
	);
}

function createVisionProxyRequestDiagnostics(
	phase: VisionProxyRequestDiagnostics['phase'],
	config: VisionProxyConfig,
	endpoint: URL,
	headers: Record<string, string>,
	request: VisionDescriptionRequest,
	apiKey: string | undefined,
): VisionProxyRequestDiagnostics {
	return {
		phase,
		providerFamily: config.providerFamily,
		apiType: config.apiType,
		modelId: config.modelId,
		endpoint,
		timeoutMs: DEFAULT_TIMEOUT_MS,
		hasApiKey: Boolean(apiKey?.trim()),
		headerNames: Object.keys(headers).sort(),
		imageCount: request.images.length,
		imageBytes: request.images.reduce((total, image) => total + image.data.byteLength, 0),
		promptChars: request.prompt.length,
	};
}

function getUnsupportedResponseMessage(context: VisionProxyRequestDiagnostics): string {
	return context.providerFamily === 'anthropic-compatible'
		? t('vision.proxy.error.unsupportedAnthropicResponse')
		: t('vision.proxy.error.unsupportedOpenAIResponse');
}

function isAbortError(error: unknown): boolean {
	return error instanceof Error && error.name === 'AbortError';
}
