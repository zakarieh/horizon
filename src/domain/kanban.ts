/**
 * Kanban board layout: which columns and swimlanes a board has, which cell each
 * card lands in, and in what order.
 *
 * Pure, so the rules TaskNotes encodes in `kanbanGrouping.ts` - grouping by a
 * property, list-property explosion, empty/pinned columns, per-property column
 * order, swimlanes and WIP counts - are all directly unit-testable here.
 */

import {
	buildChildIndex,
	computeRollup,
	filterTasks,
	normalizeTag,
	sortTasks,
	tasksForBoard,
	type BoardFilter,
	type CardView,
} from "./board";
import { isTerminalCategory, type StatusRegistries } from "./statuses";
import type { Level, Priority, SortMode, StatusDefinition, Task } from "./types";

/** Properties a board can group its columns by. */
export const KANBAN_GROUP_BY = ["status", "priority", "tags"] as const;
export type KanbanGroupBy = (typeof KANBAN_GROUP_BY)[number];

/** Runtime guard for {@link KanbanGroupBy}. */
export function isKanbanGroupBy(value: unknown): value is KanbanGroupBy {
	return typeof value === "string" && (KANBAN_GROUP_BY as readonly string[]).includes(value);
}

/** Properties a board can split into swimlanes, or `none`. */
export const KANBAN_SWIM_LANES = ["none", "priority", "tags"] as const;
export type KanbanSwimLane = (typeof KANBAN_SWIM_LANES)[number];

/** Runtime guard for {@link KanbanSwimLane}. */
export function isKanbanSwimLane(value: unknown): value is KanbanSwimLane {
	return (
		typeof value === "string" && (KANBAN_SWIM_LANES as readonly string[]).includes(value)
	);
}

/** Card density on the board. */
export const CARD_LAYOUTS = ["default", "compact"] as const;
export type CardLayout = (typeof CARD_LAYOUTS)[number];

/** Runtime guard for {@link CardLayout}. */
export function isCardLayout(value: unknown): value is CardLayout {
	return typeof value === "string" && (CARD_LAYOUTS as readonly string[]).includes(value);
}

/** Column width bounds, matching TaskNotes' 200-500px slider. */
export const MIN_COLUMN_WIDTH = 200;
export const MAX_COLUMN_WIDTH = 500;
export const DEFAULT_COLUMN_WIDTH = 280;

/** Swimlane height bounds, matching TaskNotes' 300-1200px slider. */
export const MIN_SWIMLANE_HEIGHT = 300;
export const MAX_SWIMLANE_HEIGHT = 1200;
export const DEFAULT_SWIMLANE_HEIGHT = 600;

/** Column key used for a card whose grouping property has no usable value. */
export const UNGROUPED_KEY = "";

/** Separator inside a composite cell id; a unit separator cannot appear in a tag or status id. */
const CELL_SEPARATOR = "\u001f";

/** Composite dnd-kit droppable id for one cell of the board. */
export function kanbanCellId(rowKey: string, columnKey: string): string {
	return `${rowKey}${CELL_SEPARATOR}${columnKey}`;
}

/** Splits a {@link kanbanCellId} back into its row and column keys. */
export function splitKanbanCellId(
	id: string,
): { rowKey: string; columnKey: string } | null {
	const index = id.indexOf(CELL_SEPARATOR);
	if (index < 0) {
		return null;
	}
	return { rowKey: id.slice(0, index), columnKey: id.slice(index + 1) };
}

/** One cell of the grid: the cards at the crossing of a row and a column. */
export interface KanbanCell {
	/** Composite id, used as the droppable id. */
	id: string;
	rowKey: string;
	columnKey: string;
	cards: CardView[];
}

/** One swimlane row; flat boards have exactly one row with an empty key. */
export interface KanbanRow {
	key: string;
	/** Human label; empty in flat mode. */
	label: string;
	total: number;
	cells: KanbanCell[];
}

/** A column header, shared by every row. */
export interface KanbanColumn {
	key: string;
	label: string;
	color: string | null;
	pinned: boolean;
	/** Configured WIP limit, or `null`. */
	wipLimit: number | null;
	/** Total cards across every row. */
	count: number;
}

/** The whole board: headers, rows and cells. */
export interface KanbanBoard {
	groupBy: KanbanGroupBy;
	/** Whether rows are swimlanes rather than a single implicit row. */
	swimLanes: boolean;
	columns: KanbanColumn[];
	rows: KanbanRow[];
}

/** Everything {@link buildKanbanBoard} needs. */
export interface KanbanOptions {
	level: Level;
	period: string | null;
	registries: StatusRegistries;
	groupBy: KanbanGroupBy;
	swimLane: KanbanSwimLane;
	enabledPriorities: readonly Priority[];
	/** When on, a task with several tags appears in each tag column. */
	explodeListColumns: boolean;
	hideEmptyColumns: boolean;
	collapseEmptyTerminalColumns: boolean;
	hideEmptySwimLanes: boolean;
	pinnedColumns: readonly string[];
	wipLimits: Readonly<Record<string, number>>;
	/** Column order per grouping property. */
	columnOrder: Readonly<Record<string, readonly string[]>>;
	filter?: BoardFilter;
	sortMode?: SortMode;
}

/** Distinct normalised tags of a task, in order. */
function tagsOf(task: Task): string[] {
	const seen = new Set<string>();
	const tags: string[] = [];
	for (const tag of task.tags) {
		const normalized = normalizeTag(tag);
		if (normalized === "" || seen.has(normalized)) {
			continue;
		}
		seen.add(normalized);
		tags.push(normalized);
	}
	return tags;
}

/** The column keys a task belongs to. */
function groupKeysOf(task: Task, options: KanbanOptions): string[] {
	switch (options.groupBy) {
		case "status":
			return [task.status];
		case "priority":
			return [task.priority];
		case "tags": {
			const tags = tagsOf(task);
			if (tags.length === 0) {
				return [UNGROUPED_KEY];
			}
			return options.explodeListColumns ? tags : [tags.join(", ")];
		}
	}
}

/** The swimlane keys a card belongs to. */
function swimKeysOf(task: Task, options: KanbanOptions): string[] {
	switch (options.swimLane) {
		case "none":
			return [""];
		case "priority":
			return [task.priority];
		case "tags": {
			const tags = tagsOf(task);
			return tags.length === 0 ? [UNGROUPED_KEY] : tags;
		}
	}
}

/**
 * Orders `present` keys: the stored order first, then the fallback order, then
 * anything left over in discovery order.
 */
function orderKeys(
	present: readonly string[],
	stored: readonly string[],
	fallback: readonly string[],
): string[] {
	const remaining = new Set(present);
	const ordered: string[] = [];
	for (const key of [...stored, ...fallback, ...present]) {
		if (remaining.delete(key)) {
			ordered.push(key);
		}
	}
	return ordered;
}

/** Appends a card to a map of lists. */
function push<T>(map: Map<string, T[]>, key: string, value: T): void {
	const list = map.get(key);
	if (list === undefined) {
		map.set(key, [value]);
	} else {
		list.push(value);
	}
}

/**
 * Builds the board's columns, swimlanes and cells.
 *
 * Grouping by `status` uses the board's registry, so a column exists for every
 * configured status even when empty (unless hidden); the other properties are
 * discovered from the tasks. `order` in the registry is the default column
 * order, overridden by a stored drag order.
 */
export function buildKanbanBoard(
	tasks: readonly Task[],
	options: KanbanOptions,
): KanbanBoard {
	const registry: readonly StatusDefinition[] = options.registries[options.level];
	const onBoard = filterTasks(
		tasksForBoard(tasks, options.level, options.period),
		options.filter ?? {},
	);
	const childIndex = buildChildIndex(tasks);
	const known = new Set(registry.map((status) => status.id));
	const cards = sortTasks(onBoard, options.sortMode ?? "manual").map(
		(task): CardView => ({
			task,
			...computeRollup(task, childIndex, options.registries),
			unknownStatus: !known.has(task.status),
		}),
	);

	// Column universe.
	const discovered = new Set<string>();
	for (const card of cards) {
		for (const key of groupKeysOf(card.task, options)) {
			discovered.add(key);
		}
	}
	if (options.groupBy === "status") {
		for (const status of registry) {
			discovered.add(status.id);
		}
	}
	if (options.groupBy === "priority") {
		for (const priority of options.enabledPriorities) {
			discovered.add(priority);
		}
	}

	const fallbackOrder =
		options.groupBy === "status"
			? registry.map((status) => status.id)
			: options.groupBy === "priority"
				? [...options.enabledPriorities]
				: [...discovered];
	const orderedKeys = orderKeys(
		[...discovered],
		options.columnOrder[options.groupBy] ?? [],
		fallbackOrder,
	);

	// Column metadata and counts.
	const counts = new Map<string, number>();
	for (const card of cards) {
		for (const key of groupKeysOf(card.task, options)) {
			counts.set(key, (counts.get(key) ?? 0) + 1);
		}
	}
	const metaOf = (key: string): { label: string; color: string | null } => {
		if (options.groupBy === "status") {
			const status = registry.find((entry) => entry.id === key);
			return { label: status?.label ?? key, color: status?.color ?? null };
		}
		return { label: key, color: null };
	};

	const visibleKeys = orderedKeys.filter((key) => {
		const count = counts.get(key) ?? 0;
		if (count > 0) {
			return true;
		}
		if (options.pinnedColumns.includes(key)) {
			return true;
		}
		if (options.hideEmptyColumns) {
			return false;
		}
		if (options.groupBy === "status" && options.collapseEmptyTerminalColumns) {
			const status = registry.find((entry) => entry.id === key);
			if (status !== undefined && isTerminalCategory(status.category)) {
				return false;
			}
		}
		return true;
	});

	// Swimlane universe.
	const rowKeys = new Set<string>();
	for (const card of cards) {
		for (const key of swimKeysOf(card.task, options)) {
			rowKeys.add(key);
		}
	}
	if (options.swimLane === "priority" && !options.hideEmptySwimLanes) {
		for (const priority of options.enabledPriorities) {
			rowKeys.add(priority);
		}
	}
	const rowFallback =
		options.swimLane === "priority" ? [...options.enabledPriorities] : [...rowKeys];
	const orderedRows = orderKeys([...rowKeys], [], rowFallback);

	// Cells.
	const cellCards = new Map<string, CardView[]>();
	for (const card of cards) {
		const groups = groupKeysOf(card.task, options).filter((key) => visibleKeys.includes(key));
		const lanes = swimKeysOf(card.task, options);
		for (const groupKey of groups) {
			for (const laneKey of lanes) {
				push(cellCards, kanbanCellId(laneKey, groupKey), card);
			}
		}
	}

	const rows: KanbanRow[] = orderedRows
		.filter((rowKey) => {
			if (!options.hideEmptySwimLanes) {
				return true;
			}
			return visibleKeys.some(
				(columnKey) => (cellCards.get(kanbanCellId(rowKey, columnKey))?.length ?? 0) > 0,
			);
		})
		.map((rowKey) => {
			const cells = visibleKeys.map(
				(columnKey): KanbanCell => ({
					id: kanbanCellId(rowKey, columnKey),
					rowKey,
					columnKey,
					cards: cellCards.get(kanbanCellId(rowKey, columnKey)) ?? [],
				}),
			);
			return {
				key: rowKey,
				label: options.swimLane === "none" ? "" : rowKey,
				total: cells.reduce((sum, cell) => sum + cell.cards.length, 0),
				cells,
			};
		});

	const columnTotals = new Map<string, number>();
	for (const row of rows) {
		for (const cell of row.cells) {
			columnTotals.set(
				cell.columnKey,
				(columnTotals.get(cell.columnKey) ?? 0) + cell.cards.length,
			);
		}
	}

	const columns: KanbanColumn[] = visibleKeys.map((key) => ({
		key,
		...metaOf(key),
		pinned: options.pinnedColumns.includes(key),
		wipLimit: options.wipLimits[key] ?? null,
		count: columnTotals.get(key) ?? 0,
	}));

	return {
		groupBy: options.groupBy,
		swimLanes: options.swimLane !== "none",
		columns,
		rows,
	};
}

/** The frontmatter fields a cell move writes. */
export interface KanbanMovePatch {
	status?: string;
	priority?: Priority;
	tags?: string[];
}

/**
 * The frontmatter patch that moves a card between cells.
 *
 * Columns and swimlanes are independent: moving to another column updates the
 * grouping property, moving to another row updates the swimlane property, and a
 * cross-cell drop does both. For a tag grouping the source tag is removed and
 * the target tag added, so a task tagged `[work, call]` dragged from `work` to
 * `home` becomes `[call, home]` - the behaviour TaskNotes documents for
 * "Show items in multiple columns".
 */
export function movePatch(
	options: Pick<KanbanOptions, "groupBy" | "swimLane" | "explodeListColumns">,
	task: Task,
	source: { columnKey: string; rowKey: string },
	target: { columnKey: string; rowKey: string },
): KanbanMovePatch {
	const patch: KanbanMovePatch = {};
	const tags = new Set(tagsOf(task));

	if (target.columnKey !== source.columnKey) {
		switch (options.groupBy) {
			case "status":
				patch.status = target.columnKey;
				break;
			case "priority":
				patch.priority = target.columnKey as Priority;
				break;
			case "tags":
				if (options.explodeListColumns) {
					tags.delete(source.columnKey);
				} else {
					tags.clear();
				}
				if (target.columnKey !== UNGROUPED_KEY) {
					tags.add(target.columnKey);
				}
				patch.tags = [...tags];
				break;
		}
	}

	if (target.rowKey !== source.rowKey) {
		switch (options.swimLane) {
			case "none":
				break;
			case "priority":
				patch.priority = target.rowKey as Priority;
				break;
			case "tags":
				tags.delete(source.rowKey);
				if (target.rowKey !== UNGROUPED_KEY) {
					tags.add(target.rowKey);
				}
				patch.tags = [...tags];
				break;
		}
	}

	return patch;
}

/** The tags a task should keep after a tag-based move, so the UI can preview it. */
export function tagsAfterMove(
	task: Task,
	sourceTag: string,
	targetTag: string | null,
): string[] {
	const tags = new Set(tagsOf(task));
	tags.delete(sourceTag);
	if (targetTag !== null && targetTag !== UNGROUPED_KEY) {
		tags.add(targetTag);
	}
	return [...tags];
}
