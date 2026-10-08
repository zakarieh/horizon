import { describe, expect, it } from "vitest";

import { normalizeTagColors, tagBaseColor, tagColorOf } from "../src/domain";
import { tagHue } from "../src/util/color";

describe("normalizeTagColors", () => {
	it("normalises keys and keeps usable colours", () => {
		const colors = normalizeTagColors({ "  #Work ": "#1f6feb", home: "#abc" });

		expect(colors).toEqual({ work: "#1f6feb", home: "#abc" });
	});

	it("drops entries that are not hex colours or have no tag", () => {
		const colors = normalizeTagColors({
			work: "#1f6feb",
			broken: "red",
			"#": "#1f6feb",
			7: "red",
		});

		expect(colors).toEqual({ work: "#1f6feb" });
	});

	it("returns an empty map for unusable data", () => {
		expect(normalizeTagColors(null)).toEqual({});
		expect(normalizeTagColors(["#1f6feb"])).toEqual({});
		expect(normalizeTagColors("nonsense")).toEqual({});
	});
});

describe("tagColorOf", () => {
	it("resolves a tag whatever its case or padding", () => {
		const colors = normalizeTagColors({ work: "#1f6feb" });

		expect(tagColorOf("#Work", colors)).toBe("#1f6feb");
		expect(tagColorOf("  work ", colors)).toBe("#1f6feb");
	});

	it("returns null for a tag without a stored colour", () => {
		expect(tagColorOf("home", {})).toBeNull();
	});
});

describe("tagBaseColor", () => {
	it("uses the stored colour when the tag has one", () => {
		expect(tagBaseColor("work", { work: "#1f6feb" })).toBe("#1f6feb");
	});

	it("falls back to the hue hashed from the tag name", () => {
		expect(tagBaseColor("work", {})).toBe(`hsl(${String(tagHue("work"))} 70% 50%)`);
	});
});
