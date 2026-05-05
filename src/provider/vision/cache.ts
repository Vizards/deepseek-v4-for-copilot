import { createHash } from 'crypto';
import type vscode from 'vscode';
import type { PendingVisionDescription } from './pending';
import type { VisionDescriptionCacheStats } from './types';

const MAX_VISION_DESCRIPTION_CACHE_ENTRIES = 100;

interface VisionDescriptionCacheEntry {
	description: string;
}

const visionDescriptionCache = new Map<string, VisionDescriptionCacheEntry>();
const pendingVisionDescriptions = new Map<string, PendingVisionDescription>();

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

export function getPendingDescription(key: string): PendingVisionDescription | undefined {
	const pending = pendingVisionDescriptions.get(key);
	return pending?.cancelledWhenUnused ? undefined : pending;
}

export function rememberPendingDescription(key: string, pending: PendingVisionDescription): void {
	pendingVisionDescriptions.set(key, pending);
	void pending.promise
		.finally(() => {
			if (pendingVisionDescriptions.get(key) === pending) {
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
