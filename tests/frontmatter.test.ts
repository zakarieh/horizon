import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";

import {
	WRITABLE_FIELD_KEYS,
	applyTaskFields,
	buildTaskFileContent,
	isTaskFrontmatter,
	readTask,
	splitFrontmatter,
	stripFrontmatter,
	yamlScalar,
} from "../src/data/frontmatter";
import type { Task, TaskFields } from "../src/domain";

import { makeTask } from "./helpers";

const DEFAULT_STATUS = "backlog";

/** Reads a task out of frontmatter the way the repository does. */
function read(frontmatter: unknown, inlineTags: readonly string[] = []): ReturnType<typeof readTask> {
	return readTask("Tasks/Ship v1 landing page.md", frontmatter, inlineTags, {
		fallbackStatus: () => DEFAULT_STATUS,
	});
}

/** Parses the frontmatter block out of a generated note. */
function frontmatterOf(content: string): unknown {
	const lines = content.split("\n");
	const end = lines.indexOf("---", 1);
	expect(end).toBeGreaterThan(0);
	return parseYaml(lines.slice(1, end).join("\n"));
}

describe("isTaskFrontmatter", () => {
	it("accepts the boolean and string marker forms", () => {
		expect(isTaskFrontmatter({ "tf-task": true })).toBe(true);
		expect(isTaskFrontmatter({ "tf-task": "true" })).toBe(true);
	});

	it("rejects notes without the marker", () => {
		expect(isTaskFrontmatter({ title: "Not a task" })).toBe(false);
		expect(isTaskFrontmatter({ "tf-task": false })).toBe(false);
		expect(isTaskFrontmatter(null)).toBe(false);
	});
});

describe("readTask", () => {
	it("ignores notes that are not tasks", () => {
		expect(read({ title: "Just a note" })).toEqual({ kind: "not-a-task" });
	});

	const base = {
		"tf-task": true,
		title: "Ship v1 landing page",
		status: "in-progress",
		priority: "high",
		level: "daily",
		period: "2026-09-28",
		order: "a0",
	};

	it("reads a complete note", () => {
		const outcome = read(base);
		expect(outcome.kind).toBe("task");
		if (outcome.kind !== "task") {
			return;
		}
		expect(outcome.problems).toEqual([]);
		expect(outcome.task).toMatchObject({
			path: "Tasks/Ship v1 landing page.md",
			title: "Ship v1 landing page",
			status: "in-progress",
			priority: "high",
			level: "daily",
			period: "2026-09-28",
			order: "a0",
			parent: null,
			due: null,
			completed: null,
			carriedFrom: null,
		});
	});

	it("falls back to the file name for a missing title", () => {
		const outcome = read({ ...base, title: undefined });
		expect(outcome.kind === "task" && outcome.task.title).toBe("Ship v1 landing page");
	});

	it("applies defaults for status, priority and order", () => {
		const outcome = read({
			"tf-task": true,
			level: "daily",
			period: "2026-09-28",
			priority: "enormous",
			order: "not a key",
		});
		expect(outcome.kind).toBe("task");
		if (outcome.kind !== "task") {
			return;
		}
		expect(outcome.task.status).toBe(DEFAULT_STATUS);
		expect(outcome.task.priority).toBe("none");
		expect(outcome.task.order).toBe("a0");
	});

	it("treats a note without a usable level as unusable rather than guessing", () => {
		expect(read({ "tf-task": true, level: "fortnightly" })).toEqual({
			kind: "unusable",
			problem: { path: "Tasks/Ship v1 landing page.md", kind: "invalid-level" },
		});
	});

	it("reads a yearly period that YAML stored as a number", () => {
		// `period: 2026` parses as the number 2026; it is still a usable year.
		const outcome = read({ "tf-task": true, level: "yearly", period: 2026 });
		expect(outcome.kind).toBe("task");
		if (outcome.kind !== "task") {
			return;
		}
		expect(outcome.task.period).toBe("2026");
		expect(outcome.problems).toEqual([]);
	});

	it("keeps a task whose period is missing, and reports the problem", () => {
		const outcome = read({ "tf-task": true, level: "daily" });
		expect(outcome.kind).toBe("task");
		if (outcome.kind !== "task") {
			return;
		}
		expect(outcome.task.period).toBeNull();
		expect(outcome.problems).toEqual([
			{ path: "Tasks/Ship v1 landing page.md", kind: "missing-period" },
		]);
	});

	it("rejects a period that does not match the horizon", () => {
		const outcome = read({ "tf-task": true, level: "weekly", period: "2026-09-28" });
		expect(outcome.kind === "task" && outcome.problems).toEqual([
			{ path: "Tasks/Ship v1 landing page.md", kind: "invalid-period" },
		]);
	});

	it("rejects a period on an objective, which is not time bound", () => {
		const outcome = read({ "tf-task": true, level: "objective", period: "2026" });
		expect(outcome.kind === "task" && outcome.task.period).toBeNull();
		expect(outcome.kind === "task" && outcome.problems).toEqual([
			{ path: "Tasks/Ship v1 landing page.md", kind: "invalid-period" },
		]);
	});

	it("accepts an objective without a period", () => {
		const outcome = read({ "tf-task": true, level: "objective" });
		expect(outcome.kind === "task" && outcome.problems).toEqual([]);
	});
});

describe("readTask tags", () => {
	const base = { "tf-task": true, level: "daily", period: "2026-09-28" };

	it("reads a frontmatter list and inline body tags together", () => {
		const outcome = read({ ...base, tags: ["work", "website"] }, ["#urgent", "#work"]);
		expect(outcome.kind === "task" && outcome.task.tags).toEqual([
			"work",
			"website",
			"urgent",
		]);
	});

	it("accepts a comma separated string and normalises case and the hash", () => {
		const outcome = read({ ...base, tags: "Work, #Website" });
		expect(outcome.kind === "task" && outcome.task.tags).toEqual(["work", "website"]);
	});

	it("has no tags when there are none", () => {
		const outcome = read(base);
		expect(outcome.kind === "task" && outcome.task.tags).toEqual([]);
	});
});

describe("readTask dates", () => {
	const base = { "tf-task": true, level: "daily", period: "2026-09-28" };

	it("keeps an ISO date string", () => {
		const outcome = read({ ...base, due: "2026-09-30" });
		expect(outcome.kind === "task" && outcome.task.due).toBe("2026-09-30");
	});

	it("reads a Date without sliding a day in negative UTC offsets", () => {
		// Obsidian may hand back a Date parsed from `2026-09-30`, i.e. UTC midnight.
		const outcome = read({ ...base, due: new Date(Date.UTC(2026, 8, 30)) });
		expect(outcome.kind === "task" && outcome.task.due).toBe("2026-09-30");
	});

	it("takes the date part of an ISO timestamp", () => {
		const outcome = read({ ...base, due: "2026-09-30T14:05:00" });
		expect(outcome.kind === "task" && outcome.task.due).toBe("2026-09-30");
	});

	it("returns null for a value it cannot understand, without inventing one", () => {
		const outcome = read({ ...base, due: "next tuesday" });
		expect(outcome.kind === "task" && outcome.task.due).toBeNull();
	});
});

describe("readTask parent", () => {
	const base = { "tf-task": true, level: "daily", period: "2026-09-28" };

	it("stores the link target, not the wikilink syntax", () => {
		const outcome = read({ ...base, parent: "[[2026-W40 Launch website]]" });
		expect(outcome.kind === "task" && outcome.task.parent).toBe("2026-W40 Launch website");
	});

	it("handles aliases and headings", () => {
		const outcome = read({ ...base, parent: "[[2026-W40 Launch|the launch]]" });
		expect(outcome.kind === "task" && outcome.task.parent).toBe("2026-W40 Launch");
	});
});

describe("applyTaskFields", () => {
	const task = makeTask({
		path: "Tasks/Ship v1 landing page.md",
		title: "Ship v1 landing page",
		status: "in-progress",
		priority: "high",
		level: "daily",
		period: "2026-09-28",
		parent: "2026-W40 Launch website",
		tags: ["work"],
		due: "2026-09-30",
		created: "2026-09-28",
		completed: null,
	});

	it("preserves unknown frontmatter", () => {
		const frontmatter: Record<string, unknown> = {
			favourite: true,
			"some-plugin": { nested: 1 },
		};
		applyTaskFields(frontmatter, task);

		expect(frontmatter.favourite).toBe(true);
		expect(frontmatter["some-plugin"]).toEqual({ nested: 1 });
		expect(frontmatter["tf-task"]).toBe(true);
	});

	it("writes every field when asked for all of them", () => {
		const frontmatter: Record<string, unknown> = {};
		applyTaskFields(frontmatter, task);

		expect(frontmatter).toMatchObject({
			"tf-task": true,
			status: "in-progress",
			priority: "high",
			level: "daily",
			period: "2026-09-28",
			parent: "[[2026-W40 Launch website]]",
			tags: ["work"],
			due: "2026-09-30",
			created: "2026-09-28",
		});
	});

	it("omits the title when it is just the file name", () => {
		const frontmatter: Record<string, unknown> = { title: "stale" };
		applyTaskFields(frontmatter, task);
		expect("title" in frontmatter).toBe(false);
	});

	it("writes a title that differs from the file name", () => {
		const frontmatter: Record<string, unknown> = {};
		applyTaskFields(frontmatter, { ...task, title: "Something else" });
		expect(frontmatter.title).toBe("Something else");
	});

	it("removes a key rather than writing null", () => {
		const frontmatter: Record<string, unknown> = {
			due: "2026-01-01",
			period: "2026-01-01",
			parent: "[[Old parent]]",
			tags: ["old"],
		};
		applyTaskFields(frontmatter, { ...task, due: null, parent: null, tags: [] });

		expect("due" in frontmatter).toBe(false);
		expect("parent" in frontmatter).toBe(false);
		expect("tags" in frontmatter).toBe(false);
	});

	it("touches only the keys it was asked to write", () => {
		const frontmatter: Record<string, unknown> = {
			due: "whenever",
			tags: ["keep"],
			custom: 1,
		};
		applyTaskFields(frontmatter, { ...task, status: "done", order: "a1" }, [
			"status",
			"order",
		]);

		expect(frontmatter.status).toBe("done");
		expect(frontmatter.order).toBe("a1");
		// A due date the plugin could not parse is left exactly as the user wrote it.
		expect(frontmatter.due).toBe("whenever");
		expect(frontmatter.tags).toEqual(["keep"]);
		expect(frontmatter.custom).toBe(1);
	});

	it("never leaves the marker off", () => {
		const frontmatter: Record<string, unknown> = {};
		applyTaskFields(frontmatter, task, []);
		expect(frontmatter["tf-task"]).toBe(true);
	});

	it("covers every writable field in its default key list", () => {
		const frontmatter: Record<string, unknown> = {};
		applyTaskFields(frontmatter, task);
		const fields: (keyof TaskFields)[] = Object.keys(frontmatter).filter(
			(key) => key !== "tf-task",
		) as (keyof TaskFields)[];
		for (const field of fields) {
			expect(WRITABLE_FIELD_KEYS).toContain(field);
		}
	});
});

describe("yamlScalar", () => {
	it("leaves ordinary values bare", () => {
		expect(yamlScalar("Ship v1 landing page")).toBe("Ship v1 landing page");
		expect(yamlScalar("2026-09-28")).toBe("2026-09-28");
	});

	it("quotes values that would otherwise change meaning", () => {
		expect(yamlScalar("Ship: v1")).toBe('"Ship: v1"');
		expect(yamlScalar("true")).toBe('"true"');
		expect(yamlScalar("- leading dash")).toBe('"- leading dash"');
		expect(yamlScalar("")).toBe('""');
	});

	it("quotes a bare number so YAML keeps it a string", () => {
		// A yearly period is all digits, which YAML would otherwise read as a number.
		expect(yamlScalar("2026")).toBe('"2026"');
		expect(yamlScalar("3.14")).toBe('"3.14"');
	});

	it("escapes quotes and backslashes inside a quoted value", () => {
		expect(yamlScalar('He said "hi"')).toBe('"He said \\"hi\\""');
		expect(yamlScalar("back\\slash")).toBe('"back\\\\slash"');
	});
});

describe("buildTaskFileContent", () => {
	const task = makeTask({
		path: "Tasks/2026-09-28 Ship v1.md",
		title: "Ship: v1 landing page",
		status: "in-progress",
		priority: "urgent",
		level: "daily",
		period: "2026-09-28",
		parent: "2026-W40 Launch website",
		order: "a0",
		tags: ["work", "website"],
		due: "2026-09-30",
		created: "2026-09-28",
		completed: null,
		carriedFrom: null,
	});

	it("produces YAML that reads back as the same task", () => {
		const content = buildTaskFileContent(task, "Some body text.");
		const outcome = read(frontmatterOf(content), []);

		expect(outcome.kind).toBe("task");
		if (outcome.kind !== "task") {
			return;
		}
		expect(outcome.problems).toEqual([]);
		expect(outcome.task).toMatchObject({
			title: "Ship: v1 landing page",
			status: "in-progress",
			priority: "urgent",
			level: "daily",
			period: "2026-09-28",
			parent: "2026-W40 Launch website",
			order: "a0",
			tags: ["work", "website"],
			due: "2026-09-30",
			created: "2026-09-28",
		});
	});

	it("keeps the note body after the frontmatter", () => {
		const content = buildTaskFileContent(task, "Body text.");
		expect(content.endsWith("---\n\nBody text.\n")).toBe(true);
	});

	it("omits the title when it matches the file name", () => {
		const named = { ...task, path: "Tasks/Plain.md", title: "Plain" };
		const frontmatter = frontmatterOf(buildTaskFileContent(named));
		expect(frontmatter).not.toHaveProperty("title");
	});

	it("round-trips a bare year as a string, not a number", () => {
		const yearly = makeTask({
			path: "Tasks/2026 Plan.md",
			title: "Plan",
			level: "yearly",
			period: "2026",
			parent: null,
			due: null,
			tags: [],
		});
		const content = buildTaskFileContent(yearly);

		expect(content).toContain('period: "2026"');
		const outcome = readTask(yearly.path, frontmatterOf(content), [], {
			fallbackStatus: () => DEFAULT_STATUS,
		});
		expect(outcome.kind).toBe("task");
		if (outcome.kind !== "task") {
			return;
		}
		expect(outcome.task.period).toBe("2026");
		expect(outcome.problems).toEqual([]);
	});

	it("omits the period for an objective", () => {
		const objective: Task = {
			...task,
			path: "Tasks/Grow the business.md",
			title: "Grow the business",
			level: "objective",
			period: null,
			parent: null,
			due: null,
			tags: [],
		};
		const content = buildTaskFileContent(objective);
		const outcome = readTask(objective.path, frontmatterOf(content), [], {
			fallbackStatus: () => DEFAULT_STATUS,
		});

		expect(content).not.toContain("period:");
		expect(outcome.kind === "task" && outcome.task.period).toBeNull();
		expect(outcome.kind === "task" && outcome.problems).toEqual([]);
	});
});

describe("stripFrontmatter", () => {
	it("removes the block and keeps the body", () => {
		expect(stripFrontmatter("---\ntf-task: true\n---\n# Notes\n")).toBe("# Notes\n");
	});

	it("leaves a note without frontmatter alone", () => {
		expect(stripFrontmatter("# Notes\n")).toBe("# Notes\n");
	});

	it("handles windows line endings", () => {
		expect(stripFrontmatter("---\r\ntf-task: true\r\n---\r\n# Notes\r\n")).toBe("# Notes\r\n");
	});

	it("only strips a block at the very start", () => {
		const content = "# Notes\n\n---\nnot frontmatter\n---\n";
		expect(stripFrontmatter(content)).toBe(content);
	});

	it("handles an empty body", () => {
		expect(stripFrontmatter("---\ntf-task: true\n---\n")).toBe("");
	});
});

describe("splitFrontmatter", () => {
	it("hands back the raw block and the body", () => {
		expect(splitFrontmatter("---\ntf-task: true\n---\n# Notes\n")).toEqual({
			frontmatter: "---\ntf-task: true\n---\n",
			body: "# Notes\n",
		});
	});

	it("treats a note without frontmatter as all body", () => {
		expect(splitFrontmatter("# Notes\n")).toEqual({ frontmatter: "", body: "# Notes\n" });
	});

	it("keeps the block byte for byte, so a body edit cannot reformat it", () => {
		// Foreign keys, an unusual order and a comment: a body edit has to leave
		// all of it exactly as the user wrote it.
		const block = "---\nzebra: 1\ntf-task: true\n# keep me\n  indented: yes\n---\n";
		const { frontmatter, body } = splitFrontmatter(`${block}Text`);

		expect(frontmatter).toBe(block);
		expect(body).toBe("Text");
	});

	it("copes with an empty body and windows line endings", () => {
		expect(splitFrontmatter("---\r\ntf-task: true\r\n---\r\n")).toEqual({
			frontmatter: "---\r\ntf-task: true\r\n---\r\n",
			body: "",
		});
	});
});

describe("inline tags", () => {
	it("reads them alongside the frontmatter tags, remembering where they came from", () => {
		const outcome = read({ "tf-task": true, level: "daily", tags: ["work"] }, ["#Website"]);

		expect(outcome.kind === "task" && outcome.task.tags).toEqual(["work", "website"]);
		// The body tags are kept apart, so a tag edit never rewrites the note text.
		expect(outcome.kind === "task" && outcome.task.bodyTags).toEqual(["website"]);
	});

	it("does not write them into frontmatter", () => {
		const task = makeTask({
			path: "Tasks/Ship v1.md",
			tags: ["work", "website"],
			bodyTags: ["website"],
		});
		const frontmatter: Record<string, unknown> = {};
		applyTaskFields(frontmatter, task, ["tags"]);

		// Only the frontmatter half of the merged list is persisted.
		expect(frontmatter.tags).toEqual(["work"]);
	});

	it("removes the tag key when only body tags are left", () => {
		const task = makeTask({
			path: "Tasks/Ship v1.md",
			tags: ["website"],
			bodyTags: ["website"],
		});
		const frontmatter: Record<string, unknown> = { tags: ["website"] };
		applyTaskFields(frontmatter, task, ["tags"]);

		expect("tags" in frontmatter).toBe(false);
	});

	it("keeps a body tag out of the frontmatter it writes for a new note", () => {
		const task = makeTask({ path: "Tasks/Ship v1.md", tags: ["work"], bodyTags: [] });
		const content = buildTaskFileContent(task, "#work in the body");

		expect(content).toContain("- work");
		expect(content).toContain("#work in the body");
	});
});

describe("the objective framework", () => {
	it("is a writable field", () => {
		expect(WRITABLE_FIELD_KEYS).toContain("framework");
	});

	it("writes one nested key and leaves the blank terms out", () => {
		const frontmatter: Record<string, unknown> = {};
		applyTaskFields(
			frontmatter,
			makeTask({ path: "Tasks/Objective.md", framework: { why: "Because", risks: "  " } }),
			["framework"],
		);

		expect(frontmatter.framework).toEqual({ why: "Because" });
	});

	it("removes the key once every term has been cleared", () => {
		const frontmatter: Record<string, unknown> = { framework: { why: "old" } };
		applyTaskFields(frontmatter, makeTask({ path: "Tasks/Objective.md", framework: {} }), [
			"framework",
		]);

		expect("framework" in frontmatter).toBe(false);
	});

	it("reads it back, ignoring keys that are not terms", () => {
		const outcome = read({
			"tf-task": true,
			level: "objective",
			status: "todo",
			framework: { why: " Because ", budget: "1000" },
		});

		expect(outcome.kind === "task" && outcome.task.framework).toEqual({ why: "Because" });
	});

	it("reads a task without one as an empty framework", () => {
		const outcome = read({ "tf-task": true, level: "daily", status: "todo" });

		expect(outcome.kind === "task" && outcome.task.framework).toEqual({});
	});

	it("writes the map into a brand new note", () => {
		const task = makeTask({
			path: "Tasks/Objective.md",
			level: "objective",
			period: null,
			framework: { why: "Because", metrics: "Weekly signups" },
		});
		const content = buildTaskFileContent(task);

		expect(content).toContain("framework:");
		expect(content).toContain("  why: Because");
		expect(content).toContain("  metrics: Weekly signups");
	});
});
