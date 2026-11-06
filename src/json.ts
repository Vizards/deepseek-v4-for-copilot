const REPLACEMENT_CHARACTER = '\uFFFD';
const LONE_SURROGATE_PATTERN = /([\uD800-\uDBFF][\uDC00-\uDFFF])|[\uD800-\uDFFF]/g;

type WellFormedString = string & {
	toWellFormed?: () => string;
};

export function safeStringify(value: unknown): string {
	const json = JSON.stringify(value, (_key, entryValue: unknown) => {
		if (typeof entryValue === 'string') {
			return toWellFormedString(entryValue);
		}
		return entryValue;
	});

	if (json === undefined) {
		throw new TypeError('Value cannot be serialized as JSON');
	}

	return json;
}

/** `JSON.stringify` with sorted object keys, so equal shapes serialize identically. */
export function stableStringify(value: unknown): string {
	if (value === null || typeof value !== 'object') {
		return JSON.stringify(value) ?? 'null';
	}

	if (Array.isArray(value)) {
		return `[${value.map(stableStringify).join(',')}]`;
	}

	const entries = Object.entries(value as Record<string, unknown>)
		.filter(([, entryValue]) => entryValue !== undefined)
		.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));

	return `{${entries
		.map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`)
		.join(',')}}`;
}

export function toWellFormedString(value: string): string {
	const toWellFormed = (value as WellFormedString).toWellFormed;
	if (typeof toWellFormed === 'function') {
		return toWellFormed.call(value);
	}

	return value.replace(LONE_SURROGATE_PATTERN, (_match, pair: string | undefined) =>
		pair ? pair : REPLACEMENT_CHARACTER,
	);
}
