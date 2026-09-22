import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
    getDeepSeekTariffState,
    getDeepSeekTariffWindowsFromPricingFootnote,
    getNextDeepSeekTariffTransition,
    hasDeepSeekTariffScheduleChanged,
} from './tariff';

describe('DeepSeek tariff logic', () => {
	it('marks weekdays peak windows as 2x pricing', () => {
		const peak = new Date('2026-08-24T02:30:00Z');
		assert.equal(getDeepSeekTariffState(peak), 'peak');
	});

	it('marks non-peak times as half price', () => {
		const offPeak = new Date('2026-08-24T05:00:00Z');
		assert.equal(getDeepSeekTariffState(offPeak), 'offpeak');
	});

	it('treats Chinese public holidays as off-peak on weekdays', () => {
		// 2026-09-25 (Friday) and 2026-10-01 (Thursday) are both inside peak windows.
		assert.equal(getDeepSeekTariffState(new Date('2026-09-25T02:30:00Z')), 'offpeak');
		assert.equal(getDeepSeekTariffState(new Date('2026-10-01T07:00:00Z')), 'offpeak');
	});

	it('keeps the weekday schedule unchanged outside holidays', () => {
		assert.equal(getDeepSeekTariffState(new Date('2026-09-24T02:30:00Z')), 'peak');
		// 2026-09-20 is a published makeup workday, but it is a Sunday, and the
		// pricing page keeps weekends off-peak in full.
		assert.equal(getDeepSeekTariffState(new Date('2026-09-20T02:30:00Z')), 'offpeak');
	});

	it('skips holiday and weekend days when finding the next transition', () => {
		const next = getNextDeepSeekTariffTransition(new Date('2026-09-25T03:30:00Z'));
		assert.ok(next);
		assert.equal(next.to, 'peak');
		assert.equal(next.at.toISOString(), '2026-09-28T01:00:00.000Z');
	});

	it('finds the next transition for a state change', () => {
		const now = new Date('2026-08-24T03:30:00Z');
		const next = getNextDeepSeekTariffTransition(now);
		assert.ok(next);
		assert.equal(next.to, 'offpeak');
		assert.equal(next.at.getUTCHours(), 4);
	});

	it('parses the pricing page footnote window schedule', () => {
		const windows = getDeepSeekTariffWindowsFromPricingFootnote(
			'(1) Off-peak rates are half of the peak rates. Peak hours are 01:00 - 04:00 and 06:00 - 10:00 UTC, Monday through Friday (all other hours are off-peak).',
		);
		assert.deepEqual(windows, [
			{ startHourUtc: 1, endHourUtc: 4 },
			{ startHourUtc: 6, endHourUtc: 10 },
		]);
	});

	it('parses the pricing page when the note appears elsewhere on the page', () => {
		const windows = getDeepSeekTariffWindowsFromPricingFootnote(
			'Pricing details box\nImportant note: Peak hours are 01:00 - 04:00 and 06:00 - 10:00 UTC, Monday through Friday (all other hours are off-peak).\nMore pricing tables below.',
		);
		assert.deepEqual(windows, [
			{ startHourUtc: 1, endHourUtc: 4 },
			{ startHourUtc: 6, endHourUtc: 10 },
		]);
	});

	it('parses the current live pricing page footnote', () => {
		const windows = getDeepSeekTariffWindowsFromPricingFootnote(
			'(2) Off-peak rates are half of the peak rates. Peak hours are 01:00 - 04:00 and 06:00 - 10:00 UTC, Monday through Friday, excluding Chinese public holidays. All other hours are off-peak, including weekends and Chinese public holidays in full.',
		);
		assert.deepEqual(windows, [
			{ startHourUtc: 1, endHourUtc: 4 },
			{ startHourUtc: 6, endHourUtc: 10 },
		]);
	});

	it('matches the built-in schedule so no false change is reported', () => {
		assert.equal(
			hasDeepSeekTariffScheduleChanged(
				'(2) Off-peak rates are half of the peak rates. Peak hours are 01:00 - 04:00 and 06:00 - 10:00 UTC, Monday through Friday, excluding Chinese public holidays. All other hours are off-peak, including weekends and Chinese public holidays in full.',
			),
			false,
		);
	});

	it('detects when the pricing website schedule changes from the footnote', () => {
		assert.equal(
			hasDeepSeekTariffScheduleChanged(
				'(1) Off-peak rates are half of the peak rates. Peak hours are 01:00 - 04:00 and 06:00 - 10:00 UTC, Monday through Friday (all other hours are off-peak).',
			),
			false,
		);
		assert.equal(
			hasDeepSeekTariffScheduleChanged(
				'(1) Off-peak rates are half of the peak rates. Peak hours are 00:00 - 03:00 and 05:00 - 09:00 UTC, Monday through Friday (all other hours are off-peak).',
			),
			true,
		);
	});
});
