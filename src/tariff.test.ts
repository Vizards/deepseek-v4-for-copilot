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
