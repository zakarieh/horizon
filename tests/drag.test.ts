import { describe, expect, it } from "vitest";

import {
	columnDroppableId,
	isColumnDroppableId,
	orderAtBottom,
	orderAtTop,
	resolveColumnId,
	resolveDropTarget,
	type DragBoard,
	type DragCard,
} from "../src/domain";

function card(path: string, order: string): DragCard {
	return { path, order };
}

/** todo: A B C | doing: X Y | done: (empty) */
function makeBoard(): DragBoard {
	return [
		{ id: "todo", cards: [card("A", "a0"), card("B", "a1"), card("C", "a2")] },
		{ id: "doing", cards: [card("X", "a0"), card("Y", "a1")] },
		{ id: "done", cards: [] },
	];
}

/**
 * Mirrors what the app does with a resolved drop: move the card, then re-read
 * the column in `order` sequence. Asserting on the resulting arrangement is
 * what proves the generated key really puts the card where the preview showed.
 */
function applyDrop(board: DragBoard, activePath: string, overId: string): DragBoard {
	const target = resolveDropTarget(board, activePath, overId);
	if (target === null) {
		return board;
	}
	return board.map((column) => {
		const others = column.cards.filter((entry) => entry.path !== activePath);
		if (column.id !== target.columnId) {
			return { ...column, cards: others };
		}
		return {
			...column,
			cards: [...others, card(activePath, target.order)].sort((a, b) =>
				a.order < b.order ? -1 : a.order > b.order ? 1 : 0,
			),
		};
	});
}

function order(board: DragBoard, columnId: string): string[] {
	return (board.find((column) => column.id === columnId)?.cards ?? []).map(
		(entry) => entry.path,
	);
}

describe("column droppable ids", () => {
	it("round-trips a column id", () => {
		expect(columnDroppableId("todo")).toBe("tf-column:todo");
		expect(isColumnDroppableId(columnDroppableId("todo"))).toBe(true);
		expect(isColumnDroppableId("A")).toBe(false);
	});
});

describe("resolveColumnId", () => {
	it("finds the column a card is in", () => {
		expect(resolveColumnId(makeBoard(), "C")).toBe("todo");
		expect(resolveColumnId(makeBoard(), "X")).toBe("doing");
	});

	it("finds a column from its droppable id, including an empty one", () => {
		expect(resolveColumnId(makeBoard(), columnDroppableId("done"))).toBe("done");
	});

	it("returns null for ids that match nothing", () => {
		expect(resolveColumnId(makeBoard(), "nope")).toBeNull();
		expect(resolveColumnId(makeBoard(), columnDroppableId("archived"))).toBeNull();
	});

	it("prefers a real card over a path that looks like a column id", () => {
		const tricky: DragBoard = [
			{ id: "todo", cards: [card("tf-column:done", "a0")] },
			{ id: "done", cards: [] },
		];
		expect(resolveColumnId(tricky, "tf-column:done")).toBe("todo");
	});
});

describe("resolveDropTarget across columns", () => {
	it("inserts before the card it was dropped on", () => {
		const next = applyDrop(makeBoard(), "A", "Y");
		expect(order(next, "doing")).toEqual(["X", "A", "Y"]);
		expect(order(next, "todo")).toEqual(["B", "C"]);
	});

	it("inserts at the head when dropped on the first card", () => {
		expect(order(applyDrop(makeBoard(), "A", "X"), "doing")).toEqual(["A", "X", "Y"]);
	});

	it("appends when dropped on a column's empty area", () => {
		expect(order(applyDrop(makeBoard(), "A", columnDroppableId("doing")), "doing")).toEqual([
			"X",
			"Y",
			"A",
		]);
	});

	it("moves into an empty column", () => {
		const next = applyDrop(makeBoard(), "C", columnDroppableId("done"));
		expect(order(next, "done")).toEqual(["C"]);
		expect(order(next, "todo")).toEqual(["A", "B"]);
	});

	it("reports the index it inserted at", () => {
		const target = resolveDropTarget(makeBoard(), "A", "Y");
		expect(target).toMatchObject({ columnId: "doing", index: 1 });
	});
});

describe("resolveDropTarget inside one column", () => {
	it("matches dnd-kit's arrayMove when moving a card down", () => {
		expect(order(applyDrop(makeBoard(), "A", "C"), "todo")).toEqual(["B", "C", "A"]);
	});

	it("matches dnd-kit's arrayMove when moving a card up", () => {
		expect(order(applyDrop(makeBoard(), "C", "A"), "todo")).toEqual(["C", "A", "B"]);
	});

	it("swaps neighbours", () => {
		expect(order(applyDrop(makeBoard(), "A", "B"), "todo")).toEqual(["B", "A", "C"]);
	});
});

describe("resolveDropTarget no-ops", () => {
	it("ignores a card dropped on itself", () => {
		expect(resolveDropTarget(makeBoard(), "A", "A")).toBeNull();
	});

	it("ignores a column's last card dropped on that column", () => {
		expect(resolveDropTarget(makeBoard(), "C", columnDroppableId("todo"))).toBeNull();
		expect(resolveDropTarget(makeBoard(), "Y", columnDroppableId("doing"))).toBeNull();
	});

	it("ignores an id that is not on the board", () => {
		expect(resolveDropTarget(makeBoard(), "A", "ghost")).toBeNull();
		expect(resolveDropTarget(makeBoard(), "A", columnDroppableId("archived"))).toBeNull();
	});

	it("does not move a card onto an empty column it is already the only member of", () => {
		const board: DragBoard = [{ id: "done", cards: [card("C", "a0")] }];
		expect(resolveDropTarget(board, "C", columnDroppableId("done"))).toBeNull();
	});
});

describe("generated keys stay well ordered", () => {
	it("keeps every column sorted and unique across 200 moves", () => {
		let board = makeBoard();
		const moves: [string, string][] = [
			["A", "Y"],
			["X", "B"],
			["C", "A"],
			["Y", columnDroppableId("done")],
			["B", "X"],
			["A", columnDroppableId("doing")],
			["X", columnDroppableId("todo")],
		];

		for (let step = 0; step < 200; step++) {
			const [active, over] = moves[step % moves.length];
			board = applyDrop(board, active, over);
		}

		for (const column of board) {
			const keys = column.cards.map((entry) => entry.order);
			expect(keys).toEqual([...keys].sort());
			expect(new Set(keys).size).toBe(keys.length);
		}

		// Nothing was lost or duplicated along the way.
		const paths = board.flatMap((column) => column.cards.map((entry) => entry.path)).sort();
		expect(paths).toEqual(["A", "B", "C", "X", "Y"]);
	});

	it("keeps inserting into the same gap without losing precision", () => {
		let board: DragBoard = [{ id: "todo", cards: [card("A", "a0"), card("B", "a1")] }];
		for (let step = 0; step < 60; step++) {
			board = applyDrop(board, "A", "B");
			board = applyDrop(board, "B", "A");
		}
		const keys = order(board, "todo").length;
		expect(keys).toBe(2);
		const column = board[0];
		expect(column?.cards[0]?.order).not.toBe(column?.cards[1]?.order);
	});
});

describe("non-drag ordering helpers", () => {
	it("puts a card at the top of a column", () => {
		const target = orderAtTop(makeBoard(), "doing", "A");
		expect(target < "a0").toBe(true);
	});

	it("puts a card at the bottom of a column", () => {
		const target = orderAtBottom(makeBoard(), "doing", "A");
		expect(target > "a1").toBe(true);
	});

	it("handles an empty column", () => {
		expect(orderAtTop(makeBoard(), "done", "A")).toBe("a0");
		expect(orderAtBottom(makeBoard(), "done", "A")).toBe("a0");
	});

	it("ignores the card being moved when working out the neighbours", () => {
		// Moving X to the top of its own, otherwise empty, column: the key has to
		// come from the column without X, not from X itself.
		const board: DragBoard = [{ id: "doing", cards: [card("X", "a0")] }];
		expect(orderAtTop(board, "doing", "X")).toBe("a0");
	});
});
