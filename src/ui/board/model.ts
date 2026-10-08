import type {
	HierarchyIssue,
	Level,
	Priority,
	StatusCategory,
	TagColors,
} from "../../domain";

/**
 * The board model handed to the React layer.
 *
 * The React layer only renders and reports drag gestures; which cards exist and
 * where they belong is decided by `domain/board.ts` and flattened here by the
 * view. That keeps the components dumb and the interesting logic tested.
 */

/** One card, flattened for rendering. */
export interface BoardCardModel {
	/** Task path, which doubles as the dnd-kit id. */
	path: string;
	title: string;
	/** Fractional order key, used to resolve drops. */
	order: string;
	status: string;
	/** Colour of the card's status, or `null` when the status is unknown. */
	statusColor: string | null;
	/**
	 * Category of the card's status. Drives the done and cancelled treatments,
	 * and is derived from the registry rather than the column, so a card with an
	 * unknown status still renders sensibly.
	 */
	statusCategory: StatusCategory | null;
	priority: Priority;
	level: Level;
	/** Period as stored, e.g. `2026-W40`; the popup formats it for display. */
	period: string | null;
	due: string | null;
	parent: string | null;
	/**
	 * Path of the parent note, resolved from the wikilink in frontmatter, or
	 * `null` when the link is missing or broken. This is what a click opens.
	 */
	parentPath: string | null;
	/** Merged frontmatter and body tags, for display and filtering. */
	tags: string[];
	/** Tags that live in the note body, which a tag edit must leave alone. */
	bodyTags: readonly string[];
	/**
	 * Folder the note should be in, or `null` when it is filed correctly.
	 *
	 * The note is never moved silently: the card shows a badge and offers the move.
	 */
	folderMismatch: string | null;
	/** Direct children that are done. */
	done: number;
	total: number;
	allChildrenDone: boolean;
	unknownStatus: boolean;
	issues: readonly HierarchyIssue[];
}

/** One column of the board. */
export interface BoardColumnModel {
	/** Column key: status id, priority value, or tag. */
	id: string;
	label: string;
	color: string;
	cards: readonly BoardCardModel[];
	/** Composite droppable id of this cell, when the board has swimlanes. */
	cellId?: string;
	/** Configured WIP limit, or `null`. */
	wipLimit?: number | null;
	/** Kept visible even when empty. */
	pinned?: boolean;
}

/** One swimlane row; a flat board has a single row with an empty key. */
export interface BoardRowModel {
	key: string;
	label: string;
	total: number;
	columns: readonly BoardColumnModel[];
}

/** Prefix for a column's sortable id, so it cannot collide with a card path or a cell. */
const COLUMN_SORT_PREFIX = "tf-colhead:";

/** The dnd-kit sortable id for a column header. */
export function columnSortableId(columnId: string): string {
	return `${COLUMN_SORT_PREFIX}${columnId}`;
}

/** Whether a dnd-kit id refers to a column header. */
export function isColumnSortableId(id: string): boolean {
	return id.startsWith(COLUMN_SORT_PREFIX);
}

/** The column id inside a column sortable id, or `null`. */
export function columnIdFromSortable(id: string): string | null {
	return isColumnSortableId(id) ? id.slice(COLUMN_SORT_PREFIX.length) : null;
}

/** Which optional bits of metadata a card shows. The title is always shown. */
export interface BoardDisplayOptions {
	priority: boolean;
	tags: boolean;
	due: boolean;
	parent: boolean;
	childProgress: boolean;
	period: boolean;
	/** Tag colour overrides, so a pinned tag keeps its colour on every card. */
	tagColors?: TagColors;
}

/** Callbacks a single card needs, threaded down through the columns. */
export interface CardActions {
	/** Opens the note behind a card; `newPane` opens it beside the board. */
	onOpenNote: (path: string, newPane?: boolean) => void;
	/** Applies a tag as the board's tag filter. */
	onFilterTag: (tag: string) => void;
	/** Opens the card's context menu at a screen position. */
	onContextMenu: (path: string, position: { x: number; y: number }) => void;
	/** Commits an inline title edit. */
	onRename: (path: string, title: string) => void;
	/** Opens the task editor modal for a card. */
	onEdit: (path: string) => void;
	/** Moves a note into the folder its horizon calls for. */
	onFixFolder: (path: string) => void;
}

/** Callbacks the React layer needs from the view. */
export interface BoardActions extends CardActions {
	/** Called for a completed drag; `overId` is `null` when cancelled. */
	onDragEnd: (activePath: string, overId: string | null) => void;
	/** Opens the task editor for a new task in a column. */
	onAddTask: (columnKey: string) => void;
	/** Reorders columns after a header drag. */
	onReorderColumns?: (fromId: string, toId: string) => void;
}

/** Props for the board body. */
export interface BoardBodyProps extends BoardActions {
	columns: readonly BoardColumnModel[];
	/**
	 * Swimlane rows. When present, the board renders as rows of cells instead of
	 * one flat row of columns; `columns` is then ignored.
	 */
	rows?: readonly BoardRowModel[];
	/** Column width in pixels. */
	columnWidth?: number;
	/** Height cap per swimlane row, in pixels. */
	maxSwimLaneHeight?: number;
	/** Tighter card density. */
	compact?: boolean;
	/** Cards per cell before the browser is asked to skip offscreen rendering. */
	virtualizeAt?: number;
	display: BoardDisplayOptions;
	/** Renders controls for touch devices. */
	mobile: boolean;
	/** Today as `yyyy-MM-dd`, so overdue styling is a string comparison. */
	today: string;
	/** Disables transforms, springs and the overlay tilt. */
	reducedMotion: boolean;
	/**
	 * Shows a menu button on every card. On touch devices there is no right
	 * click, and a long press is not guaranteed to reach a custom view, so the
	 * non-drag path needs a visible affordance.
	 */
	showMenuButton: boolean;
}
