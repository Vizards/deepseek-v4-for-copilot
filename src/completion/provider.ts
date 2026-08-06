import vscode from 'vscode';
import { AuthManager } from '../auth';
import { DeepSeekClient } from '../client/core';
import { formatRequestError } from '../client/error';
import {
	getBaseUrl,
	getCompletionDebounceDelay,
	getCompletionEnabled,
	getCompletionMaxTokens,
	getCompletionModelId,
} from '../config';
import { logger } from '../logger';

/** Characters of document text sent before the cursor (FIM `prompt`). */
const MAX_PREFIX_CHARS = 8000;
/** Characters of document text sent after the cursor (FIM `suffix`). */
const MAX_SUFFIX_CHARS = 2000;

interface CompletionCacheEntry {
	uri: string;
	version: number;
	prefix: string;
	suffix: string;
	completion: string;
}

/**
 * Inline code completion powered by DeepSeek FIM (Fill-In-the-Middle).
 * https://api-docs.deepseek.com/guides/fim_completion
 *
 * Failures are logged but never surfaced as popups — completion fires on
 * every typing pause, so error UI would be disruptive.
 */
export class DeepSeekInlineCompletionProvider implements vscode.InlineCompletionItemProvider {
	private readonly authManager: AuthManager;
	private lastCompletion: CompletionCacheEntry | undefined;

	constructor(context: vscode.ExtensionContext) {
		this.authManager = new AuthManager(context);
	}

	async provideInlineCompletionItems(
		document: vscode.TextDocument,
		position: vscode.Position,
		_context: vscode.InlineCompletionContext,
		token: vscode.CancellationToken,
	): Promise<vscode.InlineCompletionItem[] | undefined> {
		if (!getCompletionEnabled() || token.isCancellationRequested) {
			return undefined;
		}

		const { prefix, suffix } = getFimContext(document, position);
		if (!prefix.trim() && !suffix.trim()) {
			return undefined;
		}

		// Reuse the previous completion while the user types into it —
		// avoids an API call for every accepted character.
		const cached = this.matchCachedCompletion(document, prefix, suffix);
		if (cached !== undefined) {
			return cached ? [toItem(cached, position)] : undefined;
		}

		if (!(await waitForDebounce(getCompletionDebounceDelay(), token))) {
			return undefined;
		}

		const apiKey = await this.authManager.getApiKey();
		if (!apiKey) {
			logger.warn('Inline completion skipped: DeepSeek API key not configured');
			return undefined;
		}

		try {
			const client = new DeepSeekClient(getBaseUrl(), apiKey);
			const text = await client.fimCompletion(
				{
					model: getCompletionModelId(),
					prompt: prefix,
					suffix,
					max_tokens: getCompletionMaxTokens(),
				},
				token,
			);

			const completion = normalizeCompletion(text);
			if (!completion || token.isCancellationRequested) {
				return undefined;
			}

			this.lastCompletion = {
				uri: document.uri.toString(),
				version: document.version,
				prefix,
				suffix,
				completion,
			};
			return [toItem(completion, position)];
		} catch (error) {
			logger.warn(
				'Inline completion request failed:',
				formatRequestError(error instanceof Error ? error : new Error(String(error))),
			);
			return undefined;
		}
	}

	/**
	 * Return the remaining completion when the current request continues the
	 * previous one (same document, prefix extended into the cached completion).
	 * Returns an empty string when the cached completion was fully consumed,
	 * and `undefined` when the cache does not apply.
	 */
	private matchCachedCompletion(
		document: vscode.TextDocument,
		prefix: string,
		suffix: string,
	): string | undefined {
		const last = this.lastCompletion;
		if (!last || last.uri !== document.uri.toString() || !prefix.startsWith(last.prefix)) {
			return undefined;
		}

		const typed = prefix.slice(last.prefix.length);
		if (!last.completion.startsWith(typed)) {
			return undefined;
		}

		const remaining = last.completion.slice(typed.length);
		// Suffix may have shifted as accepted text moved before the cursor;
		// only trust the cache when the suffix still lines up.
		if (!remaining && suffix !== last.suffix) {
			return undefined;
		}
		return normalizeCompletion(remaining) ?? '';
	}
}

function getFimContext(
	document: vscode.TextDocument,
	position: vscode.Position,
): { prefix: string; suffix: string } {
	const documentEnd = document.lineAt(document.lineCount - 1).range.end;
	const fullText = document.getText(new vscode.Range(new vscode.Position(0, 0), documentEnd));
	const offset = document.offsetAt(position);

	let prefix = fullText.slice(0, offset);
	if (prefix.length > MAX_PREFIX_CHARS) {
		prefix = prefix.slice(-MAX_PREFIX_CHARS);
	}

	let suffix = fullText.slice(offset);
	if (suffix.length > MAX_SUFFIX_CHARS) {
		suffix = suffix.slice(0, MAX_SUFFIX_CHARS);
	}

	return { prefix, suffix };
}

/** Drop empty/whitespace-only results and trailing blank lines from the model. */
function normalizeCompletion(text: string | undefined): string | undefined {
	if (!text) {
		return undefined;
	}
	const trimmedEnd = text.replace(/[\s\n]+$/u, '');
	return trimmedEnd.trim().length > 0 ? trimmedEnd : undefined;
}

function toItem(insertText: string, position: vscode.Position): vscode.InlineCompletionItem {
	return new vscode.InlineCompletionItem(insertText, new vscode.Range(position, position));
}

/** Resolve `true` after `delayMs`, or `false` immediately when cancelled. */
function waitForDebounce(delayMs: number, token: vscode.CancellationToken): Promise<boolean> {
	return new Promise((resolve) => {
		const timer = setTimeout(() => {
			listener.dispose();
			resolve(true);
		}, delayMs);
		const listener = token.onCancellationRequested(() => {
			clearTimeout(timer);
			listener.dispose();
			resolve(false);
		});
	});
}
