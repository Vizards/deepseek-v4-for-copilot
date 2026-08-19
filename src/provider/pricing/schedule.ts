/**
 * DeepSeek V4 peak/off-peak billing windows.
 *
 * The official pricing page defines peak hours as 01:00-04:00 and
 * 06:00-10:00 UTC. Keep this calculation in UTC so the displayed period
 * does not depend on the user's local timezone or daylight-saving rules.
 */

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const MIN_TIMER_DELAY_MS = 1000;
const TRANSITION_HOURS_UTC = [1, 4, 6, 10] as const;

export type PricingPeriod = 'offPeak' | 'peak';

export interface PricingPeriodSnapshot {
	readonly period: PricingPeriod;
	readonly nextTransitionAt: Date;
}

export function getPricingPeriod(now = new Date()): PricingPeriodSnapshot {
	const hour = now.getUTCHours();
	const period: PricingPeriod =
		(hour >= 1 && hour < 4) || (hour >= 6 && hour < 10) ? 'peak' : 'offPeak';
	const utcDayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
	const nowMs = now.getTime();

	const nextTransitionMs =
		TRANSITION_HOURS_UTC.map((transitionHour) => utcDayStart + transitionHour * HOUR_MS).find(
			(transitionMs) => transitionMs > nowMs,
		) ?? utcDayStart + DAY_MS + TRANSITION_HOURS_UTC[0] * HOUR_MS;

	return {
		period,
		nextTransitionAt: new Date(nextTransitionMs),
	};
}

export class PricingRefreshScheduler {
	private timer: ReturnType<typeof setTimeout> | undefined;
	private isDisposed = false;

	constructor(private readonly onTransition: () => void) {
		this.schedule();
	}

	dispose(): void {
		this.isDisposed = true;
		this.clearTimer();
	}

	private schedule(): void {
		if (this.isDisposed) {
			return;
		}

		const now = new Date();
		const { nextTransitionAt } = getPricingPeriod(now);
		const delay = Math.max(nextTransitionAt.getTime() - now.getTime(), MIN_TIMER_DELAY_MS);
		this.timer = setTimeout(() => {
			this.timer = undefined;
			if (this.isDisposed) {
				return;
			}
			this.onTransition();
			this.schedule();
		}, delay);
	}

	private clearTimer(): void {
		if (this.timer !== undefined) {
			clearTimeout(this.timer);
			this.timer = undefined;
		}
	}
}
