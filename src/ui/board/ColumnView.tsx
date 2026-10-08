import { useDroppable } from "@dnd-kit/core";
import {
	SortableContext,
	useSortable,
	verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { type CSSProperties, type ReactElement } from "react";

import { columnDroppableId } from "../../domain";
import { strings } from "../../strings";
import { formatTemplate } from "../../util/text";
import { SortableCard } from "./CardView";
import { columnSortableId } from "./model";
import type { BoardColumnModel, BoardDisplayOptions, CardActions } from "./model";

/** Props for a single column. */
export interface ColumnViewProps extends CardActions {
	column: BoardColumnModel;
	display: BoardDisplayOptions;
	today: string;
	reducedMotion: boolean;
	showMenuButton: boolean;
	mobile: boolean;
	consumeDrag: () => boolean;
	/** Renders a drag handle so the column can be reordered. */
	reorderable?: boolean;
	/** Asks the browser to skip rendering offscreen cards in long columns. */
	virtualize?: boolean;
	/** Cards below which virtualisation is skipped. */
	virtualizeAt?: number;
	/** Opens the task editor for a new task in this column. */
	onAddTask: (columnKey: string) => void;
}

/**
 * One board column.
 *
 * The card list is both a sortable context (for the cards inside it) and a
 * droppable (for the cell itself), so a card can be dropped onto the empty
 * space below the last card as well as onto another card.
 *
 * The "+" sits at the bottom of the column so it stays put as cards grow, and it
 * opens the same task form as the header's New task button, pre-filled with this
 * column's value.
 */
export function ColumnView({
	column,
	onAddTask,
	reorderable = false,
	virtualize = false,
	virtualizeAt = 15,
	...cardProps
}: ColumnViewProps): ReactElement {
	const { setNodeRef, isOver } = useDroppable({
		// Wrapped in the `tf-column:` prefix: `resolveColumnId` only accepts card
		// paths and prefixed column ids, so a bare cell id is ignored and the drop
		// is silently lost.
		id: columnDroppableId(column.cellId ?? column.id),
	});

	const {
		setNodeRef: setColumnRef,
		attributes,
		listeners,
		isDragging,
	} = useSortable({ id: columnSortableId(column.id), disabled: !reorderable });

	const wipLimit = column.wipLimit ?? null;
	const overLimit = wipLimit !== null && column.cards.length > wipLimit;

	const className = [
		"task-flow-column",
		isOver ? "is-over" : "",
		isDragging ? "is-reordering" : "",
	]
		.filter((part) => part !== "")
		.join(" ");

	const cardsClassName = [
		"task-flow-column-cards",
		virtualize && column.cards.length >= virtualizeAt ? "is-virtualized" : "",
	]
		.filter((part) => part !== "")
		.join(" ");

	return (
		<section
			ref={setColumnRef}
			className={className}
			style={{ "--horizon-status-color": column.color } as CSSProperties}
			role="group"
			aria-label={formatTemplate(strings.board.columnAria, {
				label: column.label,
				count: column.cards.length,
			})}
		>
			<header className="task-flow-column-header">
				{reorderable ? (
					<button
						type="button"
						className="clickable-icon task-flow-column-handle"
						title={strings.board.reorderColumn}
						aria-label={strings.board.reorderColumn}
						{...attributes}
						{...listeners}
					>
						⠿
					</button>
				) : null}
				<span
					className="task-flow-column-dot"
					style={{ backgroundColor: column.color }}
				/>
				<span className="task-flow-column-title">{column.label}</span>
				{column.pinned === true ? (
					<span
						className="task-flow-column-pinned"
						title={strings.board.pinnedColumn}
						aria-label={strings.board.pinnedColumn}
					>
						★
					</span>
				) : null}
				<span
					className={
						overLimit
							? "task-flow-column-count is-over-limit"
							: "task-flow-column-count"
					}
				>
					{wipLimit === null
						? column.cards.length
						: `${column.cards.length}/${wipLimit}`}
				</span>
			</header>

			<SortableContext
				items={column.cards.map((card) => card.path)}
				strategy={verticalListSortingStrategy}
			>
				<div ref={setNodeRef} className={cardsClassName}>
					{column.cards.map((card) => (
						<SortableCard key={card.path} card={card} {...cardProps} />
					))}

					{column.cards.length === 0 ? (
						<p className="task-flow-column-hint">{strings.board.dropHere}</p>
					) : null}
				</div>
			</SortableContext>

			<button
				type="button"
				className="task-flow-column-add"
				title={formatTemplate(strings.board.addTaskTo, { column: column.label })}
				aria-label={formatTemplate(strings.board.addTaskTo, { column: column.label })}
				onClick={() => {
					onAddTask(column.id);
				}}
			>
				<span aria-hidden="true">＋</span>
				{strings.board.addTask}
			</button>
		</section>
	);
}
