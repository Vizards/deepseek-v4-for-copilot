import { createHash } from 'crypto';
import type vscode from 'vscode';
import type { VisionDescriptionCacheStats } from './types';

const MAX_VISION_DESCRIPTION_CACHE_ENTRIES = 100;

interface VisionDescriptionCacheEntry {
	description: string;
	/** SHA-256 of the original image bytes, for secondary index eviction. */
	dataHash?: string;
}

const visionDescriptionCache = new Map<string, VisionDescriptionCacheEntry>();
// Promise-only single-flight: caller cancellation does not abort shared vision work.
const pendingVisionDescriptions = new Map<string, Promise<string>>();
// Secondary index keyed by data hash, for lookup without knowing vision model/prompt.
// Used by provideTokenCount to find cached descriptions for image DataParts.
const dataHashToDescription = new Map<string, string>();

export function createVisionDescriptionCacheStats(): VisionDescriptionCacheStats {
	return {
		enabled: true,
		hits: 0,
		misses: 0,
		deduplicatedDescriptions: 0,
		entries: visionDescriptionCache.size,
		generatedDescriptions: 0,
		failedDescriptions: 0,
		droppedImageParts: 0,
	};
}

export function finalizeVisionDescriptionCacheStats(
	stats: VisionDescriptionCacheStats,
): VisionDescriptionCacheStats {
	stats.entries = visionDescriptionCache.size;
	return stats;
}

export function createVisionDescriptionCacheKey(
	part: vscode.LanguageModelDataPart,
	visionModelId: string,
	visionPrompt: string,
	dataHash?: string,
): string {
	const dh = dataHash ?? hashBytes(part.data);
	return hashString(
		['v1', part.mimeType, dh, visionModelId, hashString(visionPrompt)].join('\0'),
	);
}

export function getCachedDescription(key: string): string | undefined {
	const entry = visionDescriptionCache.get(key);
	if (!entry) {
		return undefined;
	}

	visionDescriptionCache.delete(key);
	visionDescriptionCache.set(key, entry);
	return entry.description;
}

export function rememberDescription(key: string, description: string, dataHash?: string): void {
	visionDescriptionCache.set(key, {
		description,
		dataHash,
	});

	if (dataHash) {
		dataHashToDescription.set(dataHash, description);
	}

	while (visionDescriptionCache.size > MAX_VISION_DESCRIPTION_CACHE_ENTRIES) {
		const oldestKey = visionDescriptionCache.keys().next().value;
		if (!oldestKey) {
			break;
		}
		const evicted = visionDescriptionCache.get(oldestKey);
		visionDescriptionCache.delete(oldestKey);
		if (evicted?.dataHash) {
			// Only delete the secondary index mapping if no other cached
			// entry still references the same data hash (same image bytes
			// may be cached under different vision model/prompt keys).
			let stillReferenced = false;
			for (const entry of visionDescriptionCache.values()) {
				if (entry.dataHash === evicted.dataHash) {
					stillReferenced = true;
					break;
				}
			}
			if (!stillReferenced) {
				dataHashToDescription.delete(evicted.dataHash);
			}
		}
	}
}

export function getPendingDescription(key: string): Promise<string> | undefined {
	return pendingVisionDescriptions.get(key);
}

export function rememberPendingDescription(key: string, description: Promise<string>): void {
	pendingVisionDescriptions.set(key, description);
	void description
		.finally(() => {
			if (pendingVisionDescriptions.get(key) === description) {
				pendingVisionDescriptions.delete(key);
			}
		})
		.catch(() => undefined);
}

export function getCachedDescriptionByDataHash(dataHash: string): string | undefined {
	return dataHashToDescription.get(dataHash);
}

export function computeDataHash(data: Uint8Array): string {
	return hashBytes(data);
}

function hashBytes(value: Uint8Array): string {
	return createHash('sha256').update(value).digest('hex');
}

function hashString(value: string): string {
	return createHash('sha256').update(value).digest('hex');
}
