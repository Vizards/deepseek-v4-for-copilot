import vscode from 'vscode';
import { t } from '../../../i18n';
import {
	VisionProxyConfigStore,
	normalizeVisionProxyConfig,
	normalizeVisionProxySource,
} from '../sources/endpoint/config';
import {
	formatVisionProxyDisplayMessage,
	getVisionProxyErrorDisplayCode,
	isVisionProxyError,
} from '../protocols/errors';
import { logVisionProxyTestFailed, showVisionLogs } from '../log';
import { testVisionProxyConnection, type VisionProxyTestResult } from '../sources/endpoint/test';
import type { VisionLanguageModelOption, VisionProxyConfig, VisionProxySource } from '../types';
import {
	getConfiguredVisionModelKey,
	listVSCodeVisionModelOptions,
	pickPreferredVSCodeVisionModelKey,
	saveVSCodeVisionModelKey,
} from '../sources/vscode';
import { getVisionProxyPanelHtml, type VisionProxyPanelState } from './html';

let currentPanel: vscode.WebviewPanel | undefined;

interface StatusAction {
	command: 'showLogs';
	label: string;
}

interface StatusMetadata {
	kind?: 'test';
	testId?: number;
	testResult?: {
		imageDataUrl: string;
		response: string;
	};
}

export function openVisionProxyPanel(
	context: vscode.ExtensionContext,
	options: { onDidChange: () => void },
): void {
	if (currentPanel) {
		currentPanel.reveal();
		return;
	}

	const store = new VisionProxyConfigStore(context);
	const panel = vscode.window.createWebviewPanel(
		'deepseekVisionProxy',
		t('vision.panel.title'),
		vscode.ViewColumn.Active,
		{
			enableScripts: true,
			retainContextWhenHidden: false,
		},
	);
	currentPanel = panel;

	panel.onDidDispose(() => {
		currentPanel = undefined;
	});

	panel.webview.onDidReceiveMessage((message: unknown) => {
		void handleMessage(panel, store, options, message);
	});

	void renderPanel(panel, store);
}

async function handleMessage(
	panel: vscode.WebviewPanel,
	store: VisionProxyConfigStore,
	options: { onDidChange: () => void },
	message: unknown,
): Promise<void> {
	if (!isWebviewMessage(message)) {
		return;
	}

	if (message.type === 'showLogs') {
		showVisionLogs();
		return;
	}

	if (message.type === 'logVisionProxyTestFailure') {
		const errorMessage = getClientErrorMessage(message.value);
		logVisionProxyTestFailed(new Error(errorMessage));
		return;
	}

	try {
		if (message.type === 'clearApiKey') {
			await store.deleteApiKey();
			options.onDidChange();
			await panel.webview.postMessage({
				type: 'apiKeyCleared',
				value: { message: t('vision.panel.status.apiKeyCleared') },
			});
			return;
		}

		if (message.type === 'saveConfig') {
			const payload = getWebviewPayload(message.value);
			if (payload.source === 'vscode-lm') {
				await saveVSCodeVisionModelKey(
					getRequiredString(payload.lmModelKey, t('vision.panel.source.vscodeLm')),
				);
				await store.saveSource('vscode-lm');
			} else {
				const config = normalizeVisionProxyConfig({
					...payload.config,
					updatedAt: Date.now(),
				});
				await store.saveConfig(config);
				await store.saveSource('api-endpoint');
				if (payload.apiKey) {
					await store.setApiKey(payload.apiKey);
				}
			}
			options.onDidChange();
			await postState(panel, store);
			postStatus(panel, createSavedMessage(payload));
			return;
		}

		if (message.type === 'testConnection') {
			const payload = getWebviewPayload(message.value);
			if (payload.source === 'vscode-lm') {
				postStatus(panel, t('vision.panel.status.vscodeLmNoHttpTest'), 'info', undefined, {
					kind: 'test',
					testId: payload.testId,
				});
				return;
			}
			const config = normalizeVisionProxyConfig(payload.config);
			const apiKey = payload.apiKey || (await store.getApiKey());
			const result = await testVisionProxyConnection(config, apiKey);
			if (result.ok) {
				postStatus(panel, t('vision.panel.status.testSucceeded'), 'success', undefined, {
					kind: 'test',
					testId: payload.testId,
					testResult: getVisionProxyTestResultView(result),
				});
			} else {
				postStatus(panel, getVisionProxyTestFailure(result), 'error', createShowLogsAction(), {
					kind: 'test',
					testId: payload.testId,
				});
			}
		}
	} catch (error) {
		const isTestError = message.type === 'testConnection';
		if (isTestError) {
			logVisionProxyTestFailed(error);
		}
		postStatus(
			panel,
			getErrorMessage(error),
			'error',
			isTestError ? createShowLogsAction() : undefined,
			isTestError ? { kind: 'test', testId: getWebviewTestId(message.value) } : undefined,
		);
	}
}

async function renderPanel(
	panel: vscode.WebviewPanel,
	store: VisionProxyConfigStore,
): Promise<void> {
	panel.webview.html = getVisionProxyPanelHtml(panel.webview, await getState(store));
}

async function postState(panel: vscode.WebviewPanel, store: VisionProxyConfigStore): Promise<void> {
	await panel.webview.postMessage({ type: 'state', value: await getState(store) });
}

async function getState(store: VisionProxyConfigStore): Promise<VisionProxyPanelState> {
	const lmModels = await listVSCodeVisionModelOptions();
	const config = getConfigForPanel(store);
	const selectedLmModelKey = pickPreferredVSCodeVisionModelKey(
		lmModels,
		getConfiguredVisionModelKey(),
	);

	return {
		source: getPanelSource(store, config, lmModels),
		config,
		hasApiKey: await store.hasApiKey(),
		lmModels,
		selectedLmModelKey,
	};
}

function getPanelSource(
	store: VisionProxyConfigStore,
	config: VisionProxyConfig | undefined,
	lmModels: readonly VisionLanguageModelOption[],
): VisionProxySource {
	if (lmModels.length === 0) {
		return 'api-endpoint';
	}
	const source = store.getSource();
	if (source) {
		return source;
	}
	return config ? 'api-endpoint' : 'vscode-lm';
}

function getConfigForPanel(store: VisionProxyConfigStore): VisionProxyConfig | undefined {
	try {
		return store.getConfig();
	} catch {
		return undefined;
	}
}

function postStatus(
	panel: vscode.WebviewPanel,
	message: string,
	tone: 'info' | 'success' | 'error' = 'info',
	action?: StatusAction,
	metadata?: StatusMetadata,
): void {
	void panel.webview.postMessage({
		type: 'status',
		value: {
			message,
			error: tone === 'error',
			success: tone === 'success',
			action,
			...metadata,
		},
	});
}

function getErrorMessage(error: unknown): string {
	if (isVisionProxyError(error)) {
		return formatVisionProxyDisplayMessage(getVisionProxyErrorDisplayCode(error), error.message);
	}
	return formatVisionProxyDisplayMessage(
		getVisionProxyErrorDisplayCode(error),
		error instanceof Error ? error.message : String(error),
	);
}

function createSavedMessage(payload: WebviewPayload): string {
	if (payload.source === 'vscode-lm') {
		return t('vision.panel.status.vscodeLmSaved');
	}
	return payload.apiKey
		? t('vision.panel.status.endpointSavedWithKey')
		: t('vision.panel.status.endpointSaved');
}

function getVisionProxyTestFailure(result: VisionProxyTestResult): string {
	return formatVisionProxyDisplayMessage(
		result.errorCode ?? 'UNKNOWN',
		result.message ?? t('vision.proxy.error.testFailed'),
	);
}

function getVisionProxyTestResultView(result: VisionProxyTestResult): StatusMetadata['testResult'] {
	return result.imageDataUrl && result.response
		? {
				imageDataUrl: result.imageDataUrl,
				response: result.response,
			}
		: undefined;
}

function createShowLogsAction(): StatusAction {
	return { command: 'showLogs', label: t('error.action.viewDetails') };
}

function getClientErrorMessage(value: unknown): string {
	const record = asRecord(value);
	const message = record.message;
	return typeof message === 'string' && message.length > 0
		? message
		: t('vision.proxy.error.testFailed');
}

function isWebviewMessage(value: unknown): value is { type: string; value?: unknown } {
	return (
		typeof value === 'object' &&
		value !== null &&
		'type' in value &&
		typeof (value as { type: unknown }).type === 'string'
	);
}

function asRecord(value: unknown): Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

type WebviewPayload = {
	source: VisionProxySource;
	config: Record<string, unknown>;
	apiKey: string | undefined;
	lmModelKey: string | undefined;
	testId: number | undefined;
};

function getWebviewPayload(value: unknown): WebviewPayload {
	const payload = asRecord(value);
	const config = asRecord(payload.config);
	const apiKey = typeof payload.apiKey === 'string' ? payload.apiKey.trim() : '';
	const source = normalizeVisionProxySource(payload.source) ?? 'api-endpoint';
	const lmModelKey = typeof payload.lmModelKey === 'string' ? payload.lmModelKey.trim() : '';
	return {
		source,
		config,
		apiKey: apiKey || undefined,
		lmModelKey: lmModelKey || undefined,
		testId: toPositiveInteger(payload.testId),
	};
}

function getWebviewTestId(value: unknown): number | undefined {
	return toPositiveInteger(asRecord(value).testId);
}

function toPositiveInteger(value: unknown): number | undefined {
	return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
}

function getRequiredString(value: string | undefined, label: string): string {
	if (!value) {
		throw new Error(t('vision.panel.error.required', label));
	}
	return value;
}
