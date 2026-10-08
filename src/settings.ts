/**
 * Plugin settings: the persisted shape, the defaults, and the repair logic that
 * turns whatever is in `data.json` into a complete, valid settings object.
 *
 * `data.json` is user-editable and survives plugin upgrades, so every read goes
 * through {@link mergeSettings}, which validates each field and falls back to
 * the default rather than trusting the file.
 */

import {
	DEFAULT_LEVEL_FOLDER_NAMES,
	DEFAULT_COLUMN_WIDTH,
	DEFAULT_SWIMLANE_HEIGHT,
	CARD_LAYOUTS,
	KANBAN_GROUP_BY,
	KANBAN_SWIM_LANES,
	MAX_COLUMN_WIDTH,
	MAX_SWIMLANE_HEIGHT,
	MIN_COLUMN_WIDTH,
	MIN_SWIMLANE_HEIGHT,
	isLevel,
	isPriority,
	isRolloverBehavior,
	isSortMode,
	isValidPeriod,
	LEVELS,
	cloneStatusesByLevel,
	normalizeLevelFolderName,
	normalizeStatusRegistries,
	PRIORITIES,
	ROLLOVER_BEHAVIORS,
	SORT_MODES,
	normalizeTagColors,
	type CardLayout,
	type KanbanGroupBy,
	type KanbanSwimLane,
	type Level,
	type LevelFolderLayout,
	type Priority,
	type RolloverBehavior,
	type SortMode,
	type StatusRegistries,
	type TagColors,
} from "./domain";
import { asRecord } from "./util/records";

/** Whether a card shows its priority, tags, due date, parent, child progress and period. */
export interface CardMetadataSettings {
	priority: boolean;
	tags: boolean;
	due: boolean;
	parent: boolean;
	childProgress: boolean;
	period: boolean;
}

/** The last board the user looked at, restored on the next launch. */
export interface BoardViewState {
	level: Level;
	/** Period string of the last board, or `null` for the objectives board. */
	period: string | null;
}

/** Kanban layout options for one board. */
export interface KanbanSettings {
	/** Property the columns are built from. */
	groupBy: KanbanGroupBy;
	/** Optional second, horizontal grouping dimension. */
	swimLane: KanbanSwimLane;
	/** Column width in pixels, 200-500. */
	columnWidth: number;
	/** Height cap per swimlane row in pixels, 300-1200. */
	maxSwimLaneHeight: number;
	/** Hide swimlanes that have no visible cards. */
	hideEmptySwimLanes: boolean;
	/** Columns kept visible even when empty. */
	pinnedColumns: string[];
	/** Per-column work-in-progress limits, shown as `current/limit`. */
	wipLimits: Record<string, number>;
	/** Card density. */
	cardLayout: CardLayout;
	/** When on, a task with several tags appears in each tag column. */
	explodeListColumns: boolean;
	/** Column drag order, per grouping property. */
	columnOrder: Record<KanbanGroupBy, string[]>;
}

/** A fresh Kanban configuration: status columns, no swimlanes. */
export function defaultKanbanSettings(): KanbanSettings {
	return {
		groupBy: "status",
		swimLane: "none",
		columnWidth: DEFAULT_COLUMN_WIDTH,
		maxSwimLaneHeight: DEFAULT_SWIMLANE_HEIGHT,
		hideEmptySwimLanes: true,
		pinnedColumns: [],
		wipLimits: {},
		cardLayout: "default",
		explodeListColumns: true,
		columnOrder: { status: [], priority: [], tags: [] },
	};
}

/** The full persisted settings object. */
export interface TaskFlowSettings {
	/** Vault folder new task notes are created in. Always has a trailing slash. */
	taskFolder: string;
	/**
	 * Whether each horizon gets its own folder under the task root.
	 *
	 * When off, every task lives flat in the task root and the plugin raises no
	 * folder warnings: the layout is the user's choice, not a mistake.
	 */
	folderPerLevel: boolean;
	/** Folder name per horizon, used when {@link folderPerLevel} is on. */
	levelFolderNames: Record<Level, string>;
	/** Use the colour-blind-safe default palette for status colours. */
	colorBlindSafe: boolean;
	/** Colour overrides for individual tags, keyed by normalised tag name. */
	tagColors: TagColors;
	/** Per-board status registries; each board's columns are its statuses in order. */
	statuses: StatusRegistries;
	/** Per-board Kanban layout: grouping, swimlanes, column config. */
	kanban: Record<Level, KanbanSettings>;
	/** Priorities offered in pickers. */
	enabledPriorities: Priority[];
	/** Horizons shown in the board switcher. Never empty. */
	enabledLevels: Level[];
	/** Whether the horizon table is enforced when creating parent links. */
	strictHierarchy: boolean;
	/** Rollover behaviour for incomplete tasks, per horizon. */
	rollover: Record<Level, RolloverBehavior>;
	collapseEmptyTerminalColumns: boolean;
	hideEmptyColumns: boolean;
	sortWithinColumn: SortMode;
	/** Horizon opened on startup. Always one of {@link enabledLevels}. */
	defaultLevel: Level;
	showCardMetadata: CardMetadataSettings;
	/** Runtime state, not a preference: restored so the app reopens where it was. */
	boardState: BoardViewState;
}

/** The settings a fresh install starts with. */
export const DEFAULT_SETTINGS: TaskFlowSettings = {
	taskFolder: "Tasks/",
	folderPerLevel: true,
	levelFolderNames: { ...DEFAULT_LEVEL_FOLDER_NAMES },
	colorBlindSafe: false,
	tagColors: {},
	statuses: cloneStatusesByLevel(),
	kanban: defaultKanbanByLevel(),
	enabledPriorities: [...PRIORITIES],
	enabledLevels: [...LEVELS],
	strictHierarchy: true,
	rollover: {
		daily: "auto",
		weekly: "auto",
		monthly: "auto",
		quarterly: "auto",
		yearly: "auto",
		objective: "never",
	},
	collapseEmptyTerminalColumns: false,
	hideEmptyColumns: false,
	sortWithinColumn: "manual",
	defaultLevel: "daily",
	showCardMetadata: { priority: true, tags: true, due: true, parent: true, childProgress: true, period: false },
	boardState: { level: "daily", period: null },
};

function pickBoolean(value: unknown, fallback: boolean): boolean {
	return typeof value === "boolean" ? value : fallback;
}

function pickEnum<T extends string>(
	value: unknown,
	allowed: readonly T[],
	fallback: T,
): T {
	return typeof value === "string" && (allowed as readonly string[]).includes(value)
		? (value as T)
		: fallback;
}

/**
 * Picks the entries of `allowed` that appear in the stored value, in canonical
 * order. Unknown entries are dropped, so a renamed level disappears quietly
 * instead of corrupting the settings.
 */
function pickEnumArray<T extends string>(
	value: unknown,
	allowed: readonly T[],
	fallback: readonly T[],
): T[] {
	if (!Array.isArray(value)) {
		return [...fallback];
	}
	const present = new Set(
		value.filter(
			(entry): entry is T =>
				typeof entry === "string" && (allowed as readonly string[]).includes(entry),
		),
	);
	return allowed.filter((entry) => present.has(entry));
}

/**
 * Repairs a user-supplied vault path: forward slashes only, no leading slash,
 * no doubled separators, and always a trailing slash.
 */
export function normalizeTaskFolder(folder: string): string {
	const collapsed = folder
		.trim()
		.replace(/\\/g, "/")
		.replace(/\/{2,}/g, "/")
		.replace(/^\/+/, "");
	if (collapsed === "") {
		return DEFAULT_SETTINGS.taskFolder;
	}
	return collapsed.endsWith("/") ? collapsed : `${collapsed}/`;
}

/**
 * The folder layout the repository and the views work from.
 *
 * A projection of the settings rather than a second copy of them, so there is
 * one place that decides where a task of a given horizon lives.
 */
export function folderLayoutOf(settings: TaskFlowSettings): LevelFolderLayout {
	return {
		enabled: settings.folderPerLevel,
		root: settings.taskFolder,
		names: settings.levelFolderNames,
	};
}

/**
 * Repairs the per-horizon folder names.
 *
 * Names are forced to be unique: two horizons sharing a folder would merge their
 * boards' storage, and there would be no way to tell the layouts apart. A
 * collision is resolved by appending the horizon name.
 */
function mergeLevelFolderNames(stored: unknown): Record<Level, string> {
	const raw = asRecord(stored);
	const names = {} as Record<Level, string>;
	const taken = new Set<string>();

	for (const level of LEVELS) {
		const requested = typeof raw[level] === "string" ? raw[level] : "";
		let name = normalizeLevelFolderName(requested, level);
		while (taken.has(name.toLowerCase())) {
			name = normalizeLevelFolderName(`${name} ${level}`, level);
		}
		taken.add(name.toLowerCase());
		names[level] = name;
	}
	return names;
}

function mergeRollover(stored: unknown): Record<Level, RolloverBehavior> {
	const raw = asRecord(stored);
	const merged = {} as Record<Level, RolloverBehavior>;
	for (const level of LEVELS) {
		merged[level] = pickEnum(
			raw[level],
			ROLLOVER_BEHAVIORS,
			DEFAULT_SETTINGS.rollover[level],
		);
	}
	return merged;
}

function mergeCardMetadata(stored: unknown): CardMetadataSettings {
	const raw = asRecord(stored);
	const fallback = DEFAULT_SETTINGS.showCardMetadata;
	return {
		priority: pickBoolean(raw.priority, fallback.priority),
		tags: pickBoolean(raw.tags, fallback.tags),
		due: pickBoolean(raw.due, fallback.due),
		parent: pickBoolean(raw.parent, fallback.parent),
		childProgress: pickBoolean(raw.childProgress, fallback.childProgress),
		period: pickBoolean(raw.period, fallback.period),
	};
}

function mergeBoardState(
	stored: unknown,
	enabledLevels: readonly Level[],
	defaultLevel: Level,
): BoardViewState {
	const raw = asRecord(stored);
	const level = pickEnum(raw.level, enabledLevels, defaultLevel);
	const period = raw.period;
	if (level === "objective" || typeof period !== "string") {
		return { level, period: null };
	}
	return { level, period: isValidPeriod(period, level) ? period : null };
}

/** One fresh Kanban configuration per horizon. */
function defaultKanbanByLevel(): Record<Level, KanbanSettings> {
	const kanban = {} as Record<Level, KanbanSettings>;
	for (const level of LEVELS) {
		kanban[level] = defaultKanbanSettings();
	}
	return kanban;
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return fallback;
	}
	return Math.max(min, Math.min(max, Math.round(value)));
}

function pickStringArray(value: unknown): string[] {
	if (!Array.isArray(value)) {
		return [];
	}
	const seen = new Set<string>();
	const result: string[] = [];
	for (const entry of value) {
		if (typeof entry !== "string") {
			continue;
		}
		const trimmed = entry.trim();
		if (trimmed === "" || seen.has(trimmed)) {
			continue;
		}
		seen.add(trimmed);
		result.push(trimmed);
	}
	return result;
}

function mergeWipLimits(stored: unknown): Record<string, number> {
	const raw = asRecord(stored);
	const limits: Record<string, number> = {};
	for (const [key, value] of Object.entries(raw)) {
		if (typeof value === "number" && Number.isFinite(value) && value > 0) {
			limits[key] = Math.round(value);
		}
	}
	return limits;
}

function mergeColumnOrder(stored: unknown): Record<KanbanGroupBy, string[]> {
	const raw = asRecord(stored);
	const order = {} as Record<KanbanGroupBy, string[]>;
	for (const groupBy of KANBAN_GROUP_BY) {
		order[groupBy] = pickStringArray(raw[groupBy]);
	}
	return order;
}

function mergeKanbanSettings(stored: unknown, fallback: KanbanSettings): KanbanSettings {
	const raw = asRecord(stored);
	const groupBy = pickEnum(raw.groupBy, KANBAN_GROUP_BY, fallback.groupBy);
	let swimLane = pickEnum(raw.swimLane, KANBAN_SWIM_LANES, fallback.swimLane);
	// A property cannot be both the column axis and the row axis.
	if (swimLane === groupBy) {
		swimLane = "none";
	}
	return {
		groupBy,
		swimLane,
		columnWidth: clampNumber(
			raw.columnWidth,
			MIN_COLUMN_WIDTH,
			MAX_COLUMN_WIDTH,
			fallback.columnWidth,
		),
		maxSwimLaneHeight: clampNumber(
			raw.maxSwimLaneHeight,
			MIN_SWIMLANE_HEIGHT,
			MAX_SWIMLANE_HEIGHT,
			fallback.maxSwimLaneHeight,
		),
		hideEmptySwimLanes: pickBoolean(raw.hideEmptySwimLanes, fallback.hideEmptySwimLanes),
		pinnedColumns: pickStringArray(raw.pinnedColumns),
		wipLimits: mergeWipLimits(raw.wipLimits),
		cardLayout: pickEnum(raw.cardLayout, CARD_LAYOUTS, fallback.cardLayout),
		explodeListColumns: pickBoolean(
			raw.explodeListColumns,
			fallback.explodeListColumns,
		),
		columnOrder: mergeColumnOrder(raw.columnOrder),
	};
}

function mergeKanban(stored: unknown): Record<Level, KanbanSettings> {
	const raw = asRecord(stored);
	const kanban = {} as Record<Level, KanbanSettings>;
	for (const level of LEVELS) {
		kanban[level] = mergeKanbanSettings(raw[level], defaultKanbanSettings());
	}
	return kanban;
}

/**
 * Turns arbitrary persisted data into a complete settings object.
 *
 * @param stored The parsed contents of `data.json` (or `null` on first run).
 * @returns Settings with every field present and valid.
 */export function mergeSettings(stored: unknown): TaskFlowSettings {
	const raw = asRecord(stored);

	let enabledLevels = pickEnumArray(
		raw.enabledLevels,
		LEVELS,
		DEFAULT_SETTINGS.enabledLevels,
	);
	if (enabledLevels.length === 0) {
		enabledLevels = [...LEVELS];
	}

	const enabledPriorities = pickEnumArray(
		raw.enabledPriorities,
		PRIORITIES,
		DEFAULT_SETTINGS.enabledPriorities,
	);

	const statuses = normalizeStatusRegistries(raw.statuses);

	const requestedDefault = pickEnum(
		raw.defaultLevel,
		LEVELS,
		DEFAULT_SETTINGS.defaultLevel,
	);
	const defaultLevel = enabledLevels.includes(requestedDefault)
		? requestedDefault
		: (enabledLevels[0] ?? DEFAULT_SETTINGS.defaultLevel);

	const folder =
		typeof raw.taskFolder === "string"
			? normalizeTaskFolder(raw.taskFolder)
			: DEFAULT_SETTINGS.taskFolder;

	return {
		taskFolder: folder,
		folderPerLevel: pickBoolean(raw.folderPerLevel, DEFAULT_SETTINGS.folderPerLevel),
		levelFolderNames: mergeLevelFolderNames(raw.levelFolderNames),
		colorBlindSafe: pickBoolean(raw.colorBlindSafe, DEFAULT_SETTINGS.colorBlindSafe),
		tagColors: normalizeTagColors(raw.tagColors),
		statuses,
		kanban: mergeKanban(raw.kanban),
		enabledPriorities:
			enabledPriorities.length > 0
				? enabledPriorities
				: [...DEFAULT_SETTINGS.enabledPriorities],
		enabledLevels,
		strictHierarchy: pickBoolean(
			raw.strictHierarchy,
			DEFAULT_SETTINGS.strictHierarchy,
		),
		rollover: mergeRollover(raw.rollover),
		collapseEmptyTerminalColumns: pickBoolean(
			raw.collapseEmptyTerminalColumns,
			DEFAULT_SETTINGS.collapseEmptyTerminalColumns,
		),
		hideEmptyColumns: pickBoolean(
			raw.hideEmptyColumns,
			DEFAULT_SETTINGS.hideEmptyColumns,
		),
		sortWithinColumn: pickEnum(
			raw.sortWithinColumn,
			SORT_MODES,
			DEFAULT_SETTINGS.sortWithinColumn,
		),
		defaultLevel,
		showCardMetadata: mergeCardMetadata(raw.showCardMetadata),
		boardState: mergeBoardState(raw.boardState, enabledLevels, defaultLevel),
	};
}

/** Runtime guards re-exported so the settings UI can validate dropdown values. */
export { isLevel, isPriority, isRolloverBehavior, isSortMode };
