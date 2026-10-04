/**
 * Editing rules for a task: what a valid draft looks like, who may be a parent,
 * and what has to change when the horizon changes.
 *
 * Pure and fully tested - the modal, the quick-add box and the parent picker are
 * all thin skins over these functions, so the rules live in one place instead of
 * being duplicated across three forms.
 */

import { buildChildIndex, buildTaskLookup } from "./board";
import { ALLOWED_PARENT_LEVELS, isAllowedParentLevel, isLinkPermitted } from "./hierarchy";
import { parseLinkRef } from "./links";
import { convertPeriod, isValidPeriod } from "./periods";
import { defaultStatusId, findStatus, type StatusRegistries } from "./statuses";
import type {
	Level,
	Priority,
	Task,
	TaskFields,
} from "./types";
import { normalizeFramework, sameFramework, type ObjectiveFramework } from "./framework";

/** The fields a user can edit. */
export interface TaskDraft {
	title: string;
	status: string;
	priority: Priority;
	level: Level;
	period: string | null;
	parent: string | null;
	tags: string[];
	due: string | null;
	/**
	 * The note's text below its frontmatter.
	 *
	 * Set when creating. When editing, the form loads the current body into this
	 * field, so the same draft shape covers both modes. Indexing never reads note
	 * text, so the value starts empty and is filled in by the caller.
	 */
	body: string;
	/** The goal/execution framework; only ever filled in on an objective. */
	framework: ObjectiveFramework;
}

/**
 * Everything the form can write.
 *
 * `body` is the odd one out: it is note text rather than frontmatter, so it is
 * written by a different repository call than the rest of the keys.
 */
export type TaskEditKey = keyof TaskFields | "body";

/** Why a draft cannot be saved, or why it deserves a warning. */
export type DraftIssueCode =
	| "empty-title"
	| "unknown-status"
	| "missing-period"
	| "invalid-period"
	| "invalid-due"
	| "self-parent"
	| "descendant-parent"
	| "invalid-parent-level";

/** A problem with a draft. `error` blocks saving; `warning` does not. */
export interface DraftIssue {
	code: DraftIssueCode;
	severity: "error" | "warning";
}

/** Everything validation needs to know about the vault. */
export interface DraftContext {
	/** Every board's status registry, keyed by horizon. */
	registries: StatusRegistries;
	tasks: readonly Task[];
	strictHierarchy: boolean;
	/** Path of the task being edited; omitted when creating a new one. */
	selfPath?: string;
}

/** What changed as a side effect of picking a different horizon. */
export type LevelChangeNoteCode =
	| "period-converted"
	| "period-dropped"
	| "period-required"
	| "parent-cleared";

/** A consequence of a level change, so the UI can explain itself. */
export interface LevelChangeNote {
	code: LevelChangeNoteCode;
	/** Title of a parent that had to be cleared, when there was one. */
	parentTitle?: string;
}

/** The draft plus the explanation of what a level change did. */
export interface LevelChangeResult {
	draft: TaskDraft;
	notes: readonly LevelChangeNote[];
}

/** Builds a draft from an existing task. */
export function draftFromTask(task: Task): TaskDraft {
	return {
		title: task.title,
		status: task.status,
		priority: task.priority,
		level: task.level,
		period: task.period,
		parent: task.parent,
		tags: [...task.tags],
		due: task.due,
		// The caller fills this in when it wants to edit the note text; a task read
		// from the index deliberately carries no body.
		body: "",
		framework: normalizeFramework(task.framework),
	};
}

/**
 * Checks a draft.
 *
 * The parent is checked against the horizon *table*, not against whether the
 * link would be permitted right now, so a draft gets exactly the same judgement
 * as the badge the board puts on the card. Only structural problems are errors:
 * the documented rule is that an invalid link is flagged and never blocks the
 * user from saving their work.
 */
export function validateDraft(draft: TaskDraft, context: DraftContext): DraftIssue[] {
	const issues: DraftIssue[] = [];

	if (draft.title.trim() === "") {
		issues.push({ code: "empty-title", severity: "error" });
	}
	if (findStatus(context.registries[draft.level], draft.status) === undefined) {
		issues.push({ code: "unknown-status", severity: "error" });
	}

	if (draft.level !== "objective") {
		if (draft.period === null) {
			issues.push({ code: "missing-period", severity: "error" });
		} else if (!isValidPeriod(draft.period, draft.level)) {
			issues.push({ code: "invalid-period", severity: "error" });
		}
	}

	if (draft.due !== null && !isValidPeriod(draft.due, "daily")) {
		// A due date is a calendar day, so the daily period format is the check.
		issues.push({ code: "invalid-due", severity: "error" });
	}

	if (draft.parent !== null) {
		const node = resolveParent(draft.parent, context.tasks);
		if (node !== null) {
			if (node.path === context.selfPath) {
				issues.push({ code: "self-parent", severity: "error" });
			} else if (
				context.selfPath !== undefined &&
				collectDescendantPaths(context.tasks, context.selfPath).has(node.path)
			) {
				issues.push({ code: "descendant-parent", severity: "error" });
			} else if (!isAllowedParentLevel(draft.level, node.level)) {
				issues.push({ code: "invalid-parent-level", severity: "warning" });
			}
		}
	}

	return issues;
}

/** Whether a draft can be saved. */
export function isDraftSaveable(issues: readonly DraftIssue[]): boolean {
	return !issues.some((issue) => issue.severity === "error");
}

function resolveParent(ref: string, tasks: readonly Task[]): Task | null {
	return buildTaskLookup(tasks)(parseLinkRef(ref) ?? "");
}

/**
 * Every task beneath `rootPath`, following parent links.
 *
 * Used to keep a task from being linked under its own descendant, which would
 * detach a whole subtree from the goal tree. Cycle safe: a path is visited at
 * most once.
 */
export function collectDescendantPaths(
	tasks: readonly Task[],
	rootPath: string,
): Set<string> {
	const index = buildChildIndex(tasks);
	const seen = new Set<string>();
	const queue = [rootPath];

	while (queue.length > 0) {
		const current = queue.pop();
		if (current === undefined) {
			break;
		}
		for (const child of index.get(current) ?? []) {
			if (child.path === rootPath || seen.has(child.path)) {
				continue;
			}
			seen.add(child.path);
			queue.push(child.path);
		}
	}
	return seen;
}

/**
 * The tasks that may be the parent of this draft: the right horizon, not the
 * task itself, and not one of its own descendants.
 *
 * With the folder-per-level layout, filtering by horizon *is* filtering by
 * folder - the folder is derived from the level - so this covers both layouts.
 *
 * Ordered by title so the picker's own fuzzy ranking does the rest.
 */
export function parentCandidates(
	draft: Pick<TaskDraft, "level" | "parent">,
	context: DraftContext,
): Task[] {
	const excluded =
		context.selfPath === undefined
			? new Set<string>()
			: collectDescendantPaths(context.tasks, context.selfPath);

	return context.tasks
		.filter((task) => {
			if (task.path === context.selfPath || excluded.has(task.path)) {
				return false;
			}
			return isLinkPermitted(draft.level, task.level, context.strictHierarchy);
		})
		.sort((a, b) => (a.title < b.title ? -1 : a.title > b.title ? 1 : 0));
}

/**
 * The horizon chips the parent picker shows, in horizon order.
 *
 * Only horizons that are both allowed for the child *and* actually hold a
 * candidate appear: a chip leading to an empty list would be a dead end, and a
 * horizon the user has disabled should not be offered at all.
 */
export function parentFilterOptions(
	childLevel: Level,
	candidates: readonly Task[],
	enabledLevels: readonly Level[],
): { level: Level; count: number }[] {
	return ALLOWED_PARENT_LEVELS[childLevel]
		.filter((level) => enabledLevels.includes(level))
		.map((level) => ({
			level,
			count: candidates.filter((task) => task.level === level).length,
		}))
		.filter((option) => option.count > 0);
}

/**
 * Applies a horizon change to a draft.
 *
 * Two things can no longer hold once the horizon moves, so they are repaired
 * here rather than left broken:
 *
 * - the **period** is re-expressed on the new horizon (a day becomes the week
 *   that contains it), or cleared for objectives;
 * - the **parent** is cleared when its horizon is no longer allowed. The caller
 *   gets a note back so the user can be told and offered a new parent.
 *
 * @param reference Date used when a period has to be invented, normally today.
 */
export function applyLevelChange(
	draft: TaskDraft,
	level: Level,
	context: Omit<DraftContext, "selfPath">,
	reference: Date,
): LevelChangeResult {
	if (level === draft.level) {
		return { draft, notes: [] };
	}
	const notes: LevelChangeNote[] = [];

	let period = draft.period;
	if (level === "objective") {
		if (period !== null) {
			notes.push({ code: "period-dropped" });
			period = null;
		}
	} else if (!isValidPeriod(period, level)) {
		period = convertPeriod(period, draft.level, level, reference);
		notes.push({
			code: period === null ? "period-required" : "period-converted",
		});
	}

	let parent = draft.parent;
	if (parent !== null) {
		const parentTask = resolveParent(parent, context.tasks);
		if (level === "objective") {
			parent = null;
			notes.push({ code: "parent-cleared", parentTitle: parentTask?.title });
		} else if (
			parentTask !== null &&
			!isLinkPermitted(level, parentTask.level, context.strictHierarchy)
		) {
			parent = null;
			notes.push({ code: "parent-cleared", parentTitle: parentTask.title });
		}
	}

	// Boards have their own statuses, so a status that does not exist on the new
	// board falls back to that board's first column instead of blocking the save.
	const registry = context.registries[level];
	const status =
		findStatus(registry, draft.status) === undefined
			? defaultStatusId(registry)
			: draft.status;

	return { draft: { ...draft, level, period, parent, status }, notes };
}

/**
 * The fields that actually changed between two drafts.
 *
 * The repository is told to write only these, which is what stops an unrelated
 * edit from rewriting - and possibly mangling - the rest of the frontmatter.
 */
export function changedFields(
	before: TaskDraft,
	after: TaskDraft,
): TaskEditKey[] {
	const keys: TaskEditKey[] = [];
	if (before.title !== after.title) {
		keys.push("title");
	}
	if (before.status !== after.status) {
		keys.push("status");
	}
	if (before.priority !== after.priority) {
		keys.push("priority");
	}
	if (before.level !== after.level) {
		keys.push("level");
	}
	if (before.period !== after.period) {
		keys.push("period");
	}
	if (before.parent !== after.parent) {
		keys.push("parent");
	}
	if (before.due !== after.due) {
		keys.push("due");
	}
	if (before.tags.join("\u0000") !== after.tags.join("\u0000")) {
		keys.push("tags");
	}
	if (before.body !== after.body) {
		keys.push("body");
	}
	if (!sameFramework(before.framework, after.framework)) {
		keys.push("framework");
	}
	return keys;
}

/**
 * Every field the task form can edit, in a stable order.
 *
 * Passing this to {@link pickFields} takes a full snapshot of the editable
 * state, which is exactly what an undo entry needs. The note body is left out on
 * purpose: undo restores frontmatter, and rewriting someone's note text as a
 * side effect of undoing a drag would be the opposite of helpful.
 */
export const EDITABLE_FIELD_KEYS = [
	"title",
	"status",
	"priority",
	"level",
	"period",
	"parent",
	"tags",
	"due",
	"framework",
] as const satisfies readonly (keyof TaskFields)[];

/**
 * The subset of a draft that should be written, restricted to `keys`.
 *
 * Built field by field rather than by copying and deleting, so it stays fully
 * typed and it is obvious that a field not listed can never reach the note.
 */
export function pickFields(
	after: TaskDraft,
	keys: readonly TaskEditKey[],
): Partial<TaskFields> {
	const wanted = new Set<TaskEditKey>(keys);
	const patch: Partial<TaskFields> = {};
	if (wanted.has("title")) {
		patch.title = after.title.trim();
	}
	if (wanted.has("status")) {
		patch.status = after.status;
	}
	if (wanted.has("priority")) {
		patch.priority = after.priority;
	}
	if (wanted.has("level")) {
		patch.level = after.level;
	}
	if (wanted.has("period")) {
		patch.period = after.period;
	}
	if (wanted.has("parent")) {
		patch.parent = after.parent;
	}
	if (wanted.has("tags")) {
		patch.tags = [...after.tags];
	}
	if (wanted.has("due")) {
		patch.due = after.due;
	}
	if (wanted.has("framework")) {
		// Normalised here rather than at the writer: what lands in the store and
		// what lands in the note have to be the same thing.
		patch.framework = normalizeFramework(after.framework);
	}
	return patch;
}

/** Parses a comma or space separated tag string into a clean list. */
export function parseTagInput(input: string): string[] {
	const tags: string[] = [];
	const seen = new Set<string>();
	for (const raw of input.split(/[,\s]+/)) {
		const tag = raw.trim().replace(/^#+/, "").toLowerCase();
		if (tag === "" || seen.has(tag)) {
			continue;
		}
		seen.add(tag);
		tags.push(tag);
	}
	return tags;
}

/** Renders a tag list for the text field. */
export function formatTagInput(tags: readonly string[]): string {
	return tags.join(", ");
}
