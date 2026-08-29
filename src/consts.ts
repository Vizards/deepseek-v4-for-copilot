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
			nativeImageInput: false,
			thinking: {
				supportedEfforts: ['low', 'high', 'max'],
				defaultEffort: 'high',
				canDisable: true,
			},
		},
		requiresThinkingParam: true,
		pricing: {
			USD: {
				offPeak: { cacheHitInput: 0.007, cacheMissInput: 0.22, output: 0.66 },
				peak: { cacheHitInput: 0.014, cacheMissInput: 0.44, output: 1.32 },
			},
			CNY: {
				offPeak: { cacheHitInput: 0.05, cacheMissInput: 1.5, output: 4.5 },
				peak: { cacheHitInput: 0.1, cacheMissInput: 3, output: 9 },
			},
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
			nativeImageInput: false,
			thinking: {
				supportedEfforts: ['low', 'high', 'max'],
				defaultEffort: 'high',
				canDisable: true,
			},
		},
		requiresThinkingParam: true,
		pricing: {
			USD: {
				offPeak: { cacheHitInput: 0.022, cacheMissInput: 0.66, output: 1.98 },
				peak: { cacheHitInput: 0.044, cacheMissInput: 1.32, output: 3.96 },
			},
			CNY: {
				offPeak: { cacheHitInput: 0.15, cacheMissInput: 4.5, output: 13.5 },
				peak: { cacheHitInput: 0.3, cacheMissInput: 9, output: 27 },
			},
		},
		priceCategory: 'low',
	},
	{
		id: 'deepseek-v4-flash-vision-exp',
		name: 'DeepSeek V4 Flash Vision Exp',
		family: 'deepseek',
		version: 'v4',
		detail: 'Experimental native vision model',
		maxInputTokens: 655360,
		maxOutputTokens: 393216,
		capabilities: {
			toolCalling: DEEPSEEK_TOOLS_LIMIT,
			imageInput: true,
			nativeImageInput: true,
			visionNative: true,
			thinking: {
				supportedEfforts: ['low', 'high', 'max'],
				defaultEffort: 'high',
				canDisable: true,
			},
		},
		requiresThinkingParam: true,
		pricing: {
			USD: {
				offPeak: { cacheHitInput: 0.007, cacheMissInput: 0.22, output: 0.66 },
				peak: { cacheHitInput: 0.014, cacheMissInput: 0.44, output: 1.32 },
			},
			CNY: {
				offPeak: { cacheHitInput: 0.05, cacheMissInput: 1.5, output: 4.5 },
				peak: { cacheHitInput: 0.1, cacheMissInput: 3, output: 9 },
			},
		},
		priceCategory: 'low',
	},
];
