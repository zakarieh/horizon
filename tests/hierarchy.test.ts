import { describe, expect, it } from "vitest";

import {
	ALLOWED_PARENT_LEVELS,
	LEVELS,
	LEVEL_RANK,
	candidateParents,
	collectHierarchyIssues,
	findCycle,
	hasStructuralIssue,
	isAllowedParentLevel,
	isLinkPermitted,
	type Level,
} from "../src/domain";

import { makeTask, resolverFor } from "./helpers";

const PERIOD_LEVELS = LEVELS.filter((level) => level !== "objective");

describe("the horizon table", () => {
	it("matches the documented allowed parents", () => {
		expect(ALLOWED_PARENT_LEVELS).toEqual({
			daily: ["weekly", "monthly"],
			weekly: ["monthly", "quarterly"],
			monthly: ["quarterly", "yearly"],
			quarterly: ["yearly", "objective"],
			yearly: ["objective"],
			objective: [],
		});
	});

	it("only ever allows strictly coarser parents", () => {
		for (const child of LEVELS) {
			for (const parent of ALLOWED_PARENT_LEVELS[child]) {
				expect(LEVEL_RANK[parent]).toBeGreaterThan(LEVEL_RANK[child]);
			}
		}
	});

	it("gives every non-objective level at least one parent option", () => {
		for (const level of PERIOD_LEVELS) {
			expect(ALLOWED_PARENT_LEVELS[level].length).toBeGreaterThan(0);
		}
	});

	it("keeps objectives as roots", () => {
		for (const level of LEVELS) {
			expect(isAllowedParentLevel("objective", level)).toBe(false);
		}
	});

	it("rejects skipping a horizon", () => {
		expect(isAllowedParentLevel("daily", "weekly")).toBe(true);
		expect(isAllowedParentLevel("daily", "monthly")).toBe(true);
		expect(isAllowedParentLevel("daily", "quarterly")).toBe(false);
		expect(isAllowedParentLevel("daily", "yearly")).toBe(false);
		expect(isAllowedParentLevel("weekly", "monthly")).toBe(true);
		expect(isAllowedParentLevel("weekly", "yearly")).toBe(false);
		expect(isAllowedParentLevel("monthly", "yearly")).toBe(true);
		expect(isAllowedParentLevel("quarterly", "yearly")).toBe(true);
		expect(isAllowedParentLevel("quarterly", "monthly")).toBe(false);
		expect(isAllowedParentLevel("yearly", "objective")).toBe(true);
	});
});

describe("isLinkPermitted", () => {
	it("enforces the table when strict hierarchy is on", () => {
		expect(isLinkPermitted("daily", "quarterly", true)).toBe(false);
		expect(isLinkPermitted("daily", "weekly", true)).toBe(true);
	});

	it("allows any different horizon when strict hierarchy is off", () => {
		expect(isLinkPermitted("daily", "quarterly", false)).toBe(true);
		expect(isLinkPermitted("yearly", "daily", false)).toBe(true);
	});

	it("still forbids same-level links and objectives as children", () => {
		expect(isLinkPermitted("daily", "daily", false)).toBe(false);
		expect(isLinkPermitted("objective", "yearly", false)).toBe(false);
		expect(isLinkPermitted("objective", "yearly", true)).toBe(false);
	});
});

describe("findCycle", () => {
	it("returns null for a healthy chain", () => {
		const daily = makeTask({ path: "Tasks/D.md", level: "daily", parent: "[[W]]" });
		const weekly = makeTask({ path: "Tasks/W.md", level: "weekly", parent: "[[M]]" });
		const monthly = makeTask({ path: "Tasks/M.md", level: "monthly" });

		expect(findCycle(daily, resolverFor(daily, weekly, monthly))).toBeNull();
	});

	it("detects a loop created by hand-edited frontmatter", () => {
		const a = makeTask({ path: "Tasks/A.md", level: "weekly", parent: "[[B]]" });
		const b = makeTask({ path: "Tasks/B.md", level: "monthly", parent: "[[A]]" });

		const cycle = findCycle(a, resolverFor(a, b));
		expect(cycle).toEqual(["Tasks/A.md", "Tasks/B.md", "Tasks/A.md"]);
	});
});

describe("collectHierarchyIssues", () => {
	it("stays silent for parentless tasks, which are valid on every board", () => {
		for (const level of LEVELS) {
			const task = makeTask({ path: `Tasks/${level}.md`, level });
			expect(collectHierarchyIssues(task, resolverFor(task))).toEqual([]);
		}
	});

	it("stays silent for a valid parent link", () => {
		const child = makeTask({
			path: "Tasks/Child.md",
			level: "daily",
			parent: "[[2026-W40 Launch]]",
		});
		const parent = makeTask({
			path: "Tasks/2026-W40 Launch.md",
			level: "weekly",
			period: "2026-W40",
		});

		expect(collectHierarchyIssues(child, resolverFor(child, parent))).toEqual([]);
	});

	it("warns when a daily task links to a quarterly task", () => {
		const child = makeTask({
			path: "Tasks/Child.md",
			level: "daily",
			parent: "[[2026-Q4 Push]]",
		});
		const parent = makeTask({
			path: "Tasks/2026-Q4 Push.md",
			level: "quarterly",
			period: "2026-Q4",
		});

		const issues = collectHierarchyIssues(child, resolverFor(child, parent));
		expect(issues).toHaveLength(1);
		expect(issues[0]?.code).toBe("invalid-parent-level");
		expect(issues[0]?.severity).toBe("warning");
		expect(hasStructuralIssue(issues)).toBe(false);
	});

	it("still reports an invalid level when strict hierarchy is off", () => {
		const child = makeTask({
			path: "Tasks/Child.md",
			level: "daily",
			parent: "[[2026-Q4 Push]]",
		});
		const parent = makeTask({
			path: "Tasks/2026-Q4 Push.md",
			level: "quarterly",
			period: "2026-Q4",
		});

		// Reporting is unconditional; `strictHierarchy` only gates link creation.
		const issues = collectHierarchyIssues(child, resolverFor(child, parent));
		expect(issues.map((issue) => issue.code)).toContain("invalid-parent-level");
	});

	it("flags a self link as an error", () => {
		const task = makeTask({
			path: "Tasks/Loop.md",
			level: "weekly",
			parent: "[[Loop]]",
		});

		const issues = collectHierarchyIssues(task, resolverFor(task));
		expect(issues.map((issue) => issue.code)).toEqual(["self-link"]);
		expect(hasStructuralIssue(issues)).toBe(true);
	});

	it("flags an objective that claims a parent", () => {
		const task = makeTask({
			path: "Tasks/Grow.md",
			level: "objective",
			period: null,
			parent: "[[2026]]",
		});
		const parent = makeTask({ path: "Tasks/2026.md", level: "yearly", period: "2026" });

		const issues = collectHierarchyIssues(task, resolverFor(task, parent));
		expect(issues.map((issue) => issue.code)).toEqual(["objective-with-parent"]);
	});

	it("warns when the parent cannot be resolved", () => {
		const task = makeTask({
			path: "Tasks/Orphan.md",
			level: "daily",
			parent: "[[Missing]]",
		});

		const issues = collectHierarchyIssues(task, resolverFor(task));
		expect(issues.map((issue) => issue.code)).toEqual(["parent-not-found"]);
		expect(hasStructuralIssue(issues)).toBe(false);
	});

	it("flags a cycle in addition to the level problem", () => {
		const a = makeTask({ path: "Tasks/A.md", level: "weekly", parent: "[[B]]" });
		const b = makeTask({ path: "Tasks/B.md", level: "monthly", parent: "[[A]]" });

		const issues = collectHierarchyIssues(a, resolverFor(a, b));
		expect(issues.map((issue) => issue.code)).toContain("cycle");
		expect(hasStructuralIssue(issues)).toBe(true);
	});

	it("tolerates aliases, headings and bare strings in the parent field", () => {
		const parent = makeTask({
			path: "Tasks/2026-W40 Launch.md",
			level: "weekly",
			period: "2026-W40",
		});
		const variants = ["[[2026-W40 Launch|the launch]]", "2026-W40 Launch", "[[2026-W40 Launch#Notes]]"];

		for (const parentValue of variants) {
			const child = makeTask({
				path: "Tasks/Child.md",
				level: "daily",
				parent: parentValue,
			});
			expect(collectHierarchyIssues(child, resolverFor(child, parent))).toEqual([]);
		}
	});
});

describe("candidateParents", () => {
	const candidates = LEVELS.map((level: Level) =>
		makeTask({ path: `Tasks/${level}.md`, level, period: level === "objective" ? null : "2026" }),
	);

	it("offers only the horizons a child may link to", () => {
		const offered = candidateParents("daily", candidates, true).map((task) => task.level);
		expect(offered).toEqual(["weekly", "monthly"]);
	});

	it("never offers an objective as a parent of a daily task", () => {
		const offered = candidateParents("daily", candidates, true).map((task) => task.level);
		expect(offered).not.toContain("objective");
	});

	it("widens the list when strict hierarchy is off but keeps levels distinct", () => {
		const offered = candidateParents("weekly", candidates, false).map((task) => task.level);
		expect(offered).toEqual(["daily", "monthly", "quarterly", "yearly", "objective"]);
	});
});
