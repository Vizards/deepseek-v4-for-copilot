import vscode from 'vscode';
import { REPLAY_MARKER_MIME } from './replay';

const IMAGE_PART_FIXED_TOKENS = 384;

interface PartTokenEstimate {
	textChars: number;
	fixedTokens: number;
}

/**
 * Sizing runs on every token count the host asks for, but a tool input only has to be
 * serialized once. Keys are the part objects themselves, so entries go away with the
 * transcript that holds them.
 *
 * This holds only while parts are read and never mutated after creation. Conversion
 * and this module both treat them as immutable; a part edited in place would keep the
 * estimate from its first sighting.
 */
const partTokenEstimateCache = new WeakMap<object, PartTokenEstimate>();

/**
 * Estimate a top level message part, the form the converter forwards or drops.
 */
function estimateMessagePartTokens(part: unknown): PartTokenEstimate {
	if (isDroppedTopLevelDataPart(part)) {
		return { textChars: 0, fixedTokens: 0 };
	}
	return estimatePartTokens(part);
}

/**
 * A data part that is neither the replay marker nor an image is dropped by the message
 * converter, so the request carries nothing for it and it must not be charged. Nested
 * data parts are left alone because a tool result can still be serialized into the
 * request, which means its bytes are not free.
 */
function isDroppedTopLevelDataPart(part: unknown): boolean {
	// A mime type that is missing or not a string cannot be an image, so the converter drops
	// that part too and it must not be charged.
	return (
		part instanceof vscode.LanguageModelDataPart &&
		part.mimeType !== REPLAY_MARKER_MIME &&
		!(typeof part.mimeType === 'string' && part.mimeType.toLowerCase().startsWith('image/'))
	);
}

/**
 * Recursively estimate text chars and fixed token parts for a single content part.
 */
function estimatePartTokens(part: unknown): PartTokenEstimate {
	if (!part || typeof part !== 'object') {
		return { textChars: 0, fixedTokens: 0 };
	}

	const cached = partTokenEstimateCache.get(part);
	if (cached) {
		return cached;
	}

	const estimate = computePartTokenEstimate(part);
	partTokenEstimateCache.set(part, estimate);
	return estimate;
}

function computePartTokenEstimate(part: object): PartTokenEstimate {
	// 1. LanguageModelTextPart - the most common case
	if (part instanceof vscode.LanguageModelTextPart) {
		return { textChars: part.value.length, fixedTokens: 0 };
	}

	// 2. LanguageModelToolCallPart - count callId + name + JSON-serialized input
	if (part instanceof vscode.LanguageModelToolCallPart) {
		let chars = part.callId.length + part.name.length;
		try {
			chars += JSON.stringify(part.input).length;
		} catch {
			// If input can't be stringified (e.g. contains circular refs), fall back to a rough estimate
			chars += 2;
		}
		return { textChars: chars, fixedTokens: 0 };
	}

	// 3. LanguageModelToolResultPart - recursively count nested content parts
	if (part instanceof vscode.LanguageModelToolResultPart) {
		let textChars = part.callId.length;
		let fixedTokens = 0;
		if (Array.isArray(part.content)) {
			for (const item of part.content) {
				const nested = estimatePartTokens(item);
				textChars += nested.textChars;
				fixedTokens += nested.fixedTokens;
			}
		}
		return { textChars, fixedTokens };
	}

	// 4. LanguageModelDataPart - a top level part reaches here unless the converter drops it, so the
	//    marker and image branches below serve both top level parts and nested ones.
	if (part instanceof vscode.LanguageModelDataPart) {
		// The part arrives untyped, so a missing mime type falls through to the capped
		// estimate instead of throwing while counting.
		const mime = typeof part.mimeType === 'string' ? part.mimeType.toLowerCase() : '';
		if (mime === REPLAY_MARKER_MIME) {
			// Marker metadata is not sent as assistant content. Its vision text belongs
			// logically to a previous user image message, but provideTokenCount only
			// receives one message at a time and cannot safely bind history here.
			return { textChars: 0, fixedTokens: 0 };
		}

		// Keep image estimation conservative and independent from charsPerToken
		// so native-image requests do not distort adaptive text calibration.
		if (mime.startsWith('image/')) {
			return { textChars: 0, fixedTokens: IMAGE_PART_FIXED_TOKENS };
		}
		// Documents: a tool result can be serialized into the request, so keep the capped
		// byteLength proxy instead of assuming the bytes cost nothing.
		return {
			textChars: Math.min(part.data?.byteLength ?? 0, 10000),
			fixedTokens: 0,
		};
	}

	// 5. LanguageModelThinkingPart (proposed API) - handle string | string[]
	if (isLanguageModelThinkingPart(part)) {
		if (typeof part.value === 'string') {
			return { textChars: part.value.length, fixedTokens: 0 };
		}
		if (Array.isArray(part.value)) {
			let textChars = 0;
			for (const s of part.value) {
				textChars += s.length;
			}
			return { textChars, fixedTokens: 0 };
		}
		return { textChars: 0, fixedTokens: 0 };
	}

	// 6. LanguageModelPromptTsxPart - stringify the value if present
	// Duck-type check since PromptTsxPart may not always be available
	if ('value' in part && part.constructor?.name === 'LanguageModelPromptTsxPart') {
		try {
			return {
				textChars: JSON.stringify((part as { value: unknown }).value).length,
				fixedTokens: 0,
			};
		} catch {
			return { textChars: 0, fixedTokens: 0 };
		}
	}

	// Fallback: try to stringify unknown part types
	try {
		return { textChars: JSON.stringify(part).length, fixedTokens: 0 };
	} catch {
		return { textChars: 0, fixedTokens: 0 };
	}
}

/**
 * Check for LanguageModelThinkingPart (proposed API, may not be available at runtime).
 */
function isLanguageModelThinkingPart(part: unknown): part is vscode.LanguageModelThinkingPart {
	return (
		typeof (vscode as Record<string, unknown>).LanguageModelThinkingPart === 'function' &&
		part instanceof vscode.LanguageModelThinkingPart
	);
}

export function estimateTokenCount(
	text: string | vscode.LanguageModelChatRequestMessage,
	charsPerToken: number,
): number {
	if (typeof text === 'string') {
		return Math.max(1, Math.ceil(text.length / charsPerToken));
	}

	if (!text?.content || !Array.isArray(text.content)) {
		return 1;
	}

	let totalChars = 0;
	let fixedTokens = 0;
	for (const part of text.content) {
		const estimate = estimateMessagePartTokens(part);
		totalChars += estimate.textChars;
		fixedTokens += estimate.fixedTokens;
	}

	const textTokens = totalChars > 0 ? Math.ceil(totalChars / charsPerToken) : 0;
	return Math.max(1, textTokens + fixedTokens);
}
