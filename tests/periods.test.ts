import { describe, expect, it } from "vitest";

import {
	OBJECTIVE_BOARD_LABEL,
	PERIOD_LEVELS,
	comparePeriods,
	formatPeriodLabel,
	getCurrentPeriod,
	getPeriodBounds,
	getPeriodFor,
	isDateInPeriod,
	isValidPeriod,
	nextPeriod,
	periodToAnchorDate,
	prevPeriod,
	shiftPeriod,
	type PeriodLevel,
} from "../src/domain";

/** A Monday, and the date used throughout the expected-value tables. */
const MONDAY = new Date(2026, 8, 28);

describe("getPeriodFor", () => {
	it("projects a date onto every horizon", () => {
		expect(getPeriodFor(MONDAY, "daily")).toBe("2026-09-28");
		expect(getPeriodFor(MONDAY, "weekly")).toBe("2026-W40");
		expect(getPeriodFor(MONDAY, "monthly")).toBe("2026-09");
		expect(getPeriodFor(MONDAY, "quarterly")).toBe("2026-Q3");
		expect(getPeriodFor(MONDAY, "yearly")).toBe("2026");
	});

	it("returns null for objectives, which are not time bound", () => {
		expect(getPeriodFor(MONDAY, "objective")).toBeNull();
	});

	it("uses the ISO week-numbering year, not the calendar year", () => {
		// 1 Jan 2021 was a Friday, so it still belongs to the last week of 2020.
		expect(getPeriodFor(new Date(2021, 0, 1), "weekly")).toBe("2020-W53");
		// 1 Jan 2022 was a Saturday.
		expect(getPeriodFor(new Date(2022, 0, 1), "weekly")).toBe("2021-W52");
		// 30 Dec 2019 was a Monday and the first day of ISO week 2020-W01.
		expect(getPeriodFor(new Date(2019, 11, 30), "weekly")).toBe("2020-W01");
		// 2026 is a 53-week ISO year, so 1 Jan 2027 still belongs to 2026.
		expect(getPeriodFor(new Date(2027, 0, 1), "weekly")).toBe("2026-W53");
	});

	it("defaults to now for the current period", () => {
		expect(getCurrentPeriod("daily", MONDAY)).toBe("2026-09-28");
		expect(getCurrentPeriod("yearly", MONDAY)).toBe("2026");
	});
});

describe("nextPeriod and prevPeriod", () => {
	it("steps days across month, year and leap boundaries", () => {
		expect(nextPeriod("2026-09-28", "daily")).toBe("2026-09-29");
		expect(nextPeriod("2026-09-30", "daily")).toBe("2026-10-01");
		expect(nextPeriod("2026-12-31", "daily")).toBe("2027-01-01");
		expect(nextPeriod("2024-02-28", "daily")).toBe("2024-02-29");
		expect(nextPeriod("2024-02-29", "daily")).toBe("2024-03-01");
		expect(nextPeriod("2023-02-28", "daily")).toBe("2023-03-01");
		expect(prevPeriod("2027-01-01", "daily")).toBe("2026-12-31");
		expect(prevPeriod("2024-03-01", "daily")).toBe("2024-02-29");
	});

	it("steps ISO weeks across the 53-week boundary", () => {
		expect(nextPeriod("2026-W52", "weekly")).toBe("2026-W53");
		expect(nextPeriod("2026-W53", "weekly")).toBe("2027-W01");
		expect(prevPeriod("2027-W01", "weekly")).toBe("2026-W53");
		expect(prevPeriod("2021-W01", "weekly")).toBe("2020-W53");
		expect(nextPeriod("2020-W53", "weekly")).toBe("2021-W01");
		expect(nextPeriod("2015-W53", "weekly")).toBe("2016-W01");
	});

	it("steps months across the year boundary", () => {
		expect(nextPeriod("2026-09", "monthly")).toBe("2026-10");
		expect(nextPeriod("2026-12", "monthly")).toBe("2027-01");
		expect(prevPeriod("2026-01", "monthly")).toBe("2025-12");
	});

	it("steps quarters across the year boundary", () => {
		expect(nextPeriod("2026-Q3", "quarterly")).toBe("2026-Q4");
		expect(nextPeriod("2026-Q4", "quarterly")).toBe("2027-Q1");
		expect(prevPeriod("2026-Q1", "quarterly")).toBe("2025-Q4");
	});

	it("steps years", () => {
		expect(nextPeriod("2026", "yearly")).toBe("2027");
		expect(prevPeriod("2026", "yearly")).toBe("2025");
	});

	it("is a no-op for a zero shift and supports multi-step shifts", () => {
		for (const level of PERIOD_LEVELS) {
			const period = getPeriodFor(MONDAY, level);
			expect(shiftPeriod(period, level, 0)).toBe(period);
			expect(shiftPeriod(period, level, 1)).toBe(nextPeriod(period, level));
			expect(shiftPeriod(period, level, 3)).toBe(
				nextPeriod(nextPeriod(nextPeriod(period, level), level), level),
			);
		}
	});

	it("round-trips next and prev for every horizon across 400 consecutive days", () => {
		for (const level of PERIOD_LEVELS) {
			let date = new Date(2019, 11, 20);
			for (let step = 0; step < 400; step++) {
				const period = getPeriodFor(date, level);
				expect(prevPeriod(nextPeriod(period, level), level)).toBe(period);
				// Advancing the calendar never moves the period backwards.
				expect(nextPeriod(period, level) > period).toBe(true);
				date = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
			}
		}
	});

	it("rejects levels without periods and malformed periods", () => {
		expect(() => nextPeriod("2026", "objective")).toThrow(/not period-scoped/);
		expect(() => nextPeriod("2026-13", "monthly")).toThrow(/Invalid monthly period/);
		expect(() => nextPeriod("2026-W54", "weekly")).toThrow(/ISO weeks/);
		expect(() => prevPeriod("2026-02-30", "daily")).toThrow(/does not exist/);
		expect(() => shiftPeriod("2026-Q2", "quarterly", 1.5)).toThrow(/integer/);
	});
});

describe("periodToAnchorDate", () => {
	it("anchors periods on their first day", () => {
		expect(periodToAnchorDate("2026-W40", "weekly")).toEqual(new Date(2026, 8, 28));
		expect(periodToAnchorDate("2026-09", "monthly")).toEqual(new Date(2026, 8, 1));
		expect(periodToAnchorDate("2026-Q4", "quarterly")).toEqual(new Date(2026, 9, 1));
		expect(periodToAnchorDate("2026", "yearly")).toEqual(new Date(2026, 0, 1));
	});
});

describe("isValidPeriod", () => {
	const valid: Array<[string, PeriodLevel]> = [
		["2026-09-28", "daily"],
		["2024-02-29", "daily"],
		["2026-W01", "weekly"],
		["2026-W53", "weekly"],
		["2020-W53", "weekly"],
		["2026-01", "monthly"],
		["2026-12", "monthly"],
		["2026-Q1", "quarterly"],
		["2026-Q4", "quarterly"],
		["2026", "yearly"],
	];

	const invalid: Array<[string | null, PeriodLevel]> = [
		["2026-02-30", "daily"],
		["2023-02-29", "daily"],
		["2026-13-01", "daily"],
		["2026-9-28", "daily"],
		["21", "daily"],
		["2021-W53", "weekly"],
		["2026-W54", "weekly"],
		["2026-W00", "weekly"],
		["2026W40", "weekly"],
		["2026-13", "monthly"],
		["2026-00", "monthly"],
		["2026-Q5", "quarterly"],
		["2026-Q0", "quarterly"],
		["26", "yearly"],
		[null, "daily"],
		["2026-W40", "daily"],
	];

	it.each(valid)("accepts %s as %s", (period, level) => {
		expect(isValidPeriod(period, level)).toBe(true);
	});

	it.each(invalid)("rejects %s as %s", (period, level) => {
		expect(isValidPeriod(period, level)).toBe(false);
	});

	it("treats only a null period as valid for objectives", () => {
		expect(isValidPeriod(null, "objective")).toBe(true);
		expect(isValidPeriod("2026", "objective")).toBe(false);
	});
});

describe("period bounds", () => {
	it("covers a Monday-to-Sunday ISO week", () => {
		const bounds = getPeriodBounds("2026-W40", "weekly");
		expect(bounds.start).toEqual(new Date(2026, 8, 28));
		expect(bounds.endExclusive).toEqual(new Date(2026, 9, 5));
	});

	it("covers a whole calendar month", () => {
		const bounds = getPeriodBounds("2026-02", "monthly");
		expect(bounds.start).toEqual(new Date(2026, 1, 1));
		expect(bounds.endExclusive).toEqual(new Date(2026, 2, 1));
	});

	it("is half-open, so the boundary day belongs to the next period", () => {
		expect(isDateInPeriod(new Date(2026, 8, 28), "2026-W40", "weekly")).toBe(true);
		expect(isDateInPeriod(new Date(2026, 9, 4), "2026-W40", "weekly")).toBe(true);
		expect(isDateInPeriod(new Date(2026, 9, 5), "2026-W40", "weekly")).toBe(false);
		expect(isDateInPeriod(new Date(2026, 9, 5), "2026-W41", "weekly")).toBe(true);
	});
});

describe("comparePeriods", () => {
	it("orders periods of the same horizon chronologically", () => {
		expect(comparePeriods("2026-09", "2026-10", "monthly")).toBeLessThan(0);
		expect(comparePeriods("2026-10", "2026-09", "monthly")).toBeGreaterThan(0);
		expect(comparePeriods("2026-Q1", "2026-Q1", "quarterly")).toBe(0);
	});
});

describe("formatPeriodLabel", () => {
	it("formats each horizon for the board header", () => {
		expect(formatPeriodLabel("2026-09-28", "daily")).toBe("Mon, 28 Sep 2026");
		expect(formatPeriodLabel("2026-W40", "weekly")).toBe(
			"Week 40 · 28 Sep – 4 Oct 2026",
		);
		expect(formatPeriodLabel("2026-09", "monthly")).toBe("September 2026");
		expect(formatPeriodLabel("2026-Q4", "quarterly")).toBe("Q4 2026");
		expect(formatPeriodLabel("2026", "yearly")).toBe("2026");
	});

	it("labels the objective board, which has no period", () => {
		expect(formatPeriodLabel(null, "objective")).toBe(OBJECTIVE_BOARD_LABEL);
	});

	it("rejects malformed periods instead of printing nonsense", () => {
		expect(() => formatPeriodLabel("banana", "daily")).toThrow();
	});
});
