import { createHash } from 'node:crypto';
import vscode from 'vscode';
import {
	getVisionDescriptionCachePersist,
	getVisionDescriptionCacheTtlHours,
	MAX_VISION_DESCRIPTION_CACHE_ENTRIES,
} from '../../config';
import { logger } from '../../logger';
import type { VisionImagePart } from './types';

const CACHE_FILE_NAME = 'vision-description-cache.json';
const CACHE_FILE_VERSION = 1;
const CACHE_FLUSH_DELAY_MS = 500;
const HOURS_TO_MS = 60 * 60 * 1000;

interface VisionDescriptionCacheEntry {
	text: string;
	expiresAt: number;
}

interface PersistedVisionDescriptionCache {
	version: number;
	entries: Record<string, VisionDescriptionCacheEntry>;
}

export interface VisionDescriptionResolution {
	text: string;
	/** `cache` replayed a stored description, `shared` joined an in-flight call, `generated` called the describer. */
	source: 'cache' | 'shared' | 'generated';
}

/**
 * Identity of one description: the backend, the prompt, and the exact image set.
 *
 * Descriptions are generated text. Identical inputs must reuse the identical text,
 * otherwise a replayed image mutates between turns and every token after it falls out
 * of DeepSeek's prompt-cache prefix.
 */
export function createVisionDescriptionCacheKey(input: {
	/** `VisionDescriber.cacheIdentity`: source, effective model and payload mapping. */
	cacheIdentity: string;
	prompt: string;
	images: readonly VisionImagePart[];
}): string {
	const hash = createHash('sha256');
	hash.update(input.cacheIdentity);
	hash.update('\u0000');
	hash.update(input.prompt);
	for (const image of input.images) {
		hash.update('\u0000');
		hash.update(image.mimeType);
		hash.update('\u0000');
		hash.update(createHash('sha256').update(image.data).digest('hex'));
	}
	return hash.digest('hex');
}

/**
 * Time-bounded description cache with in-flight coalescing.
 *
 * Memory only by default; `visionDescriptionCachePersist` opts into surviving an
 * extension-host restart. Entries expire after `visionDescriptionCacheTtlHours`
 * (14 days by default) and the store is capped, so a long session cannot grow it
 * without limit.
 *
 * Two requests that hit the same uncached image share one generation: paying twice
 * would be wasteful, and the two different texts would make later replays disagree.
 */
class VisionDescriptionCache {
	private entries = new Map<string, VisionDescriptionCacheEntry>();
	private inflight = new Map<string, Promise<string>>();
	private globalStorageUri: vscode.Uri | undefined;
	private loadPromise: Promise<void> | undefined;
	private flushTimer: ReturnType<typeof setTimeout> | undefined;
	private flushPromise: Promise<void> = Promise.resolve();

	configure(globalStorageUri: vscode.Uri): void {
		if (this.globalStorageUri?.toString() === globalStorageUri.toString()) {
			return;
		}
		this.globalStorageUri = globalStorageUri;
		this.entries.clear();
		this.inflight.clear();
		this.loadPromise = undefined;
	}

	/** Resolve one description, reusing the store or an in-flight generation. */
	async resolve(
		key: string,
		generate: () => Promise<string>,
	): Promise<VisionDescriptionResolution> {
		const existingGeneration = this.inflight.get(key);
		if (existingGeneration) {
			return { text: await existingGeneration, source: 'shared' };
		}

		if (!this.isEnabled()) {
			// Coalescing still applies: identical inputs must produce identical text.
			return { text: await this.startGeneration(key, generate, false), source: 'generated' };
		}

		await this.ensureLoaded();
		const cached = this.readEntry(key);
		if (cached !== undefined) {
			return { text: cached, source: 'cache' };
		}

		const pending = this.inflight.get(key);
		if (pending) {
			// A load or another caller may have filled the gap while we were awaiting.
			return { text: await pending, source: 'shared' };
		}

		return { text: await this.startGeneration(key, generate, true), source: 'generated' };
	}

	/** Test/diagnostic hook: number of live entries. */
	get size(): number {
		return this.entries.size;
	}

	private startGeneration(
		key: string,
		generate: () => Promise<string>,
		store: boolean,
	): Promise<string> {
		const promise = (async () => {
			const text = await generate();
			if (store) {
				this.storeEntry(key, text);
			}
			return text;
		})();

		this.inflight.set(key, promise);
		// Failed (including cancelled) generations must disappear so a retry is possible.
		const release = (): void => {
			if (this.inflight.get(key) === promise) {
				this.inflight.delete(key);
			}
		};
		void promise.then(release, release);
		return promise;
	}

	private readEntry(key: string): string | undefined {
		const entry = this.entries.get(key);
		if (!entry) {
			return undefined;
		}
		if (entry.expiresAt <= Date.now()) {
			this.entries.delete(key);
			return undefined;
		}
		return entry.text;
	}

	private storeEntry(key: string, text: string): void {
		const ttlHours = getVisionDescriptionCacheTtlHours();
		if (ttlHours <= 0 || text.length === 0) {
			return;
		}
		this.entries.set(key, { text, expiresAt: Date.now() + ttlHours * HOURS_TO_MS });
		this.prune();
		this.scheduleFlush();
	}

	private isEnabled(): boolean {
		return getVisionDescriptionCacheTtlHours() > 0;
	}

	private isPersistent(): boolean {
		return this.isEnabled() && getVisionDescriptionCachePersist() && this.globalStorageUri !== undefined;
	}

	/**
	 * Await the shared load. Every persistent lookup must wait for it, otherwise a
	 * second caller sees an empty map and regenerates a description already on disk.
	 */
	private ensureLoaded(): Promise<void> {
		if (!this.isPersistent()) {
			return Promise.resolve();
		}
		this.loadPromise ??= this.load().catch((error: unknown) => {
			logger.warn('Failed to load the vision description cache', error);
		});
		return this.loadPromise;
	}

	private get cacheFileUri(): vscode.Uri | undefined {
		return this.globalStorageUri
			? vscode.Uri.joinPath(this.globalStorageUri, CACHE_FILE_NAME)
			: undefined;
	}

	private async load(): Promise<void> {
		const uri = this.cacheFileUri;
		if (!uri) {
			return;
		}
		let text: string;
		try {
			text = new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
		} catch {
			return;
		}
		const parsed = parsePersistedCache(text);
		if (!parsed) {
			logger.warn('Ignoring an unreadable vision description cache file');
			return;
		}
		const now = Date.now();
		for (const [key, entry] of Object.entries(parsed.entries)) {
			// Never replace a description generated while the file was loading.
			if (entry.expiresAt > now && !this.entries.has(key)) {
				this.entries.set(key, entry);
			}
		}
		this.prune();
	}

	private prune(): void {
		const now = Date.now();
		for (const [key, entry] of this.entries) {
			if (entry.expiresAt <= now) {
				this.entries.delete(key);
			}
		}
		if (this.entries.size <= MAX_VISION_DESCRIPTION_CACHE_ENTRIES) {
			return;
		}
		const ordered = [...this.entries.entries()].sort(
			([, left], [, right]) => left.expiresAt - right.expiresAt,
		);
		for (const [key] of ordered.slice(0, this.entries.size - MAX_VISION_DESCRIPTION_CACHE_ENTRIES)) {
			this.entries.delete(key);
		}
	}

	private scheduleFlush(): void {
		if (!this.isPersistent() || this.flushTimer) {
			return;
		}
		this.flushTimer = setTimeout(() => {
			this.flushTimer = undefined;
			this.flushPromise = this.flushPromise
				.then(() => this.flush())
				.catch((error: unknown) => {
					logger.warn('Failed to persist the vision description cache', error);
				});
		}, CACHE_FLUSH_DELAY_MS);
	}

	private async flush(): Promise<void> {
		const uri = this.cacheFileUri;
		// Persistence can be switched off while the flush is queued; recheck before
		// writing, so descriptions do not reach disk after the user disabled it.
		if (!uri || !this.isPersistent()) {
			return;
		}
		this.prune();
		const payload: PersistedVisionDescriptionCache = {
			version: CACHE_FILE_VERSION,
			entries: Object.fromEntries(this.entries),
		};
		await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(JSON.stringify(payload)));
	}
}

function parsePersistedCache(text: string): PersistedVisionDescriptionCache | undefined {
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch {
		return undefined;
	}
	if (!value || typeof value !== 'object') {
		return undefined;
	}
	const record = value as Partial<PersistedVisionDescriptionCache>;
	const entries = record.entries;
	if (!entries || typeof entries !== 'object') {
		return undefined;
	}
	const parsed: Record<string, VisionDescriptionCacheEntry> = {};
	for (const [key, entry] of Object.entries(entries)) {
		const candidate = entry as VisionDescriptionCacheEntry | undefined;
		if (candidate && typeof candidate.text === 'string' && Number.isFinite(candidate.expiresAt)) {
			parsed[key] = { text: candidate.text, expiresAt: candidate.expiresAt };
		}
	}
	return { version: CACHE_FILE_VERSION, entries: parsed };
}

/** One cache shared by every provider request in this extension host. */
export const visionDescriptionCache = new VisionDescriptionCache();
