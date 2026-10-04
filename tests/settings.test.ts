import { describe, expect, it } from "vitest";

import { LEVELS } from "../src/domain";
import { DEFAULT_SETTINGS, mergeSettings, normalizeTaskFolder } from "../src/settings";

describe("normalizeTaskFolder", () => {
	it("adds a trailing slash", () => {
		expect(normalizeTaskFolder("Tasks")).toBe("Tasks/");
		expect(normalizeTaskFolder("Tasks/")).toBe("Tasks/");
	});

	it("normalises separators and collapses redundant slashes", () => {
		expect(normalizeTaskFolder("Work\\Tasks")).toBe("Work/Tasks/");
		expect(normalizeTaskFolder("/Tasks//Sub")).toBe("Tasks/Sub/");
		expect(normalizeTaskFolder("  Tasks  ")).toBe("Tasks/");
	});

	it("falls back to the default for an empty value", () => {
		expect(normalizeTaskFolder("")).toBe(DEFAULT_SETTINGS.taskFolder);
		expect(normalizeTaskFolder("   ")).toBe(DEFAULT_SETTINGS.taskFolder);
		expect(normalizeTaskFolder("/")).toBe(DEFAULT_SETTINGS.taskFolder);
	});
});

describe("mergeSettings", () => {
	it("returns the full defaults for missing or unusable data", () => {
		expect(mergeSettings(null)).toEqual(DEFAULT_SETTINGS);
		expect(mergeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
		expect(mergeSettings({})).toEqual(DEFAULT_SETTINGS);
		expect(mergeSettings("nonsense")).toEqual(DEFAULT_SETTINGS);
		expect(mergeSettings([])).toEqual(DEFAULT_SETTINGS);
	});

	it("keeps valid stored values", () => {
		const merged = mergeSettings({
			taskFolder: "Work/Tasks",
			strictHierarchy: false,
			hideEmptyColumns: true,
			collapseEmptyTerminalColumns: false,
			sortWithinColumn: "priority",
			defaultLevel: "weekly",
			showCardMetadata: { tags: false, childProgress: false },
			rollover: { daily: "auto", weekly: "never" },
			enabledPriorities: ["high", "urgent"],
		});

		expect(merged.taskFolder).toBe("Work/Tasks/");
		expect(merged.strictHierarchy).toBe(false);
		expect(merged.hideEmptyColumns).toBe(true);
		expect(merged.collapseEmptyTerminalColumns).toBe(false);
		expect(merged.sortWithinColumn).toBe("priority");
		expect(merged.defaultLevel).toBe("weekly");
		expect(merged.showCardMetadata).toEqual({
			priority: true,
			tags: false,
			due: true,
			parent: true,
			childProgress: false,
			period: false,
		});
		expect(merged.rollover.daily).toBe("auto");
		expect(merged.rollover.weekly).toBe("never");
		expect(merged.rollover.monthly).toBe("ask");
		expect(merged.enabledPriorities).toEqual(["high", "urgent"]);
	});

	it("replaces invalid scalars with defaults", () => {
		const merged = mergeSettings({
			taskFolder: 7,
			strictHierarchy: "yes",
			sortWithinColumn: "alphabetical",
			defaultLevel: "fortnightly",
			rollover: { daily: "sometimes" },
			showCardMetadata: { tags: "no" },
		});

		expect(merged.taskFolder).toBe(DEFAULT_SETTINGS.taskFolder);
		expect(merged.strictHierarchy).toBe(true);
		expect(merged.sortWithinColumn).toBe("manual");
		expect(merged.defaultLevel).toBe("daily");
		expect(merged.rollover.daily).toBe("ask");
		expect(merged.showCardMetadata.tags).toBe(true);
	});

	it("canonicalises the enabled horizons and never leaves them empty", () => {
		expect(mergeSettings({ enabledLevels: ["weekly", "daily", "weekly"] }).enabledLevels).toEqual(
			["daily", "weekly"],
		);
		expect(mergeSettings({ enabledLevels: ["nonsense"] }).enabledLevels).toEqual([...LEVELS]);
		expect(mergeSettings({ enabledLevels: [] }).enabledLevels).toEqual([...LEVELS]);
	});

	it("keeps the default level inside the enabled horizons", () => {
		const merged = mergeSettings({
			enabledLevels: ["monthly", "yearly"],
			defaultLevel: "daily",
		});
		expect(merged.defaultLevel).toBe("monthly");
	});

	it("repairs a per-board status registry", () => {
		expect(mergeSettings({ statuses: "nope" }).statuses).toEqual(DEFAULT_SETTINGS.statuses);

		// A legacy flat array is applied to every board.
		const legacy = mergeSettings({
			statuses: [
				{ id: "shipped", label: "Shipped", color: "#0f0", category: "done", order: 0 },
			],
		});
		const shipped = [
			{ id: "shipped", label: "Shipped", color: "#0f0", category: "done", order: 0 },
		];
		for (const level of LEVELS) {
			expect(legacy.statuses[level]).toEqual(shipped);
		}

		const perBoard = mergeSettings({
			statuses: {
				daily: [{ id: "today", label: "Today", color: "#abc", category: "todo", order: 0 }],
			},
		});
		expect(perBoard.statuses.daily.map((status) => status.id)).toEqual(["today"]);
		expect(perBoard.statuses.weekly).toEqual(DEFAULT_SETTINGS.statuses.weekly);
	});

	it("restores a board state that is still valid", () => {
		const merged = mergeSettings({
			boardState: { level: "weekly", period: "2026-W40" },
		});
		expect(merged.boardState).toEqual({ level: "weekly", period: "2026-W40" });
	});

	it("clears a board state that no longer makes sense", () => {
		expect(
			mergeSettings({ boardState: { level: "weekly", period: "2026-13" } }).boardState,
		).toEqual({ level: "weekly", period: null });

		expect(
			mergeSettings({ boardState: { level: "objective", period: "2026" } }).boardState,
		).toEqual({ level: "objective", period: null });

		expect(mergeSettings({ boardState: "nope" }).boardState).toEqual(
			DEFAULT_SETTINGS.boardState,
		);
	});

	it("falls back to an enabled level when the stored board level was disabled", () => {
		const merged = mergeSettings({
			enabledLevels: ["daily"],
			defaultLevel: "daily",
			boardState: { level: "quarterly", period: "2026-Q4" },
		});
		expect(merged.boardState).toEqual({ level: "daily", period: null });
	});
});
