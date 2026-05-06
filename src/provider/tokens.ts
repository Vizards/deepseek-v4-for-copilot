import vscode from 'vscode';
import { computeDataHash, getCachedDescriptionByDataHash } from './vision/cache';

/**
 * Recursively estimate the character count for a single content part.
 * Returns character count, which the caller divides by charsPerToken to get token estimate.
 */
function estimatePartChars(part: unknown): number {
	// 1. LanguageModelTextPart — the most common case
	if (part instanceof vscode.LanguageModelTextPart) {
		return part.value.length;
	}

	// 2. LanguageModelToolCallPart — count callId + name + JSON-serialized input
	if (part instanceof vscode.LanguageModelToolCallPart) {
		let chars = part.callId.length + part.name.length;
		try {
			chars += JSON.stringify(part.input).length;
		} catch {
			// If input can't be stringified (e.g. contains circular refs), fall back to a rough estimate
			chars += 2;
		}
		return chars;
	}

	// 3. LanguageModelToolResultPart — recursively count nested content parts
	if (part instanceof vscode.LanguageModelToolResultPart) {
		let chars = part.callId.length;
		if (Array.isArray(part.content)) {
			for (const item of part.content) {
				chars += estimatePartChars(item);
			}
		}
		return chars;
	}

	// 4. LanguageModelDataPart — use a capped heuristic because our model never
	//    receives binary data directly. Images are resolved to text descriptions
	//    by the vision pipeline; raw byteLength would massively overestimate.
	if (part instanceof vscode.LanguageModelDataPart) {
		const mime = part.mimeType;
		// Images: try the vision description cache first. If this image was
		// already resolved, the cached description length is the most accurate
		// estimate of what the model will actually receive.
		if (mime.startsWith('image/')) {
			// Skip SHA-256 for very large images — the hash cost outweighs the
			// benefit of a cache lookup, and such images are unlikely to be
			// processed by the vision pipeline anyway.
			if (part.data.byteLength <= 500_000) {
				const cached = getCachedDescriptionByDataHash(computeDataHash(part.data));
				if (cached !== undefined) {
					return cached.length;
				}
			}
			// Cold cache (or image too large to hash): use a conservative
			// fixed estimate (~255 tokens at 4 chars/tok, roughly matching
			// OpenAI auto-detail for a moderate image).
			// The vision pipeline will replace these with text descriptions
			// whose actual token cost is counted via LanguageModelTextPart
			// on the next pass.
			return 1020;
		}
		// PDFs and other documents: use byteLength as a rough proxy but cap it
		// to prevent a single large attachment from dominating the budget.
		return Math.min(part.data?.byteLength ?? 0, 10000);
	}

	// 5. LanguageModelThinkingPart (proposed API) — handle string | string[]
	if (isLanguageModelThinkingPart(part)) {
		if (typeof part.value === 'string') {
			return part.value.length;
		}
		if (Array.isArray(part.value)) {
			let chars = 0;
			for (const s of part.value) {
				chars += s.length;
			}
			return chars;
		}
		return 0;
	}

	// 6. LanguageModelPromptTsxPart — stringify the value if present
	// Duck-type check since PromptTsxPart may not always be available
	if (
		part &&
		typeof part === 'object' &&
		'value' in part &&
		part.constructor?.name === 'LanguageModelPromptTsxPart'
	) {
		try {
			return JSON.stringify((part as { value: unknown }).value).length;
		} catch {
			return 0;
		}
	}

	// Fallback: try to stringify unknown part types
	if (part && typeof part === 'object') {
		try {
			return JSON.stringify(part).length;
		} catch {
			return 0;
		}
	}

	return 0;
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
	for (const part of text.content) {
		totalChars += estimatePartChars(part);
	}
	return Math.max(1, Math.ceil(totalChars / charsPerToken));
}
