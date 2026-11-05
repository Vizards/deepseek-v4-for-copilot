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

interface VisionDescriptionCacheEntry {
	text: string;
	expiresAt: number;
}

interface PersistedVisionDescriptionCache {
	version: number;
	entries: Record<string, VisionDescriptionCacheEntry>;
}

/**
 * Identity of one description: the describer, the prompt, and the exact image set.
 *
 * Descriptions are generated text. Identical inputs must reuse the identical text,
 * otherwise a replayed image mutates between turns and every token after it falls out
 * of DeepSeek's prompt-cache prefix.
 */
export function createVisionDescriptionCacheKey(input: {
	describerId: string;
	prompt: string;
	images: readonly VisionImagePart[];
}): string {
	const hash = createHash('sha256');
	hash.update(input.describerId);
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
 * Time-bounded description cache.
 *
 * Memory only by default; `visionDescriptionCachePersist` opts into surviving an
 * extension-host restart. Entries expire after `visionDescriptionCacheTtlHours`
 * (14 days by default) and the store is capped, so a long session cannot grow it
 * without limit.
 */
class VisionDescriptionCache {
	private entries = new Map<string, VisionDescriptionCacheEntry>();
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
		this.loadPromise = undefined;
	}

	async get(key: string): Promise<string | undefined> {
		if (getVisionDescriptionCacheTtlHours() <= 0) {
			return undefined;
		}
		await this.ensureLoaded();
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

	set(key: string, text: string): void {
		const ttlHours = getVisionDescriptionCacheTtlHours();
		if (ttlHours <= 0 || text.length === 0) {
			return;
		}
		const now = Date.now();
		this.entries.set(key, { text, expiresAt: now + ttlHours * 60 * 60 * 1000 });
		this.prune();
		this.scheduleFlush();
	}

	/** Test/diagnostic hook: number of live entries. */
	get size(): number {
		return this.entries.size;
	}

	private async ensureLoaded(): Promise<void> {
		if (this.loadPromise || !this.isPersistent()) {
			return;
		}
		this.loadPromise = this.load();
		try {
			await this.loadPromise;
		} catch (error) {
			logger.warn('Failed to load the vision description cache', error);
		}
	}

	private isPersistent(): boolean {
		return getVisionDescriptionCachePersist() && this.globalStorageUri !== undefined;
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
			if (entry.expiresAt > now) {
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
		if (!uri) {
			return;
		}
		this.prune();
		const payload: PersistedVisionDescriptionCache = {
			version: CACHE_FILE_VERSION,
			entries: Object.fromEntries(this.entries),
		};
		await vscode.workspace.fs.writeFile(
			uri,
			new TextEncoder().encode(JSON.stringify(payload)),
		);
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
		if (
			entry &&
			typeof entry === 'object' &&
			typeof (entry as VisionDescriptionCacheEntry).text === 'string' &&
			Number.isFinite((entry as VisionDescriptionCacheEntry).expiresAt)
		) {
			parsed[key] = {
				text: (entry as VisionDescriptionCacheEntry).text,
				expiresAt: (entry as VisionDescriptionCacheEntry).expiresAt,
			};
		}
	}
	return { version: CACHE_FILE_VERSION, entries: parsed };
}

/** One cache shared by every provider request in this extension host. */
export const visionDescriptionCache = new VisionDescriptionCache();
