/**
 * Core domain types for Horizon Task.
 *
 * This module (and everything else under `domain/`) is deliberately free of
 * Obsidian and Node imports so that the whole layer is unit-testable without a
 * vault, a `MetadataCache` or a running app.
 */

import type { ObjectiveFramework } from "./framework";

/** All time horizons, ordered from the finest to the coarsest granularity. */
export const LEVELS = [
	"daily",
	"weekly",
	"monthly",
	"quarterly",
	"yearly",
	"objective",
] as const;

/** A time horizon. Every task belongs to exactly one level. */
export type Level = (typeof LEVELS)[number];

/** Levels that are scoped to a period. `objective` is deliberately excluded. */
export const PERIOD_LEVELS = [
	"daily",
	"weekly",
	"monthly",
	"quarterly",
	"yearly",
] as const;

/** A horizon that is bound to a calendar period. */
export type PeriodLevel = (typeof PERIOD_LEVELS)[number];

/**
 * How coarse a level is. The parent of a task must always have a strictly
 * higher rank, which is what makes cycles impossible by construction.
 */
export const LEVEL_RANK: Record<Level, number> = {
	daily: 0,
	weekly: 1,
	monthly: 2,
	quarterly: 3,
	yearly: 4,
	objective: 5,
};

/** Whether the level is bound to a calendar period. */
export function isPeriodLevel(level: Level): level is PeriodLevel {
	return level !== "objective";
}

/** Runtime guard for the `Level` union, used when parsing untrusted data. */
export function isLevel(value: unknown): value is Level {
	return typeof value === "string" && (LEVELS as readonly string[]).includes(value);
}

/** Task priority, ordered from least to most severe. */
export const PRIORITIES = ["none", "low", "medium", "high", "urgent"] as const;

/** A task priority. */
export type Priority = (typeof PRIORITIES)[number];

/** Severity ranking for priorities; higher wins. */
export const PRIORITY_RANK: Record<Priority, number> = {
	none: 0,
	low: 1,
	medium: 2,
	high: 3,
	urgent: 4,
};

/** Runtime guard for the `Priority` union. */
export function isPriority(value: unknown): value is Priority {
	return typeof value === "string" && (PRIORITIES as readonly string[]).includes(value);
}

/** Lifecycle bucket a status belongs to. */
export const STATUS_CATEGORIES = ["todo", "active", "done", "cancelled"] as const;

/** The lifecycle bucket of a status. */
export type StatusCategory = (typeof STATUS_CATEGORIES)[number];

/** Runtime guard for the `StatusCategory` union. */
export function isStatusCategory(value: unknown): value is StatusCategory {
	return (
		typeof value === "string" && (STATUS_CATEGORIES as readonly string[]).includes(value)
	);
}

/** How cards are ordered inside a column. */
export const SORT_MODES = ["manual", "priority", "due", "created"] as const;

/** A column sort strategy. `manual` uses the `order` fractional index. */
export type SortMode = (typeof SORT_MODES)[number];

/** Runtime guard for the `SortMode` union. */
export function isSortMode(value: unknown): value is SortMode {
	return typeof value === "string" && (SORT_MODES as readonly string[]).includes(value);
}

/** Per-level rollover behaviour for incomplete tasks. */
export const ROLLOVER_BEHAVIORS = ["ask", "auto", "never"] as const;

/** How incomplete tasks are carried into the next period. */
export type RolloverBehavior = (typeof ROLLOVER_BEHAVIORS)[number];

/** Runtime guard for the `RolloverBehavior` union. */
export function isRolloverBehavior(value: unknown): value is RolloverBehavior {
	return (
		typeof value === "string" && (ROLLOVER_BEHAVIORS as readonly string[]).includes(value)
	);
}

/**
 * A board column definition. Statuses belong to a single board, so each
 * horizon has its own registry and its own columns.
 */
export interface StatusDefinition {
	/** Stable identifier stored in task frontmatter. Renaming the label keeps the id. */
	id: string;
	/** Human readable column title. */
	label: string;
	/** Any CSS colour, used for the column header accent and the card chip. */
	color: string;
	/** Which lifecycle bucket the status belongs to. */
	category: StatusCategory;
	/** Position of the column on the board, ascending. */
	order: number;
	/**
	 * Minutes a card may sit in this status before it is archived. Only meaningful
	 * for `done` statuses; `null`/absent disables archiving.
	 */
	archiveAfterMinutes?: number | null;
}

/** The task payload, as stored in frontmatter. Identity is the file path. */
export interface TaskFields {
	/** Display title; falls back to the file basename when absent. */
	title: string;
	/** Id of a status in the task's own board registry. */
	status: string;
	priority: Priority;
	level: Level;
	/** Period string for the task's level, or `null` for objectives. */
	period: string | null;
	/** Raw wikilink reference to the single parent, or `null` for a root task. */
	parent: string | null;
	/** Fractional index used for manual ordering inside a column. */
	order: string;
	/** Tags from frontmatter; inline `#tags` are merged in by the data layer. */
	tags: string[];
	/** ISO `yyyy-MM-dd` due date, or `null`. */
	due: string | null;
	/** ISO `yyyy-MM-dd` creation date, or `null` when unknown. */
	created: string | null;
	/** ISO `yyyy-MM-dd`; set when the status moves into a `done` category. */
	completed: string | null;
	/** Period the task was rolled over from, or `null`. */
	carriedFrom: string | null;
	/** ISO timestamp of when the status moved into a `done` category, or `null`. */
	completedAt?: string | null;
	/** Archived tasks are kept in the vault but hidden from every board. */
	archived?: boolean;
	/**
	 * The goal/execution framework.
	 *
	 * Only objectives carry one: they are the only horizon without a period, so
	 * the plan lives on the note instead of in the calendar. Absent or empty on
	 * every other horizon.
	 */
	framework?: ObjectiveFramework;
}

/** A task plus its stable identity. */
export interface Task extends TaskFields {
	/** Vault path of the markdown file backing the task. */
	path: string;
	/**
	 * Tags found inline in the note body, normalised.
	 *
	 * Read-only by nature: they live in the note text, so the plugin never writes
	 * them into `tags:` frontmatter. {@link TaskFields.tags} is the merged view
	 * used for display and filtering; this field is what tells the two apart.
	 */
	bodyTags: readonly string[];
}

/** Why a parent link is considered broken. */
export type HierarchyIssueCode =
	| "self-link"
	| "objective-with-parent"
	| "invalid-parent-level"
	| "parent-not-found"
	| "cycle";

/**
 * A problem found while validating a task's parent link.
 *
 * Issues are never auto-repaired: the UI shows a badge and offers an explicit
 * "Fix hierarchy" action so that user data is never silently rewritten.
 */
export interface HierarchyIssue {
	code: HierarchyIssueCode;
	/**
	 * `error` marks a structurally broken graph (self link, cycle, objective
	 * with a parent); `warning` marks a link that violates the horizon table.
	 */
	severity: "error" | "warning";
	/** Path of the task the issue was found on. */
	path: string;
	/** The raw parent reference as stored in frontmatter, when there is one. */
	parentRef?: string;
	/** Resolved path of the parent, when it could be resolved. */
	parentPath?: string;
}
