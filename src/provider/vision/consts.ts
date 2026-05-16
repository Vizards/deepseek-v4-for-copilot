/** Default model ID used for the vision proxy when auto-detection is enabled. */
export const DEFAULT_VISION_MODEL_ID = 'oswe-vscode-prime';

/**
 * Prompt sent to the vision proxy model when describing image attachments
 * before forwarding them to text-only DeepSeek models.
 *
 * Keep in sync with `deepseek-copilot.visionPrompt.default` in package.json.
 */
export const IMAGE_DESCRIPTION_PROMPT =
	'Describe all image attachments in this message.\n\n' +
	'If there is one image, describe it directly.\n' +
	'If there are multiple images:\n' +
	'1. Describe each image separately, preserving their order.\n' +
	'2. Then provide a combined description explaining the overall context and relationships across the images.\n\n' +
	'Return one concise factual description suitable for inserting into a text-only chat prompt. Include visible text, objects, UI elements, people, and relevant context. Do not invent details.';

/**
 * Stable fallback marker inserted into the chat prompt when the vision proxy
 * fails to describe an image. Keep this in English and out of i18n so prompt
 * shape and marker replay text do not vary by VS Code display language.
 */
export const IMAGE_DESCRIPTION_UNAVAILABLE = '[Image Description unavailable]';

/**
 * Wrapper applied to vision model descriptions before they are inserted into
 * the chat prompt. The full format is: `[Image Description: <description>]`.
 * Keep these in English and out of i18n so prompt shape and token estimates
 * stay stable regardless of VS Code display language.
 */
export const IMAGE_DESCRIPTION_PREFIX = '[Image Description: ';
export const IMAGE_DESCRIPTION_SUFFIX = ']';
