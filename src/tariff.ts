export type DeepSeekTariffState = 'peak' | 'offpeak';

export interface DeepSeekTariffWindow {
	readonly startHourUtc: number;
	readonly endHourUtc: number;
}

export interface DeepSeekTariffTransition {
	readonly from: DeepSeekTariffState;
	readonly to: DeepSeekTariffState;
	readonly at: Date;
	readonly remainingMs: number;
}

const DEFAULT_PEAK_WINDOWS: readonly DeepSeekTariffWindow[] = [
	{ startHourUtc: 1, endHourUtc: 4 },
	{ startHourUtc: 6, endHourUtc: 10 },
] as const;

export interface DeepSeekTariffScheduleSnapshot {
	readonly windows: readonly DeepSeekTariffWindow[];
	readonly footnote: string;
	readonly updatedAt: number;
}

const DEEPSEEK_TARIFF_SCHEDULE_KEY = 'deepseek-copilot.tariff.schedule';

let activePeakWindows: readonly DeepSeekTariffWindow[] = DEFAULT_PEAK_WINDOWS;

export function getDeepSeekTariffWindows(): readonly DeepSeekTariffWindow[] {
	return activePeakWindows;
}

export function setDeepSeekTariffWindows(windows: readonly DeepSeekTariffWindow[]): void {
	if (windows.length === 0) {
		return;
	}
	activePeakWindows = [...windows].sort((a, b) => a.startHourUtc - b.startHourUtc);
}

export function getDeepSeekTariffWindowsFromPricingFootnote(
	text: string | undefined | null,
): DeepSeekTariffWindow[] {
	if (!text) {
		return [];
	}

	const normalized = text.replace(/\s+/g, ' ').trim();
	const match = normalized.match(
		/peak hours are\s+(.+?)(?:\s+utc|$)/i,
	);
	if (!match) {
		return [];
	}

	const ranges = match[1].matchAll(/(\d{1,2})(?::(\d{2}))?\s*-\s*(\d{1,2})(?::(\d{2}))?/g);
	const windows: DeepSeekTariffWindow[] = [];
	for (const range of ranges) {
		const startHour = parseHourUtc(range[1], range[2]);
		const endHour = parseHourUtc(range[3], range[4]);
		if (Number.isFinite(startHour) && Number.isFinite(endHour)) {
			windows.push({
				startHourUtc: startHour,
				endHourUtc: endHour,
			});
		}
	}

	return windows.sort((a, b) => a.startHourUtc - b.startHourUtc);
}

export function hasDeepSeekTariffScheduleChanged(text: string | undefined | null): boolean {
	const parsed = getDeepSeekTariffWindowsFromPricingFootnote(text);
	if (parsed.length === 0) {
		return false;
	}

	return !isDeepSeekTariffWindowListEqual(parsed, getDeepSeekTariffWindows());
}

function parseHourUtc(hourText: string | undefined, minuteText: string | undefined): number {
	const hour = Number.parseInt(hourText ?? '', 10);
	if (!Number.isFinite(hour) || hour < 0 || hour > 23) {
		return Number.NaN;
	}

	const minute = Number.parseInt(minuteText ?? '', 10);
	if (minuteText !== undefined && (!Number.isFinite(minute) || minute < 0 || minute > 59)) {
		return Number.NaN;
	}

	return hour + (minuteText === undefined ? 0 : minute / 60);
}

function isDeepSeekTariffWindowListEqual(
	left: readonly DeepSeekTariffWindow[],
	right: readonly DeepSeekTariffWindow[],
): boolean {
	if (left.length !== right.length) {
		return false;
	}

	for (let index = 0; index < left.length; index += 1) {
		if (
			left[index].startHourUtc !== right[index].startHourUtc ||
			left[index].endHourUtc !== right[index].endHourUtc
		) {
			return false;
		}
	}

	return true;
}

function isWeekendUtc(date: Date): boolean {
	const day = date.getUTCDay();
	return day === 0 || day === 6;
}

function getUtcHourFraction(date: Date): number {
	return date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
}

function isInPeakWindow(hour: number): boolean {
	return getDeepSeekTariffWindows().some(
		(window) => hour >= window.startHourUtc && hour < window.endHourUtc,
	);
}

export function getDeepSeekTariffState(date: Date): DeepSeekTariffState {
	if (isWeekendUtc(date)) {
		return 'offpeak';
	}

	const windows = getDeepSeekTariffWindows();
	const fraction = getUtcHourFraction(date);
	const isPeak = windows.some((window) => fraction >= window.startHourUtc && fraction < window.endHourUtc);
	return isPeak ? 'peak' : 'offpeak';
}

export function getNextDeepSeekTariffTransition(now: Date): DeepSeekTariffTransition | undefined {
	const candidates: Date[] = [];
	const startOfDay = new Date(
		Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
	);
	const windows = getDeepSeekTariffWindows();

	for (let dayOffset = 0; dayOffset <= 10; dayOffset += 1) {
		const day = new Date(startOfDay.getTime() + dayOffset * 24 * 60 * 60 * 1000);
		candidates.push(new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 0, 0, 0)));
		for (const window of windows) {
			candidates.push(
				new Date(
					Date.UTC(
						day.getUTCFullYear(),
						day.getUTCMonth(),
						day.getUTCDate(),
						window.startHourUtc,
						0,
						0,
					),
				),
			);
			candidates.push(
				new Date(
					Date.UTC(
						day.getUTCFullYear(),
						day.getUTCMonth(),
						day.getUTCDate(),
						window.endHourUtc,
						0,
						0,
					),
				),
			);
		}
	}

	for (const candidate of [...candidates]
		.filter((item) => item.getTime() > now.getTime())
		.sort((a, b) => a.getTime() - b.getTime())) {
		const before = getDeepSeekTariffState(new Date(candidate.getTime() - 60_000));
		const after = getDeepSeekTariffState(new Date(candidate.getTime() + 60_000));
		if (before !== after) {
			return {
				from: before,
				to: after,
				at: candidate,
				remainingMs: Math.max(candidate.getTime() - now.getTime(), 0),
			};
		}
	}

	return undefined;
}

export function formatDeepSeekTariffRemaining(ms: number): string {
	const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = totalSeconds % 60;
	return `${hours}h ${minutes}m ${seconds}s`;
}

export function getDeepSeekTariffStatusText(now: Date = new Date()): string {
	const state = getDeepSeekTariffState(now);
	const nextTransition = getNextDeepSeekTariffTransition(now);
	const billing = state === 'peak' ? '2x price' : '1/2 price';
	const countdown = nextTransition ? formatDeepSeekTariffRemaining(nextTransition.remainingMs) : '—';
	return `${state === 'peak' ? 'PEAK' : 'OFF-PEAK'} (${billing}) • ${countdown}`;
}

export async function refreshDeepSeekTariffWindowsFromPricingPage(
	pageUrl: string = 'https://api-docs.deepseek.com/quick_start/pricing',
	storage?: {
		get<T>(key: string): T | undefined;
		update<T>(key: string, value: T): Thenable<void>;
	},
): Promise<readonly DeepSeekTariffWindow[]> {
	try {
		const response = await fetch(pageUrl, {
			headers: {
				Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
			},
		});
		if (!response.ok) {
			throw new Error(`HTTP ${response.status}`);
		}
		const html = await response.text();
		const footnote = extractPricingFootnote(html);
		const parsed = getDeepSeekTariffWindowsFromPricingFootnote(footnote);
		const snapshot = storage?.get<DeepSeekTariffScheduleSnapshot>(DEEPSEEK_TARIFF_SCHEDULE_KEY);
		if (snapshot && snapshot.footnote && snapshot.windows.length > 0) {
			if (!isDeepSeekTariffWindowListEqual(snapshot.windows, parsed)) {
				setDeepSeekTariffWindows(parsed);
			}
		}
		if (parsed.length > 0 && hasDeepSeekTariffScheduleChanged(footnote)) {
			setDeepSeekTariffWindows(parsed);
		}
		if (storage && footnote && parsed.length > 0) {
			void storage.update(DEEPSEEK_TARIFF_SCHEDULE_KEY, {
				windows: parsed,
				footnote,
				updatedAt: Date.now(),
			});
		}
		return getDeepSeekTariffWindows();
	} catch {
		if (storage) {
			const snapshot = storage.get<DeepSeekTariffScheduleSnapshot>(DEEPSEEK_TARIFF_SCHEDULE_KEY);
			if (snapshot && snapshot.windows.length > 0) {
				setDeepSeekTariffWindows(snapshot.windows);
			}
		}
		return getDeepSeekTariffWindows();
	}
}

export function getDeepSeekTariffScheduleSnapshot(
	storage?: {
		get<T>(key: string): T | undefined;
	},
): DeepSeekTariffScheduleSnapshot | undefined {
	return storage?.get<DeepSeekTariffScheduleSnapshot>(DEEPSEEK_TARIFF_SCHEDULE_KEY);
}

function extractPricingFootnote(html: string): string | undefined {
	const text = html.replace(/<script[\s\S]*?<\/script>/gi, ' ');
	const body = text.replace(/<style[\s\S]*?<\/style>/gi, ' ');
	const plainText = body
		.replace(/<[^>]+>/g, ' ')
		.replace(/&nbsp;/gi, ' ')
		.replace(/&amp;/gi, '&')
		.replace(/&#39;/gi, "'")
		.replace(/\s+/g, ' ')
		.trim();

		const markerIndex = plainText.search(/peak\s+hours?\s+are/i);
	if (markerIndex === -1) {
		return undefined;
	}

	const fromMarker = plainText.slice(markerIndex);
	const sentenceMatch = fromMarker.match(/peak\s+hours?\s+are\s+([^\n]+?)(?:\.|\)|\]|$)/i);
	if (!sentenceMatch) {
		return undefined;
	}

	return sentenceMatch[0];
}
