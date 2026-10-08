import {
	DndContext,
	DragOverlay,
	KeyboardSensor,
	MouseSensor,
	TouchSensor,
	closestCorners,
	pointerWithin,
	useSensor,
	useSensors,
	type CollisionDetection,
	type DragEndEvent,
	type DragStartEvent,
	type DropAnimation,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { horizontalListSortingStrategy, SortableContext } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
	useCallback,
	useRef,
	useState,
	type CSSProperties,
	type ReactElement,
} from "react";

import { strings } from "../../strings";
import { CardContent, DROP_ANIMATION_MS } from "./CardView";
import { ColumnView } from "./ColumnView";
import { columnIdFromSortable, columnSortableId, isColumnSortableId } from "./model";
import type { BoardBodyProps, BoardCardModel, BoardColumnModel } from "./model";

/**
 * The drop animation.
 *
 * The overlay is faded out where it was released rather than glided to the
 * card's slot. dnd-kit animates towards the card's rectangle as measured when
 * the drop starts, and the view paints the new layout on the same tick; gliding
 * towards a stale rectangle is what makes a cross-column drop fly all the way
 * back to the source column before snapping into place - most obvious when
 * moving a card from a column on the right to one on the left.
 *
 * `sideEffects: null` keeps the card that has already arrived at its new slot
 * visible through the fade, so the two cross-fade instead of flashing.
 */
const DROP_ANIMATION: DropAnimation = {
	duration: DROP_ANIMATION_MS,
	easing: "cubic-bezier(0.2, 0, 0, 1)",
	keyframes: ({ transform }) => [
		{ transform: CSS.Transform.toString(transform.initial), opacity: 1 },
		{ transform: CSS.Transform.toString(transform.initial), opacity: 0 },
	],
	sideEffects: null,
};

/**
 * Hit detection, scoped to the kind of thing being dragged.
 *
 * A column header is a sortable item, so dnd-kit registers it as a droppable
 * spanning the whole column as well. Without scoping, a card dropped over an
 * empty column resolves `over` to that header rather than to the cell, and
 * `resolveColumnId` cannot map a header id to a cell - so the drop is silently
 * discarded. That is the "cannot drop into an empty column" bug.
 *
 * Filtering by drag kind makes each space unambiguous: a card may only land on
 * a card or a cell, a column only on another column.
 *
 * `pointerWithin` keeps the highlighted target under the cursor; `closestCorners`
 * covers the gaps between columns and keyboard dragging, where there is no
 * pointer at all.
 */
const COLLISION_DETECTION: CollisionDetection = (args) => {
	const draggingColumn = isColumnSortableId(String(args.active.id));
	const droppableContainers = args.droppableContainers.filter(
		(container) => isColumnSortableId(String(container.id)) === draggingColumn,
	);
	const scoped = { ...args, droppableContainers };
	const within = pointerWithin(scoped);
	return within.length > 0 ? within : closestCorners(scoped);
};

/**
 * The draggable board.
 *
 * Three sensors, on purpose:
 *
 * - **Mouse**, requiring 6px of movement, so a plain click still opens a note.
 * - **Touch**, requiring a 200ms press, so scrolling a column and tapping a card
 *   keep working on a phone and only a deliberate press starts a drag.
 * - **Keyboard**, with sortable coordinates so arrow keys move the card between
 *   positions and columns. Space or Enter lifts, Space or Enter drops, Escape
 *   cancels - all provided by dnd-kit's sensor, not re-implemented here.
 *
 * Nothing about *where* a card lands is decided here: the drop is reported to
 * the view, which resolves it with the tested `domain/drag.ts` helpers and
 * writes it through the repository.
 */
export function BoardBody({
	columns,
	rows,
	columnWidth = 280,
	maxSwimLaneHeight = 600,
	compact = false,
	virtualizeAt = 15,
	onReorderColumns,
	display,
	onAddTask,
	mobile,
	today,
	reducedMotion,
	showMenuButton,
	onDragEnd,
	...cardActions
}: BoardBodyProps): ReactElement {
	const [activeCard, setActiveCard] = useState<BoardCardModel | null>(null);

	const allColumns =
		rows === undefined ? columns : rows.flatMap((row) => row.columns);

	/**
	 * dnd-kit fires a click after a drop, so the cards need to know a drag just
	 * ended. The flag is cleared on the next tick, which is after that click has
	 * been dispatched, so only the click belonging to the drag is swallowed.
	 */
	const dragHappened = useRef(false);
	const consumeDrag = useCallback((): boolean => dragHappened.current, []);
	const clearDragFlagSoon = useCallback((): void => {
		window.setTimeout(() => {
			dragHappened.current = false;
		}, 0);
	}, []);

	const sensors = useSensors(
		useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
		useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
		useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
	);

	return (
		<DndContext
			sensors={sensors}
			collisionDetection={COLLISION_DETECTION}
			// Kanban columns change height as cards are sorted, so compensating for
			// layout shift makes the dragged card drift away from the pointer; the
			// card should stay where the pointer put it.
			autoScroll={{ layoutShiftCompensation: false }}
			accessibility={{
				screenReaderInstructions: { draggable: strings.board.dragInstructions },
			}}
			onDragStart={(event: DragStartEvent): void => {
				dragHappened.current = true;
				setActiveCard(findCard(allColumns, String(event.active.id)));
			}}
			onDragEnd={(event: DragEndEvent): void => {
				setActiveCard(null);
				clearDragFlagSoon();
				const activeId = String(event.active.id);
				// A column header drag reorders columns instead of moving a card.
				if (isColumnSortableId(activeId)) {
					const fromId = columnIdFromSortable(activeId);
					const toId =
						event.over === null
							? null
							: columnIdFromSortable(String(event.over.id));
					if (fromId !== null && toId !== null && fromId !== toId) {
						onReorderColumns?.(fromId, toId);
					}
					return;
				}
				onDragEnd(activeId, event.over === null ? null : String(event.over.id));
			}}
			onDragCancel={(): void => {
				setActiveCard(null);
				clearDragFlagSoon();
			}}
		>
			<div
				className={[
					"task-flow-columns",
					activeCard === null ? "" : "is-dragging",
					compact ? "is-compact" : "",
					rows === undefined ? "" : "is-swimlanes",
				]
					.filter((part) => part !== "")
					.join(" ")}
				style={
					{
						"--task-flow-column-width": `${columnWidth}px`,
						"--task-flow-swimlane-max-height": `${maxSwimLaneHeight}px`,
					} as CSSProperties
				}
			>
				{rows === undefined ? (
					<SortableContext
						items={columns.map((column) => columnSortableId(column.id))}
						strategy={horizontalListSortingStrategy}
					>
						{columns.map((column) => (
							<ColumnView
								key={column.id}
								column={column}
								reorderable={onReorderColumns !== undefined}
								virtualize={activeCard === null}
								virtualizeAt={virtualizeAt}
								display={display}
								today={today}
								reducedMotion={reducedMotion}
								showMenuButton={showMenuButton}
								mobile={mobile}
								consumeDrag={consumeDrag}
								onAddTask={onAddTask}
								{...cardActions}
							/>
						))}
					</SortableContext>
				) : (
					rows.map((row) => (
						<div className="task-flow-swimlane" key={row.key}>
							{row.label === "" ? null : (
								<div className="task-flow-swimlane-label">
									<span className="task-flow-swimlane-title">{row.label}</span>
									<span className="task-flow-column-count">{row.total}</span>
								</div>
							)}
							<div className="task-flow-swimlane-cells">
								{row.columns.map((column) => (
									<ColumnView
										key={column.cellId ?? column.id}
										column={column}
										virtualize={activeCard === null}
										virtualizeAt={virtualizeAt}
										display={display}
										today={today}
										reducedMotion={reducedMotion}
										showMenuButton={showMenuButton}
										mobile={mobile}
										consumeDrag={consumeDrag}
										onAddTask={onAddTask}
										{...cardActions}
									/>
								))}
							</div>
						</div>
					))
				)}
			</div>

			<DragOverlay dropAnimation={reducedMotion ? null : DROP_ANIMATION}>
				{activeCard === null ? null : (
					<CardContent
						card={activeCard}
						display={display}
						today={today}
						isOverlay
						showMenuButton={false}
						consumeDrag={consumeDrag}
						{...cardActions}
					/>
				)}
			</DragOverlay>
		</DndContext>
	);
}

function findCard(
	columns: readonly BoardColumnModel[],
	path: string,
): BoardCardModel | null {
	for (const column of columns) {
		const card = column.cards.find((entry) => entry.path === path);
		if (card !== undefined) {
			return card;
		}
	}
	return null;
}
