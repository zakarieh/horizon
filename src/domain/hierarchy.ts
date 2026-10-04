/**
 * Hierarchy rules for the goal tree.
 *
 * Every task has zero or one parent. A parent's level must be one of the levels
 * listed for the child level in {@link ALLOWED_PARENT_LEVELS}, which always
 * means "strictly coarser". Because the parent is always coarser, cycles are
 * impossible by construction; the checks here exist to defend against
 * hand-edited frontmatter that breaks the invariant.
 *
 * Linking is optional at every level: a parentless task is perfectly valid and
 * never produces a warning.
 */

import { parseLinkRef } from "./links";
import type { HierarchyIssue, Level, Task } from "./types";

/**
 * The horizons a task of each level may link up to.
 *
 * | Child     | Allowed parents     |
 * |-----------|---------------------|
 * | daily     | weekly, monthly     |
 * | weekly    | monthly, quarterly  |
 * | monthly   | quarterly, yearly   |
 * | quarterly | yearly, objective   |
 * | yearly    | objective           |
 * | objective | *(none, it is a root)* |
 */
export const ALLOWED_PARENT_LEVELS: Record<Level, readonly Level[]> = {
	daily: ["weekly", "monthly"],
	weekly: ["monthly", "quarterly"],
	monthly: ["quarterly", "yearly"],
	quarterly: ["yearly", "objective"],
	yearly: ["objective"],
	objective: [],
};

/**
 * Whether a parent link satisfies the horizon table.
 *
 * This is the structural rule and is *always* used for the warning badge, even
 * when `strictHierarchy` is switched off.
 */
export function isAllowedParentLevel(childLevel: Level, parentLevel: Level): boolean {
	return ALLOWED_PARENT_LEVELS[childLevel].includes(parentLevel);
}

/**
 * Whether a parent link may be created at all.
 *
 * With `strictHierarchy` on (the default) the horizon table is enforced. With
 * it off, any parent on a *different* level is permitted — the graph stays
 * acyclic — but invalid links still get the warning badge.
 *
 * Objectives are roots and can never have a parent.
 *
 * @param childLevel Level of the task being linked.
 * @param parentLevel Level of the prospective parent.
 * @param strict Whether `strictHierarchy` is enabled.
 */
export function isLinkPermitted(
	childLevel: Level,
	parentLevel: Level,
	strict: boolean,
): boolean {
	if (childLevel === "objective") {
		return false;
	}
	if (isAllowedParentLevel(childLevel, parentLevel)) {
		return true;
	}
	return !strict && childLevel !== parentLevel;
}

/**
 * Resolves a parent reference (a wikilink target) to a task.
 * The data layer supplies this from the `MetadataCache`.
 */
export type HierarchyResolver = (ref: string) => Task | null;

/**
 * Walks the parent chain from `start` and returns the cycle when one exists.
 *
 * @returns The chain of paths ending at the repeated task, or `null` when the
 * chain terminates at a root.
 */
export function findCycle(start: Task, resolve: HierarchyResolver): string[] | null {
	const chain: string[] = [start.path];
	const seen = new Set<string>([start.path]);

	let current: Task | null = start;
	while (current !== null) {
		const ref = parseLinkRef(current.parent);
		if (ref === null) {
			return null;
		}
		const parent = resolve(ref);
		if (parent === null) {
			return null;
		}
		if (seen.has(parent.path)) {
			return [...chain, parent.path];
		}
		seen.add(parent.path);
		chain.push(parent.path);
		current = parent;
	}
	return null;
}

/**
 * Validates a task's parent link.
 *
 * Returns an empty array for the common, healthy cases: no parent, a valid
 * parent, or a parent that the cache has simply not indexed yet is a warning.
 *
 * @param task The task whose `parent` field should be checked.
 * @param resolve Resolver from link target to task.
 */
export function collectHierarchyIssues(
	task: Task,
	resolve: HierarchyResolver,
): HierarchyIssue[] {
	const ref = parseLinkRef(task.parent);
	if (ref === null) {
		return [];
	}

	if (task.level === "objective") {
		return [
			{
				code: "objective-with-parent",
				severity: "error",
				path: task.path,
				parentRef: ref,
			},
		];
	}

	const parent = resolve(ref);
	if (parent === null) {
		return [
			{
				code: "parent-not-found",
				severity: "warning",
				path: task.path,
				parentRef: ref,
			},
		];
	}

	if (parent.path === task.path) {
		return [
			{
				code: "self-link",
				severity: "error",
				path: task.path,
				parentRef: ref,
				parentPath: parent.path,
			},
		];
	}

	const issues: HierarchyIssue[] = [];
	if (!isAllowedParentLevel(task.level, parent.level)) {
		issues.push({
			code: "invalid-parent-level",
			severity: "warning",
			path: task.path,
			parentRef: ref,
			parentPath: parent.path,
		});
	}
	if (findCycle(task, resolve) !== null) {
		issues.push({
			code: "cycle",
			severity: "error",
			path: task.path,
			parentRef: ref,
			parentPath: parent.path,
		});
	}
	return issues;
}

/**
 * Whether the parent link is structurally broken (as opposed to merely
 * violating the horizon table). Broken links get an error-styled badge.
 */
export function hasStructuralIssue(issues: readonly HierarchyIssue[]): boolean {
	return issues.some((issue) => issue.severity === "error");
}

/**
 * Candidate parents for a child, filtered to the levels the child may link to.
 * Used to populate the parent picker; the caller still has to exclude the child
 * itself and its descendants.
 *
 * @param childLevel The level of the task being linked.
 * @param candidates All known tasks.
 * @param strict Whether `strictHierarchy` is enabled.
 */
export function candidateParents(
	childLevel: Level,
	candidates: readonly Task[],
	strict: boolean,
): Task[] {
	return candidates.filter((candidate) =>
		isLinkPermitted(childLevel, candidate.level, strict),
	);
}
