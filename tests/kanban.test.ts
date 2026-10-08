import { describe, expect, it } from "vitest";

import {
	DEFAULT_STATUSES,
	PRIORITIES,
	buildKanbanBoard,
	cloneStatusesByLevel,
	isKanbanGroupBy,
	isKanbanSwimLane,
	kanbanCellId,
	movePatch,
	splitKanbanCellId,
	type KanbanOptions,
} from "../src/domain";

import { makeTask } from "./helpers";

const REGISTRIES = cloneStatusesByLevel(DEFAULT_STATUSES);

function options(overrides: Partial<KanbanOptions> = {}): KanbanOptions {
	return {
		level: "daily",
		period: "2026-09-28",
		registries: REGISTRIES,
		groupBy: "status",
		swimLane: "none",
		enabledPriorities: PRIORITIES,
		explodeListColumns: true,
		hideEmptyColumns: false,
		collapseEmptyTerminalColumns: false,
		hideEmptySwimLanes: true,
		pinnedColumns: [],
		wipLimits: {},
		columnOrder: {},
		...overrides,
	};
}

const tasks = [
	makeTask({ path: "Tasks/A.md", title: "A", status: "todo", order: "a0" }),
	makeTask({ path: "Tasks/B.md", title: "B", status: "done", order: "a1" }),
	makeTask({ path: "Tasks/C.md", title: "C", status: "todo", order: "a2", priority: "high" }),
];

describe("kanban guards", () => {
	it("validates grouping and swimlane values", () => {
		expect(isKanbanGroupBy("status")).toBe(true);
		expect(isKanbanGroupBy("nope")).toBe(false);
		expect(isKanbanSwimLane("priority")).toBe(true);
		expect(isKanbanSwimLane("status")).toBe(false);
	});
});

describe("cell ids", () => {
	it("round-trips row and column keys through a composite id", () => {
		const id = kanbanCellId("high", "in-progress");
		expect(splitKanbanCellId(id)).toEqual({ rowKey: "high", columnKey: "in-progress" });
		expect(splitKanbanCellId("not-a-cell")).toBeNull();
	});

	it("round-trips an empty row key for flat boards", () => {
		expect(splitKanbanCellId(kanbanCellId("", "done"))).toEqual({
			rowKey: "",
			columnKey: "done",
		});
	});
});

describe("buildKanbanBoard", () => {
	it("groups by status and keeps every configured status column", () => {
		const board = buildKanbanBoard(tasks, options());
		expect(board.columns.map((column) => column.key)).toEqual(
			DEFAULT_STATUSES.map((status) => status.id),
		);
		expect(board.swimLanes).toBe(false);
		expect(board.rows).toHaveLength(1);
		expect(board.rows[0]?.key).toBe("");
		const todo = board.columns.find((column) => column.key === "todo");
		expect(todo?.count).toBe(2);
		const done = board.columns.find((column) => column.key === "done");
		expect(done?.count).toBe(1);
	});

	it("hides empty columns but keeps pinned ones", () => {
		const board = buildKanbanBoard(
			tasks,
			options({ hideEmptyColumns: true, pinnedColumns: ["blocked"] }),
		);
		const keys = board.columns.map((column) => column.key);
		expect(keys).toContain("blocked");
		expect(keys).toContain("todo");
		expect(keys).not.toContain("cancelled");
	});

	it("collapses empty terminal columns when asked", () => {
		const board = buildKanbanBoard(
			tasks,
			options({ collapseEmptyTerminalColumns: true }),
		);
		const keys = board.columns.map((column) => column.key);
		expect(keys).not.toContain("cancelled");
		expect(keys).toContain("done");
	});

	it("groups by priority, ordered by the priority list", () => {
		const board = buildKanbanBoard(tasks, options({ groupBy: "priority" }));
		expect(board.columns.map((column) => column.key)).toEqual([...PRIORITIES]);
		const high = board.columns.find((column) => column.key === "high");
		expect(high?.count).toBe(1);
	});

	it("explodes tag groups so a multi-tag task appears in each column", () => {
		const tagged = [
			makeTask({ path: "Tasks/T.md", tags: ["work", "call"] }),
			makeTask({ path: "Tasks/U.md", tags: ["work"] }),
		];
		const board = buildKanbanBoard(tagged, options({ groupBy: "tags" }));
		expect(board.columns.map((column) => column.key).sort()).toEqual(["call", "work"]);
		expect(board.columns.find((column) => column.key === "work")?.count).toBe(2);
		expect(board.columns.find((column) => column.key === "call")?.count).toBe(1);
	});

	it("keeps a combined column when listing is not exploded", () => {
		const tagged = [makeTask({ path: "Tasks/T.md", tags: ["work", "call"] })];
		const board = buildKanbanBoard(
			tagged,
			options({ groupBy: "tags", explodeListColumns: false }),
		);
		expect(board.columns.map((column) => column.key)).toEqual(["work, call"]);
	});

	it("honours a stored column order per grouping property", () => {
		const board = buildKanbanBoard(
			tasks,
			options({ columnOrder: { status: ["done", "todo"] } }),
		);
		expect(board.columns.map((column) => column.key).slice(0, 2)).toEqual(["done", "todo"]);
	});

	it("splits rows into swimlanes and counts per cell", () => {
		const board = buildKanbanBoard(tasks, options({ swimLane: "priority" }));
		expect(board.swimLanes).toBe(true);
		const high = board.rows.find((row) => row.key === "high");
		expect(high?.total).toBe(1);
		expect(high?.cells.find((cell) => cell.columnKey === "todo")?.cards).toHaveLength(1);
	});

	it("keeps empty priority swimlanes when they are not hidden", () => {
		const board = buildKanbanBoard(
			tasks,
			options({ swimLane: "priority", hideEmptySwimLanes: false }),
		);
		expect(board.rows.map((row) => row.key)).toEqual([...PRIORITIES]);
	});

	it("sums column counts across swimlanes", () => {
		const board = buildKanbanBoard(tasks, options({ swimLane: "priority" }));
		expect(board.columns.find((column) => column.key === "todo")?.count).toBe(2);
	});

	it("reports the configured WIP limit on the column", () => {
		const board = buildKanbanBoard(tasks, options({ wipLimits: { todo: 1 } }));
		expect(board.columns.find((column) => column.key === "todo")?.wipLimit).toBe(1);
	});
});

describe("movePatch", () => {
	const task = makeTask({ path: "Tasks/T.md", status: "todo", priority: "none" });

	it("updates the grouping property when grouped by status", () => {
		const patch = movePatch(
			{ groupBy: "status", swimLane: "none", explodeListColumns: true },
			task,
			{ columnKey: "todo", rowKey: "" },
			{ columnKey: "done", rowKey: "" },
		);
		expect(patch).toEqual({ status: "done" });
	});

	it("updates the grouping property when grouped by priority", () => {
		const patch = movePatch(
			{ groupBy: "priority", swimLane: "none", explodeListColumns: true },
			task,
			{ columnKey: "none", rowKey: "" },
			{ columnKey: "high", rowKey: "" },
		);
		expect(patch.priority).toBe("high");
	});

	it("swaps tags when grouped by tags", () => {
		const tagged = makeTask({ path: "Tasks/T.md", tags: ["work", "call"] });
		const patch = movePatch(
			{ groupBy: "tags", swimLane: "none", explodeListColumns: true },
			tagged,
			{ columnKey: "work", rowKey: "" },
			{ columnKey: "home", rowKey: "" },
		);
		expect(patch.tags).toEqual(["call", "home"]);
	});

	it("updates both axes for a cross-cell drop", () => {
		const patch = movePatch(
			{ groupBy: "status", swimLane: "priority", explodeListColumns: true },
			task,
			{ columnKey: "todo", rowKey: "none" },
			{ columnKey: "done", rowKey: "high" },
		);
		expect(patch).toEqual({ status: "done", priority: "high" });
	});

	it("does nothing when the cell is unchanged", () => {
		const patch = movePatch(
			{ groupBy: "status", swimLane: "none", explodeListColumns: true },
			task,
			{ columnKey: "todo", rowKey: "" },
			{ columnKey: "todo", rowKey: "" },
		);
		expect(patch).toEqual({});
	});
});
