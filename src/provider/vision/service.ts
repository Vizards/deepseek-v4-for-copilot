import vscode from 'vscode';
import { t } from '../../i18n';
import { logInvalidVisionProxyApiEndpointConfig, logVisionApiEndpointSelected } from './log';
import { VISION_PROXY_API_KEY_SECRET, VisionProxyConfigStore } from './sources/endpoint/config';
import { createEndpointVisionDescriber } from './sources/endpoint';
import { openVisionProxyPanel } from './ui/panel';
import type { VisionDescriber, VisionProxyConfig } from './types';
import { isVisionProxyError, VisionProxyError } from './protocols/errors';
import { createVSCodeLanguageModelVisionDescriberGetter } from './sources/vscode';

interface ApiEndpointConfigResult {
	config?: VisionProxyConfig;
	error?: unknown;
}

export function createVisionService(context: vscode.ExtensionContext): {
	get: () => Promise<VisionDescriber | undefined>;
	reset: () => void;
	openConfiguration: () => Promise<void>;
} {
	const store = new VisionProxyConfigStore(context);
	const vscodeLm = createVSCodeLanguageModelVisionDescriberGetter();

	const reset = (): void => {
		vscodeLm.reset();
	};

	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration((event) => {
			if (event.affectsConfiguration('deepseek-copilot.visionModel')) {
				reset();
			}
		}),
		context.secrets.onDidChange((event) => {
			if (event.key === VISION_PROXY_API_KEY_SECRET) {
				reset();
			}
		}),
	);

	return {
		async get() {
			const source = store.getSource();
			if (source === 'vscode-lm') {
				return vscodeLm.get();
			}

			if (source === 'api-endpoint') {
				const result = getApiEndpointConfig(store, true);
				if (!result.config) {
					if (!result.error) {
						return undefined;
					}
					return createInvalidApiEndpointDescriber(result.error);
				}
				const apiKey = await store.getApiKey();
				const describer = createEndpointVisionDescriber(result.config, apiKey);
				logVisionApiEndpointSelected(describer.id);
				return describer;
			}

			const result = getApiEndpointConfig(store, false);
			if (result.config) {
				const apiKey = await store.getApiKey();
				const describer = createEndpointVisionDescriber(result.config, apiKey);
				logVisionApiEndpointSelected(describer.id);
				return describer;
			}
			return vscodeLm.get();
		},

		reset,

		async openConfiguration() {
			openVisionProxyPanel(context, { onDidChange: reset });
		},
	};
}

function getApiEndpointConfig(
	store: VisionProxyConfigStore,
	explicitApiEndpointSource: boolean,
): ApiEndpointConfigResult {
	try {
		return { config: store.getConfig() };
	} catch (error) {
		logInvalidVisionProxyApiEndpointConfig(store.getSource(), explicitApiEndpointSource, error);
		return { error };
	}
}

function createInvalidApiEndpointDescriber(error: unknown): VisionDescriber {
	return {
		id: 'api-endpoint:invalid-configuration',
		source: 'api-endpoint',
		async describe(): Promise<string> {
			if (isVisionProxyError(error)) {
				throw error;
			}
			throw new VisionProxyError(
				'missing-configuration',
				t('vision.proxy.error.configurationInvalid'),
				undefined,
				error,
			);
		},
	};
}
