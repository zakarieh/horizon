/**
 * Period mathematics for the five period-scoped levels.
 *
 * The stored period strings are:
 *
 * | Level     | Format          | Example      |
 * |-----------|-----------------|--------------|
 * | daily     | `yyyy-MM-dd`    | `2026-09-28` |
 * | weekly    | `yyyy-'W'ww`    | `2026-W40`   |
 * | monthly   | `yyyy-MM`       | `2026-09`    |
 * | quarterly | `yyyy-'Q'q`      | `2026-Q4`    |
 * | yearly    | `yyyy`          | `2026`       |
 *
 * Weeks are ISO 8601 weeks: they start on Monday, and the week-numbering year
 * is not always the calendar year (`2021-01-01` belongs to `2020-W53`). That
 * year-boundary behaviour is delegated to `date-fns` and pinned down by tests,
 * including the 53-week years 2015, 2020, 2026 and 2032.
 *
 * All dates are built with the local `Date` constructor and only ever compared
 * against other local dates, so the module is timezone-independent as long as
 * callers do the same.
 */

import {
	addDays,
	addMonths,
	addWeeks,
	addYears,
	format,
	getISOWeeksInYear,
	setISOWeek,
	startOfISOWeek,
} from "date-fns";
import { enUS } from "date-fns/locale";
import { isPeriodLevel, type Level, type PeriodLevel } from "./types";

/** Label of the objectives board, which is not bound to a period. */
export const OBJECTIVE_BOARD_LABEL = "Objectives";

const DATE_FORMAT = "yyyy-MM-dd";
const WEEK_FORMAT = "RRRR-'W'II";
const MONTH_FORMAT = "yyyy-MM";
const QUARTER_FORMAT = "yyyy-'Q'q";
const YEAR_FORMAT = "yyyy";

const DAILY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const WEEKLY_RE = /^(\d{4})-W(\d{2})$/;
const MONTHLY_RE = /^(\d{4})-(\d{2})$/;
const QUARTERLY_RE = /^(\d{4})-Q(\d)$/;
const YEARLY_RE = /^(\d{4})$/;

/** A half-open `[start, endExclusive)` range covering one period. */
export interface PeriodBounds {
	/** First instant of the period, at local midnight. */
	start: Date;
	/** First instant of the *next* period, excluded from the range. */
	endExclusive: Date;
}

function isRealCalendarDate(year: number, month: number, day: number): boolean {
	const probe = new Date(year, month - 1, day);
	return (
		probe.getFullYear() === year &&
		probe.getMonth() === month - 1 &&
		probe.getDate() === day
	);
}

/**
 * Narrows a level to a period-scoped one.
 *
 * @throws When `level` is `objective`, which has no period by design.
 */
function assertPeriodLevel(level: Level): PeriodLevel {
	if (!isPeriodLevel(level)) {
		throw new Error(`Level "${level}" is not period-scoped; objectives have no period.`);
	}
	return level;
}

/**
 * Converts a period string into a canonical representative date.
 *
 * The anchor is the first instant of the period (the Monday of an ISO week, the
 * first day of a month/quarter/year), which makes all further maths trivial and
 * comparison safe.
 *
 * @throws When the period string is malformed or out of range for the level.
 */
export function periodToAnchorDate(period: string, level: Level): Date {
	const scoped = assertPeriodLevel(level);

	switch (scoped) {
		case "daily": {
			const match = DAILY_RE.exec(period);
			if (!match) {
				throw new Error(`Invalid daily period "${period}"; expected yyyy-MM-dd.`);
			}
			const year = Number(match[1]);
			const month = Number(match[2]);
			const day = Number(match[3]);
			if (!isRealCalendarDate(year, month, day)) {
				throw new Error(`Invalid daily period "${period}"; that date does not exist.`);
			}
			return new Date(year, month - 1, day);
		}
		case "weekly": {
			const match = WEEKLY_RE.exec(period);
			if (!match) {
				throw new Error(`Invalid weekly period "${period}"; expected yyyy-Www.`);
			}
			const year = Number(match[1]);
			const week = Number(match[2]);
			// 4 January is always in ISO week 1 of its week-numbering year.
			const jan4 = new Date(year, 0, 4);
			const weeksInYear = getISOWeeksInYear(jan4);
			if (week < 1 || week > weeksInYear) {
				throw new Error(
					`Invalid weekly period "${period}"; ${year} has ${weeksInYear} ISO weeks.`,
				);
			}
			return startOfISOWeek(setISOWeek(jan4, week));
		}
		case "monthly": {
			const match = MONTHLY_RE.exec(period);
			if (!match) {
				throw new Error(`Invalid monthly period "${period}"; expected yyyy-MM.`);
			}
			const year = Number(match[1]);
			const month = Number(match[2]);
			if (month < 1 || month > 12) {
				throw new Error(`Invalid monthly period "${period}"; month must be 01-12.`);
			}
			return new Date(year, month - 1, 1);
		}
		case "quarterly": {
			const match = QUARTERLY_RE.exec(period);
			if (!match) {
				throw new Error(`Invalid quarterly period "${period}"; expected yyyy-Qq.`);
			}
			const year = Number(match[1]);
			const quarter = Number(match[2]);
			if (quarter < 1 || quarter > 4) {
				throw new Error(
					`Invalid quarterly period "${period}"; quarter must be Q1-Q4.`,
				);
			}
			return new Date(year, (quarter - 1) * 3, 1);
		}
		case "yearly": {
			const match = YEARLY_RE.exec(period);
			if (!match) {
				throw new Error(`Invalid yearly period "${period}"; expected yyyy.`);
			}
			return new Date(Number(match[1]), 0, 1);
		}
		default: {
			throw new Error(`Unsupported level "${String(scoped)}".`);
		}
	}
}

/**
 * The period a date falls into.
 *
 * @param date Any date.
 * @param level The horizon to project onto.
 * @returns The period string, or `null` for `objective`, which is not timed.
 */
export function getPeriodFor(date: Date, level: PeriodLevel): string;
export function getPeriodFor(date: Date, level: "objective"): null;
export function getPeriodFor(date: Date, level: Level): string | null;
export function getPeriodFor(date: Date, level: Level): string | null {
	switch (level) {
		case "objective":
			return null;
		case "daily":
			return format(date, DATE_FORMAT);
		case "weekly":
			return format(date, WEEK_FORMAT);
		case "monthly":
			return format(date, MONTH_FORMAT);
		case "quarterly":
			return format(date, QUARTER_FORMAT);
		case "yearly":
			return format(date, YEAR_FORMAT);
		default:
			throw new Error(`Unsupported level "${String(level)}".`);
	}
}

/**
 * Moves a period anchor forward (or backward) by `steps` periods.
 *
 * Quarters step three months at a time, which keeps the anchor on the first day
 * of the quarter even across year boundaries.
 */
function advanceAnchor(anchor: Date, level: PeriodLevel, steps: number): Date {
	switch (level) {
		case "daily":
			return addDays(anchor, steps);
		case "weekly":
			return addWeeks(anchor, steps);
		case "monthly":
			return addMonths(anchor, steps);
		case "quarterly":
			return addMonths(anchor, steps * 3);
		case "yearly":
			return addYears(anchor, steps);
		default:
			throw new Error(`Unsupported level "${String(level)}".`);
	}
}

/**
 * The period `delta` steps away from `period`. `delta` may be negative.
 *
 * @throws When the level is `objective` or `period` is malformed.
 */
export function shiftPeriod(period: string, level: Level, delta: number): string {
	const scoped = assertPeriodLevel(level);
	if (!Number.isInteger(delta)) {
		throw new Error(`delta must be an integer, got ${String(delta)}.`);
	}
	if (delta === 0) {
		return period;
	}

	const anchor = periodToAnchorDate(period, scoped);
	return getPeriodFor(advanceAnchor(anchor, scoped, delta), scoped);
}

/**
 * The period immediately after `period`, crossing year boundaries correctly.
 *
 * @example nextPeriod("2026-W53", "weekly") === "2027-W01"
 */
export function nextPeriod(period: string, level: Level): string {
	return shiftPeriod(period, level, 1);
}

/**
 * The period immediately before `period`, crossing year boundaries correctly.
 *
 * @example prevPeriod("2021-W01", "weekly") === "2020-W53"
 */
export function prevPeriod(period: string, level: Level): string {
	return shiftPeriod(period, level, -1);
}

/**
 * The period that contains `date`, using the current time by default.
 */
export function getCurrentPeriod(level: PeriodLevel, now: Date = new Date()): string {
	return getPeriodFor(now, level);
}

/**
 * Whether `period` is a syntactically valid, in-range period for `level`.
 *
 * `objective` is valid only with a `null` period.
 */
export function isValidPeriod(period: string | null, level: Level): boolean {
	if (!isPeriodLevel(level)) {
		return period === null;
	}
	if (period === null) {
		return false;
	}
	try {
		periodToAnchorDate(period, level);
		return true;
	} catch {
		return false;
	}
}

/**
 * The half-open date range covered by `period`.
 *
 * @throws When the level is `objective` or `period` is malformed.
 */
export function getPeriodBounds(period: string, level: Level): PeriodBounds {
	const scoped = assertPeriodLevel(level);
	return {
		start: periodToAnchorDate(period, scoped),
		endExclusive: periodToAnchorDate(shiftPeriod(period, scoped, 1), scoped),
	};
}

/**
 * Whether `date` falls inside `period`. Used by the rollover banner to detect
 * that "this week" is a period the board is already showing.
 *
 * @throws When the level is `objective` or `period` is malformed.
 */
export function isDateInPeriod(date: Date, period: string, level: Level): boolean {
	const bounds = getPeriodBounds(period, level);
	const time = date.getTime();
	return time >= bounds.start.getTime() && time < bounds.endExclusive.getTime();
}

/**
 * Orders two periods of the same level. Period strings are zero-padded and
 * fixed-width, so lexical comparison is already chronological; this exists to
 * compare by anchor date and to tolerate differently-shaped-but-valid input.
 *
 * @returns A negative number when `a` is earlier than `b`, `0` when equal.
 */
export function comparePeriods(a: string, b: string, level: Level): number {
	const anchorA = periodToAnchorDate(a, level).getTime();
	const anchorB = periodToAnchorDate(b, level).getTime();
	return anchorA === anchorB ? 0 : anchorA < anchorB ? -1 : 1;
}

/**
 * A human readable label for the board header, e.g. `Mon, 28 Sep 2026`,
 * `Week 40 · 28 Sep – 4 Oct 2026`, `September 2026`, `Q4 2026` or `2026`.
 *
 * The locale is pinned to `en-US` so labels are deterministic in tests; a
 * localised build can pass its own `date-fns` locale through a later change.
 */
export function formatPeriodLabel(period: string | null, level: Level): string {
	if (!isPeriodLevel(level)) {
		return OBJECTIVE_BOARD_LABEL;
	}
	if (period === null) {
		return OBJECTIVE_BOARD_LABEL;
	}

	const anchor = periodToAnchorDate(period, level);
	switch (level) {
		case "daily":
			return format(anchor, "EEE, d MMM yyyy", { locale: enUS });
		case "weekly": {
			const week = Number(WEEKLY_RE.exec(period)?.[2] ?? 0);
			const end = addDays(anchor, 6);
			const range = `${format(anchor, "d MMM", { locale: enUS })} – ${format(end, "d MMM yyyy", { locale: enUS })}`;
			return `Week ${week} · ${range}`;
		}
		case "monthly":
			return format(anchor, "MMMM yyyy", { locale: enUS });
		case "quarterly":
			return `Q${(QUARTERLY_RE.exec(period)?.[2] ?? "?")} ${String(anchor.getFullYear())}`;
		case "yearly":
			return String(anchor.getFullYear());
		default:
			throw new Error(`Unsupported level "${String(level)}".`);
	}
}

/**
 * Re-expresses a period on another horizon, keeping the same point in time.
 *
 * Used when a task's level changes: a daily task on `2026-09-28` becomes
 * `2026-W40` rather than losing its period, so changing horizon preserves the
 * intent instead of resetting it.
 *
 * @param period The period to convert, or `null` when there is none.
 * @param from The horizon `period` belongs to.
 * @param to The horizon to convert to.
 * @param reference Date used when there is nothing to convert, normally today.
 * @returns The converted period, or `null` when `to` is `objective`.
 */
export function convertPeriod(
	period: string | null,
	from: Level,
	to: Level,
	reference: Date = new Date(),
): string | null {
	if (!isPeriodLevel(to)) {
		return null;
	}
	if (period === null || !isPeriodLevel(from) || !isValidPeriod(period, from)) {
		return getPeriodFor(reference, to);
	}
	return getPeriodFor(periodToAnchorDate(period, from), to);
}
