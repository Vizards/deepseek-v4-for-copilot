import { createHash } from 'crypto';
import type vscode from 'vscode';
import type { VisionDescriptionCacheStats } from './types';

const MAX_VISION_DESCRIPTION_CACHE_ENTRIES = 100;

interface VisionDescriptionCacheEntry {
	description: string;
}

const visionDescriptionCache = new Map<string, VisionDescriptionCacheEntry>();
// Promise-only single-flight: caller cancellation does not abort shared vision work.
const pendingVisionDescriptions = new Map<string, Promise<string>>();

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
): string {
	return hashString(
		['v1', part.mimeType, hashBytes(part.data), visionModelId, hashString(visionPrompt)].join('\0'),
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

export function rememberDescription(key: string, description: string): void {
	visionDescriptionCache.set(key, {
		description,
	});

	while (visionDescriptionCache.size > MAX_VISION_DESCRIPTION_CACHE_ENTRIES) {
		const oldestKey = visionDescriptionCache.keys().next().value;
		if (!oldestKey) {
			break;
		}
		visionDescriptionCache.delete(oldestKey);
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

function hashBytes(value: Uint8Array): string {
	return createHash('sha256').update(value).digest('hex');
}

function hashString(value: string): string {
	return createHash('sha256').update(value).digest('hex');
}
