import { describe, expect, it } from "vitest";

import {
	cloneStatusesByLevel,
	collectRollovers,
	getCurrentPeriod,
	prevPeriod,
	type Task,
} from "../src/domain";
import { makeTask } from "./helpers";

/** A fresh set of per-board registries, with the shipped status categories. */
const registries = cloneStatusesByLevel();

/** A fixed clock: 30 September 2026, local time. */
const NOW = new Date(2026, 8, 30, 9, 0, 0);

function task(overrides: Partial<Task> & Pick<Task, "path">): Task {
	return makeTask(overrides);
}

describe("collectRollovers", () => {
	it("carries an unfinished daily task to today", () => {
		const candidates = collectRollovers(
			[task({ path: "Tasks/Daily/standup.md", period: "2026-09-29" })],
			registries,
			NOW,
		);
		expect(candidates).toEqual([
			{
				path: "Tasks/Daily/standup.md",
				level: "daily",
				from: "2026-09-29",
				to: "2026-09-30",
				carriedFrom: "2026-09-29",
			},
		]);
	});

	it("leaves a task that is already on the current period", () => {
		const candidates = collectRollovers(
			[task({ path: "a.md", period: "2026-09-30" })],
			registries,
			NOW,
		);
		expect(candidates).toEqual([]);
	});

	it("leaves a task whose period is in the future", () => {
		const candidates = collectRollovers(
			[task({ path: "a.md", period: "2026-10-01" })],
			registries,
			NOW,
		);
		expect(candidates).toEqual([]);
	});

	it("never carries an objective", () => {
		const candidates = collectRollovers(
			[task({ path: "goal.md", level: "objective", period: null })],
			registries,
			NOW,
		);
		expect(candidates).toEqual([]);
	});

	it("leaves finished tasks where they are", () => {
		const candidates = collectRollovers(
			[
				task({ path: "done.md", period: "2026-09-29", status: "done" }),
				task({ path: "cancelled.md", period: "2026-09-29", status: "cancelled" }),
			],
			registries,
			NOW,
		);
		expect(candidates).toEqual([]);
	});

	it("leaves archived tasks alone", () => {
		const candidates = collectRollovers(
			[task({ path: "a.md", period: "2026-09-29", archived: true })],
			registries,
			NOW,
		);
		expect(candidates).toEqual([]);
	});

	it("rolls an unknown status forward rather than dropping the task", () => {
		const candidates = collectRollovers(
			[task({ path: "a.md", period: "2026-09-29", status: "mystery" })],
			registries,
			NOW,
		);
		expect(candidates).toHaveLength(1);
	});

	it("catches up in one step after several missed periods", () => {
		const candidates = collectRollovers(
			[task({ path: "a.md", period: "2026-09-20" })],
			registries,
			NOW,
		);
		expect(candidates[0]).toMatchObject({ from: "2026-09-20", to: "2026-09-30" });
	});

	it("keeps the earliest carriedFrom when a task rolls again", () => {
		const candidates = collectRollovers(
			[task({ path: "a.md", period: "2026-09-29", carriedFrom: "2026-08-01" })],
			registries,
			NOW,
		);
		expect(candidates[0]?.carriedFrom).toBe("2026-08-01");
	});

	it("rolls a weekly task to the current week", () => {
		const current = getCurrentPeriod("weekly", NOW);
		const candidates = collectRollovers(
			[task({ path: "w.md", level: "weekly", period: prevPeriod(current, "weekly") })],
			registries,
			NOW,
		);
		expect(candidates).toEqual([
			{
				path: "w.md",
				level: "weekly",
				from: prevPeriod(current, "weekly"),
				to: current,
				carriedFrom: prevPeriod(current, "weekly"),
			},
		]);
	});

	it("rolls a yearly task to the current year", () => {
		const candidates = collectRollovers(
			[task({ path: "y.md", level: "yearly", period: "2025" })],
			registries,
			NOW,
		);
		expect(candidates).toEqual([
			{
				path: "y.md",
				level: "yearly",
				from: "2025",
				to: "2026",
				carriedFrom: "2025",
			},
		]);
	});

	it("returns nothing when there are no tasks", () => {
		expect(collectRollovers([], registries, NOW)).toEqual([]);
	});
});
