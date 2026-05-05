import { MAX_CACHE_SIZE } from '../consts';

/**
 * Reasoning cache: persists across turns so multi-turn tool-call conversations
 * can inject reasoning_content back into prior assistant messages.
 *
 * Key strategy (per DeepSeek docs):
 *  - Plain non-tool turns: reasoning_content does NOT need to be passed back.
 *  - Tool-call turns and their post-tool final turns: reasoning_content MUST be
 *    in ALL subsequent requests.
 *
 * We cache by stable history keys so we can look up which reasoning goes with
 * tool-call-bearing assistant messages and final post-tool assistant messages
 * when reconstructing the message history.
 */
export interface ReasoningEntry {
	text: string;
	timestamp: number;
}

export function createToolReasoningKey(toolCallId: string): string {
	return `tool:${toolCallId}`;
}

export function createPostToolReasoningKey(toolCallIds: readonly string[]): string {
	return `post-tool:${JSON.stringify(toolCallIds)}`;
}

export function pruneReasoningCache(cache: Map<string, ReasoningEntry>, clearAll: boolean): void {
	if (clearAll) {
		cache.clear();
		return;
	}

	if (cache.size <= MAX_CACHE_SIZE) {
		return;
	}

	// Evict oldest entries
	const sorted = [...cache.entries()].sort((a, b) => a[1].timestamp - b[1].timestamp);
	const toRemove = sorted.slice(0, sorted.length - MAX_CACHE_SIZE);
	for (const [key] of toRemove) {
		cache.delete(key);
	}
}
