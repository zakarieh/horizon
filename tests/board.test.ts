import { describe, expect, it } from "vitest";

import {
	DEFAULT_STATUSES,
	buildChildIndex,
	buildTaskLookup,
	cloneStatusesByLevel,
	computeRollup,
	filterTasks,
	normalizeTag,
	selectBoard,
	sortTasks,
	tasksForBoard,
	type Task,
} from "../src/domain";

import { makeTask } from "./helpers";

/** Every board shares the default registry in these tests. */
const REGISTRIES = cloneStatusesByLevel(DEFAULT_STATUSES);

/** A parent on the weekly board with three children on the daily board. */
const parent: Task = makeTask({
	path: "Tasks/2026-W40 Launch website.md",
	title: "Launch website",
	level: "weekly",
	period: "2026-W40",
	status: "in-progress",
	order: "a0",
});

const children: Task[] = [
	makeTask({
		path: "Tasks/Write copy.md",
		title: "Write copy",
		parent: "2026-W40 Launch website",
		status: "done",
		order: "a0",
	}),
	makeTask({
		path: "Tasks/Design hero.md",
		title: "Design hero",
		parent: "2026-W40 Launch website",
		status: "todo",
		order: "a1",
	}),
	makeTask({
		path: "Tasks/Ship it.md",
		title: "Ship it",
		parent: "2026-W40 Launch website",
		status: "done",
		order: "a2",
	}),
];

describe("buildTaskLookup", () => {
	const tasks = [
		makeTask({ path: "Tasks/A.md" }),
		makeTask({ path: "Deep/Nested/B.md" }),
	];

	it("resolves a full path, with or without the extension", () => {
		const resolve = buildTaskLookup(tasks);
		expect(resolve("Tasks/A.md")?.path).toBe("Tasks/A.md");
		expect(resolve("Tasks/A")?.path).toBe("Tasks/A.md");
	});

	it("resolves a note name from anywhere in the vault", () => {
		const resolve = buildTaskLookup(tasks);
		expect(resolve("B")?.path).toBe("Deep/Nested/B.md");
	});

	it("returns null for anything it cannot resolve", () => {
		const resolve = buildTaskLookup(tasks);
		expect(resolve("Missing")).toBeNull();
	});

	it("resolves an ambiguous name deterministically", () => {
		const ambiguous = [
			makeTask({ path: "Zeta/Plan.md" }),
			makeTask({ path: "Alpha/Plan.md" }),
		];
		const resolve = buildTaskLookup(ambiguous);
		expect(resolve("Plan")?.path).toBe("Alpha/Plan.md");
	});
});

describe("buildChildIndex", () => {
	it("indexes children under their resolved parent", () => {
		const index = buildChildIndex([parent, ...children]);
		expect(index.get(parent.path)?.map((task) => task.title)).toEqual([
			"Write copy",
			"Design hero",
			"Ship it",
		]);
	});

	it("ignores unresolved references and self links", () => {
		const index = buildChildIndex([
			makeTask({ path: "Tasks/Orphan.md", parent: "Nobody" }),
			makeTask({ path: "Tasks/Loop.md", parent: "Loop" }),
		]);
		expect(index.size).toBe(0);
	});

	it("has no entry for tasks without children", () => {
		expect(buildChildIndex(children).size).toBe(0);
	});
});

describe("computeRollup", () => {
	const index = buildChildIndex([parent, ...children]);

	it("counts direct children only, not the whole subtree", () => {
		const grandchild = makeTask({
			path: "Tasks/Grandchild.md",
			parent: "Write copy",
			status: "done",
		});
		const deeper = buildChildIndex([parent, ...children, grandchild]);
		expect(computeRollup(parent, deeper, REGISTRIES)).toMatchObject({
			done: 2,
			total: 3,
			allChildrenDone: false,
		});
	});

	it("reports progress for a partly finished parent", () => {
		expect(computeRollup(parent, index, REGISTRIES)).toMatchObject({
			done: 2,
			total: 3,
			allChildrenDone: false,
		});
	});

	it("knows when every child is done", () => {
		const allDone = children.map((child) => ({ ...child, status: "done" }));
		const doneIndex = buildChildIndex([parent, ...allDone]);
		expect(computeRollup(parent, doneIndex, REGISTRIES).allChildrenDone).toBe(true);
	});

	it("does not claim a childless task is finished", () => {
		const leaf = computeRollup(children[0], index, REGISTRIES);
		expect(leaf).toMatchObject({ done: 0, total: 0, allChildrenDone: false });
	});

	it("does not treat cancelled as done", () => {
		const cancelled = children.map((child) => ({ ...child, status: "cancelled" }));
		const cancelledIndex = buildChildIndex([parent, ...cancelled]);
		expect(computeRollup(parent, cancelledIndex, REGISTRIES).done).toBe(0);
	});
});

describe("tasksForBoard", () => {
	const tasks = [...children, parent, makeTask({ path: "Tasks/Other day.md", period: "2026-09-27" })];

	it("returns only tasks on that horizon and period", () => {
		expect(tasksForBoard(tasks, "daily", "2026-09-28").map((task) => task.title)).toEqual([
			"Write copy",
			"Design hero",
			"Ship it",
		]);
		expect(tasksForBoard(tasks, "weekly", "2026-W40").map((task) => task.title)).toEqual([
			"Launch website",
		]);
	});

	it("never puts the same task on two boards", () => {
		const daily = new Set(tasksForBoard(tasks, "daily", "2026-09-28").map((t) => t.path));
		const weekly = tasksForBoard(tasks, "weekly", "2026-W40").map((t) => t.path);
		for (const path of weekly) {
			expect(daily.has(path)).toBe(false);
		}
	});

	it("shows every objective on the single objectives board", () => {
		const objective = makeTask({
			path: "Tasks/Grow.md",
			level: "objective",
			period: null,
		});
		expect(tasksForBoard([...tasks, objective], "objective", null).map((t) => t.path)).toEqual([
			"Tasks/Grow.md",
		]);
	});

	it("places nothing when a period level has no period", () => {
		expect(tasksForBoard(tasks, "daily", null)).toEqual([]);
	});
});

describe("filterTasks", () => {
	const tasks = [
		makeTask({ path: "Tasks/Write copy.md", title: "Write copy", tags: ["work"] }),
		makeTask({ path: "Tasks/Buy milk.md", title: "Buy milk", tags: ["home", "urgent"] }),
	];

	it("returns everything for an empty filter", () => {
		expect(filterTasks(tasks, {})).toHaveLength(2);
	});

	it("filters by tag with or without the hash, case-insensitively", () => {
		expect(filterTasks(tasks, { tag: "work" }).map((t) => t.title)).toEqual(["Write copy"]);
		expect(filterTasks(tasks, { tag: "#WORK" }).map((t) => t.title)).toEqual(["Write copy"]);
	});

	it("searches titles, tags and paths", () => {
		expect(filterTasks(tasks, { query: "milk" }).map((t) => t.title)).toEqual(["Buy milk"]);
		expect(filterTasks(tasks, { query: "urgent" }).map((t) => t.title)).toEqual(["Buy milk"]);
		expect(filterTasks(tasks, { query: "Tasks/" })).toHaveLength(2);
	});

	it("combines the tag filter and the search box", () => {
		expect(filterTasks(tasks, { tag: "home", query: "milk" })).toHaveLength(1);
		expect(filterTasks(tasks, { tag: "work", query: "milk" })).toHaveLength(0);
	});

	it("normalises tags for comparison", () => {
		expect(normalizeTag("  #Work ")).toBe("work");
	});
});

describe("sortTasks", () => {
	const tasks = [
		makeTask({ path: "Tasks/B.md", order: "a1", priority: "low", due: "2026-10-02", created: "2026-01-02" }),
		makeTask({ path: "Tasks/A.md", order: "a0", priority: "urgent", due: null, created: "2026-01-01" }),
		makeTask({ path: "Tasks/C.md", order: "a2", priority: "high", due: "2026-09-01", created: "2026-01-03" }),
	];

	it("sorts manual by the fractional index", () => {
		expect(sortTasks(tasks, "manual").map((t) => t.path)).toEqual([
			"Tasks/A.md",
			"Tasks/B.md",
			"Tasks/C.md",
		]);
	});

	it("sorts by priority, most severe first", () => {
		expect(sortTasks(tasks, "priority").map((t) => t.title)).toEqual([
			"A",
			"C",
			"B",
		]);
	});

	it("sorts by due date, soonest first, undated last", () => {
		expect(sortTasks(tasks, "due").map((t) => t.title)).toEqual(["C", "B", "A"]);
	});

	it("sorts by created date, newest first, undated last", () => {
		expect(sortTasks(tasks, "created").map((t) => t.title)).toEqual(["C", "B", "A"]);
	});

	it("breaks ties with the manual order so the result is stable", () => {
		const tied = [
			makeTask({ path: "Tasks/Second.md", order: "a1", priority: "high" }),
			makeTask({ path: "Tasks/First.md", order: "a0", priority: "high" }),
		];
		expect(sortTasks(tied, "priority").map((t) => t.title)).toEqual(["First", "Second"]);
	});

	it("does not mutate its input", () => {
		const original = tasks.map((task) => task.path);
		sortTasks(tasks, "priority");
		expect(tasks.map((task) => task.path)).toEqual(original);
	});
});

describe("selectBoard", () => {
	const boardTasks = [...children, parent];

	it("groups cards into the registry columns, in order", () => {
		const columns = selectBoard(boardTasks, {
			level: "daily",
			period: "2026-09-28",
			registries: REGISTRIES,
		});

		expect(columns.map((column) => column.status.id)).toEqual(
			DEFAULT_STATUSES.map((status) => status.id),
		);
		const todo = columns.find((column) => column.status.id === "todo");
		expect(todo?.cards.map((card) => card.task.title)).toEqual(["Design hero"]);
		const done = columns.find((column) => column.status.id === "done");
		expect(done?.cards.map((card) => card.task.title)).toEqual(["Write copy", "Ship it"]);
	});

	it("computes the rollup from children that live on another board", () => {
		const columns = selectBoard(boardTasks, {
			level: "weekly",
			period: "2026-W40",
			registries: REGISTRIES,
		});
		const card = columns.flatMap((column) => column.cards)[0];

		expect(card?.task.title).toBe("Launch website");
		expect(card).toMatchObject({ done: 2, total: 3, allChildrenDone: false });
	});

	it("shows a card with an unknown status in the first column instead of dropping it", () => {
		const stray = makeTask({
			path: "Tasks/Stray.md",
			title: "Stray",
			status: "archived",
		});
		const columns = selectBoard([...boardTasks, stray], {
			level: "daily",
			period: "2026-09-28",
			registries: REGISTRIES,
		});
		const first = columns[0];
		const card = first?.cards.find((entry) => entry.task.title === "Stray");

		expect(first?.status.id).toBe("backlog");
		expect(card?.unknownStatus).toBe(true);
	});

	it("shows every column when nothing is collapsed or hidden", () => {
		// `selectBoard` takes explicit flags; the defaults (collapse terminal
		// columns, never hide) live in settings and are passed by the view.
		const columns = selectBoard([], {
			level: "daily",
			period: "2026-09-28",
			registries: REGISTRIES,
		});
		expect(columns.map((column) => column.status.id)).toEqual(
			DEFAULT_STATUSES.map((status) => status.id),
		);
	});

	it("collapses empty terminal columns when asked", () => {
		const columns = selectBoard([], {
			level: "daily",
			period: "2026-09-28",
			registries: REGISTRIES,
			collapseEmptyTerminalColumns: true,
		});
		expect(columns.map((column) => column.status.id)).toEqual([
			"backlog",
			"todo",
			"in-progress",
			"blocked",
		]);
	});

	it("keeps a terminal column that has cards", () => {
		const columns = selectBoard(boardTasks, {
			level: "daily",
			period: "2026-09-28",
			registries: REGISTRIES,
			collapseEmptyTerminalColumns: true,
		});
		expect(columns.map((column) => column.status.id)).toContain("done");
	});

	it("hides every empty column when asked", () => {
		const columns = selectBoard(boardTasks, {
			level: "daily",
			period: "2026-09-28",
			registries: REGISTRIES,
			hideEmptyColumns: true,
		});
		expect(columns.map((column) => column.status.id)).toEqual(["todo", "done"]);
	});

	it("applies filtering before grouping", () => {
		const tagged = boardTasks.map((task) =>
			task.path === "Tasks/Design hero.md" ? { ...task, tags: ["website"] } : task,
		);
		const columns = selectBoard(tagged, {
			level: "daily",
			period: "2026-09-28",
			registries: REGISTRIES,
			filter: { tag: "website" },
		});
		expect(columns.flatMap((column) => column.cards).map((card) => card.task.title)).toEqual([
			"Design hero",
		]);
	});

	it("honours the sort mode", () => {
		const columns = selectBoard(boardTasks, {
			level: "daily",
			period: "2026-09-28",
			registries: REGISTRIES,
			sortMode: "priority",
		});
		const done = columns.find((column) => column.status.id === "done");
		expect(done?.cards.map((card) => card.task.title)).toEqual(["Write copy", "Ship it"]);
	});

	it("returns no columns when there is no registry", () => {
		expect(
			selectBoard(boardTasks, {
				level: "daily",
				period: "2026-09-28",
				registries: { ...REGISTRIES, daily: [] },
			}),
		).toEqual([]);
	});
});
