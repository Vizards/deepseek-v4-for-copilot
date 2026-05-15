import vscode from 'vscode';
import { REASONING_CACHE_DIR_NAME, REASONING_CACHE_TTL_MS } from '../consts';
import { logger } from '../logger';

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
interface ReasoningEntry {
	text: string;
	updatedAt: number;
}

type PersistentReasoningSnapshot = Array<[reasoningKey: string, text: string, updatedAt: number]>;

interface SegmentCacheState {
	segmentId: string;
	cacheUri: vscode.Uri;
	cache: Map<string, ReasoningEntry>;
	readyPromise: Promise<void>;
	saveTimer: NodeJS.Timeout | undefined;
	saveInFlight: Promise<void> | undefined;
	dirty: boolean;
	lastAccessedAt: number;
}

interface ReasoningCacheCleanupResult {
	scanned: number;
	deleted: number;
	errors: number;
}

type ReasoningCacheCleanupTrigger = 'startup' | 'record';

export interface ReasoningLookup {
	getToolCallReasoning(toolCallId: string): string | undefined;
	getPostToolReasoning(toolCallIds: readonly string[]): string | undefined;
}

export interface ReasoningRecorder {
	readonly size: number;
	recordToolCallReasoning(toolCallIds: readonly string[], text: string): void;
	recordPostToolReasoning(toolCallIds: readonly string[], text: string): void;
	prune(now?: number): ReasoningCachePruneResult;
}

export type SegmentReasoningCache = ReasoningLookup & ReasoningRecorder;

export interface ReasoningCachePruneResult {
	removed: number;
	expired: number;
}

const REASONING_CACHE_SAVE_DEBOUNCE_MS = 500;
const REASONING_CACHE_TOUCH_INTERVAL_MS = REASONING_CACHE_TTL_MS / 2;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function createToolReasoningKey(toolCallId: string): string {
	return `tool:${toolCallId}`;
}

function createPostToolReasoningKey(toolCallIds: readonly string[]): string {
	return `post-tool:${JSON.stringify(toolCallIds)}`;
}

export class ReasoningCacheStore {
	private readonly cacheRootUri: vscode.Uri;
	private cleanupPromise: Promise<void> = Promise.resolve();
	private readonly segments = new Map<string, SegmentCacheState>();

	constructor(globalStorageUri: vscode.Uri) {
		this.cacheRootUri = vscode.Uri.joinPath(globalStorageUri, REASONING_CACHE_DIR_NAME);
		void this.queueExpiredSegmentCleanup('startup');
	}

	get size(): number {
		let size = 0;
		for (const state of this.segments.values()) {
			size += state.cache.size;
		}
		return size;
	}

	async forSegment(segmentId: string): Promise<SegmentReasoningCache> {
		await this.cleanupPromise;
		const state = this.getOrCreateSegmentState(segmentId);
		await state.readyPromise;
		this.markAccessed(state);

		const getSize = () => state.cache.size;
		return {
			get size(): number {
				return getSize();
			},
			getToolCallReasoning: (toolCallId) =>
				this.get(state, createToolReasoningKey(toolCallId))?.text,
			getPostToolReasoning: (toolCallIds) =>
				this.get(state, createPostToolReasoningKey(toolCallIds))?.text,
			recordToolCallReasoning: (toolCallIds, text) => {
				const updatedAt = Date.now();
				for (const toolCallId of toolCallIds) {
					this.set(state, createToolReasoningKey(toolCallId), text, updatedAt);
				}
				void this.queueExpiredSegmentCleanup('record');
			},
			recordPostToolReasoning: (toolCallIds, text) => {
				this.set(state, createPostToolReasoningKey(toolCallIds), text, Date.now());
				void this.queueExpiredSegmentCleanup('record');
			},
			prune: (now) => this.pruneSegment(state, now),
		};
	}

	private get(state: SegmentCacheState, reasoningKey: string): ReasoningEntry | undefined {
		const entry = state.cache.get(reasoningKey);
		if (!entry) {
			return undefined;
		}

		const now = Date.now();
		this.markAccessed(state, now);
		if (now - entry.updatedAt >= REASONING_CACHE_TOUCH_INTERVAL_MS) {
			entry.updatedAt = now;
			this.scheduleSave(state);
		}
		return entry;
	}

	private set(
		state: SegmentCacheState,
		reasoningKey: string,
		text: string,
		updatedAt = Date.now(),
	): void {
		this.markAccessed(state, updatedAt);
		state.cache.set(reasoningKey, { text, updatedAt });
		this.scheduleSave(state);
	}

	private markAccessed(state: SegmentCacheState, now = Date.now()): void {
		state.lastAccessedAt = now;
	}

	private pruneSegment(state: SegmentCacheState, now = Date.now()): ReasoningCachePruneResult {
		const result = pruneReasoningCache(state.cache, now);
		if (result.removed > 0) {
			logger.info(
				`reasoningCache prune segment=${state.segmentId}` +
					` removed=${result.removed} expired=${result.expired}` +
					` ttlMs=${REASONING_CACHE_TTL_MS}`,
			);
			this.scheduleSave(state);
		}
		return result;
	}

	async flush(): Promise<void> {
		await this.cleanupPromise;
		await Promise.all([...this.segments.values()].map((state) => this.flushSegment(state)));
	}

	private getOrCreateSegmentState(segmentId: string): SegmentCacheState {
		const existing = this.segments.get(segmentId);
		if (existing) {
			return existing;
		}

		const state: SegmentCacheState = {
			segmentId,
			cacheUri: vscode.Uri.joinPath(this.cacheRootUri, `${segmentId}.json`),
			cache: new Map<string, ReasoningEntry>(),
			readyPromise: Promise.resolve(),
			saveTimer: undefined,
			saveInFlight: undefined,
			dirty: false,
			lastAccessedAt: Date.now(),
		};
		state.readyPromise = this.loadSegment(state);
		this.segments.set(segmentId, state);
		return state;
	}

	private async flushSegment(state: SegmentCacheState): Promise<void> {
		await state.readyPromise;

		if (state.saveTimer) {
			clearTimeout(state.saveTimer);
			state.saveTimer = undefined;
		}

		if (state.saveInFlight) {
			await state.saveInFlight;
		}

		if (!state.dirty) {
			return;
		}

		state.dirty = false;
		state.saveInFlight = (async () => {
			try {
				if (state.cache.size === 0) {
					await deleteFileIfExists(state.cacheUri);
					return;
				}

				await vscode.workspace.fs.createDirectory(this.cacheRootUri);
				await vscode.workspace.fs.writeFile(
					state.cacheUri,
					textEncoder.encode(JSON.stringify(toPersistentSnapshot(state.cache))),
				);
			} catch (error) {
				state.dirty = true;
				logger.warn(`Failed to persist reasoning cache segment=${state.segmentId}`, error);
			} finally {
				state.saveInFlight = undefined;
			}
		})();

		await state.saveInFlight;
	}

	private async loadSegment(state: SegmentCacheState): Promise<void> {
		let data: Uint8Array;
		try {
			data = await vscode.workspace.fs.readFile(state.cacheUri);
		} catch (error) {
			if (!isFileNotFoundError(error)) {
				logger.warn(`Failed to load reasoning cache segment=${state.segmentId}`, error);
			}
			return;
		}

		let snapshot: unknown;
		try {
			snapshot = JSON.parse(textDecoder.decode(data)) as unknown;
		} catch (error) {
			logger.warn(`Ignoring invalid reasoning cache file segment=${state.segmentId}`, error);
			return;
		}

		if (!Array.isArray(snapshot)) {
			logger.warn(`Ignoring invalid reasoning cache snapshot segment=${state.segmentId}`);
			return;
		}

		for (const item of snapshot) {
			if (!Array.isArray(item) || item.length !== 3) {
				continue;
			}

			const [key, text, updatedAt] = item as [unknown, unknown, unknown];
			if (typeof key !== 'string' || typeof text !== 'string') {
				continue;
			}
			if (typeof updatedAt !== 'number' || !Number.isFinite(updatedAt)) {
				continue;
			}

			state.cache.set(key, { text, updatedAt });
		}

		const pruneResult = this.pruneSegment(state);
		if (pruneResult.removed > 0) {
			this.scheduleSave(state);
		}
	}

	private scheduleSave(state: SegmentCacheState): void {
		state.dirty = true;
		if (state.saveTimer) {
			return;
		}

		state.saveTimer = setTimeout(() => {
			state.saveTimer = undefined;
			void this.flushSegment(state);
		}, REASONING_CACHE_SAVE_DEBOUNCE_MS);
	}

	private queueExpiredSegmentCleanup(trigger: ReasoningCacheCleanupTrigger): Promise<void> {
		const next = this.cleanupPromise
			.then(() => this.pruneExpiredSegmentFiles(trigger))
			.catch((error) => {
				logger.warn(`Failed to run reasoning cache cleanup trigger=${trigger}`, error);
			});
		this.cleanupPromise = next;
		return next;
	}

	private async pruneExpiredSegmentFiles(trigger: ReasoningCacheCleanupTrigger): Promise<void> {
		let entries: [string, vscode.FileType][];
		try {
			entries = await vscode.workspace.fs.readDirectory(this.cacheRootUri);
		} catch (error) {
			if (!isFileNotFoundError(error)) {
				logger.warn('Failed to scan reasoning cache directory', error);
			}
			return;
		}

		const now = Date.now();
		const result: ReasoningCacheCleanupResult = {
			scanned: 0,
			deleted: 0,
			errors: 0,
		};
		await Promise.all(
			entries.map(async ([name, type]) => {
				if (type !== vscode.FileType.File || !name.endsWith('.json')) {
					return;
				}

				result.scanned += 1;
				const segmentId = name.slice(0, -'.json'.length);
				const loadedState = this.segments.get(segmentId);
				if (loadedState) {
					const deleted = await this.pruneLoadedSegmentFile(loadedState, now);
					if (deleted) {
						result.deleted += 1;
					}
					return;
				}

				const uri = vscode.Uri.joinPath(this.cacheRootUri, name);
				try {
					const stat = await vscode.workspace.fs.stat(uri);
					if (now - stat.mtime > REASONING_CACHE_TTL_MS) {
						await vscode.workspace.fs.delete(uri);
						result.deleted += 1;
					}
				} catch (error) {
					if (!isFileNotFoundError(error)) {
						result.errors += 1;
						logger.warn(`Failed to prune reasoning cache file name=${name}`, error);
					}
				}
			}),
		);
		await this.unloadInactiveEmptySegments(now);

		if (shouldLogCleanupResult(trigger, result)) {
			logger.info(
				`reasoningCache cleanup trigger=${trigger}` +
					` scanned=${result.scanned} deleted=${result.deleted} errors=${result.errors}` +
					` ttlMs=${REASONING_CACHE_TTL_MS}`,
			);
		}
	}

	private async pruneLoadedSegmentFile(state: SegmentCacheState, now: number): Promise<boolean> {
		await state.readyPromise;
		this.pruneSegment(state, now);
		return this.unloadInactiveEmptySegment(state, now, true);
	}

	private async unloadInactiveEmptySegments(now: number): Promise<void> {
		await Promise.all(
			[...this.segments.values()].map(async (state) => {
				await state.readyPromise;
				await this.unloadInactiveEmptySegment(state, now, false);
			}),
		);
	}

	private async unloadInactiveEmptySegment(
		state: SegmentCacheState,
		now: number,
		deletePersistedFile: boolean,
	): Promise<boolean> {
		if (state.cache.size > 0 || now - state.lastAccessedAt <= REASONING_CACHE_TTL_MS) {
			return false;
		}

		if (deletePersistedFile) {
			this.scheduleSave(state);
		}
		if (state.dirty || state.saveTimer || state.saveInFlight) {
			await this.flushSegment(state);
		}

		if (state.cache.size === 0 && !state.dirty) {
			this.segments.delete(state.segmentId);
			return deletePersistedFile;
		}

		return false;
	}
}

function shouldLogCleanupResult(
	trigger: ReasoningCacheCleanupTrigger,
	result: ReasoningCacheCleanupResult,
): boolean {
	return trigger === 'startup' || result.deleted > 0 || result.errors > 0;
}

export function pruneReasoningCache(
	cache: Map<string, ReasoningEntry>,
	now = Date.now(),
): ReasoningCachePruneResult {
	let expired = 0;
	for (const [key, entry] of cache) {
		if (now - entry.updatedAt > REASONING_CACHE_TTL_MS) {
			cache.delete(key);
			expired += 1;
		}
	}

	return {
		removed: expired,
		expired,
	};
}

function toPersistentSnapshot(cache: Map<string, ReasoningEntry>): PersistentReasoningSnapshot {
	return [...cache.entries()].map(([key, entry]) => [key, entry.text, entry.updatedAt]);
}

function isFileNotFoundError(error: unknown): boolean {
	return (error as { code?: unknown })?.code === 'FileNotFound';
}

async function deleteFileIfExists(uri: vscode.Uri): Promise<void> {
	try {
		await vscode.workspace.fs.delete(uri);
	} catch (error) {
		if (!isFileNotFoundError(error)) {
			throw error;
		}
	}
}
