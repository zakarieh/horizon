/**
 * Mapping between note frontmatter and the domain {@link Task}.
 *
 * Pure: it takes plain objects and strings, never a `TFile`, so every rule here
 * is unit-tested. The repository is the only thing that knows about the vault.
 *
 * Two invariants matter more than anything else in this file:
 *
 * 1. **Reads never invent data.** A note that is not marked as a task is left
 *    alone, and a value the plugin does not understand is never guessed at.
 * 2. **Writes never destroy data.** Only the keys the caller explicitly asked
 *    to change are touched, so an unrecognised `due: next tuesday` survives
 *    every write that is not itself editing the due date.
 */

import {
	FRAMEWORK_TERMS,
	basename,
	firstOrderKey,
	frameworkIsEmpty,
	isLevel,
	isPriority,
	isValidOrderKey,
	isValidPeriod,
	normalizeFramework,
	normalizeTag,
	parseLinkRef,
	toLinkRef,
	type Level,
	type Task,
	type TaskFields,
} from "../domain";
import { asRecord, isRecord, trimmedOrNull } from "../util/records";

/** Frontmatter key that marks a note as a task. */
export const TASK_MARKER = "tf-task";

/** A frontmatter record, mutable so it can be handed to `processFrontMatter`. */
export type FrontmatterRecord = Record<string, unknown>;

/** A field the plugin knows how to write. */
export type TaskFieldKey = keyof TaskFields;

/** All writable fields, used when creating a note or rewriting one wholesale. */
export const WRITABLE_FIELD_KEYS: readonly TaskFieldKey[] = [
	"title",
	"status",
	"priority",
	"level",
	"period",
	"parent",
	"order",
	"tags",
	"due",
	"created",
	"completed",
	"carriedFrom",
	"completedAt",
	"archived",
	"framework",
];

/** Why a note could not be placed on a board, or is filed oddly. */
export type TaskProblemKind =
	| "invalid-level"
	| "missing-period"
	| "invalid-period"
	| "folder-mismatch";

/** A note that is marked as a task but needs attention. */
export interface TaskProblem {
	path: string;
	kind: TaskProblemKind;
	/** Folder the task belongs in, for a `folder-mismatch`. */
	expectedFolder?: string;
}

/** The outcome of reading one note. */
export type TaskReadOutcome =
	| { kind: "not-a-task" }
	/** Marked as a task, but with no usable level, so it cannot be placed. */
	| { kind: "unusable"; problem: TaskProblem }
	/** A usable task, which may still carry problems such as an unusable period. */
	| { kind: "task"; task: Task; problems: readonly TaskProblem[] };

/** Options for {@link readTask}. */
export interface ReadTaskOptions {
	/** Status id used when a note has no usable `status` field, per board. */
	fallbackStatus: (level: Level) => string;
	/** Order key used when a note has no usable `order` field. */
	fallbackOrder?: string;
}

/** Whether frontmatter carries the task marker. */
export function isTaskFrontmatter(frontmatter: unknown): boolean {
	if (!isRecord(frontmatter)) {
		return false;
	}
	const marker = frontmatter[TASK_MARKER];
	return marker === true || marker === "true";
}

/**
 * Reads one note into a task.
 *
 * @param path Vault path, which is the task's identity.
 * @param frontmatter The parsed frontmatter, as found in the metadata cache.
 * @param inlineTags Inline `#tags` from the note body, as reported by the cache.
 * @param options Defaults applied when the note omits a field.
 */
export function readTask(
	path: string,
	frontmatter: unknown,
	inlineTags: readonly string[],
	options: ReadTaskOptions,
): TaskReadOutcome {
	if (!isTaskFrontmatter(frontmatter)) {
		return { kind: "not-a-task" };
	}

	const fm = asRecord(frontmatter);
	if (!isLevel(fm.level)) {
		return { kind: "unusable", problem: { path, kind: "invalid-level" } };
	}
	const level = fm.level;

	const problems: TaskProblem[] = [];
	const bodyTags = normalizeTags(inlineTags);
	const task: Task = {
		path,
		title: trimmedOrNull(fm.title) ?? basename(path),
		status: trimmedOrNull(fm.status) ?? options.fallbackStatus(level),
		priority: isPriority(fm.priority) ? fm.priority : "none",
		level,
		period: readPeriod(fm.period, level, path, problems),
		parent: parseLinkRef(fm.parent),
		order: readOrder(fm.order, options.fallbackOrder),
		tags: mergeTags(fm.tags, bodyTags),
		bodyTags,
		due: readDate(fm.due),
		created: readDate(fm.created),
		completed: readDate(fm.completed),
		completedAt: trimmedOrNull(fm.completedAt),
		archived: fm.archived === true || fm.archived === "true",
		carriedFrom: trimmedOrNull(fm.carriedFrom),
		framework: normalizeFramework(fm.framework),
	};

	return { kind: "task", task, problems };
}

function readPeriod(
	raw: unknown,
	level: Task["level"],
	path: string,
	problems: TaskProblem[],
): string | null {
	if (level === "objective") {
		if (raw !== undefined && raw !== null) {
			problems.push({ path, kind: "invalid-period" });
		}
		return null;
	}
	const value = readScalar(raw);
	if (value === null) {
		problems.push({ path, kind: "missing-period" });
		return null;
	}
	if (!isValidPeriod(value, level)) {
		problems.push({ path, kind: "invalid-period" });
		return null;
	}
	return value;
}

/**
 * A scalar from frontmatter as a string.
 *
 * YAML resolves a bare number such as a yearly period (`period: 2026`) to a
 * `number`, so a finite number is coerced back to its string form rather than
 * being dropped. This also heals notes written before the writer quoted them.
 */
function readScalar(raw: unknown): string | null {
	if (typeof raw === "number" && Number.isFinite(raw)) {
		return String(raw);
	}
	return trimmedOrNull(raw);
}

/** The order key, falling back when it is missing or not a usable key. */
function readOrder(raw: unknown, fallback: string | undefined): string {
	const value = readScalar(raw);
	return value !== null && isValidOrderKey(value) ? value : (fallback ?? firstOrderKey());
}

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_TIMESTAMP_RE = /^(\d{4}-\d{2}-\d{2})T/;

/**
 * Normalises a date field to `yyyy-MM-dd`.
 *
 * Obsidian may hand back a `Date` rather than a string. Those are UTC based, so
 * they are read back with the UTC getters: using the local ones would turn
 * `2026-09-30` into the 29th for anyone west of Greenwich.
 *
 * Unrecognised values become `null`; they are only ever overwritten when the
 * caller is explicitly editing that field.
 */
function readDate(raw: unknown): string | null {
	if (raw instanceof Date) {
		if (Number.isNaN(raw.getTime())) {
			return null;
		}
		const month = String(raw.getUTCMonth() + 1).padStart(2, "0");
		const day = String(raw.getUTCDate()).padStart(2, "0");
		return `${String(raw.getUTCFullYear())}-${month}-${day}`;
	}

	const value = trimmedOrNull(raw);
	if (value === null) {
		return null;
	}
	if (DATE_ONLY_RE.test(value)) {
		return value;
	}
	return ISO_TIMESTAMP_RE.exec(value)?.[1] ?? null;
}

/**
 * Normalises a list of raw tags: trimmed, no leading `#`, lower-cased, deduped
 * and in first-seen order.
 */
function normalizeTags(raw: readonly unknown[]): string[] {
	const tags: string[] = [];
	const seen = new Set<string>();
	for (const entry of raw) {
		const trimmed = trimmedOrNull(entry);
		if (trimmed === null) {
			continue;
		}
		const tag = normalizeTag(trimmed);
		if (tag === "" || seen.has(tag)) {
			continue;
		}
		seen.add(tag);
		tags.push(tag);
	}
	return tags;
}

/**
 * Merges frontmatter tags with inline body tags.
 *
 * Frontmatter first, so the user's explicit list keeps its order and spelling.
 */
function mergeTags(raw: unknown, bodyTags: readonly string[]): string[] {
	const fromFrontmatter = Array.isArray(raw)
		? normalizeTags(raw)
		: typeof raw === "string"
			? normalizeTags(raw.split(","))
			: [];
	const seen = new Set(fromFrontmatter);
	for (const tag of bodyTags) {
		if (!seen.has(tag)) {
			seen.add(tag);
			fromFrontmatter.push(tag);
		}
	}
	return fromFrontmatter;
}

/**
 * Writes a task's fields into a frontmatter record, in place.
 *
 * @param frontmatter The record to mutate - the live object given to
 * `processFrontMatter`, or a fresh one when creating a note.
 * @param task The task to write.
 * @param keys Which fields to write. Defaults to all of them (a create or a
 * full rewrite). Passing just the fields that changed is what keeps unrelated
 * and unrecognised frontmatter untouched.
 *
 * A field with no value has its key removed rather than written as `null`, so
 * notes stay tidy; reads treat "missing" and "null" identically.
 */
export function applyTaskFields(
	frontmatter: FrontmatterRecord,
	task: Task,
	keys: readonly TaskFieldKey[] = WRITABLE_FIELD_KEYS,
): void {
	const writes = new Set(keys);
	frontmatter[TASK_MARKER] = true;

	if (writes.has("title")) {
		// Only persist a title that differs from the file name, so the file name
		// stays the single source of truth when the user never set one.
		setOrRemove(
			frontmatter,
			"title",
			task.title === basename(task.path) ? null : task.title,
		);
	}
	if (writes.has("status")) {
		frontmatter.status = task.status;
	}
	if (writes.has("priority")) {
		frontmatter.priority = task.priority;
	}
	if (writes.has("level")) {
		frontmatter.level = task.level;
	}
	if (writes.has("period")) {
		setOrRemove(frontmatter, "period", task.period);
	}
	if (writes.has("parent")) {
		setOrRemove(
			frontmatter,
			"parent",
			task.parent === null ? null : toLinkRef(task.parent),
		);
	}
	if (writes.has("order")) {
		frontmatter.order = task.order;
	}
	if (writes.has("tags")) {
		// Only the frontmatter half of the tag list is written: inline `#tags`
		// belong to the note's text, and copying them into frontmatter would
		// duplicate them and start editing the user's prose.
		const bodyTags = new Set(task.bodyTags);
		const frontmatterTags = task.tags.filter((tag) => !bodyTags.has(tag));
		setOrRemove(frontmatter, "tags", frontmatterTags.length === 0 ? null : frontmatterTags);
	}
	if (writes.has("due")) {
		setOrRemove(frontmatter, "due", task.due);
	}
	if (writes.has("created")) {
		setOrRemove(frontmatter, "created", task.created);
	}
	if (writes.has("completed")) {
		setOrRemove(frontmatter, "completed", task.completed);
	}
	if (writes.has("carriedFrom")) {
		setOrRemove(frontmatter, "carriedFrom", task.carriedFrom);
	}
	if (writes.has("completedAt")) {
		setOrRemove(frontmatter, "completedAt", task.completedAt ?? null);
	}
	if (writes.has("archived")) {
		if (task.archived === true) {
			frontmatter.archived = true;
		} else {
			delete frontmatter.archived;
		}
	}
	if (writes.has("framework")) {
		// One nested key rather than twelve flat ones: the terms are generic words
		// (`risks`, `metrics`) that would otherwise sit in the note's root and
		// collide with whatever else the user keeps there.
		const framework = normalizeFramework(task.framework);
		setOrRemove(frontmatter, "framework", frameworkIsEmpty(framework) ? null : framework);
	}
}

function setOrRemove(frontmatter: FrontmatterRecord, key: string, value: unknown): void {
	if (value === null || value === undefined) {
		delete frontmatter[key];
	} else {
		frontmatter[key] = value;
	}
}

const BARE_SCALAR_RE = /^[A-Za-z0-9][A-Za-z0-9 _.-]*$/;
const YAML_KEYWORDS = new Set(["true", "false", "null", "yes", "no", "on", "off", "~"]);
/**
 * A number YAML would resolve to a number rather than a string.
 *
 * A bare yearly period (`period: 2026`) is the important case: written unquoted
 * it comes back from the metadata cache as the number `2026`, not `"2026"`.
 */
const YAML_NUMBER_RE = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/;

/** Quotes a scalar only when YAML would otherwise misread it. */
export function yamlScalar(value: string): string {
	if (
		BARE_SCALAR_RE.test(value) &&
		!YAML_KEYWORDS.has(value.toLowerCase()) &&
		!YAML_NUMBER_RE.test(value)
	) {
		return value;
	}
	return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * Splits note content into its raw frontmatter block and the body that follows.
 *
 * The block is returned verbatim, fences included, rather than re-serialised:
 * that is what lets a body edit leave every other key - including keys this
 * plugin does not understand - exactly as the user wrote them.
 */
export function splitFrontmatter(content: string): { frontmatter: string; body: string } {
	const match = /^---\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n?/.exec(content);
	return match === null
		? { frontmatter: "", body: content }
		: { frontmatter: match[0], body: content.slice(match[0].length) };
}

/**
 * Removes a leading YAML frontmatter block from note content.
 *
 * Used when copying a note: the copy gets freshly generated frontmatter, so the
 * original block must not be carried into the body.
 */
export function stripFrontmatter(content: string): string {
	return splitFrontmatter(content).body;
}

/**
 * Renders a brand new task note.
 *
 * Used when the plugin creates a file, where `processFrontMatter` is not
 * available because it only edits existing notes.
 *
 * @param task The task to serialise. `task.path` decides whether `title` is
 * written at all.
 * @param body Optional note body, typically empty.
 */
export function buildTaskFileContent(task: Task, body = ""): string {
	const lines = ["---", `${TASK_MARKER}: true`];

	if (task.title !== basename(task.path)) {
		lines.push(`title: ${yamlScalar(task.title)}`);
	}
	lines.push(`status: ${yamlScalar(task.status)}`);
	lines.push(`priority: ${yamlScalar(task.priority)}`);
	lines.push(`level: ${yamlScalar(task.level)}`);
	if (task.period !== null) {
		lines.push(`period: ${yamlScalar(task.period)}`);
	}
	if (task.parent !== null) {
		lines.push(`parent: ${yamlScalar(toLinkRef(task.parent))}`);
	}
	lines.push(`order: ${yamlScalar(task.order)}`);
	const bodyTags = new Set(task.bodyTags);
	const frontmatterTags = task.tags.filter((tag) => !bodyTags.has(tag));
	if (frontmatterTags.length > 0) {
		lines.push("tags:");
		for (const tag of frontmatterTags) {
			lines.push(`  - ${yamlScalar(tag)}`);
		}
	}
	if (task.due !== null) {
		lines.push(`due: ${yamlScalar(task.due)}`);
	}
	if (task.created !== null) {
		lines.push(`created: ${yamlScalar(task.created)}`);
	}
	const framework = normalizeFramework(task.framework);
	if (!frameworkIsEmpty(framework)) {
		lines.push("framework:");
		for (const term of FRAMEWORK_TERMS) {
			const value = framework[term];
			if (value !== undefined) {
				lines.push(`  ${term}: ${yamlScalar(value)}`);
			}
		}
	}
	lines.push("---", "");

	if (body !== "") {
		lines.push(body, "");
	}
	return lines.join("\n");
}
