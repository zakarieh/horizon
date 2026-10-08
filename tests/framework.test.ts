import { describe, expect, it } from "vitest";

import {
	FRAMEWORK_LAYERS,
	FRAMEWORK_TERMS,
	frameworkIsEmpty,
	frameworkSections,
	isFrameworkTerm,
	normalizeFramework,
	sameFramework,
} from "../src/domain";

describe("FRAMEWORK_LAYERS", () => {
	it("splits the twelve terms into design and execution, in order", () => {
		expect(FRAMEWORK_LAYERS.map((entry) => entry.layer)).toEqual(["plan", "execute"]);
		expect(FRAMEWORK_LAYERS[0].terms).toHaveLength(6);
		expect(FRAMEWORK_LAYERS[1].terms).toHaveLength(6);
		expect([...FRAMEWORK_LAYERS[0].terms, ...FRAMEWORK_LAYERS[1].terms]).toEqual([
			...FRAMEWORK_TERMS,
		]);
	});

	it("puts the design terms before the execution ones", () => {
		expect(FRAMEWORK_LAYERS[0].terms[0]).toBe("why");
		expect(FRAMEWORK_LAYERS[0].terms).toContain("risks");
		expect(FRAMEWORK_LAYERS[1].terms[0]).toBe("outcome");
		expect(FRAMEWORK_LAYERS[1].terms).toContain("stopList");
	});
});

describe("isFrameworkTerm", () => {
	it("accepts the twelve terms and nothing else", () => {
		for (const term of FRAMEWORK_TERMS) {
			expect(isFrameworkTerm(term)).toBe(true);
		}
		expect(isFrameworkTerm("budget")).toBe(false);
		expect(isFrameworkTerm("")).toBe(false);
	});
});

describe("normalizeFramework", () => {
	it("trims values and drops blank terms", () => {
		expect(normalizeFramework({ why: "  keep going  ", risks: "   " })).toEqual({
			why: "keep going",
		});
	});

	it("drops keys that are not terms, whatever they hold", () => {
		expect(normalizeFramework({ why: "x", budget: "1000", metrics: 5 })).toEqual({
			why: "x",
		});
	});

	it("tolerates anything frontmatter could hold", () => {
		for (const raw of [null, undefined, 7, "text", [], true]) {
			expect(normalizeFramework(raw)).toEqual({});
		}
	});
});

describe("frameworkIsEmpty", () => {
	it("is true only when every term is blank", () => {
		expect(frameworkIsEmpty({})).toBe(true);
		expect(frameworkIsEmpty({ why: "  " })).toBe(true);
		expect(frameworkIsEmpty({ review: "Fridays" })).toBe(false);
	});
});

describe("frameworkSections", () => {
	it("groups the filled terms by layer, in framework order", () => {
		const sections = frameworkSections({ metrics: "Signups", why: "Because" });

		expect(sections.map((section) => section.layer)).toEqual(["plan", "execute"]);
		expect(sections[0].terms).toEqual(["why"]);
		expect(sections[1].terms).toEqual(["metrics"]);
	});

	it("orders the terms of a layer the way the framework does", () => {
		const [plan] = frameworkSections({ risks: "a", why: "b", constraints: "c" });

		expect(plan.terms).toEqual(["why", "constraints", "risks"]);
	});

	it("drops a layer that has nothing filled in", () => {
		expect(frameworkSections({ why: "a" }).map((section) => section.layer)).toEqual([
			"plan",
		]);
		expect(frameworkSections({ habits: "b" }).map((section) => section.layer)).toEqual([
			"execute",
		]);
	});

	it("treats a whitespace-only term as empty", () => {
		expect(frameworkSections({ why: "  " })).toEqual([]);
	});
});

describe("sameFramework", () => {
	it("ignores key order and surrounding whitespace", () => {
		expect(
			sameFramework({ why: "a", metrics: "b" }, { metrics: "b ", why: " a" }),
		).toBe(true);
	});

	it("sees a cleared term as a change", () => {
		expect(sameFramework({ why: "a" }, { why: "" })).toBe(false);
		expect(sameFramework({ why: "a" }, {})).toBe(false);
	});
});
