import { MAX_CACHE_SIZE } from '../consts';

/**
 * Reasoning cache: persists across turns so multi-turn tool-call conversations
 * can inject reasoning_content back into prior assistant messages.
 *
 * Key strategy (per DeepSeek docs):
 *  - Non-tool-call turns: reasoning_content does NOT need to be passed back.
 *  - Tool-call turns: reasoning_content MUST be in ALL subsequent requests.
 *
 * We cache by tool_call IDs so we can look up which reasoning goes with which
 * tool-call-bearing assistant message when reconstructing the message history.
 */
export interface ReasoningEntry {
	text: string;
	timestamp: number;
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
