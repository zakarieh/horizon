import { describe, expect, it } from "vitest";

import {
	DEFAULT_STATUS_COLORS,
	DEFAULT_STATUSES,
	LEVELS,
	STATUS_CATEGORIES,
	addStatus,
	cloneStatuses,
	cloneStatusesByLevel,
	defaultStatusId,
	deleteStatus,
	findStatus,
	findStatusByLabel,
	isDoneStatus,
	isTerminalCategory,
	migrationTargets,
	normalizeRegistry,
	normalizeStatusRegistries,
	reorderStatus,
	slugifyStatusId,
	statusCategory,
	statusesByCategory,
	updateStatus,
} from "../src/domain";

describe("the default registry", () => {
	it("has unique, sequential ids and column positions", () => {
		const ids = DEFAULT_STATUSES.map((status) => status.id);
		expect(new Set(ids).size).toBe(ids.length);
		expect(DEFAULT_STATUSES.map((status) => status.order)).toEqual(
			DEFAULT_STATUSES.map((_, index) => index),
		);
	});

	it("covers every category", () => {
		const covered = new Set(DEFAULT_STATUSES.map((status) => status.category));
		expect([...STATUS_CATEGORIES].sort()).toEqual([...covered].sort());
	});

	it("is cloned, not shared", () => {
		const clone = cloneStatuses();
		clone[0].label = "Changed";
		expect(DEFAULT_STATUSES[0]?.label).toBe("Backlog");
	});
});

describe("per-board registries", () => {
	it("clones an independent registry for every board", () => {
		const registries = cloneStatusesByLevel();
		expect(Object.keys(registries).sort()).toEqual([...LEVELS].sort());
		registries.daily[0].label = "Changed";
		expect(registries.weekly[0]?.label).toBe("Backlog");
		expect(DEFAULT_STATUSES[0]?.label).toBe("Backlog");
	});

	it("applies a legacy flat array to every board", () => {
		const registries = normalizeStatusRegistries([{ id: "x", label: "X" }]);
		for (const level of LEVELS) {
			expect(registries[level].map((status) => status.id)).toEqual(["x"]);
		}
	});

	it("normalises a per-board map and fills missing boards with the defaults", () => {
		const registries = normalizeStatusRegistries({ daily: [{ id: "x", label: "X" }] });
		expect(registries.daily.map((status) => status.id)).toEqual(["x"]);
		expect(registries.weekly).toEqual(cloneStatuses());
	});
});

describe("normalizeRegistry", () => {
	it("falls back to the defaults when given nothing usable", () => {
		expect(normalizeRegistry([])).toEqual(cloneStatuses());
		expect(normalizeRegistry([null, 42, "nope", {}, { id: "x" }])).toEqual(
			cloneStatuses(),
		);
	});

	it("drops malformed entries and repairs invalid fields", () => {
		const repaired = normalizeRegistry([
			{ id: "keep", label: "Keep", color: "", category: "nonsense", order: "7" },
			{ id: "", label: "No id" },
			{ id: "keep", label: "Duplicate" },
		]);

		expect(repaired).toHaveLength(1);
		expect(repaired[0]).toEqual({
			id: "keep",
			label: "Keep",
			color: DEFAULT_STATUS_COLORS.backlog,
			category: "todo",
			order: 0,
		});
	});

	it("keeps a done status's archive delay and omits it otherwise", () => {
		const repaired = normalizeRegistry([
			{ id: "done", label: "Done", category: "done", order: 0, archiveAfterMinutes: 120 },
			{ id: "todo", label: "Todo", order: 1 },
		]);
		expect(repaired[0]?.archiveAfterMinutes).toBe(120);
		expect("archiveAfterMinutes" in (repaired[1] ?? {})).toBe(false);
	});

	it("sorts by the stored order and renumbers the columns", () => {
		const sorted = normalizeRegistry([
			{ id: "b", label: "B", color: "#000", category: "active", order: 5 },
			{ id: "a", label: "A", color: "#000", category: "todo", order: 1 },
			{ id: "c", label: "C", color: "#000", category: "done", order: 3 },
		]);

		expect(sorted.map((status) => status.id)).toEqual(["a", "c", "b"]);
		expect(sorted.map((status) => status.order)).toEqual([0, 1, 2]);
	});
});

describe("lookups", () => {
	it("finds statuses by id and label", () => {
		expect(findStatus(DEFAULT_STATUSES, "blocked")?.label).toBe("Blocked");
		expect(findStatus(DEFAULT_STATUSES, null)).toBeUndefined();
		expect(findStatusByLabel(DEFAULT_STATUSES, "in progress")?.id).toBe("in-progress");
	});

	it("reports the category and done-ness of a status", () => {
		expect(statusCategory(DEFAULT_STATUSES, "in-progress")).toBe("active");
		expect(statusCategory(DEFAULT_STATUSES, "nope")).toBeNull();
		expect(isDoneStatus(DEFAULT_STATUSES, "done")).toBe(true);
		expect(isDoneStatus(DEFAULT_STATUSES, "cancelled")).toBe(false);
		expect(isDoneStatus(DEFAULT_STATUSES, "nope")).toBe(false);
	});

	it("treats done and cancelled as terminal", () => {
		expect(isTerminalCategory("done")).toBe(true);
		expect(isTerminalCategory("cancelled")).toBe(true);
		expect(isTerminalCategory("todo")).toBe(false);
		expect(isTerminalCategory("active")).toBe(false);
	});

	it("picks the first todo status as the default", () => {
		expect(defaultStatusId(DEFAULT_STATUSES)).toBe("backlog");
	});

	it("filters by category in column order", () => {
		expect(statusesByCategory(DEFAULT_STATUSES, "active").map((s) => s.id)).toEqual([
			"in-progress",
			"blocked",
		]);
	});
});

describe("addStatus", () => {
	it("derives a slug id and appends the column", () => {
		const { registry, status } = addStatus(DEFAULT_STATUSES, {
			label: "In Review",
			color: "#abcdef",
			category: "active",
		});

		expect(status).toEqual({
			id: "in-review",
			label: "In Review",
			color: "#abcdef",
			category: "active",
			order: 6,
		});
		expect(registry).toHaveLength(DEFAULT_STATUSES.length + 1);
		expect(registry[6]?.id).toBe("in-review");
	});

	it("de-duplicates ids instead of colliding", () => {
		const first = addStatus(DEFAULT_STATUSES, {
			label: "Todo",
			color: "#000",
			category: "todo",
		});
		const second = addStatus(first.registry, {
			label: "Todo",
			color: "#000",
			category: "todo",
		});

		expect(first.status.id).toBe("todo-2");
		expect(second.status.id).toBe("todo-3");
	});

	it("slugifies awkward labels", () => {
		expect(slugifyStatusId("  Waiting on  Review!  ")).toBe("waiting-on-review");
		expect(slugifyStatusId("???")).toBe("status");
	});
});

describe("updateStatus", () => {
	it("renames and recolours without changing the id", () => {
		const updated = updateStatus(DEFAULT_STATUSES, "in-progress", {
			label: "Doing",
			color: "#ff00ff",
		});
		const status = findStatus(updated, "in-progress");

		expect(status?.label).toBe("Doing");
		expect(status?.color).toBe("#ff00ff");
	});

	it("can move a status between categories", () => {
		const updated = updateStatus(DEFAULT_STATUSES, "blocked", { category: "cancelled" });
		expect(statusCategory(updated, "blocked")).toBe("cancelled");
	});
});

describe("reorderStatus", () => {
	it("moves a column and renumbers the rest", () => {
		const reordered = reorderStatus(DEFAULT_STATUSES, "done", 0);

		expect(reordered.map((status) => status.id)).toEqual([
			"done",
			"backlog",
			"todo",
			"in-progress",
			"blocked",
			"cancelled",
		]);
		expect(reordered.map((status) => status.order)).toEqual([0, 1, 2, 3, 4, 5]);
	});

	it("clamps out-of-range targets and rejects unknown ids", () => {
		expect(reorderStatus(DEFAULT_STATUSES, "backlog", 99).at(-1)?.id).toBe("backlog");
		expect(reorderStatus(DEFAULT_STATUSES, "cancelled", -5)[0]?.id).toBe("cancelled");
		expect(() => reorderStatus(DEFAULT_STATUSES, "nope", 0)).toThrow(/Unknown status/);
	});
});

describe("deleteStatus", () => {
	it("removes the status and renumbers the remaining columns", () => {
		const remaining = deleteStatus(DEFAULT_STATUSES, "blocked", "todo");

		expect(findStatus(remaining, "blocked")).toBeUndefined();
		expect(remaining.map((status) => status.order)).toEqual([0, 1, 2, 3, 4]);
	});

	it("requires a replacement that exists and is different", () => {
		expect(() => deleteStatus(DEFAULT_STATUSES, "blocked", "blocked")).toThrow(
			/cannot replace itself/,
		);
		expect(() => deleteStatus(DEFAULT_STATUSES, "blocked", "ghost")).toThrow(
			/Unknown replacement/,
		);
		expect(() => deleteStatus(DEFAULT_STATUSES, "ghost", "todo")).toThrow(
			/Unknown status/,
		);
	});

	it("refuses to delete the last remaining status", () => {
		const single = normalizeRegistry([
			{ id: "only", label: "Only", color: "#000", category: "todo", order: 0 },
		]);
		expect(() => deleteStatus(single, "only", "other")).toThrow(/Unknown replacement/);
	});

	it("ranks same-category replacements first", () => {
		expect(migrationTargets(DEFAULT_STATUSES, "blocked").map((status) => status.id)).toEqual(
			["in-progress", "backlog", "todo", "done", "cancelled"],
		);
	});
});
