/**
 * The global status registry.
 *
 * Statuses are defined once and shared by every board: a column is simply a
 * status. All functions here are pure and return a new registry rather than
 * mutating the one they are given, so the caller (the settings store) can keep
 * an immutable snapshot for undo.
 *
 * Ids are stable and are what task frontmatter stores, so renaming a label or
 * recolouring a status never touches task files. Deleting a status does, which
 * is why {@link deleteStatus} demands a replacement id.
 */

import {
	LEVELS,
	isStatusCategory,
	type Level,
	type StatusCategory,
	type StatusDefinition,
} from "./types";
import { DEFAULT_STATUS_COLORS } from "./palette";
import { isRecord } from "../util/records";

/**
 * The registry a fresh install starts with.
 * `Backlog`/`Todo` are `todo`, `In Progress`/`Blocked` are `active`, and the
 * two terminal columns are `done` and `cancelled`.
 */
export const DEFAULT_STATUSES: readonly StatusDefinition[] = [
	{
		id: "backlog",
		label: "Backlog",
		color: DEFAULT_STATUS_COLORS.backlog,
		category: "todo",
		order: 0,
	},
	{
		id: "todo",
		label: "Todo",
		color: DEFAULT_STATUS_COLORS.todo,
		category: "todo",
		order: 1,
	},
	{
		id: "in-progress",
		label: "In Progress",
		color: DEFAULT_STATUS_COLORS["in-progress"],
		category: "active",
		order: 2,
	},
	{
		id: "blocked",
		label: "Blocked",
		color: DEFAULT_STATUS_COLORS.blocked,
		category: "active",
		order: 3,
	},
	{
		id: "done",
		label: "Done",
		color: DEFAULT_STATUS_COLORS.done,
		category: "done",
		order: 4,
	},
	{
		id: "cancelled",
		label: "Cancelled",
		color: DEFAULT_STATUS_COLORS.cancelled,
		category: "cancelled",
		order: 5,
	},
];

/** A deep copy of the default registry, safe to mutate in settings. */
export function cloneStatuses(
	statuses: readonly StatusDefinition[] = DEFAULT_STATUSES,
): StatusDefinition[] {
	return statuses.map((status) => ({ ...status }));
}

/** One status registry per board, keyed by horizon. */
export type StatusRegistries = Record<Level, StatusDefinition[]>;

/** A fresh registry for every board, each starting from `source`. */
export function cloneStatusesByLevel(
	source: readonly StatusDefinition[] = DEFAULT_STATUSES,
): StatusRegistries {
	const registries = {} as StatusRegistries;
	for (const level of LEVELS) {
		registries[level] = cloneStatuses(source);
	}
	return registries;
}

/**
 * Repairs a per-board registry map from persisted data.
 *
 * A plain array is the legacy single-registry shape: it is applied to every
 * board so existing installs keep their statuses.
 */
export function normalizeStatusRegistries(raw: unknown): StatusRegistries {
	if (Array.isArray(raw)) {
		return cloneStatusesByLevel(normalizeRegistry(raw));
	}
	const record = isRecord(raw) ? raw : {};
	const registries = {} as StatusRegistries;
	for (const level of LEVELS) {
		registries[level] = normalizeRegistry(
			Array.isArray(record[level]) ? record[level] : [],
		);
	}
	return registries;
}

/** Whether a category means "finished" for the purposes of `completed`. */
export function isTerminalCategory(category: StatusCategory): boolean {
	return category === "done" || category === "cancelled";
}

/**
 * Turns a label into a candidate id: lower case, ASCII alphanumerics and single
 * dashes. Never returns an empty string.
 */
export function slugifyStatusId(label: string): string {
	const slug = label
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return slug === "" ? "status" : slug;
}

/**
 * Repairs a registry that came from user settings or a hand-edited data file:
 * drops malformed entries, de-duplicates ids, sorts by the `order` field and
 * renumbers the column positions from zero.
 *
 * Falls back to {@link DEFAULT_STATUSES} when nothing usable is left.
 */
export function normalizeRegistry(statuses: readonly unknown[]): StatusDefinition[] {
	const seen = new Set<string>();
	const candidates: StatusDefinition[] = [];

	for (const entry of statuses) {
		if (!isRecord(entry)) {
			continue;
		}
		const id = typeof entry.id === "string" ? entry.id.trim() : "";
		const label = typeof entry.label === "string" ? entry.label.trim() : "";
		if (id === "" || label === "" || seen.has(id)) {
			continue;
		}
		seen.add(id);
		const archiveAfterMinutes =
			typeof entry.archiveAfterMinutes === "number" &&
			Number.isFinite(entry.archiveAfterMinutes) &&
			entry.archiveAfterMinutes > 0
				? Math.round(entry.archiveAfterMinutes)
				: null;
		candidates.push({
			id,
			label,
			color:
				typeof entry.color === "string" && entry.color !== ""
					? entry.color
					: DEFAULT_STATUS_COLORS.backlog,
			category: isStatusCategory(entry.category) ? entry.category : "todo",
			order:
				typeof entry.order === "number" && Number.isFinite(entry.order)
					? entry.order
					: candidates.length,
			// Omitted entirely when unset, so statuses without a limit keep the
			// exact same shape as before this field existed.
			...(archiveAfterMinutes === null ? {} : { archiveAfterMinutes }),
		});
	}

	if (candidates.length === 0) {
		return cloneStatuses();
	}

	return candidates
		.map((status, index) => ({ status, index }))
		.sort((a, b) => a.status.order - b.status.order || a.index - b.index)
		.map(({ status }, index) => ({ ...status, order: index }));
}

/** Looks a status up by id. */
export function findStatus(
	registry: readonly StatusDefinition[],
	id: string | null | undefined,
): StatusDefinition | undefined {
	if (id === null || id === undefined) {
		return undefined;
	}
	return registry.find((status) => status.id === id);
}

/** Looks a status up by its (case-insensitive) label. */
export function findStatusByLabel(
	registry: readonly StatusDefinition[],
	label: string,
): StatusDefinition | undefined {
	const needle = label.trim().toLowerCase();
	return registry.find((status) => status.label.toLowerCase() === needle);
}

/** The category of a status id, or `null` when the id is unknown. */
export function statusCategory(
	registry: readonly StatusDefinition[],
	id: string | null | undefined,
): StatusCategory | null {
	return findStatus(registry, id)?.category ?? null;
}

/** Whether a status id means "finished" and should stamp `completed`. */
export function isDoneStatus(
	registry: readonly StatusDefinition[],
	id: string | null | undefined,
): boolean {
	return statusCategory(registry, id) === "done";
}

/** All statuses in a category, in column order. */
export function statusesByCategory(
	registry: readonly StatusDefinition[],
	category: StatusCategory,
): StatusDefinition[] {
	return registry.filter((status) => status.category === category);
}

/** The id of the first `todo` status, or the first status of the registry. */
export function defaultStatusId(registry: readonly StatusDefinition[]): string {
	return statusesByCategory(registry, "todo")[0]?.id ?? registry[0]?.id ?? "";
}

/**
 * The statuses that can replace `id` when it is deleted, best matches first
 * (same category, then the rest in column order).
 */
export function migrationTargets(
	registry: readonly StatusDefinition[],
	id: string,
): StatusDefinition[] {
	const removed = findStatus(registry, id);
	const others = registry.filter((status) => status.id !== id);
	if (removed === undefined) {
		return others;
	}
	return [
		...others.filter((status) => status.category === removed.category),
		...others.filter((status) => status.category !== removed.category),
	];
}

/**
 * Appends a new status to the registry.
 *
 * @param registry The current registry.
 * @param input Label, colour and category of the new status.
 * @returns The new registry and the status that was created.
 */
export function addStatus(
	registry: readonly StatusDefinition[],
	input: { label: string; color: string; category: StatusCategory },
): { registry: StatusDefinition[]; status: StatusDefinition } {
	const label = input.label.trim() === "" ? "New status" : input.label.trim();
	const base = slugifyStatusId(label);
	const taken = new Set(registry.map((status) => status.id));
	let id = base;
	for (let suffix = 2; taken.has(id); suffix++) {
		id = `${base}-${suffix}`;
	}

	const status: StatusDefinition = {
		id,
		label,
		color: input.color,
		category: input.category,
		order: registry.length,
	};

	return { registry: normalizeRegistry([...registry, status]), status };
}

/**
 * Applies a patch to a status. The `id` is immutable: it is the value stored in
 * task frontmatter, so changing it would orphan every task using the status.
 *
 * @returns The new registry.
 */
export function updateStatus(
	registry: readonly StatusDefinition[],
	id: string,
	patch: Partial<
		Pick<StatusDefinition, "label" | "color" | "category" | "archiveAfterMinutes">
	>,
): StatusDefinition[] {
	return normalizeRegistry(
		registry.map((status) => (status.id === id ? { ...status, ...patch } : status)),
	);
}

/**
 * Moves a status to a new column position.
 *
 * @param toIndex Target index; values outside the registry are clamped.
 */
export function reorderStatus(
	registry: readonly StatusDefinition[],
	id: string,
	toIndex: number,
): StatusDefinition[] {
	const current = registry.findIndex((status) => status.id === id);
	if (current < 0) {
		throw new Error(`Unknown status id "${id}".`);
	}
	const clamped = Math.max(0, Math.min(registry.length - 1, toIndex));
	const next = [...registry];
	const [moved] = next.splice(current, 1);
	next.splice(clamped, 0, moved);
	return next.map((status, index) => ({ ...status, order: index }));
}

/**
 * Removes a status, migrating every task that used it to `replacementId`.
 *
 * The caller is responsible for rewriting the affected task files (and should
 * confirm the destructive action with the user first); this function only
 * computes the new registry.
 *
 * @throws When `id` is unknown or `replacementId` is unknown or equal to `id`.
 */
export function deleteStatus(
	registry: readonly StatusDefinition[],
	id: string,
	replacementId: string,
): StatusDefinition[] {
	if (findStatus(registry, id) === undefined) {
		throw new Error(`Unknown status id "${id}".`);
	}
	if (id === replacementId) {
		throw new Error("A status cannot replace itself.");
	}
	if (findStatus(registry, replacementId) === undefined) {
		throw new Error(`Unknown replacement status id "${replacementId}".`);
	}
	if (registry.length <= 1) {
		throw new Error("The last remaining status cannot be deleted.");
	}
	return normalizeRegistry(registry.filter((status) => status.id !== id));
}
