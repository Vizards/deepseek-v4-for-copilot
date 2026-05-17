import { MODELS } from '../../consts';

export const REPLAY_MARKER_MIME = 'stateful_marker';
export const REPLAY_MARKER_WRITER_ID = 'deepseek-copilot';
export const REPLAY_MARKER_PREFIXES = new Set([
	REPLAY_MARKER_WRITER_ID,
	...MODELS.map((model) => model.id),
]);
export const ENCODED_JSON_MARKER_PREFIX = 'json:';
export const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
export const LEGACY_SEGMENT_ID_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
