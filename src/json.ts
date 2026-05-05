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
		throw new TypeError('Value cannot be serialized as a JSON request body');
	}

	return json;
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
