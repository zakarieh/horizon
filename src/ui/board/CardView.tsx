import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
	useEffect,
	useRef,
	useState,
	type CSSProperties,
	type MouseEvent as ReactMouseEvent,
	type ReactElement,
} from "react";

import type { BoardCardModel, BoardDisplayOptions, CardActions } from "./model";
import { basename, formatPeriodLabel } from "../../domain";
import { strings } from "../../strings";
import { tagHue } from "../../util/color";
import { formatTemplate } from "../../util/text";

/** How many tag chips a card shows before the rest collapse into `+N`. */
const MAX_VISIBLE_TAGS = 3;

/** Drop animation length; the spec asks for a short spring, not a bounce. */
export const DROP_ANIMATION_MS = 180;

/**
 * How long a click waits before opening the quick edit popup.
 *
 * The card answers to three gestures on the same target: a single click opens
 * the popup, while a double click and a Ctrl/Cmd click open the note. The
 * browser reports the two clicks of a double click before the double click
 * itself, so the popup has to wait out the double-click window or a double
 * click would open it as well.
 */
const TITLE_CLICK_GRACE_MS = 240;

interface CardViewProps extends CardActions {
	card: BoardCardModel;
	display: BoardDisplayOptions;
	today: string;
	/** Rendered inside the drag overlay rather than in a column. */
	isOverlay?: boolean;
	/** Shows the actions button; on touch there is no right click. */
	showMenuButton: boolean;
	/**
	 * Reports, once, whether a drag just happened. dnd-kit fires a click after a
	 * drop, so the card has to be able to tell a click from the end of a drag -
	 * otherwise every drag would also open the popup.
	 */
	consumeDrag: () => boolean;
}

/**
 * A card in a column: a sortable wrapper around the card's presentation.
 *
 * The sortable hooks live here rather than in {@link CardContent} because the
 * drag overlay renders the same presentation outside the sortable tree, and
 * hooks cannot be called conditionally.
 */
export function SortableCard({
	card,
	display,
	today,
	reducedMotion,
	...actions
}: CardViewProps & { reducedMotion: boolean }): ReactElement {
	const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
		useSortable({
			id: card.path,
			// `transition: null` is how dnd-kit is told to reposition instantly.
			transition: reducedMotion
				? null
				: { duration: DROP_ANIMATION_MS, easing: "cubic-bezier(0.2, 0, 0, 1)" },
		});

	return (
		<div
			ref={setNodeRef}
			className={isDragging ? "task-flow-card is-dragging" : "task-flow-card"}
			style={{ transform: CSS.Translate.toString(transform), transition }}
			{...attributes}
			{...listeners}
		>
			<CardContent
				card={card}
				display={display}
				today={today}
				{...actions}
			/>
		</div>
	);
}

/**
 * The visible card.
 *
 * The leading edge is the status spine, coloured from the registry; priority is
 * a chip, so the two signals never fight over the same corner of the card.
 * Clicking opens the quick edit popup, and double-clicking the title renames it
 * in place, which is the one interaction that stays on the card itself.
 *
 * The open button is a real `<button>` so it is reachable by keyboard: on the
 * card itself, Space is taken by "pick up the card" for keyboard dragging.
 */
export function CardContent({
	card,
	display,
	today,
	isOverlay = false,
	showMenuButton,
	consumeDrag,
	onOpenNote,
	onFilterTag,
	onContextMenu,
	onRename,
	onEdit,
	onFixFolder,
}: CardViewProps): ReactElement {
	const [editing, setEditing] = useState(false);
	const [value, setValue] = useState(card.title);
	const clickTimer = useRef<number | null>(null);

	const cancelPendingEdit = (): void => {
		if (clickTimer.current !== null) {
			window.clearTimeout(clickTimer.current);
			clickTimer.current = null;
		}
	};

	// A card unmounted mid-click must not open a popup from the grave.
	useEffect(() => cancelPendingEdit, []);

	const commit = (): void => {
		setEditing(false);
		const next = value.trim();
		if (next !== "" && next !== card.title) {
			onRename(card.path, next);
		}
	};

	const openEdit = (): void => {
		if (consumeDrag()) {
			return;
		}
		onEdit(card.path);
	};

	const handleClick = (event: ReactMouseEvent<HTMLDivElement>): void => {
		if (isOverlay || editing) {
			return;
		}
		const target = event.target as HTMLElement;
		// Buttons, chips and fields in the meta rows handle their own clicks.
		if (target.closest("button, input, select, textarea, a") !== null) {
			return;
		}
		cancelPendingEdit();
		// Ctrl/Cmd click is the shortcut for "open the note": no waiting needed.
		if (event.metaKey || event.ctrlKey) {
			onOpenNote(card.path);
			return;
		}
		// Otherwise the click waits to see whether it is half of a double click,
		// which opens the note instead of the popup.
		clickTimer.current = window.setTimeout(() => {
			clickTimer.current = null;
			openEdit();
		}, TITLE_CLICK_GRACE_MS);
	};

	/**
	 * A double click opens the card's note.
	 *
	 * The title keeps double click for the inline rename, which stops the event
	 * before it reaches here, so the two never conflict.
	 */
	const handleDoubleClick = (event: ReactMouseEvent<HTMLDivElement>): void => {
		if (isOverlay || editing) {
			return;
		}
		const target = event.target as HTMLElement;
		if (target.closest("button, input, select, textarea, a") !== null) {
			return;
		}
		cancelPendingEdit();
		onOpenNote(card.path);
	};

	const className = [
		"task-flow-card-content",
		isOverlay ? "is-overlay" : "",
		card.priority === "urgent" ? "is-urgent" : "",
		card.statusCategory === "done" ? "is-done" : "",
		card.statusCategory === "cancelled" ? "is-cancelled" : "",
	]
		.filter((part) => part !== "")
		.join(" ");
	const style =
		card.statusColor === null
			? undefined
			: ({ "--horizon-status-color": card.statusColor } as CSSProperties);

	return (
		<div
			className={className}
			style={style}
			onClick={isOverlay ? undefined : handleClick}
			onDoubleClick={isOverlay ? undefined : handleDoubleClick}
			onContextMenu={(event) => {
				event.preventDefault();
				onContextMenu(card.path, { x: event.clientX, y: event.clientY });
			}}
		>
			{card.priority === "urgent" ? (
				<span
					className="task-flow-card-urgent"
					role="img"
					aria-label={strings.priorities.urgent}
					title={strings.priorities.urgent}
				/>
			) : null}

			<div className="task-flow-card-title-row">
				<span
					className="task-flow-card-status-dot"
					title={card.status}
					aria-hidden="true"
				/>
				{editing ? (
					<input
						className="task-flow-card-title-input"
						value={value}
						autoFocus
						aria-label={strings.task.title.name}
						// The drag sensors sit on the card, so the field has to keep
						// its own clicks and keystrokes to itself - otherwise typing a
						// space would try to lift the card.
						onPointerDown={(event) => {
							event.stopPropagation();
						}}
						onClick={(event) => {
							event.stopPropagation();
						}}
						onChange={(event) => {
							setValue(event.target.value);
						}}
						onBlur={commit}
						onKeyDown={(event) => {
							event.stopPropagation();
							if (event.key === "Enter") {
								event.preventDefault();
								commit();
							} else if (event.key === "Escape") {
								event.preventDefault();
								setValue(card.title);
								setEditing(false);
							}
						}}
					/>
				) : (
					<span
						className="task-flow-card-title"
						title={card.title}
					onDoubleClick={(event) => {
							event.stopPropagation();
							// The rename wins: the popup that the first click queued is dropped.
							cancelPendingEdit();
							setValue(card.title);
							setEditing(true);
						}}
					>
						{card.title}
					</span>
				)}
				{card.folderMismatch === null ? null : (
					<button
						type="button"
						className="task-flow-card-folder"
						title={formatTemplate(strings.board.folderMismatch, {
							folder: card.folderMismatch,
						})}
						aria-label={strings.board.moveToCorrectFolder}
						onPointerDown={(event) => {
							event.stopPropagation();
						}}
						onClick={(event) => {
							event.stopPropagation();
							onFixFolder(card.path);
						}}
					>
						{strings.board.moveToCorrectFolder}
					</button>
				)}
				{card.issues.length > 0 ? (
					<span
						className={
							card.issues.some((issue) => issue.severity === "error")
								? "task-flow-card-warning is-error"
								: "task-flow-card-warning"
						}
						title={card.issues
							.map((issue) => strings.hierarchyIssues[issue.code])
							.join(" ")}
					>
						!
					</span>
				) : null}
				<button
					type="button"
					className="task-flow-card-action"
					title={strings.board.openNote}
					aria-label={strings.board.openNote}
					// Keep the drag sensor from claiming this press.
					onPointerDown={(event) => {
						event.stopPropagation();
					}}
					onClick={(event) => {
						event.stopPropagation();
						onOpenNote(card.path);
					}}
				>
					↗
				</button>
				{isOverlay || !showMenuButton ? null : (
					<button
						type="button"
						className="task-flow-card-action"
						title={strings.board.cardActions}
						aria-label={strings.board.cardActions}
						onPointerDown={(event) => {
							event.stopPropagation();
						}}
						onClick={(event) => {
							event.stopPropagation();
							const rect = event.currentTarget.getBoundingClientRect();
							onContextMenu(card.path, { x: rect.left, y: rect.bottom });
						}}
					>
						⋯
					</button>
				)}
			</div>

			{renderMeta(card, display, today, onFilterTag, onOpenNote)}
		</div>
	);
}

function renderMeta(
	card: BoardCardModel,
	display: BoardDisplayOptions,
	today: string,
	onFilterTag: (tag: string) => void,
	onOpenNote: (path: string, newPane?: boolean) => void,
): ReactElement | null {
	const rows: ReactElement[] = [];

	// Priority leads the row: it is the one chip that changes what the card asks
	// of the reader, so it should not be the last thing found.
	if (display.priority && card.priority !== "none") {
		rows.push(
			<span className={`task-flow-card-priority is-${card.priority}`} key="priority">
				{strings.priorities[card.priority]}
			</span>,
		);
	}

	if (display.period) {
		rows.push(
			<span className="task-flow-card-period" key="period">
				{`${strings.levels[card.level]} · ${formatPeriodLabel(card.period, card.level)}`}
			</span>,
		);
	}

	if (display.due && card.due !== null) {
		rows.push(
			<span
				className={card.due < today ? "task-flow-card-due is-overdue" : "task-flow-card-due"}
				key="due"
			>
				{`${strings.board.duePrefix} ${card.due}`}
			</span>,
		);
	}

	if (display.parent && card.parent !== null) {
		const label = `↑ ${
			card.parentPath === null ? card.parent : basename(card.parentPath)
		}`;
		const target = card.parentPath;
		rows.push(
			target === null ? (
				// A broken or missing link is shown, but has nowhere to go.
				<span className="task-flow-card-parent is-unresolved" key="parent">
					{label}
				</span>
			) : (
				<button
					type="button"
					className="task-flow-card-parent"
					key="parent"
					title={strings.board.openNote}
					aria-label={strings.board.openNote}
					onPointerDown={(event) => {
						event.stopPropagation();
					}}
					onClick={(event) => {
						event.stopPropagation();
						onOpenNote(target);
					}}
				>
					{label}
				</button>
			),
		);
	}

	if (display.tags && card.tags.length > 0) {
		const hidden = card.tags.length - MAX_VISIBLE_TAGS;
		rows.push(
			<div className="task-flow-card-tags" key="tags">
				{card.tags.slice(0, MAX_VISIBLE_TAGS).map((tag) => (
					<button
						type="button"
						className="task-flow-tag"
						key={tag}
						// The hue is a hash of the tag, so a tag keeps its colour wherever
						// it appears instead of taking one from its position in the list.
						style={{ "--tag-hue": String(tagHue(tag)) } as CSSProperties}
						onPointerDown={(event) => {
							event.stopPropagation();
						}}
						onClick={(event) => {
							event.stopPropagation();
							onFilterTag(tag);
						}}
					>
						#{tag}
					</button>
				))}
				{hidden > 0 ? <span className="task-flow-tag is-more">+{hidden}</span> : null}
			</div>,
		);
	}

	if (display.childProgress && card.total > 0) {
		rows.push(
			<div className="task-flow-card-rollup" key="rollup">
				<span className="task-flow-card-rollup-count">
					{`${String(card.done)}/${String(card.total)}`}
				</span>
				<div
					className="task-flow-progress"
					title={`${formatTemplate(strings.board.childProgress, {
						done: card.done,
						total: card.total,
					})}`}
				>
					<div
						className="task-flow-progress-fill"
						style={{ width: `${String(Math.round((card.done / card.total) * 100))}%` }}
					/>
				</div>
				{card.allChildrenDone ? (
					<span className="task-flow-card-hint">{strings.board.allChildrenDone}</span>
				) : null}
			</div>,
		);
	}

	if (rows.length === 0) {
		return null;
	}
	return <div className="task-flow-card-meta">{rows}</div>;
}
