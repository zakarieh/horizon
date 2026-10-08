import { describe, expect, it } from "vitest";

import { parseLinkRef, toLinkRef } from "../src/domain";

describe("parseLinkRef", () => {
	it("extracts a plain wikilink target", () => {
		expect(parseLinkRef("[[2026-W40 Launch website]]")).toBe("2026-W40 Launch website");
	});

	it("accepts a bare note name", () => {
		expect(parseLinkRef("2026-W40 Launch website")).toBe("2026-W40 Launch website");
	});

	it("strips aliases and heading anchors", () => {
		expect(parseLinkRef("[[Target|some alias]]")).toBe("Target");
		expect(parseLinkRef("[[Target#Heading]]")).toBe("Target");
		expect(parseLinkRef("[[Target#^block-id]]")).toBe("Target");
		expect(parseLinkRef("[[Folder/Target#Heading|alias]]")).toBe("Folder/Target");
	});

	it("returns null for missing, empty and non-string values", () => {
		expect(parseLinkRef(null)).toBeNull();
		expect(parseLinkRef(undefined)).toBeNull();
		expect(parseLinkRef("")).toBeNull();
		expect(parseLinkRef("   ")).toBeNull();
		expect(parseLinkRef("[[   ]]")).toBeNull();
		expect(parseLinkRef("[[]]")).toBeNull();
		expect(parseLinkRef(["Target"])).toBeNull();
		expect(parseLinkRef(42)).toBeNull();
	});

	it("trims surrounding whitespace", () => {
		expect(parseLinkRef("  [[Target]]  ")).toBe("Target");
	});
});

describe("toLinkRef", () => {
	it("wraps a target in a wikilink", () => {
		expect(toLinkRef("Target")).toBe("[[Target]]");
	});

	it("is idempotent", () => {
		expect(toLinkRef("[[Target]]")).toBe("[[Target]]");
		expect(toLinkRef(" [[Target]] ")).toBe("[[Target]]");
	});

	it("round-trips through parseLinkRef", () => {
		const target = "2026-Q4 Launch website";
		expect(parseLinkRef(toLinkRef(target))).toBe(target);
	});
});
