import { DEEPSEEK_TOOLS_LIMIT } from './provider/tools/consts';
import type { ModelDefinition } from './types';

/**
 * Compile-time constants shared across the extension.
 *
 * These do NOT depend on the VS Code runtime (no workspace configuration,
 * no secrets API). For run-time settings reads see `config.ts`.
 */

/** VS Code configuration section prefix for all extension settings. */
export const CONFIG_SECTION = 'dnova-copilot';

export const EXTERNAL_URLS = {
	dnova: {
		apiKeys: '',
		usage: '',
		status: '',
	},
} as const;

/** URI path handled by this extension to reveal the output log. */
export const SHOW_LOGS_URI_PATH = '/showLogs';

/** URI path handled by this extension to open API key configuration. */
export const CONFIGURE_API_KEY_URI_PATH = '/setApiKey';

// VS Code's internal LanguageModelChatMessageRole.System is not exposed in @types/vscode.
export const LANGUAGE_MODEL_CHAT_SYSTEM_ROLE = 3;

// ---- Secret keys ----

/** SecretStorage key for the DNova API key. */
export const API_KEY_SECRET = 'dnova-copilot.apiKey';

/** memento key tracking whether the welcome walkthrough has been shown. */
export const WELCOME_SHOWN_KEY = 'dnova-copilot.welcomeShown';

// ---- Walkthrough ----

/** Walkthrough contribution ID. */
export const WALKTHROUGH_ID = 'luke.dnova-for-copilot#dnovaGettingStarted';

// ---- Model registry ----

/** Available DNova models exposed through the language model provider. */
export const MODELS: ModelDefinition[] = [
	{
		id: 'GLM-5.2',
		name: 'GLM-5.2',
		family: 'dnova',
		version: '5.2',
		detail: 'DNova GLM-5.2 model',
		maxInputTokens: 131072,
		maxOutputTokens: 16384,
		capabilities: {
			toolCalling: DEEPSEEK_TOOLS_LIMIT,
			imageInput: false,
			thinking: false,
		},
		requiresThinkingParam: false,
	},
];
