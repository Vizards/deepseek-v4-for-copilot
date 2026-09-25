/**
 * Chinese public holidays, which the DeepSeek pricing page excludes from peak
 * billing hours.
 *
 * Pricing page footnote, retrieved 2026-09-21: "Off-peak rates are half of the
 * peak rates. Peak hours are 01:00 - 04:00 and 06:00 - 10:00 UTC, Monday through
 * Friday, excluding Chinese public holidays. All other hours are off-peak,
 * including weekends and Chinese public holidays in full."
 *
 * A holiday is a Beijing calendar day, and both peak windows (01:00-04:00 and
 * 06:00-10:00 UTC) fall inside a single Beijing day, so the Beijing date is the
 * one to test.
 *
 * Makeup workdays are deliberately ignored. The page keeps weekends off-peak in
 * full, and every published makeup workday is a weekend day, so the weekend rule
 * already reports them as off-peak.
 *
 * The built-in list is a fallback for offline use. The published arrangement is
 * fetched so later years work without a code change.
 */

/** Application-wide memento surface used by the tariff modules. */
export interface TariffScheduleStorage {
	get<T>(key: string): T | undefined;
	update<T>(key: string, value: T): Thenable<void>;
}

export interface ChineseHolidayScheduleSnapshot {
	readonly dates: readonly string[];
	readonly updatedAt: number;
}

const HOLIDAY_SCHEDULE_KEY = 'deepseek-copilot.tariff.holidays';

/**
 * Community mirror of the State Council holiday arrangement. Each file lists
 * every day of that year with `isOffDay`, so makeup workdays are visible too.
 */
const HOLIDAY_DATASET_BASE_URL = 'https://raw.githubusercontent.com/NateScarlet/holiday-cn/master';

const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Published holiday days per year. A year fetched at runtime replaces its entry. */
const BUILT_IN_HOLIDAYS: Readonly<Record<string, readonly string[]>> = {
	'2025': [
		'2025-01-01',
		'2025-01-28',
		'2025-01-29',
		'2025-01-30',
		'2025-01-31',
		'2025-02-01',
		'2025-02-02',
		'2025-02-03',
		'2025-02-04',
		'2025-04-04',
		'2025-04-05',
		'2025-04-06',
		'2025-05-01',
		'2025-05-02',
		'2025-05-03',
		'2025-05-04',
		'2025-05-05',
		'2025-05-31',
		'2025-06-01',
		'2025-06-02',
		'2025-10-01',
		'2025-10-02',
		'2025-10-03',
		'2025-10-04',
		'2025-10-05',
		'2025-10-06',
		'2025-10-07',
		'2025-10-08',
	],
	'2026': [
		'2026-01-01',
		'2026-01-02',
		'2026-01-03',
		'2026-02-15',
		'2026-02-16',
		'2026-02-17',
		'2026-02-18',
		'2026-02-19',
		'2026-02-20',
		'2026-02-21',
		'2026-02-22',
		'2026-02-23',
		'2026-04-04',
		'2026-04-05',
		'2026-04-06',
		'2026-05-01',
		'2026-05-02',
		'2026-05-03',
		'2026-05-04',
		'2026-05-05',
		'2026-06-19',
		'2026-06-20',
		'2026-06-21',
		'2026-09-25',
		'2026-09-26',
		'2026-09-27',
		'2026-10-01',
		'2026-10-02',
		'2026-10-03',
		'2026-10-04',
		'2026-10-05',
		'2026-10-06',
		'2026-10-07',
	],
};

let activeHolidays: ReadonlySet<string> = new Set(mergeHolidayYears(BUILT_IN_HOLIDAYS, new Map()));

export function getChinesePublicHolidays(): ReadonlySet<string> {
	return activeHolidays;
}

export function setChinesePublicHolidays(dates: Iterable<string>): void {
	const valid = [...dates].filter((date) => DATE_PATTERN.test(date));
	if (valid.length === 0) {
		return;
	}
	activeHolidays = new Set(valid);
}

/** Calendar day in Beijing, the timezone the published holiday arrangement uses. */
export function getBeijingDateKey(date: Date): string {
	return new Date(date.getTime() + BEIJING_OFFSET_MS).toISOString().slice(0, 10);
}

export function isChinesePublicHoliday(date: Date): boolean {
	return activeHolidays.has(getBeijingDateKey(date));
}

/** Reads the `days[]` array of a holiday-cn dataset, keeping off days only. */
export function parseChineseHolidayDataset(payload: unknown): string[] {
	if (typeof payload !== 'object' || payload === null) {
		return [];
	}

	const days = (payload as { days?: unknown }).days;
	if (!Array.isArray(days)) {
		return [];
	}

	const dates: string[] = [];
	for (const day of days) {
		if (typeof day !== 'object' || day === null) {
			continue;
		}
		const { date, isOffDay } = day as { date?: unknown; isOffDay?: unknown };
		if (isOffDay === true && typeof date === 'string' && DATE_PATTERN.test(date)) {
			dates.push(date);
		}
	}

	return dates.sort();
}

export function getChineseHolidayScheduleSnapshot(
	storage?: TariffScheduleStorage,
): ChineseHolidayScheduleSnapshot | undefined {
	return storage?.get<ChineseHolidayScheduleSnapshot>(HOLIDAY_SCHEDULE_KEY);
}

/**
 * Fetches last, current, and next year's arrangement and caches the result.
 *
 * Individual years that cannot be fetched keep their cached or built-in dates,
 * so a failed request never makes the schedule less accurate than it already is.
 */
export async function refreshChinesePublicHolidaysFromWeb(
	storage?: TariffScheduleStorage,
	now: Date = new Date(),
	fetchImpl: typeof fetch = fetch,
): Promise<readonly string[]> {
	const thisYear = now.getUTCFullYear();
	const fetched = new Map<string, readonly string[]>();

	await Promise.all(
		[thisYear - 1, thisYear, thisYear + 1].map(async (year) => {
			try {
				const response = await fetchImpl(`${HOLIDAY_DATASET_BASE_URL}/${year}.json`, {
					headers: { Accept: 'application/json' },
				});
				if (!response.ok) {
					return;
				}
				const dates = parseChineseHolidayDataset(await response.json());
				if (dates.length > 0) {
					fetched.set(String(year), dates);
				}
			} catch {
				// Keep the cached or built-in dates for this year.
			}
		}),
	);

	const dates =
		fetched.size > 0
			? mergeHolidayYears(BUILT_IN_HOLIDAYS, fetched)
			: mergeHolidayYears(BUILT_IN_HOLIDAYS, cachedHolidayYears(storage));

	setChinesePublicHolidays(dates);
	if (fetched.size > 0 && storage) {
		void storage.update(HOLIDAY_SCHEDULE_KEY, { dates, updatedAt: Date.now() });
	}

	return dates;
}

function cachedHolidayYears(
	storage?: TariffScheduleStorage,
): ReadonlyMap<string, readonly string[]> {
	const snapshot = getChineseHolidayScheduleSnapshot(storage);
	const years = new Map<string, readonly string[]>();
	if (!snapshot) {
		return years;
	}

	for (const date of snapshot.dates) {
		const year = date.slice(0, 4);
		years.set(year, [...(years.get(year) ?? []), date]);
	}

	return years;
}

function mergeHolidayYears(
	builtIn: Readonly<Record<string, readonly string[]>>,
	fetched: ReadonlyMap<string, readonly string[]>,
): string[] {
	const dates = new Set<string>();

	for (const year of new Set([...Object.keys(builtIn), ...fetched.keys()])) {
		for (const date of fetched.get(year) ?? builtIn[year] ?? []) {
			if (DATE_PATTERN.test(date)) {
				dates.add(date);
			}
		}
	}

	return [...dates].sort();
}
