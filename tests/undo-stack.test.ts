import { describe, expect, it } from "vitest";

import { UndoStack } from "../src/util/undo-stack";

describe("UndoStack", () => {
	it("returns the most recent entry first", () => {
		const stack = new UndoStack<string>();
		stack.push("first");
		stack.push("second");

		expect(stack.pop()).toBe("second");
		expect(stack.pop()).toBe("first");
	});

	it("is empty to begin with and stays empty", () => {
		const stack = new UndoStack<number>();
		expect(stack.size).toBe(0);
		expect(stack.pop()).toBeUndefined();
		expect(stack.peek()).toBeUndefined();
	});

	it("peeks without consuming", () => {
		const stack = new UndoStack<string>();
		stack.push("only");
		expect(stack.peek()).toBe("only");
		expect(stack.size).toBe(1);
	});

	it("forgets the oldest entry once it is full", () => {
		const stack = new UndoStack<number>(2);
		stack.push(1);
		stack.push(2);
		stack.push(3);

		expect(stack.size).toBe(2);
		expect(stack.pop()).toBe(3);
		expect(stack.pop()).toBe(2);
		expect(stack.pop()).toBeUndefined();
	});

	it("keeps at least one entry", () => {
		const stack = new UndoStack<number>(0);
		stack.push(1);
		stack.push(2);
		expect(stack.size).toBe(1);
		expect(stack.pop()).toBe(2);
	});

	it("can be cleared", () => {
		const stack = new UndoStack<string>();
		stack.push("a");
		stack.clear();
		expect(stack.size).toBe(0);
	});
});
