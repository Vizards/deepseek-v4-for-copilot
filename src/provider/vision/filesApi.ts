import vscode from 'vscode';
import * as crypto from 'crypto';

/** DeepSeek Files API 上传返回的文件对象。 */
export interface DeepSeekFile {
	id: string;
	object: string;
	bytes: number;
	created_at: number;
	filename: string;
	purpose: string;
	expires_at?: number;
}

/** 云端缓存默认时长：7 天（秒）。 */
export const CLOUD_CACHE_SECONDS = 7 * 24 * 60 * 60;
/** 云端缓存最小时长：1 小时（秒，DeepSeek Files API 允许的最小值）。 */
export const MIN_CACHE_SECONDS = 60 * 60;
/** 云端缓存最大时长：30 天（秒，DeepSeek 上限）。 */
export const MAX_CACHE_SECONDS = 30 * 24 * 60 * 60;

/** 文件过期前多久视为即将失效，需要重传（秒 = 1 小时）。 */
const EXPIRY_WARN_SECONDS = 60 * 60;

/** 本地缓存保留时长：超过该时长的缓存文件将被清理（秒 = 7 天）。 */
export const LOCAL_CACHE_RETENTION_SECONDS = 7 * 24 * 60 * 60;

/** 两次清理之间的最小间隔，避免每次上传都遍历目录（秒 = 1 小时）。 */
const PRUNE_INTERVAL_SECONDS = 60 * 60;

/** 本地缓存元数据。 */
interface LocalCacheEntry {
	contentHash: string;
	fileId?: string;
	expiresAt?: number;
}

/** 从 MIME 推断扩展名。 */
function extFromMime(mime: string): string {
	const map: Record<string, string> = {
		'image/png': '.png',
		'image/jpeg': '.jpg',
		'image/gif': '.gif',
		'image/webp': '.webp',
	};
	return map[mime] || '.img';
}

function sha256(data: Uint8Array): string {
	return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * 上传图片字节到 DeepSeek Files API。
 * @param apiKey DeepSeek API Key
 * @param baseUrl API 基础地址
 * @param data 图片字节
 * @param filename 文件名
 * @param expiresSeconds 云端过期秒数（0 = 永久）
 * @param token 可选的取消令牌；请求会响应取消并通过 AbortController 中断
 */
export async function uploadBytes(
	apiKey: string,
	baseUrl: string,
	data: Uint8Array,
	filename: string,
	expiresSeconds: number,
	token?: vscode.CancellationToken,
): Promise<DeepSeekFile> {
	const MAX_BYTES = 64 * 1024 * 1024;
	if (data.byteLength > MAX_BYTES) {
		throw new Error(
			`图片大小超过 64 MiB 上限（当前 ${(data.byteLength / 1024 / 1024).toFixed(2)} MiB）。`,
		);
	}

	// 用可选的取消令牌构建 AbortController，支持用户按 Esc 中断上传。
	const controller = new AbortController();
	const onCancel = () => controller.abort();
	let cancelDisposable: vscode.Disposable | undefined;
	if (token) {
		if (token.isCancellationRequested) {
			throw new Error('Files API upload cancelled');
		}
		cancelDisposable = token.onCancellationRequested(onCancel, undefined);
	}

	const form = new FormData();
	form.append('file', new Blob([Buffer.from(data)]), filename);
	form.append('purpose', 'user_data');
	if (expiresSeconds > 0) {
		// 防御性钳制到 API 允许范围（3600 ~ 2592000 秒），避免非法值导致 400。
		const safeExpires = Math.min(Math.max(expiresSeconds, MIN_CACHE_SECONDS), MAX_CACHE_SECONDS);
		form.append('expires_after[anchor]', 'created_at');
		form.append('expires_after[seconds]', String(safeExpires));
	}

	try {
		const response = await fetch(`${baseUrl}/files`, {
			method: 'POST',
			headers: { Authorization: `Bearer ${apiKey}` },
			body: form,
			signal: controller.signal,
		});

		if (!response.ok) {
			const body = await response.text();
			throw new Error(`Files API 上传失败（HTTP ${response.status}）：${body}`);
		}

		return (await response.json()) as DeepSeekFile;
	} finally {
		cancelDisposable?.dispose();
	}
}

/** 官方 `GET /files` 的分页响应。 */
interface DeepSeekFileListResponse {
	object: string;
	data: DeepSeekFile[];
	first_id?: string;
	last_id?: string;
	has_more?: boolean;
}

/**
 * 列出当前账号在 DeepSeek Files API 上已上传的文件（默认 1000 个，覆盖官方上限）。
 * @param apiKey DeepSeek API Key
 * @param baseUrl API 基础地址
 */
export async function listCloudFiles(apiKey: string, baseUrl: string): Promise<DeepSeekFile[]> {
	const response = await fetch(`${baseUrl}/files?limit=1000`, {
		method: 'GET',
		headers: { Authorization: `Bearer ${apiKey}` },
	});

	if (!response.ok) {
		const body = await response.text();
		throw new Error(`Files API 列出文件失败（HTTP ${response.status}）：${body}`);
	}

	const list = (await response.json()) as DeepSeekFileListResponse;
	return list.data ?? [];
}

/**
 * 删除 DeepSeek Files API 上的单个文件。
 * @param apiKey DeepSeek API Key
 * @param baseUrl API 基础地址
 * @param fileId 要删除的文件 ID（形如 `file-api-...`）
 */
export async function deleteCloudFile(
	apiKey: string,
	baseUrl: string,
	fileId: string,
): Promise<void> {
	const response = await fetch(`${baseUrl}/files/${encodeURIComponent(fileId)}`, {
		method: 'DELETE',
		headers: { Authorization: `Bearer ${apiKey}` },
	});

	if (!response.ok) {
		const body = await response.text();
		throw new Error(`Files API 删除文件失败（HTTP ${response.status}）：${body}`);
	}
}

/**
 * 清空当前账号在 DeepSeek Files API 上已上传的所有文件。
 * 遍历列出全部文件并逐个删除，返回删除的文件数量。
 * @param apiKey DeepSeek API Key
 * @param baseUrl API 基础地址
 */
export async function clearCloudFiles(apiKey: string, baseUrl: string): Promise<number> {
	const files = await listCloudFiles(apiKey, baseUrl);
	let deleted = 0;
	for (const file of files) {
		try {
			await deleteCloudFile(apiKey, baseUrl, file.id);
			deleted += 1;
		} catch (error) {
			// 单个文件删除失败时继续尝试删除其他文件，最后汇总结果。
			console.warn(`Failed to delete cloud file ${file.id}`, error);
		}
	}
	return deleted;
}

/**
 * 确保图片已上传到 Files API 并返回有效 file_id。
 * 本地按内容哈希缓存；云端缓存（默认 7 天）；云端缓存失效时自动重传。
 *
 * @param globalStorageUri 扩展全局存储根（用于本地缓存目录）
 * @param apiKey DeepSeek API Key
 * @param baseUrl API 基础地址
 * @param imageData 图片字节
 * @param mimeType 图片 MIME 类型
 * @param expiresSeconds 云端过期秒数（0 = 永久；默认使用 CLOUD_CACHE_SECONDS）
 * @param token 可选的取消令牌；上传过程会响应取消
 */
export async function ensureFileId(
	globalStorageUri: vscode.Uri,
	apiKey: string,
	baseUrl: string,
	imageData: Uint8Array,
	mimeType: string,
	expiresSeconds: number = CLOUD_CACHE_SECONDS,
	token?: vscode.CancellationToken,
): Promise<string> {
	if (token?.isCancellationRequested) {
		throw new Error('Files API upload cancelled');
	}

	const contentHash = sha256(imageData);
	const cacheDir = vscode.Uri.joinPath(globalStorageUri, 'image-cache');
	await vscode.workspace.fs.createDirectory(cacheDir);

	// 每次上传都顺带做一次过期清理（带时间门槛，不会每次都遍历目录）。
	// 永久文件（expiresSeconds <= 0）不触发本地清理，避免删除仍在复用的本地 meta。
	// 清理失败不影响主流程，只记录状态。
	if (expiresSeconds > 0) {
		void pruneLocalCache(globalStorageUri, expiresSeconds).catch(() => {
			// 非关键路径，忽略清理错误。
		});
	}

	const localPath = vscode.Uri.joinPath(cacheDir, `${contentHash}${extFromMime(mimeType)}`);
	const metaPath = vscode.Uri.joinPath(cacheDir, `${contentHash}.json`);

	// 写本地字节缓存（内容寻址，天然去重）
	await vscode.workspace.fs.writeFile(localPath, imageData);

	const entry = await readCacheEntry(metaPath);
	if (entry && entry.fileId) {
		const nowSec = Math.floor(Date.now() / 1000);
		// 永久文件（未设置 expires_at）视为永远有效，直接复用
		if (!entry.expiresAt) {
			// 重写元数据以刷新 mtime，避免被本地保留期清理误删。
			await writeCacheEntry(metaPath, entry);
			return entry.fileId;
		}
		// 云端缓存仍有效（且离过期还有 1 小时以上），直接复用
		if (entry.expiresAt - nowSec > EXPIRY_WARN_SECONDS) {
			// 重写元数据以刷新 mtime，避免被本地保留期清理误删。
			await writeCacheEntry(metaPath, entry);
			return entry.fileId;
		}
		// 即将过期或已失效：重新上传
	}

	const uploaded = await uploadBytes(
		apiKey,
		baseUrl,
		imageData,
		contentHash + extFromMime(mimeType),
		expiresSeconds,
		token,
	);

	const newEntry: LocalCacheEntry = {
		contentHash,
		fileId: uploaded.id,
		expiresAt: uploaded.expires_at,
	};
	await writeCacheEntry(metaPath, newEntry);

	return uploaded.id;
}

async function readCacheEntry(metaPath: vscode.Uri): Promise<LocalCacheEntry | undefined> {
	try {
		const raw = await vscode.workspace.fs.readFile(metaPath);
		return JSON.parse(Buffer.from(raw).toString('utf8')) as LocalCacheEntry;
	} catch {
		return undefined;
	}
}

async function writeCacheEntry(metaPath: vscode.Uri, entry: LocalCacheEntry): Promise<void> {
	await vscode.workspace.fs.writeFile(
		metaPath,
		Buffer.from(JSON.stringify(entry, null, 2), 'utf8'),
	);
}

/** 记录上一次清理的时间（Unix 秒），避免每次上传都触发目录遍历。 */
let lastPruneAt = 0;

/**
 * 清理本地图片缓存：删除超过保留期的 `.json` 元数据及其对应的图片文件。
 * 通过 `retentionSeconds` 控制保留时长（默认 7 天）。清理是幂等的，且带时间门槛。
 *
 * @param globalStorageUri 扩展全局存储根（用于定位 image-cache 目录）
 * @param retentionSeconds 保留时长（秒）。默认使用 LOCAL_CACHE_RETENTION_SECONDS。
 * @param force 为 true 时忽略时间门槛，立即执行（用于测试/手动触发）。
 * @returns 删除的缓存条目数量。
 */
export async function pruneLocalCache(
	globalStorageUri: vscode.Uri,
	retentionSeconds: number = LOCAL_CACHE_RETENTION_SECONDS,
	force = false,
): Promise<number> {
	if (!force) {
		const nowSec = Math.floor(Date.now() / 1000);
		// 距上次清理不足 PRUNE_INTERVAL_SECONDS 则跳过。
		if (nowSec - lastPruneAt < PRUNE_INTERVAL_SECONDS) {
			return 0;
		}
	}

	const cacheDir = vscode.Uri.joinPath(globalStorageUri, 'image-cache');
	let entries: [string, vscode.FileType][];
	try {
		entries = await vscode.workspace.fs.readDirectory(cacheDir);
	} catch {
		// 目录不存在（尚未上传过图片），无需清理。
		lastPruneAt = Math.floor(Date.now() / 1000);
		return 0;
	}

	const nowSec = Math.floor(Date.now() / 1000);
	let removed = 0;

	for (const [name, type] of entries) {
		if (type !== vscode.FileType.File || !name.endsWith('.json')) {
			continue;
		}

		const metaUri = vscode.Uri.joinPath(cacheDir, name);

		// 用元数据文件的修改时间（mtime）作为“最后使用时间”。
		// 每次 ensureFileId 命中复用都会重写 meta，因此 mtime 能反映最近使用。
		const stat = await vscode.workspace.fs.stat(metaUri);
		const mtimeSec = Math.floor(stat.mtime / 1000);
		// 超过保留期（默认 7 天）未使用的条目视为过期。
		if (nowSec - mtimeSec <= retentionSeconds) {
			continue;
		}

		// meta 文件名形如 `<hash>.json`，对应图片文件为 `<hash>.<ext>`。
		// 图片扩展名未存进 meta，因此通过扫描同目录中同前缀（去掉 .json）的图片文件来定位。
		const imagePrefix = name.slice(0, -'.json'.length);
		try {
			await vscode.workspace.fs.delete(metaUri, { recursive: false });
			for (const [candidate, candidateType] of entries) {
				if (
					candidateType === vscode.FileType.File &&
					candidate.startsWith(imagePrefix) &&
					candidate !== name &&
					!candidate.endsWith('.json')
				) {
					const imageUri = vscode.Uri.joinPath(cacheDir, candidate);
					try {
						await vscode.workspace.fs.delete(imageUri, { recursive: false });
					} catch {
						// 单张图片删除失败时继续尝试删除其他匹配文件。
					}
				}
			}
			removed += 1;
		} catch {
			// 删除失败时跳过，不影响其他条目。
		}
	}

	lastPruneAt = Math.floor(Date.now() / 1000);
	return removed;
}

/**
 * 清空本地图片缓存目录（递归删除整个 image-cache 并重建）。
 * 在清空云端缓存后调用，确保本地 meta 不会引用已删除的 file_id。
 *
 * @param globalStorageUri 扩展全局存储根
 */
export async function clearLocalCache(globalStorageUri: vscode.Uri): Promise<void> {
	const cacheDir = vscode.Uri.joinPath(globalStorageUri, 'image-cache');
	try {
		await vscode.workspace.fs.delete(cacheDir, { recursive: true });
	} catch {
		// 目录不存在（尚未上传过图片），无需处理。
	}
	await vscode.workspace.fs.createDirectory(cacheDir);
	lastPruneAt = Math.floor(Date.now() / 1000);
}
