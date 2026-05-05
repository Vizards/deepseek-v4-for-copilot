import { createHash } from 'crypto';
import type vscode from 'vscode';
import type { VisionDescriptionCacheStats } from './types';

const MAX_VISION_DESCRIPTION_CACHE_ENTRIES = 100;

interface VisionDescriptionCacheEntry {
	description: string;
	createdAt: number;
	lastAccessedAt: number;
	hits: number;
}

const visionDescriptionCache = new Map<string, VisionDescriptionCacheEntry>();

export function createVisionDescriptionCacheStats(): VisionDescriptionCacheStats {
	return {
		enabled: true,
		hits: 0,
		misses: 0,
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

	entry.hits += 1;
	entry.lastAccessedAt = Date.now();
	visionDescriptionCache.delete(key);
	visionDescriptionCache.set(key, entry);
	return entry.description;
}

export function rememberDescription(key: string, description: string): void {
	const now = Date.now();
	visionDescriptionCache.set(key, {
		description,
		createdAt: now,
		lastAccessedAt: now,
		hits: 0,
	});

	while (visionDescriptionCache.size > MAX_VISION_DESCRIPTION_CACHE_ENTRIES) {
		const oldestKey = visionDescriptionCache.keys().next().value;
		if (!oldestKey) {
			break;
		}
		visionDescriptionCache.delete(oldestKey);
	}
}

function hashBytes(value: Uint8Array): string {
	return createHash('sha256').update(value).digest('hex');
}

function hashString(value: string): string {
	return createHash('sha256').update(value).digest('hex');
}
