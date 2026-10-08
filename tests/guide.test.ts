import { describe, expect, it } from "vitest";

import {
	ALLOWED_PARENT_LEVELS,
	LEVELS,
	PRIORITIES,
	STATUS_CATEGORIES,
} from "../src/domain";
import { buildGuideMarkdown } from "../src/guide";

const VERSION = "9.9.9";
const guide = buildGuideMarkdown(VERSION);

/**
 * The frontmatter keys the data layer reads. The guide has to document all of
 * them, which is what keeps the in-app help honest as the schema grows.
 */
const FRONTMATTER_FIELDS = [
	"tf-task",
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
] as const;

describe("buildGuideMarkdown", () => {
	it("substitutes the version and leaves no placeholder behind", () => {
		expect(guide).toContain(VERSION);
		expect(guide).not.toContain("{{");
	});

	it("produces a substantial markdown document", () => {
		expect(guide.startsWith("# ")).toBe(true);
		expect(guide.length).toBeGreaterThan(2000);
	});

	it("keeps fenced code blocks balanced", () => {
		const fences = guide
			.split("\n")
			.filter((line) => line.trimStart().startsWith("```"));
		expect(fences.length).toBeGreaterThan(0);
		expect(fences.length % 2).toBe(0);
	});

	it("keeps every markdown table row well formed", () => {
		const rows = guide.split("\n").filter((line) => line.startsWith("|"));
		expect(rows.length).toBeGreaterThan(20);

		for (const row of rows) {
			// Each row must be terminated and contain at least one cell.
			expect(row.endsWith("|")).toBe(true);
			expect(row.split("|").length).toBeGreaterThanOrEqual(3);
		}
	});
});

describe("the guide stays in sync with the domain", () => {
	it("documents every horizon", () => {
		for (const level of LEVELS) {
			expect(guide).toContain(`\`${level}\``);
		}
	});

	it("documents every priority", () => {
		for (const priority of PRIORITIES) {
			expect(guide).toContain(`\`${priority}\``);
		}
	});

	it("documents every frontmatter field", () => {
		for (const field of FRONTMATTER_FIELDS) {
			expect(guide).toContain(`\`${field}\``);
		}
	});

	it("documents every status category", () => {
		for (const category of STATUS_CATEGORIES) {
			expect(guide).toContain(category);
		}
	});

	it("mirrors the allowed parent table", () => {
		for (const child of LEVELS) {
			const parents = ALLOWED_PARENT_LEVELS[child];
			if (parents.length === 0) {
				continue;
			}
			expect(guide).toContain(parents.join(" or "));
		}
	});

	it("shows a usable frontmatter example", () => {
		expect(guide).toContain("```yaml");
		expect(guide).toContain("tf-task: true");
		expect(guide).toContain("[[2026-W40 Launch website]]");
	});
});
