import type { VisionImagePart } from '../../types';

export function toBase64(image: VisionImagePart): string {
	return Buffer.from(image.data.buffer, image.data.byteOffset, image.data.byteLength).toString(
		'base64',
	);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
