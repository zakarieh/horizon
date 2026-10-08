import { describe, expect, it } from "vitest";

import {
	COLOR_BLIND_SAFE_STATUS_COLORS,
	DEFAULT_STATUS_COLORS,
	DEFAULT_STATUSES,
	applyPalette,
	cloneStatuses,
} from "../src/domain";
import {
	MIN_GRAPHIC_CONTRAST,
	THEME_BACKGROUNDS,
	contrastRatio,
	meetsGraphicContrast,
} from "../src/util/color";

/** Every colour either palette can hand out for a default status. */
function paletteColors(palette: Record<string, string>): [string, string][] {
	return Object.entries(palette);
}

describe("status colour contrast", () => {
	it("keeps every default colour distinguishable from both themes", () => {
		for (const [id, color] of paletteColors(DEFAULT_STATUS_COLORS)) {
			const light = contrastRatio(color, THEME_BACKGROUNDS.light);
			const dark = contrastRatio(color, THEME_BACKGROUNDS.dark);
			expect(light, `${id} against the light theme`).not.toBeNull();
			expect(dark, `${id} against the dark theme`).not.toBeNull();
			expect(
				meetsGraphicContrast(color).ok,
				`${id} (${color}) must reach ${String(MIN_GRAPHIC_CONTRAST)}:1`,
			).toBe(true);
		}
	});

	it("keeps every colour-blind-safe colour distinguishable from both themes", () => {
		for (const [id, color] of paletteColors(COLOR_BLIND_SAFE_STATUS_COLORS)) {
			expect(
				meetsGraphicContrast(color).ok,
				`${id} (${color}) must reach ${String(MIN_GRAPHIC_CONTRAST)}:1`,
			).toBe(true);
		}
	});

	it("moves done and blocked off red and green", () => {
		// The point of the second palette: these two states are told apart by hue
		// family rather than by red versus green.
		expect(COLOR_BLIND_SAFE_STATUS_COLORS.done).not.toBe(DEFAULT_STATUS_COLORS.done);
		expect(COLOR_BLIND_SAFE_STATUS_COLORS.blocked).not.toBe(
			DEFAULT_STATUS_COLORS.blocked,
		);
		// Amber carries "in progress" in both: it is already distinguishable from
		// blue, teal and magenta without relying on red-green perception.
		expect(COLOR_BLIND_SAFE_STATUS_COLORS["in-progress"]).toBe(
			DEFAULT_STATUS_COLORS["in-progress"],
		);
	});

	it("keeps the two palettes otherwise disjoint", () => {
		const defaults = new Set(Object.values(DEFAULT_STATUS_COLORS));
		for (const [id, color] of Object.entries(COLOR_BLIND_SAFE_STATUS_COLORS)) {
			if (id === "in-progress") {
				// The one deliberate overlap: amber is colour-blind-safe already.
				continue;
			}
			expect(defaults.has(color), `${id} (${color}) must not repeat a default`).toBe(
				false,
			);
		}
	});

	it("has a colour for every status the registry starts with", () => {
		for (const status of DEFAULT_STATUSES) {
			expect(DEFAULT_STATUS_COLORS[status.id]).toBeDefined();
			expect(COLOR_BLIND_SAFE_STATUS_COLORS[status.id]).toBeDefined();
		}
	});
});

describe("applyPalette", () => {
	it("moves every status that is still on a default colour", () => {
		const recoloured = applyPalette(DEFAULT_STATUSES, COLOR_BLIND_SAFE_STATUS_COLORS);
		for (const status of recoloured) {
			expect(status.color).toBe(COLOR_BLIND_SAFE_STATUS_COLORS[status.id]);
		}
	});

	it("leaves a status the user recoloured alone", () => {
		const registry = cloneStatuses(DEFAULT_STATUSES).map((status) =>
			status.id === "done" ? { ...status, color: "#123456" } : status,
		);
		const recoloured = applyPalette(registry, COLOR_BLIND_SAFE_STATUS_COLORS);
		expect(recoloured.find((status) => status.id === "done")?.color).toBe("#123456");
		// Everything else still moves.
		expect(recoloured.find((status) => status.id === "todo")?.color).toBe(
			COLOR_BLIND_SAFE_STATUS_COLORS.todo,
		);
	});

	it("leaves a status the palette has nothing to say about alone", () => {
		const registry = [
			{ ...DEFAULT_STATUSES[0], id: "custom", color: "#abcdef" },
			...cloneStatuses(DEFAULT_STATUSES),
		];
		const recoloured = applyPalette(registry, COLOR_BLIND_SAFE_STATUS_COLORS);
		expect(recoloured.find((status) => status.id === "custom")?.color).toBe("#abcdef");
	});

	it("compares colours case-insensitively", () => {
		const registry = cloneStatuses(DEFAULT_STATUSES).map((status) =>
			status.id === "todo" ? { ...status, color: "#1F6FEB" } : status,
		);
		const recoloured = applyPalette(registry, COLOR_BLIND_SAFE_STATUS_COLORS);
		expect(recoloured.find((status) => status.id === "todo")?.color).toBe(
			COLOR_BLIND_SAFE_STATUS_COLORS.todo,
		);
	});

	it("does not touch the input registry", () => {
		const registry = cloneStatuses(DEFAULT_STATUSES);
		applyPalette(registry, COLOR_BLIND_SAFE_STATUS_COLORS);
		expect(registry.find((status) => status.id === "done")?.color).toBe(
			DEFAULT_STATUS_COLORS.done,
		);
	});

	it("round-trips back to the default palette", () => {
		const theirWay = applyPalette(DEFAULT_STATUSES, COLOR_BLIND_SAFE_STATUS_COLORS);
		const back = applyPalette(theirWay, DEFAULT_STATUS_COLORS);
		for (const status of back) {
			expect(status.color).toBe(DEFAULT_STATUS_COLORS[status.id]);
		}
	});
});
