import { DEEPSEEK_TOOLS_LIMIT } from './provider/tools/consts';
import type { ModelDefinition } from './types';

/**
 * Compile-time constants shared across the extension.
 *
 * These do NOT depend on the VS Code runtime (no workspace configuration,
 * no secrets API). For run-time settings reads see `config.ts`.
 */

/** VS Code configuration section prefix for all extension settings. */
export const CONFIG_SECTION = 'deepseek-copilot';

export const EXTERNAL_URLS = {
	deepseek: {
		apiKeys: 'https://platform.deepseek.com/api_keys',
		usage: 'https://platform.deepseek.com/usage',
		status: 'https://status.deepseek.com',
	},
} as const;

/** URI path handled by this extension to reveal the output log. */
export const SHOW_LOGS_URI_PATH = '/showLogs';

/** URI path handled by this extension to open API key configuration. */
export const CONFIGURE_API_KEY_URI_PATH = '/setApiKey';

/** URI path handled by this extension to open vision model configuration. */
export const SET_VISION_MODEL_URI_PATH = '/setVisionModel';

// VS Code's internal LanguageModelChatMessageRole.System is not exposed in @types/vscode.
export const LANGUAGE_MODEL_CHAT_SYSTEM_ROLE = 3;

// ---- Secret keys ----

/** SecretStorage key for the DeepSeek API key. */
export const API_KEY_SECRET = 'deepseek-copilot.apiKey';

/** memento key tracking whether the welcome walkthrough has been shown. */
export const WELCOME_SHOWN_KEY = 'deepseek-copilot.welcomeShown';

// ---- Walkthrough ----

/** Walkthrough contribution ID. */
export const WALKTHROUGH_ID = 'Vizards.deepseek-v4-for-copilot#deepseekGettingStarted';

// ---- Model registry ----

/** Available DeepSeek models exposed through the language model provider. */
export const MODELS: ModelDefinition[] = [
	{
		id: 'deepseek-v4-flash',
		name: 'DeepSeek V4 Flash',
		family: 'deepseek',
		version: 'v4',
		detail: 'Fast, general-purpose model',
		maxInputTokens: 655360,
		maxOutputTokens: 393216,
		capabilities: {
			toolCalling: DEEPSEEK_TOOLS_LIMIT,
			imageInput: true,
			thinking: true,
		},
		requiresThinkingParam: true,
		pricing: {
			USD: { cacheHitInput: 0.0028, cacheMissInput: 0.14, output: 0.28 },
			CNY: { cacheHitInput: 0.02, cacheMissInput: 1, output: 2 },
		},
		priceCategory: 'low',
	},
	{
		id: 'deepseek-v4-pro',
		name: 'DeepSeek V4 Pro',
		family: 'deepseek',
		version: 'v4',
		detail: 'Most capable reasoning model',
		maxInputTokens: 655360,
		maxOutputTokens: 393216,
		capabilities: {
			toolCalling: DEEPSEEK_TOOLS_LIMIT,
			imageInput: true,
			thinking: true,
		},
		requiresThinkingParam: true,
		pricing: {
			USD: { cacheHitInput: 0.003625, cacheMissInput: 0.435, output: 0.87 },
			CNY: { cacheHitInput: 0.025, cacheMissInput: 3, output: 6 },
		},
		priceCategory: 'low',
	},
];
