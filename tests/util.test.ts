import { describe, expect, it } from "vitest";

import { basename, folderOf, toNoteFileName } from "../src/domain";
import { tagHue } from "../src/util/color";
import { asRecord, isRecord, trimmedOrNull } from "../src/util/records";
import { formatTemplate } from "../src/util/text";

describe("basename", () => {
	it("strips folders and the extension", () => {
		expect(basename("Tasks/2026-W40 Launch.md")).toBe("2026-W40 Launch");
		expect(basename("2026-W40 Launch.md")).toBe("2026-W40 Launch");
		expect(basename("a/b/c/Note.md")).toBe("Note");
	});

	it("tolerates a missing extension or an empty path", () => {
		expect(basename("Tasks/Note")).toBe("Note");
		expect(basename("")).toBe("");
	});

	it("only strips a trailing .md", () => {
		expect(basename("Tasks/markdown.md.txt")).toBe("markdown.md.txt");
		expect(basename("Tasks/.md")).toBe("");
	});
});

describe("folderOf", () => {
	it("returns the folder including its trailing slash", () => {
		expect(folderOf("Tasks/Sub/Note.md")).toBe("Tasks/Sub/");
		expect(folderOf("Note.md")).toBe("");
	});
});

describe("toNoteFileName", () => {
	it("keeps ordinary titles as they are", () => {
		expect(toNoteFileName("Ship v1 landing page", "Untitled")).toBe("Ship v1 landing page");
	});

	it("replaces characters Obsidian rejects", () => {
		expect(toNoteFileName("Ship: v1", "Untitled")).toBe("Ship v1");
		expect(toNoteFileName("a/b\\c", "Untitled")).toBe("a b c");
		expect(toNoteFileName("why? [really]", "Untitled")).toBe("why really");
		expect(toNoteFileName("hashtag #work", "Untitled")).toBe("hashtag work");
	});

	it("strips leading and trailing dots and spaces", () => {
		expect(toNoteFileName("  spaced  out  ", "Untitled")).toBe("spaced out");
		expect(toNoteFileName("..hidden..", "Untitled")).toBe("hidden");
	});

	it("falls back when nothing usable is left", () => {
		expect(toNoteFileName("///", "Untitled task")).toBe("Untitled task");
		expect(toNoteFileName("   ", "Untitled task")).toBe("Untitled task");
	});

	it("caps the length", () => {
		expect(toNoteFileName("x".repeat(500), "Untitled").length).toBe(96);
	});
});

describe("record guards", () => {
	it("recognises plain objects only", () => {
		expect(isRecord({})).toBe(true);
		expect(isRecord([])).toBe(false);
		expect(isRecord(null)).toBe(false);
		expect(isRecord("text")).toBe(false);
	});

	it("hands back the same reference so frontmatter can be mutated in place", () => {
		const original: Record<string, unknown> = { keep: true };
		expect(asRecord(original)).toBe(original);
	});

	it("substitutes an empty object for anything else", () => {
		expect(asRecord(null)).toEqual({});
		expect(asRecord("nope")).toEqual({});
	});

	it("trims strings and rejects everything else", () => {
		expect(trimmedOrNull("  value ")).toBe("value");
		expect(trimmedOrNull("   ")).toBeNull();
		expect(trimmedOrNull(42)).toBeNull();
		expect(trimmedOrNull(null)).toBeNull();
	});
});

describe("formatTemplate", () => {
	it("fills named slots", () => {
		expect(formatTemplate("{count} notes need attention", { count: 3 })).toBe(
			"3 notes need attention",
		);
	});

	it("leaves unknown slots alone rather than printing undefined", () => {
		expect(formatTemplate("{a} and {b}", { a: "x" })).toBe("x and {b}");
	});
});

describe("tagHue", () => {
	it("is stable for a tag, whatever its case or padding", () => {
		expect(tagHue("work")).toBe(tagHue("work"));
		expect(tagHue("  Work ")).toBe(tagHue("work"));
	});

	it("keeps every tag on the hue circle", () => {
		for (const tag of ["", "a", "work", "website", "launch", "über", "2026"]) {
			const hue = tagHue(tag);
			expect(hue).toBeGreaterThanOrEqual(0);
			expect(hue).toBeLessThan(360);
		}
	});

	it("spreads different tags over more than one hue", () => {
		const hues = new Set(["work", "website", "launch", "home", "urgent"].map(tagHue));
		expect(hues.size).toBeGreaterThan(1);
	});
});
