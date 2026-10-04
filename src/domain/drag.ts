/**
 * Drop resolution for drag and drop.
 *
 * All of the thinking lives here rather than in the React layer: given the
 * board as it is rendered, the card being dragged and the dnd-kit `over` id,
 * this module decides which column the card lands in, at which index, and what
 * fractional `order` key puts it there.
 *
 * The insertion rule matches dnd-kit's own `arrayMove`, so the card settles
 * exactly where the drag preview showed it:
 *
 * **The card is inserted at the index the card it was dropped on occupies in
 * its column, after the dragged card has been taken out.** Dropping onto a
 * column's empty area appends to the end.
 */

import { generateKeyBetween } from "./fractional";

/** A card as the drag layer needs to see it. */
export interface DragCard {
	/** Task path, which is the dnd-kit id for the card. */
	path: string;
	/** Current fractional order key. */
	order: string;
}

/** A column as the drag layer needs to see it. */
export interface DragColumn {
	/** Status id. */
	id: string;
	cards: readonly DragCard[];
}

/**
 * The rendered board. Only rendered columns appear, so indexes always match
 * what the user can see.
 */
export type DragBoard = readonly DragColumn[];

/** Where a dragged card ends up. */
export interface DropTarget {
	columnId: string;
	/** Index among the other cards of the target column. */
	index: number;
	/** Fractional key that places the card at that index. */
	order: string;
}

/**
 * Prefix for a column's droppable id.
 *
 * Cards are identified by their task path, so a column id has to be something a
 * path can never be. Cards are looked up first, which makes the two spaces
 * unambiguous even if a note were called `tf-column:todo`.
 */
const COLUMN_PREFIX = "tf-column:";

/** The dnd-kit droppable id for a column's drop area. */
export function columnDroppableId(columnId: string): string {
	return `${COLUMN_PREFIX}${columnId}`;
}

/** Whether a dnd-kit id refers to a column's drop area. */
export function isColumnDroppableId(id: string): boolean {
	return id.startsWith(COLUMN_PREFIX);
}

/**
 * Resolves a dnd-kit `over` id to the column it belongs to.
 *
 * @returns The column id, or `null` when the id matches nothing on the board.
 */
export function resolveColumnId(board: DragBoard, overId: string): string | null {
	for (const column of board) {
		if (column.cards.some((card) => card.path === overId)) {
			return column.id;
		}
	}
	if (!isColumnDroppableId(overId)) {
		return null;
	}
	const columnId = overId.slice(COLUMN_PREFIX.length);
	return board.some((column) => column.id === columnId) ? columnId : null;
}

/** Locates a card on the board. */
function findCard(
	board: DragBoard,
	path: string,
): { column: DragColumn; index: number } | null {
	for (const column of board) {
		const index = column.cards.findIndex((card) => card.path === path);
		if (index >= 0) {
			return { column, index };
		}
	}
	return null;
}

/**
 * Works out where a dragged card lands.
 *
 * @param board The board as rendered.
 * @param activePath The card being dragged.
 * @param overId The dnd-kit id the pointer or keyboard is over.
 * @returns The target column, index and order key - or `null` when the drop
 * changes nothing, or `overId` matches nothing.
 */
export function resolveDropTarget(
	board: DragBoard,
	activePath: string,
	overId: string,
): DropTarget | null {
	const columnId = resolveColumnId(board, overId);
	if (columnId === null) {
		return null;
	}
	const column = board.find((entry) => entry.id === columnId);
	if (column === undefined) {
		return null;
	}

	const from = findCard(board, activePath);
	const overIndex = column.cards.findIndex((card) => card.path === overId);

	// Dropping a card onto itself, or onto the column it already ends, is a no-op.
	if (overIndex >= 0 && column.cards[overIndex]?.path === activePath) {
		return null;
	}

	const others = column.cards.filter((card) => card.path !== activePath);
	const startedHere = from !== null && from.column.id === columnId;

	// `overIndex` indexes the column as it currently is, including the dragged
	// card. Inserting at that same index in `others` (which no longer holds the
	// dragged card) reproduces `arrayMove` exactly, for both directions and for
	// drops from another column.
	const index = overIndex >= 0 ? overIndex : others.length;

	if (startedHere && index === from.index) {
		return null;
	}

	const before = index > 0 ? others[index - 1] : undefined;
	// `others` no longer holds the dragged card, so its index is a plain lookup.
	const after = index < others.length ? others[index] : undefined;

	return {
		columnId,
		index,
		order: generateKeyBetween(before?.order ?? null, after?.order ?? null),
	};
}

/**
 * The order key that puts a card at the top of a column.
 *
 * Used by the non-drag "Move to" actions, which have to work even on a device
 * where dragging is unreliable.
 */
export function orderAtTop(board: DragBoard, columnId: string, excludePath: string): string {
	const column = board.find((entry) => entry.id === columnId);
	const first = column?.cards.filter((card) => card.path !== excludePath)[0];
	return generateKeyBetween(null, first?.order ?? null);
}

/** The order key that puts a card at the bottom of a column. */
export function orderAtBottom(
	board: DragBoard,
	columnId: string,
	excludePath: string,
): string {
	const column = board.find((entry) => entry.id === columnId);
	const others = (column?.cards ?? []).filter((card) => card.path !== excludePath);
	const last = others[others.length - 1];
	return generateKeyBetween(last?.order ?? null, null);
}
