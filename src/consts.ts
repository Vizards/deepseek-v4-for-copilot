import type { ModelDefinition } from './types';

/**
 * Compile-time constants shared across the extension.
 *
 * These do NOT depend on the VS Code runtime (no workspace configuration,
 * no secrets API). For run-time settings reads see `config.ts`.
 */

/** VS Code configuration section prefix for all extension settings. */
export const CONFIG_SECTION = 'deepseek-copilot';

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

// ---- Vision proxy ----

/** Default model ID used for the vision proxy when auto-detection is enabled. */
export const DEFAULT_VISION_MODEL_ID = 'oswe-vscode-prime';

/**
 * Prompt sent to the vision proxy model when describing image attachments
 * before forwarding them to text-only DeepSeek models.
 */
export const IMAGE_DESCRIPTION_PROMPT =
	'Describe the visual contents of this image in detail, including any text, objects, people, or context that would be relevant for understanding it. Focus on factual visual elements.';

/**
 * Stable fallback marker inserted into the chat prompt when the vision proxy
 * fails to describe an image. Keep this in English and out of i18n so prompt
 * shape and cache behaviour do not vary by VS Code display language.
 */
export const IMAGE_DESCRIPTION_UNAVAILABLE = '[Image Description unavailable]';

/**
 * Wrapper applied to vision model descriptions before they are inserted into
 * the chat prompt. The full format is: `[Image Description: <description>]`.
 * Keep these in English and out of i18n so cache keys and token estimates
 * stay stable regardless of VS Code display language.
 */
export const IMAGE_DESCRIPTION_PREFIX = '[Image Description: ';
export const IMAGE_DESCRIPTION_SUFFIX = ']';

// ---- Cache ----

/** Max entries in the reasoning-content cache before eviction kicks in. */
export const MAX_CACHE_SIZE = 200;

// ---- Model registry ----

/**
 * Context window sizing: total = 1000K, output = 384K, input = remainder.
 * MODIFY these constants to recalculate maxInputTokens / maxOutputTokens.
 */

const K_UNIT = 1024;
const CONTEXT_SIZE_K = 1000;
const CONTEXT_MAX_OUT_TOKEN_K = 384;
const CONTEXT_MAX_IN_TOKEN_K = CONTEXT_SIZE_K - CONTEXT_MAX_OUT_TOKEN_K;

// export const MODEL_CONTEXT_SIZE = CONTEXT_SIZE_K * K_UNIT;
export const MODEL_MAX_INPUT_TOKEN = CONTEXT_MAX_IN_TOKEN_K * K_UNIT;
export const MODEL_MAX_OUTPUT_TOKEN = CONTEXT_MAX_OUT_TOKEN_K * K_UNIT;

/** Available DeepSeek models exposed through the language model provider. */
export const MODELS: ModelDefinition[] = [
	{
		id: 'deepseek-v4-flash',
		name: 'DeepSeek V4 Flash',
		family: 'deepseek',
		version: 'v4',
		detail: 'Fast, general-purpose model',
		maxInputTokens: MODEL_MAX_INPUT_TOKEN,
		maxOutputTokens: MODEL_MAX_OUTPUT_TOKEN,
		capabilities: {
			toolCalling: true,
			imageInput: true,
			thinking: true,
		},
		requiresThinkingParam: true,
	},
	{
		id: 'deepseek-v4-pro',
		name: 'DeepSeek V4 Pro',
		family: 'deepseek',
		version: 'v4',
		detail: 'Most capable reasoning model',
		maxInputTokens: MODEL_MAX_INPUT_TOKEN,
		maxOutputTokens: MODEL_MAX_OUTPUT_TOKEN,
		capabilities: {
			toolCalling: true,
			imageInput: true,
			thinking: true,
		},
		requiresThinkingParam: true,
	},
];
