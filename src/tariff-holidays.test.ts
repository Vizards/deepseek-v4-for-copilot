import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';

import {
    type TariffScheduleStorage,
    getBeijingDateKey,
    getChineseHolidayScheduleSnapshot,
    getChinesePublicHolidays,
    isChinesePublicHoliday,
    parseChineseHolidayDataset,
    refreshChinesePublicHolidaysFromWeb,
    setChinesePublicHolidays,
} from './tariff-holidays';

function createStorage(): TariffScheduleStorage {
	const values = new Map<string, unknown>();
	return {
		get: <T>(key: string): T | undefined => values.get(key) as T | undefined,
		update: async <T>(key: string, value: T): Promise<void> => {
			values.set(key, value);
		},
	};
}

function stubFetch(datasets: Record<string, readonly string[]>): typeof fetch {
	return (async (input: string | URL | Request) => {
		const url = input.toString();
		const year = /(\d{4})\.json$/.exec(url)?.[1] ?? '';
		const dates = datasets[year];
		if (!dates) {
			return new Response('not found', { status: 404 });
		}

		const days = dates.map((date) => ({ name: 'holiday', date, isOffDay: true }));
		return new Response(JSON.stringify({ year: Number(year), days }), {
			status: 200,
			headers: { 'Content-Type': 'application/json' },
		});
	}) as typeof fetch;
}

function failingFetch(): typeof fetch {
	return (async () => {
		throw new Error('offline');
	}) as unknown as typeof fetch;
}

describe('DeepSeek tariff holiday calendar', () => {
	const builtIn = [...getChinesePublicHolidays()];
	after(() => {
		setChinesePublicHolidays(builtIn);
	});

	it('resolves the Beijing calendar day', () => {
		assert.equal(getBeijingDateKey(new Date('2026-09-30T16:00:00Z')), '2026-10-01');
		assert.equal(getBeijingDateKey(new Date('2026-09-30T15:59:00Z')), '2026-09-30');
	});

	it('recognizes built-in holiday dates', () => {
		assert.equal(isChinesePublicHoliday(new Date('2026-02-18T12:00:00Z')), true);
		assert.equal(isChinesePublicHoliday(new Date('2026-03-18T12:00:00Z')), false);
	});

	it('keeps only off days from a published dataset', () => {
		assert.deepEqual(
			parseChineseHolidayDataset({
				year: 2026,
				days: [
					{ name: '国庆节', date: '2026-10-02', isOffDay: true },
					{ name: '调休', date: '2026-10-10', isOffDay: false },
					{ name: 'bad date', date: 'nope', isOffDay: true },
					{ date: '2026-10-01', isOffDay: true },
				],
			}),
			['2026-10-01', '2026-10-02'],
		);
		assert.deepEqual(parseChineseHolidayDataset(null), []);
		assert.deepEqual(parseChineseHolidayDataset({ days: 'nope' }), []);
		assert.deepEqual(parseChineseHolidayDataset({ days: [null, 42] }), []);
	});

	it('replaces a built-in year with the fetched dataset', async () => {
		const storage = createStorage();
		const dates = await refreshChinesePublicHolidaysFromWeb(
			storage,
			new Date('2027-01-05T00:00:00Z'),
			stubFetch({ 2026: ['2026-01-01'], 2027: ['2027-02-06', '2027-02-07'] }),
		);

		assert.ok(dates.includes('2027-02-06'));
		assert.ok(!dates.includes('2026-10-01'));
		assert.equal(isChinesePublicHoliday(new Date('2027-02-06T02:30:00Z')), true);
		assert.deepEqual(getChineseHolidayScheduleSnapshot(storage)?.dates, dates);
	});

	it('falls back to the cached calendar when every request fails', async () => {
		const storage = createStorage();
		await refreshChinesePublicHolidaysFromWeb(
			storage,
			new Date('2028-01-05T00:00:00Z'),
			stubFetch({ 2028: ['2028-05-01'] }),
		);

		const dates = await refreshChinesePublicHolidaysFromWeb(
			storage,
			new Date('2028-01-05T00:00:00Z'),
			failingFetch(),
		);

		assert.ok(dates.includes('2028-05-01'));
		assert.equal(isChinesePublicHoliday(new Date('2028-05-01T02:30:00Z')), true);
	});
});
