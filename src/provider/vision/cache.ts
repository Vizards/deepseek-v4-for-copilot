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
/** Upper bound for one shared generation, so a stalled describer cannot pin an entry. */
const SHARED_GENERATION_TIMEOUT_MS = 120 * 1000;

interface VisionDescriptionCacheEntry {
	text: string;
	expiresAt: number;
}

interface PersistedVisionDescriptionCache {
	version: number;
	entries: Record<string, VisionDescriptionCacheEntry>;
}

interface InflightGeneration {
	promise: Promise<string>;
}

/**
 * Thrown to one waiter whose own request was cancelled. Other waiters keep their
 * generation: their cancellation token never touched the shared work.
 */
export class VisionDescriptionAbandonedError extends Error {
	constructor() {
		super('The requesting turn was cancelled while waiting for a vision description');
		this.name = 'VisionDescriptionAbandonedError';
	}
}

export interface VisionDescriptionResolution {
	text: string;
	/** `cache` replayed a stored description, `shared` joined an in-flight call, `generated` started one. */
	source: 'cache' | 'shared' | 'generated';
}

export interface VisionDescriptionRequest {
	/** The calling turn's token. Cancelling it abandons only this waiter. */
	token: vscode.CancellationToken;
	/** Runs the describer against the shared token, not the caller's. */
	generate: (sharedToken: vscode.CancellationToken) => Promise<string>;
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
 * Two requests that need the same uncached image share one generation: paying twice
 * is wasteful, and two different texts would make later replays disagree. The shared
 * generation owns its cancellation: it runs on a private token source with its own
 * timeout, so one caller cancelling its turn only abandons that caller. Its result
 * still lands in the cache for the next turn.
 */
class VisionDescriptionCache {
	private entries = new Map<string, VisionDescriptionCacheEntry>();
	private inflight = new Map<string, InflightGeneration>();
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
	async resolve(key: string, request: VisionDescriptionRequest): Promise<VisionDescriptionResolution> {
		const pending = this.inflight.get(key);
		if (pending) {
			return { text: await this.awaitGeneration(pending, request.token), source: 'shared' };
		}

		if (!this.isEnabled()) {
			// Coalescing still applies: identical inputs must produce identical text.
			const generation = this.startGeneration(key, request, false);
			return { text: await this.awaitGeneration(generation, request.token), source: 'generated' };
		}

		await this.ensureLoaded();
		const cached = this.readEntry(key);
		if (cached !== undefined) {
			return { text: cached, source: 'cache' };
		}

		const raced = this.inflight.get(key);
		if (raced) {
			// The load may have taken long enough for another caller to start generating.
			return { text: await this.awaitGeneration(raced, request.token), source: 'shared' };
		}

		const generation = this.startGeneration(key, request, true);
		return { text: await this.awaitGeneration(generation, request.token), source: 'generated' };
	}

	/** Test/diagnostic hook: number of live entries. */
	get size(): number {
		return this.entries.size;
	}

	/**
	 * Wait for the shared generation, but give up as soon as this waiter's own turn is
	 * cancelled. The generation itself keeps running on its private token.
	 */
	private async awaitGeneration(
		generation: InflightGeneration,
		token: vscode.CancellationToken,
	): Promise<string> {
		if (token.isCancellationRequested) {
			throw new VisionDescriptionAbandonedError();
		}

		let subscription: vscode.Disposable | undefined;
		try {
			return await Promise.race([
				generation.promise,
				new Promise<never>((_resolve, reject) => {
					subscription = token.onCancellationRequested(() => {
						reject(new VisionDescriptionAbandonedError());
					});
				}),
			]);
		} finally {
			subscription?.dispose();
		}
	}

	private startGeneration(
		key: string,
		request: VisionDescriptionRequest,
		store: boolean,
	): InflightGeneration {
		const source = new vscode.CancellationTokenSource();
		const timeout = setTimeout(() => source.cancel(), SHARED_GENERATION_TIMEOUT_MS);
		// Identity holder, so the finally block can tell whether this entry is still
		// the live one without referencing the not-yet-assigned promise.
		const generation: InflightGeneration = {
			promise: Promise.resolve(''),
		};
		generation.promise = (async () => {
			try {
				const text = await request.generate(source.token);
				if (store) {
					this.storeEntry(key, text);
				}
				return text;
			} finally {
				clearTimeout(timeout);
				source.dispose();
				// Failed (including timed out) generations must disappear so retries can run.
				if (this.inflight.get(key) === generation) {
					this.inflight.delete(key);
				}
			}
		})();
		this.inflight.set(key, generation);
		// Keep an unobserved rejection from surfacing as an unhandled rejection when
		// every waiter abandoned the generation.
		void generation.promise.catch(() => undefined);
		return generation;
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
		return (
			this.isEnabled() && getVisionDescriptionCachePersist() && this.globalStorageUri !== undefined
		);
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
