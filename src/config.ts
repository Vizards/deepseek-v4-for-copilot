import vscode from 'vscode';
import { CONFIG_SECTION } from './consts';
import {
	CLOUD_CACHE_SECONDS,
	MAX_CACHE_SECONDS,
	MIN_CACHE_SECONDS,
} from './provider/vision/filesApi';

export type DebugMode = 'minimal' | 'metadata' | 'verbose';

/**
 * Get DeepSeek API base URL from settings.
 * Falls back to the official endpoint when not configured.
 */
export function getBaseUrl(): string {
	const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
	return config.get<string>('baseUrl') || 'https://api.deepseek.com';
}

/**
 * Resolve the API model ID to send to the endpoint.
 *
 * Users can override model IDs via the `modelIdOverrides` setting object
 * (e.g. for third-party API proxies). Falls back to the VS Code model ID
 * when no override is configured.
 */
export function getApiModelId(vscodeModelId: string): string {
	const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
	const overrides = config.get<Record<string, string>>('modelIdOverrides');
	const override = overrides?.[vscodeModelId]?.trim();
	return override || vscodeModelId;
}

/**
 * Get the configured max output tokens limit.
 * Returns `undefined` when set to 0 (API default — no limit).
 */
export function getMaxTokens(): number | undefined {
	const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
	const value = config.get<number>('maxTokens', 0);
	return value > 0 ? value : undefined;
}

/**
 * Diagnostic mode. `verbose` also enables metadata logs.
 *
 * The legacy boolean `debug` setting is still read as a fallback so old
 * settings keep working even if migration cannot update every scope.
 */
export function getDebugMode(): DebugMode {
	const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
	const mode = getConfiguredDebugMode(config);
	if (mode) return mode;

	return config.get<boolean>('debug', false) ? 'metadata' : 'minimal';
}

/**
 * Whether to log privacy-preserving diagnostic debug information.
 */
export function getDebugLoggingEnabled(): boolean {
	return getDebugMode() !== 'minimal';
}

/**
 * Whether to write full DeepSeek request payloads to disk.
 */
export function getRequestDumpEnabled(): boolean {
	return getDebugMode() === 'verbose';
}

export function getStabilizeToolListEnabled(): boolean {
	const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
	return config.get<boolean>('experimental.stabilizeToolList', false);
}

/**
 * Whether the experimental DeepSeek Files API native-vision route is enabled.
 *
 * When enabled (and the model supports it and the endpoint is the official
 * DeepSeek API), images are uploaded via POST /files and referenced by file_id.
 */
export function getFilesApiEnabled(): boolean {
	const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
	return config.get<boolean>('experimental.filesApi', false);
}

/**
 * Get the configured cloud cache lifetime (in seconds) for Files API uploads.
 *
 * Reads `cacheExpiresDays` from settings:
 *   - `-1` → permanent (0, no expires_after)
 *   - `0` → 1 hour (the API's minimum)
 *   - a plain number `N` → N days
 *
 * The result is clamped to the API's valid range [MIN_CACHE_SECONDS, MAX_CACHE_SECONDS].
 * Returns 0 only when the user explicitly wants permanent files (never expires).
 */
export function getCacheExpiresSeconds(): number {
	const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
	// 兜底为 7（天），与 package.json 的 schema default 保持一致，
	// 避免配置读取失败时落入 0 → 1 小时的语义。
	const days = config.get<number>('cacheExpiresDays', 7);
	return parseCacheExpiresSeconds(days);
}

/**
 * Parse a `cacheExpiresDays` numeric value into seconds. Clamps to the API's
 * valid range, or returns 0 for permanent.
 */
export function parseCacheExpiresSeconds(raw: number | undefined | null): number {
	if (raw == null) {
		return CLOUD_CACHE_SECONDS; // 默认 7 天
	}
	// 永久：-1 或任意负数
	if (raw < 0) {
		return 0;
	}
	// 0 → 1 小时（API 允许的最小值）
	if (raw === 0) {
		return MIN_CACHE_SECONDS;
	}
	// 正数 → 天，并钳制到 API 允许范围
	return clampToValidCacheRange(raw * 24 * 60 * 60);
}

/** Clamp a raw duration (seconds) to the API's valid range. */
function clampToValidCacheRange(seconds: number): number {
	return Math.min(Math.max(Math.round(seconds), MIN_CACHE_SECONDS), MAX_CACHE_SECONDS);
}

/**
 * Migrate the legacy boolean `deepseek-copilot.debug` setting to `debugMode`.
 *
 * `debug: true` maps to `debugMode: metadata`; `debug: false` maps to the
 * default `minimal`, so it only needs cleanup.
 */
export async function migrateLegacyDebugSetting(): Promise<void> {
	await migrateLegacyDebugSettingAtScope(vscode.ConfigurationTarget.Global);
	if (vscode.workspace.workspaceFile || vscode.workspace.workspaceFolders?.length) {
		await migrateLegacyDebugSettingAtScope(vscode.ConfigurationTarget.Workspace);
	}
}

function getConfiguredDebugMode(config: vscode.WorkspaceConfiguration): DebugMode | undefined {
	const mode = config.inspect<unknown>('debugMode');
	return normalizeDebugMode(mode?.workspaceValue) ?? normalizeDebugMode(mode?.globalValue);
}

function normalizeDebugMode(value: unknown): DebugMode | undefined {
	if (value === 'minimal' || value === 'metadata' || value === 'verbose') {
		return value;
	}
	return undefined;
}

async function migrateLegacyDebugSettingAtScope(
	target: vscode.ConfigurationTarget,
	resource?: vscode.Uri,
): Promise<void> {
	const config = vscode.workspace.getConfiguration(CONFIG_SECTION, resource);
	const legacy = config.inspect<boolean>('debug');
	const mode = config.inspect<DebugMode>('debugMode');
	const legacyValue = getScopedValue(legacy, target);

	if (legacyValue === undefined) {
		return;
	}

	if (legacyValue === true && getScopedValue(mode, target) === undefined) {
		await config.update('debugMode', 'metadata', target);
	}
	await config.update('debug', undefined, target);
}

function getScopedValue<T>(
	inspection:
		| {
				globalValue?: T;
				workspaceValue?: T;
				workspaceFolderValue?: T;
		  }
		| undefined,
	target: vscode.ConfigurationTarget,
): T | undefined {
	if (!inspection) {
		return undefined;
	}

	if (target === vscode.ConfigurationTarget.Global) {
		return inspection.globalValue;
	}
	if (target === vscode.ConfigurationTarget.Workspace) {
		return inspection.workspaceValue;
	}
	return undefined;
}
