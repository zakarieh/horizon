import type { Task } from "../src/domain";

/**
 * Builds a `Task` with sensible defaults so each test only states the fields it
 * actually cares about.
 *
 * @param overrides Fields to override; `path` is required as it is the identity.
 */
export function makeTask(overrides: Partial<Task> & Pick<Task, "path">): Task {
	// `bodyTags` is pulled out of the spread so its default survives: a readonly
	// field paired with `Partial` widens to `undefined` when merged.
	const { bodyTags, ...rest } = overrides;
	return {
		title: overrides.path.replace(/^.*\//, "").replace(/\.md$/, ""),
		status: "todo",
		priority: "none",
		level: "daily",
		period: "2026-09-28",
		parent: null,
		order: "a0",
		tags: [],
		due: null,
		created: null,
		completed: null,
		carriedFrom: null,
		...rest,
		bodyTags: bodyTags ?? [],
	};
}

/**
 * Builds a resolver that finds tasks by full path, by path without the `.md`
 * extension, and by bare basename - mirroring how Obsidian resolves wikilinks.
 */
export function resolverFor(...tasks: readonly Task[]): (ref: string) => Task | null {
	const index = new Map<string, Task>();
	for (const task of tasks) {
		index.set(task.path, task);
		index.set(task.path.replace(/\.md$/, ""), task);
		index.set(task.path.replace(/^.*\//, "").replace(/\.md$/, ""), task);
	}
	return (ref) => index.get(ref) ?? null;
}
