/**
 * Board selection: which cards belong on a board, in which column, in what
 * order, and what their progress rollup says.
 *
 * This is pure logic - no DOM and no vault - so the rules that decide what a
 * user sees (board scoping, filtering, sorting, column collapse, rollups) are
 * all directly unit-testable.
 */

import { parseLinkRef } from "./links";
import { basename } from "./paths";
import { isDoneStatus, isTerminalCategory, type StatusRegistries } from "./statuses";
import {
	PRIORITY_RANK,
	type Level,
	type SortMode,
	type StatusDefinition,
	type Task,
} from "./types";

/** A task plus everything the card needs to render. */
export interface CardView {
	task: Task;
	/** The task's direct children, in manual order. Not recursive. */
	children: Task[];
	/** How many direct children sit in a `done` status. */
	done: number;
	/** How many direct children the task has. */
	total: number;
	/** True only when there is at least one child and every child is done. */
	allChildrenDone: boolean;
	/** True when the task's status is missing from the registry. */
	unknownStatus: boolean;
}

/** One board column: a status and the cards in it. */
export interface BoardColumn {
	status: StatusDefinition;
	cards: CardView[];
}

/** Board-level card filtering, driven by the header controls. */
export interface BoardFilter {
	/** Tag to keep, with or without a leading `#`. */
	tag?: string | null;
	/** Free text matched against title, tags and file path. */
	query?: string | null;
}

/** Everything {@link selectBoard} needs to build a board. */
export interface BoardOptions {
	level: Level;
	/** `null` for the objectives board, which is not period scoped. */
	period: string | null;
	/** Every board's status registry, keyed by horizon. */
	registries: StatusRegistries;
	filter?: BoardFilter;
	sortMode?: SortMode;
	hideEmptyColumns?: boolean;
	collapseEmptyTerminalColumns?: boolean;
}

/** Normalises a tag for comparison: no leading `#`, case-insensitive. */
export function normalizeTag(tag: string): string {
	return tag.trim().replace(/^#+/, "").toLowerCase();
}

/**
 * Builds a resolver from a wikilink target to a task.
 *
 * Targets are matched the way Obsidian matches them: by full path first, then
 * by note name. Ambiguous names resolve to the alphabetically first path, so
 * the result is deterministic instead of depending on vault iteration order.
 *
 * @returns A function returning the task, or `null` when there is none.
 */
export function buildTaskLookup(tasks: readonly Task[]): (ref: string) => Task | null {
	const byPath = new Map<string, Task>();
	const byName = new Map<string, Task>();

	for (const task of [...tasks].sort((a, b) => compareStrings(a.path, b.path))) {
		byPath.set(task.path, task);
		const name = basename(task.path).toLowerCase();
		if (!byName.has(name)) {
			byName.set(name, task);
		}
	}

	return (ref) => {
		const withExtension = ref.toLowerCase().endsWith(".md") ? ref : `${ref}.md`;
		return (
			byPath.get(ref) ??
			byPath.get(withExtension) ??
			byName.get(basename(ref).toLowerCase()) ??
			null
		);
	};
}

/**
 * Indexes tasks by the path of their resolved parent.
 *
 * @returns A map from parent path to its direct children, children sorted by
 * manual order and then path.
 */
export function buildChildIndex(tasks: readonly Task[]): Map<string, Task[]> {
	const resolve = buildTaskLookup(tasks);
	const index = new Map<string, Task[]>();

	for (const task of tasks) {
		const ref = parseLinkRef(task.parent);
		if (ref === null) {
			continue;
		}
		const parent = resolve(ref);
		if (parent === null || parent.path === task.path) {
			continue;
		}
		const children = index.get(parent.path);
		if (children === undefined) {
			index.set(parent.path, [task]);
		} else {
			children.push(task);
		}
	}

	for (const children of index.values()) {
		children.sort((a, b) => compareStrings(a.order, b.order) || compareStrings(a.path, b.path));
	}
	return index;
}

/**
 * Progress of a task's **direct** children. Deliberately not recursive: an
 * objective with three quarterly children reads as `1/3`, not as every daily
 * task underneath them.
 */
export function computeRollup(
	task: Task,
	childIndex: ReadonlyMap<string, Task[]>,
	registries: StatusRegistries,
): Pick<CardView, "children" | "done" | "total" | "allChildrenDone"> {
	const children = childIndex.get(task.path) ?? [];
	const done = children.filter((child) =>
		isDoneStatus(registries[child.level], child.status),
	).length;
	return {
		children,
		done,
		total: children.length,
		allChildrenDone: children.length > 0 && done === children.length,
	};
}

/**
 * The tasks that belong on the board for `level` and `period`.
 *
 * A task appears on exactly one board - the board for its own level - so a
 * parent never shows its children as cards. The objectives board is a single
 * permanent board and ignores the period entirely.
 *
 * Tasks on a period level with no usable period (a malformed `period` field)
 * are unplaced and match no board; the repository reports them separately so
 * they cannot silently disappear.
 */
export function tasksForBoard(
	tasks: readonly Task[],
	level: Level,
	period: string | null,
): Task[] {
	if (level === "objective") {
		return tasks.filter((task) => task.level === "objective");
	}
	if (period === null) {
		return [];
	}
	return tasks.filter((task) => task.level === level && task.period === period);
}

/** Applies the header's tag filter and search box. */
export function filterTasks(tasks: readonly Task[], filter: BoardFilter): Task[] {
	const tag = filter.tag == null || filter.tag === "" ? null : normalizeTag(filter.tag);
	const query = (filter.query ?? "").trim().toLowerCase();
	if (tag === null && query === "") {
		return [...tasks];
	}
	return tasks.filter((task) => {
		if (tag !== null && !task.tags.some((entry) => normalizeTag(entry) === tag)) {
			return false;
		}
		if (query === "") {
			return true;
		}
		return (
			task.title.toLowerCase().includes(query) ||
			task.path.toLowerCase().includes(query) ||
			task.tags.some((entry) => entry.toLowerCase().includes(query))
		);
	});
}

/**
 * Orders cards inside a column.
 *
 * Every mode falls back to the manual fractional index and then the path, so
 * the order is total and stable: two cards never swap places between renders.
 * Undated cards always sort last.
 */
export function sortTasks(tasks: readonly Task[], mode: SortMode): Task[] {
	return [...tasks].sort((a, b) => {
		const primary = comparePrimary(a, b, mode);
		if (primary !== 0) {
			return primary;
		}
		return compareStrings(a.order, b.order) || compareStrings(a.path, b.path);
	});
}

function comparePrimary(a: Task, b: Task, mode: SortMode): number {
	switch (mode) {
		case "manual":
			return 0;
		case "priority":
			return PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority];
		case "due":
			return compareNullableDates(a.due, b.due, false);
		case "created":
			// Newest first: a board is about what is current.
			return compareNullableDates(a.created, b.created, true);
		default:
			return 0;
	}
}

function compareNullableDates(
	a: string | null,
	b: string | null,
	descending: boolean,
): number {
	if (a === null || b === null) {
		// Undated cards sink to the bottom either way.
		return a === b ? 0 : a === null ? 1 : -1;
	}
	const result = compareStrings(a, b);
	return descending ? -result : result;
}

function compareStrings(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Builds the full board.
 *
 * Empty columns follow the documented rules: todo/active columns are always
 * shown unless "hide columns with no tasks" is on, and done/cancelled columns
 * are collapsed when empty by default.
 *
 * A card whose status is not in the registry is placed in the first column and
 * flagged, so a hand-edited status never makes a task vanish.
 */
export function selectBoard(
	tasks: readonly Task[],
	options: BoardOptions,
): BoardColumn[] {
	const registry = options.registries[options.level];
	if (registry.length === 0) {
		return [];
	}

	const childIndex = buildChildIndex(tasks);
	const known = new Set(registry.map((status) => status.id));
	const onBoard = filterTasks(
		tasksForBoard(tasks, options.level, options.period),
		options.filter ?? {},
	);
	const cards = sortTasks(onBoard, options.sortMode ?? "manual").map(
		(task): CardView => ({
			task,
			...computeRollup(task, childIndex, options.registries),
			unknownStatus: !known.has(task.status),
		}),
	);

	const byColumn = new Map<string, CardView[]>(
		registry.map((status) => [status.id, []]),
	);
	const unplaced: CardView[] = [];
	for (const card of cards) {
		const column = byColumn.get(card.task.status);
		if (column === undefined) {
			unplaced.push(card);
		} else {
			column.push(card);
		}
	}
	const first = registry[0];
	if (first !== undefined && unplaced.length > 0) {
		byColumn.get(first.id)?.push(...unplaced);
	}

	const columns: BoardColumn[] = [];
	for (const status of registry) {
		const columnCards = byColumn.get(status.id) ?? [];
		if (columnCards.length === 0) {
			if (options.hideEmptyColumns === true) {
				continue;
			}
			if (options.collapseEmptyTerminalColumns === true && isTerminalCategory(status.category)) {
				continue;
			}
		}
		columns.push({ status, cards: columnCards });
	}
	return columns;
}
