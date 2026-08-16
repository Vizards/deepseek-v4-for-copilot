import vscode from 'vscode';
import { CONFIG_SECTION } from './consts';
import { ORCAROUTER_API_BASE } from './endpoint';

export type DebugMode = 'minimal' | 'metadata' | 'verbose';

/** API backend that serves the DeepSeek V4 models. */
export type ProviderId = 'deepseek' | 'orcarouter';

/**
 * Selected provider for the DeepSeek V4 models.
 *
 * `deepseek` uses the official API (or a custom `baseUrl`/`modelIdOverrides`
 * for compatible third-party endpoints). `orcarouter` is a named preset that
 * routes through the [OrcaRouter](https://www.orcarouter.ai) model gateway
 * with namespaced model IDs and its own error links.
 */
export function getProvider(): ProviderId {
	const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
	return config.get<string>('provider') === 'orcarouter' ? 'orcarouter' : 'deepseek';
}

/**
 * Get DeepSeek API base URL from settings.
 * Falls back to the official endpoint when not configured.
 *
 * The `orcarouter` provider always uses the OrcaRouter gateway endpoint.
 */
export function getBaseUrl(): string {
	const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
	if (getProvider() === 'orcarouter') {
		return ORCAROUTER_API_BASE;
	}
	return config.get<string>('baseUrl') || 'https://api.deepseek.com';
}

/**
 * Namespaced model IDs used by the OrcaRouter gateway.
 * OrcaRouter rejects bare model names, so `deepseek-v4-flash` becomes
 * `deepseek/deepseek-v4-flash` etc.
 */
const ORCAROUTER_MODEL_ID_MAP: Readonly<Record<string, string>> = {
	'deepseek-v4-flash': 'deepseek/deepseek-v4-flash',
	'deepseek-v4-pro': 'deepseek/deepseek-v4-pro',
};

/**
 * Resolve the API model ID to send to the endpoint.
 *
 * Users can override model IDs via the `modelIdOverrides` setting object
 * (e.g. for third-party API proxies). Falls back to the VS Code model ID
 * when no override is configured.
 *
 * The `orcarouter` provider maps to namespaced gateway IDs automatically and
 * ignores `modelIdOverrides`.
 */
export function getApiModelId(vscodeModelId: string): string {
	if (getProvider() === 'orcarouter') {
		return ORCAROUTER_MODEL_ID_MAP[vscodeModelId] ?? vscodeModelId;
	}

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
