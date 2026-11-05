import { getNativeVisionRouting } from '../config';
import { isOfficialDeepSeekBaseUrl } from '../endpoint';
import type { ModelDefinition } from '../types';
import { LEGACY_FLASH_MODEL_IDS } from './retirement';

export type NativeImageInputReason =
	| 'declared-native'
	| 'declared-proxy'
	| 'routing-official-alias'
	| 'routing-forced';

export interface NativeImageInputResolution {
	nativeImageInput: boolean;
	reason: NativeImageInputReason;
}

export interface NativeImageInputContext {
	baseUrl: string;
	/** The model ID actually sent is the catalog ID (no `modelIdOverrides` remap). */
	usesOfficialModelId: boolean;
}

/**
 * Decide whether images reach the model as image parts or through the Vision Proxy.
 *
 * The catalog describes the retired Flash aliases as text-only, but the official API
 * keeps accepting them and serves DeepSeek-V4.1-Flash, which accepts images. Forcing
 * the text route there costs an extra model call per image on every turn and turns a
 * stable image into freshly generated text, which breaks DeepSeek's prompt-cache
 * prefix for the rest of the conversation.
 *
 * `nativeVisionRouting` resolves the conflict:
 * - `auto` (default): follow the documented redirect on the official endpoint only.
 * - `always`: trust the redirect on any endpoint (e.g. an official-compatible relay).
 * - `never`: keep the declared capability (current behaviour).
 *
 * Models that declare native image input keep it, and catalog entries that are not
 * redirect aliases (V4 Pro) are never affected.
 */
export function resolveNativeImageInput(
	model: ModelDefinition | undefined,
	context: NativeImageInputContext,
): NativeImageInputResolution {
	if (!model || model.capabilities.imageInput !== true) {
		return { nativeImageInput: false, reason: 'declared-proxy' };
	}

	const declaredNative = model.capabilities.nativeImageInput === true;
	if (declaredNative) {
		return { nativeImageInput: true, reason: 'declared-native' };
	}

	const routing = getNativeVisionRouting();
	if (routing === 'never' || !LEGACY_FLASH_MODEL_IDS.has(model.id)) {
		return { nativeImageInput: false, reason: 'declared-proxy' };
	}
	if (routing === 'always') {
		return { nativeImageInput: true, reason: 'routing-forced' };
	}
	if (context.usesOfficialModelId && isOfficialDeepSeekBaseUrl(context.baseUrl)) {
		return { nativeImageInput: true, reason: 'routing-official-alias' };
	}
	return { nativeImageInput: false, reason: 'declared-proxy' };
}
