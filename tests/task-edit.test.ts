import { describe, expect, it } from "vitest";

import {
	DEFAULT_STATUSES,
	LEVELS,
	applyLevelChange,
	changedFields,
	cloneStatusesByLevel,
	collectDescendantPaths,
	convertPeriod,
	draftFromTask,
	formatTagInput,
	isDraftSaveable,
	parentCandidates,
	parentFilterOptions,
	parseTagInput,
	pickFields,
	validateDraft,
	type DraftContext,
	type TaskDraft,
} from "../src/domain";

import { makeTask } from "./helpers";

/** 2026-09-28 is a Monday, the start of ISO week 2026-W40. */
const MONDAY = new Date(2026, 8, 28);

/** Every board shares the default registry in these tests. */
const REGISTRIES = cloneStatusesByLevel(DEFAULT_STATUSES);

const WEEKLY_PARENT = makeTask({
	path: "Tasks/2026-W40 Launch website.md",
	title: "Launch website",
	level: "weekly",
	period: "2026-W40",
});

const MONTHLY_PARENT = makeTask({
	path: "Tasks/2026-09 Content.md",
	title: "Content",
	level: "monthly",
	period: "2026-09",
});

const QUARTERLY_PARENT = makeTask({
	path: "Tasks/2026-Q3 Push.md",
	title: "Push",
	level: "quarterly",
	period: "2026-Q3",
});

const DAILY = makeTask({
	path: "Tasks/Write copy.md",
	title: "Write copy",
	level: "daily",
	period: "2026-09-28",
	parent: "2026-W40 Launch website",
	tags: ["work"],
});

const CONTEXT: DraftContext = {
	registries: REGISTRIES,
	tasks: [WEEKLY_PARENT, MONTHLY_PARENT, QUARTERLY_PARENT, DAILY],
	strictHierarchy: true,
};

/** A complete draft, so a test only states the fields it cares about. */
const BASE_DRAFT: TaskDraft = {
	title: "Write copy",
	status: "todo",
	priority: "none",
	level: "daily",
	period: "2026-09-28",
	parent: null,
	tags: [],
	due: null,
	body: "",
	framework: {},
};

function draft(overrides: Partial<TaskDraft> = {}): TaskDraft {
	return { ...BASE_DRAFT, ...overrides };
}

function codes(issues: readonly { code: string }[]): string[] {
	return issues.map((issue) => issue.code);
}

describe("draftFromTask", () => {
	it("round-trips the editable fields and leaves the body alone", () => {
		const result = draftFromTask(DAILY);

		expect(result).toMatchObject({
			title: "Write copy",
			status: DAILY.status,
			level: "daily",
			period: "2026-09-28",
			parent: "2026-W40 Launch website",
			tags: ["work"],
			body: "",
		});
		expect(changedFields(result, draftFromTask(DAILY))).toEqual([]);
	});
});

describe("validateDraft", () => {
	it("accepts a complete draft", () => {
		expect(
			validateDraft(draft({ parent: "2026-W40 Launch website" }), CONTEXT),
		).toEqual([]);
	});

	it("requires a title", () => {
		const issues = validateDraft(draft({ title: "   " }), CONTEXT);
		expect(codes(issues)).toEqual(["empty-title"]);
		expect(isDraftSaveable(issues)).toBe(false);
	});

	it("requires a status that exists in the registry", () => {
		expect(codes(validateDraft(draft({ status: "archived" }), CONTEXT))).toEqual([
			"unknown-status",
		]);
	});

	it("requires a period on a period horizon, in the right format", () => {
		expect(codes(validateDraft(draft({ period: null }), CONTEXT))).toEqual([
			"missing-period",
		]);
		expect(codes(validateDraft(draft({ level: "daily", period: "2026-W40" }), CONTEXT))).toEqual(
			["invalid-period"],
		);
	});

	it("does not ask an objective for a period", () => {
		expect(
			validateDraft(draft({ level: "objective", period: null }), CONTEXT),
		).toEqual([]);
	});

	it("accepts only a calendar day as a due date", () => {
		expect(validateDraft(draft({ due: "2026-09-30" }), CONTEXT)).toEqual([]);
		expect(codes(validateDraft(draft({ due: "next tuesday" }), CONTEXT))).toEqual([
			"invalid-due",
		]);
	});

	it("refuses a task as its own parent", () => {
		const selfDraft = draft({ parent: "Write copy" });
		const issues = validateDraft(selfDraft, { ...CONTEXT, selfPath: DAILY.path });
		expect(codes(issues)).toEqual(["self-parent"]);
	});

	it("refuses a descendant as a parent", () => {
		const grandchild = makeTask({
			path: "Tasks/Deep.md",
			title: "Deep",
			level: "monthly",
			period: "2026-09",
			parent: "Write copy",
		});
		const issues = validateDraft(draft({ level: "monthly", period: "2026-09", parent: "Deep" }), {
			...CONTEXT,
			tasks: [...CONTEXT.tasks, grandchild],
			selfPath: DAILY.path,
		});
		expect(codes(issues)).toEqual(["descendant-parent"]);
	});

	it("warns rather than blocks on a cross-horizon parent", () => {
		// Daily may link to weekly or monthly, never to quarterly.
		const issues = validateDraft(draft({ parent: "2026-Q3 Push" }), CONTEXT);
		expect(codes(issues)).toEqual(["invalid-parent-level"]);
		expect(isDraftSaveable(issues)).toBe(true);
	});

	it("still warns when strict hierarchy is off, because the link is still off the table", () => {
		const issues = validateDraft(draft({ parent: "2026-Q3 Push" }), {
			...CONTEXT,
			strictHierarchy: false,
		});
		expect(codes(issues)).toEqual(["invalid-parent-level"]);
		expect(isDraftSaveable(issues)).toBe(true);
	});

	it("ignores a parent link it cannot resolve", () => {
		// Not a known task: the board flags that separately, and it must not
		// stop the user from saving an unrelated change.
		expect(validateDraft(draft({ parent: "Someone's draft note" }), CONTEXT)).toEqual([]);
	});
});

describe("collectDescendantPaths", () => {
	const child = makeTask({ path: "Tasks/Child.md", title: "Child", parent: "Root" });
	const grandchild = makeTask({ path: "Tasks/Grand.md", title: "Grand", parent: "Child" });
	const root = makeTask({ path: "Tasks/Root.md", title: "Root" });
	const other = makeTask({ path: "Tasks/Other.md", title: "Other" });

	it("finds the whole subtree", () => {
		expect([...collectDescendantPaths([root, child, grandchild, other], "Tasks/Root.md")]).toEqual([
			"Tasks/Child.md",
			"Tasks/Grand.md",
		]);
	});

	it("never includes the root itself", () => {
		expect(collectDescendantPaths([root, child], "Tasks/Root.md").has("Tasks/Root.md")).toBe(false);
	});

	it("is empty for a leaf", () => {
		expect(collectDescendantPaths([root, child], "Tasks/Child.md").size).toBe(0);
	});

	it("terminates on a hand-made cycle", () => {
		const a = makeTask({ path: "Tasks/A.md", title: "A", parent: "B" });
		const b = makeTask({ path: "Tasks/B.md", title: "B", parent: "A" });
		expect(collectDescendantPaths([a, b], "Tasks/A.md").size).toBeLessThanOrEqual(2);
	});
});

describe("parentCandidates", () => {
	it("offers only the horizons the child may link to", () => {
		expect(parentCandidates({ level: "daily", parent: null }, CONTEXT).map((t) => t.title)).toEqual(
			["Content", "Launch website"],
		);
	});

	it("never offers the task itself or its descendants", () => {
		const offers = parentCandidates({ level: "monthly", parent: null }, {
			...CONTEXT,
			strictHierarchy: false,
			selfPath: DAILY.path,
		}).map((task) => task.path);

		expect(offers).not.toContain(DAILY.path);
	});

	it("widens the list when strict hierarchy is off, but never to objectives as children", () => {
		const loose = parentCandidates(
			{ level: "daily", parent: null },
			{ ...CONTEXT, strictHierarchy: false },
		).map((task) => task.title);

		expect(loose).toContain("Push");
		expect(loose).not.toContain("Write copy");
	});

	it("orders candidates by title", () => {
		const titles = parentCandidates({ level: "daily", parent: null }, CONTEXT).map(
			(task) => task.title,
		);
		expect(titles).toEqual([...titles].sort());
	});
});

describe("applyLevelChange", () => {
	const context = { registries: REGISTRIES, tasks: CONTEXT.tasks, strictHierarchy: true };

	it("changes nothing when the level is the same", () => {
		const result = applyLevelChange(draft(), "daily", context, MONDAY);
		expect(result.notes).toEqual([]);
		expect(result.draft).toEqual(draft());
	});

	it("falls back to the new board's first status when the old one is missing", () => {
		const narrowed = {
			registries: {
				...REGISTRIES,
				weekly: REGISTRIES.weekly.filter((status) => status.id !== "todo"),
			},
			tasks: CONTEXT.tasks,
			strictHierarchy: true,
		};
		const result = applyLevelChange(draft(), "weekly", narrowed, MONDAY);
		expect(result.draft.status).toBe("backlog");
	});

	it("re-expresses the period on the new horizon", () => {
		const result = applyLevelChange(
			draft({ parent: "2026-W40 Launch website" }),
			"weekly",
			context,
			MONDAY,
		);

		expect(result.draft.period).toBe("2026-W40");
		expect(result.draft.level).toBe("weekly");
		// The weekly parent cannot parent a weekly task, so it is cleared.
		expect(result.notes).toEqual([
			{ code: "period-converted" },
			{ code: "parent-cleared", parentTitle: "Launch website" },
		]);
	});

	it("drops the period for an objective", () => {
		const result = applyLevelChange(
			draft({ level: "quarterly", period: "2026-Q3" }),
			"objective",
			context,
			MONDAY,
		);

		expect(result.draft.period).toBeNull();
		expect(result.notes.map((note) => note.code)).toEqual(["period-dropped"]);
	});

	it("invents a period when coming from an objective", () => {
		const result = applyLevelChange(
			draft({ level: "objective", period: null }),
			"daily",
			context,
			MONDAY,
		);

		expect(result.draft.period).toBe("2026-09-28");
		expect(result.notes.map((note) => note.code)).toEqual(["period-converted"]);
	});

	it("clears a parent the new horizon may not link to, and names it", () => {
		const result = applyLevelChange(
			draft({ level: "monthly", period: "2026-09", parent: "2026-Q3 Push" }),
			"daily",
			context,
			MONDAY,
		);

		expect(result.draft.parent).toBeNull();
		expect(result.notes).toEqual([
			{ code: "period-converted" },
			{ code: "parent-cleared", parentTitle: "Push" },
		]);
	});

	it("keeps a parent that is still allowed", () => {
		// Weekly may link to monthly or quarterly, so a quarterly parent survives
		// while the monthly period is re-expressed as a week.
		const result = applyLevelChange(
			draft({ level: "monthly", period: "2026-09", parent: "2026-Q3 Push" }),
			"weekly",
			context,
			MONDAY,
		);

		expect(result.draft.parent).toBe("2026-Q3 Push");
		expect(result.draft.period).toBe("2026-W36");
		expect(result.notes.map((note) => note.code)).toEqual(["period-converted"]);
	});

	it("leaves an unresolvable parent alone rather than dropping user data", () => {
		const result = applyLevelChange(
			draft({ parent: "Not a task yet" }),
			"weekly",
			context,
			MONDAY,
		);

		expect(result.draft.parent).toBe("Not a task yet");
	});
});

describe("convertPeriod", () => {
	it("keeps the moment when moving between horizons", () => {
		expect(convertPeriod("2026-09-28", "daily", "weekly")).toBe("2026-W40");
		expect(convertPeriod("2026-09-28", "daily", "monthly")).toBe("2026-09");
		expect(convertPeriod("2026-09", "monthly", "quarterly")).toBe("2026-Q3");
		expect(convertPeriod("2026-09-28", "daily", "yearly")).toBe("2026");
	});

	it("falls back to the reference date when there is nothing to convert", () => {
		expect(convertPeriod(null, "daily", "weekly", MONDAY)).toBe("2026-W40");
		expect(convertPeriod("nonsense", "daily", "weekly", MONDAY)).toBe("2026-W40");
		expect(convertPeriod("2026", "objective", "daily", MONDAY)).toBe("2026-09-28");
	});

	it("returns null for objectives", () => {
		expect(convertPeriod("2026-09-28", "daily", "objective", MONDAY)).toBeNull();
	});
});

describe("changedFields", () => {
	it("reports nothing for an untouched draft", () => {
		expect(changedFields(draft(), draft())).toEqual([]);
	});

	it("reports exactly the fields that changed", () => {
		const before = draft();
		const after = draft({
			title: "Write more copy",
			status: "done",
			priority: "high",
			due: "2026-09-30",
		});

		expect(changedFields(before, after)).toEqual(["title", "status", "priority", "due"]);
	});

	it("sees a tag change even when the count matches", () => {
		expect(changedFields(draft({ tags: ["a", "b"] }), draft({ tags: ["a", "c"] }))).toEqual([
			"tags",
		]);
	});

	it("reports a body edit, which is note text rather than frontmatter", () => {
		expect(changedFields(draft({ body: "one" }), draft({ body: "two" }))).toEqual(["body"]);
	});

	it("reports a framework term that was filled in or cleared", () => {
		expect(
			changedFields(draft({ framework: {} }), draft({ framework: { why: "Because" } })),
		).toEqual(["framework"]);
		expect(
			changedFields(draft({ framework: { why: "Because" } }), draft({ framework: {} })),
		).toEqual(["framework"]);
	});

	it("leaves the framework out when only whitespace moved", () => {
		expect(
			changedFields(
				draft({ framework: { why: "Because" } }),
				draft({ framework: { why: "  Because  " } }),
			),
		).toEqual([]);
	});
});

describe("pickFields", () => {
	it("carries only the fields that changed", () => {
		const patch = pickFields(draft({ title: "  Write copy  ", due: "2026-09-30" }), [
			"title",
			"due",
		]);

		expect(patch).toEqual({ title: "Write copy", due: "2026-09-30" });
		// Fields that were not asked for must never reach the note.
		expect("period" in patch).toBe(false);
		expect("tags" in patch).toBe(false);
	});

	it("copies the tag list so later edits cannot alias it", () => {
		const tags = ["work"];
		const patch = pickFields(draft({ tags }), ["tags"]);

		expect(patch.tags).toEqual(["work"]);
		expect(patch.tags).not.toBe(tags);
	});

	it("never lets the body reach a frontmatter patch", () => {
		// `body` is a legal edit key, but it is note text: it is written by its own
		// repository call, never as a field on the frontmatter.
		expect(pickFields(draft({ body: "text" }), ["body"])).toEqual({});
	});

	it("normalises the framework on its way into the patch", () => {
		// What lands in the store and what lands in the note have to be the same
		// thing, so the trim happens here rather than at the writer.
		expect(
			pickFields(draft({ framework: { why: "  Because  ", risks: "" } }), ["framework"]),
		).toEqual({ framework: { why: "Because" } });
	});

	it("is empty when nothing changed", () => {
		expect(pickFields(draft(), [])).toEqual({});
	});
});

describe("tag input", () => {
	it("accepts commas, spaces and hashes", () => {
		expect(parseTagInput("work, #website  work")).toEqual(["work", "website"]);
	});

	it("round-trips through the field format", () => {
		expect(parseTagInput(formatTagInput(["work", "website"]))).toEqual(["work", "website"]);
	});

	it("is empty for an empty input", () => {
		expect(parseTagInput("  ")).toEqual([]);
	});
});

describe("parent filter options", () => {
	const CANDIDATES = [
		makeTask({ path: "Tasks/Weekly/A.md", level: "weekly" }),
		makeTask({ path: "Tasks/Weekly/B.md", level: "weekly" }),
		makeTask({ path: "Tasks/Monthly/C.md", level: "monthly" }),
		makeTask({ path: "Tasks/Daily/D.md", level: "daily" }),
	];

	it("offers only the horizons a task may link to, with their counts", () => {
		expect(parentFilterOptions("daily", CANDIDATES, LEVELS)).toEqual([
			{ level: "weekly", count: 2 },
			{ level: "monthly", count: 1 },
		]);
	});

	it("hides a horizon the user has turned off", () => {
		expect(parentFilterOptions("daily", CANDIDATES, ["weekly"])).toEqual([
			{ level: "weekly", count: 2 },
		]);
	});

	it("hides a horizon with nothing in it", () => {
		// A chip leading to an empty list would be a dead end.
		expect(parentFilterOptions("daily", [CANDIDATES[0]], LEVELS)).toEqual([
			{ level: "weekly", count: 1 },
		]);
	});

	it("offers nothing at all for a task that cannot have a parent", () => {
		expect(parentFilterOptions("objective", CANDIDATES, LEVELS)).toEqual([]);
	});
});
