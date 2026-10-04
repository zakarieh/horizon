import { describe, expect, it } from "vitest";

import {
	firstOrderKey,
	generateKeyBetween,
	generateNKeysBetween,
	isValidOrderKey,
} from "../src/domain";

/** Inserts `count` keys into the same shrinking gap and returns them. */
function stackBetween(a: string, b: string, count: number): string[] {
	const inserted: string[] = [];
	let upper = b;
	for (let i = 0; i < count; i++) {
		upper = generateKeyBetween(a, upper);
		inserted.push(upper);
	}
	return inserted;
}

describe("generateKeyBetween", () => {
	it("creates a valid first key", () => {
		const key = firstOrderKey();
		expect(isValidOrderKey(key)).toBe(true);
		expect(key).toBe("a0");
	});

	it("inserts strictly between its bounds", () => {
		const a = generateKeyBetween(null, null);
		const b = generateKeyBetween(a, null);
		const middle = generateKeyBetween(a, b);

		expect(a < middle).toBe(true);
		expect(middle < b).toBe(true);
	});

	it("inserts before the first and after the last key", () => {
		const only = generateKeyBetween(null, null);
		const before = generateKeyBetween(null, only);
		const after = generateKeyBetween(only, null);

		expect(before < only).toBe(true);
		expect(only < after).toBe(true);
	});

	it("appends 200 keys while preserving strict order and uniqueness", () => {
		const keys = [generateKeyBetween(null, null)];
		for (let i = 1; i < 200; i++) {
			keys.push(generateKeyBetween(keys[keys.length - 1], null));
		}

		expect([...keys].sort()).toEqual(keys);
		expect(new Set(keys).size).toBe(keys.length);
	});

	it("prepends 200 keys while preserving strict order", () => {
		const keys = [generateKeyBetween(null, null)];
		for (let i = 1; i < 200; i++) {
			keys.unshift(generateKeyBetween(null, keys[0]));
		}

		expect([...keys].sort()).toEqual(keys);
	});

	it("keeps inserting into the same gap without running out of precision", () => {
		const a = generateKeyBetween(null, null);
		const b = generateKeyBetween(a, null);
		const inserted = stackBetween(a, b, 100);

		for (const key of inserted) {
			expect(key > a).toBe(true);
			expect(key < b).toBe(true);
			expect(isValidOrderKey(key)).toBe(true);
		}
		// Inserted from the top down, so each new key sorts before the previous.
		expect([...inserted].sort()).toEqual([...inserted].reverse());
	});

	it("rejects inverted, equal and malformed bounds", () => {
		const a = generateKeyBetween(null, null);
		const b = generateKeyBetween(a, null);

		expect(() => generateKeyBetween(b, a)).toThrow();
		expect(() => generateKeyBetween(a, a)).toThrow();
		expect(() => generateKeyBetween("A", null)).toThrow();
		expect(() => generateKeyBetween("", null)).toThrow();
	});

	it("decrements below the very first key instead of failing", () => {
		const first = firstOrderKey();
		const before = generateKeyBetween(null, first);
		expect(before < first).toBe(true);
		expect(isValidOrderKey(before)).toBe(true);
	});
});

describe("generateNKeysBetween", () => {
	it("returns the requested number of ordered keys between its bounds", () => {
		const a = generateKeyBetween(null, null);
		const b = generateKeyBetween(a, null);
		const keys = generateNKeysBetween(a, b, 10);

		expect(keys).toHaveLength(10);
		expect([...keys].sort()).toEqual(keys);
		expect(keys.every((key) => key > a && key < b)).toBe(true);
	});

	it("handles open bounds and the empty/tiny cases", () => {
		expect(generateNKeysBetween(null, null, 0)).toEqual([]);
		expect(generateNKeysBetween(null, null, 1)).toHaveLength(1);

		const tail = generateNKeysBetween(null, null, 5);
		expect([...tail].sort()).toEqual(tail);
		expect(tail.every(isValidOrderKey)).toBe(true);
	});

	it("rejects a non-integer count", () => {
		expect(() => generateNKeysBetween(null, null, -1)).toThrow(/non-negative/);
		expect(() => generateNKeysBetween(null, null, 2.5)).toThrow(/non-negative/);
	});
});

describe("isValidOrderKey", () => {
	it("rejects non-string and malformed input", () => {
		expect(isValidOrderKey(null)).toBe(false);
		expect(isValidOrderKey(42)).toBe(false);
		expect(isValidOrderKey("")).toBe(false);
		expect(isValidOrderKey("a")).toBe(false);
		expect(isValidOrderKey("a0")).toBe(true);
	});
});
