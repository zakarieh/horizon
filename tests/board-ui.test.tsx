// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BoardBody } from "../src/ui/board/BoardBody";
import { CardContent } from "../src/ui/board/CardView";
import type { BoardBodyProps, BoardCardModel, BoardColumnModel } from "../src/ui/board/model";

/**
 * happy-dom does not implement ResizeObserver, which dnd-kit uses to watch the
 * board. A no-op stub is enough: these tests are about what the board renders
 * and what it reports, not about geometry, which cannot be measured in a
 * headless DOM anyway.
 */
class StubResizeObserver implements ResizeObserver {
	constructor(_callback: ResizeObserverCallback) {
		/* the callback is never invoked: nothing has a size in a headless DOM */
	}
	observe(): void {
		/* no layout in a headless DOM */
	}
	unobserve(): void {
		/* no layout in a headless DOM */
	}
	disconnect(): void {
		/* no layout in a headless DOM */
	}
}
window.ResizeObserver = StubResizeObserver;

afterEach(cleanup);

function makeCard(overrides: Partial<BoardCardModel> & Pick<BoardCardModel, "path">): BoardCardModel {
	return {
		title: overrides.path,
		order: "a0",
		status: "todo",
		statusColor: "#58a6ff",
		statusCategory: "todo",
		priority: "none",
		level: "daily",
		period: TODAY,
		due: null,
		parent: null,
		parentPath: null,
		tags: [],
		bodyTags: [],
		folderMismatch: null,
		done: 0,
		total: 0,
		allChildrenDone: false,
		unknownStatus: false,
		issues: [],
		...overrides,
	};
}

const TODAY = "2026-09-28";

function makeColumns(): BoardColumnModel[] {
	return [
		{
			id: "todo",
			label: "Todo",
			color: "#58a6ff",
			cards: [
				makeCard({
					path: "Tasks/Write copy.md",
					title: "Write copy",
					priority: "urgent",
					tags: ["work", "website", "launch", "extra"],
					due: "2026-09-01",
					parent: "Tasks/2026-W40 Launch website.md",
					parentPath: "Tasks/2026-W40 Launch website.md",
					done: 2,
					total: 3,
				}),
				makeCard({
					path: "Tasks/Buy milk.md",
					title: "Buy milk",
					due: "2026-12-01",
					allChildrenDone: true,
					done: 1,
					total: 1,
				}),
			],
		},
		{ id: "done", label: "Done", color: "#3fb950", cards: [] },
	];
}

/** Every prop the board needs, so a test only states the ones it cares about. */
function boardProps(overrides: Partial<BoardBodyProps> = {}): BoardBodyProps {
	return {
		columns: makeColumns(),
		display: { priority: true, tags: true, due: true, parent: true, childProgress: true, period: false },
		mobile: false,
		today: TODAY,
		reducedMotion: false,
		showMenuButton: false,
		onDragEnd: vi.fn(),
		onOpenNote: vi.fn(),
		onFilterTag: vi.fn(),
		onContextMenu: vi.fn(),
		onRename: vi.fn(),
		onAddTask: vi.fn(),
		onEdit: vi.fn(),
		onFixFolder: vi.fn(),
		...overrides,
	};
}

function renderBoard(overrides: Partial<BoardBodyProps> = {}): {
	onOpenNote: ReturnType<typeof vi.fn>;
	onFilterTag: ReturnType<typeof vi.fn>;
	onDragEnd: ReturnType<typeof vi.fn>;
	onRename: ReturnType<typeof vi.fn>;
	onAddTask: ReturnType<typeof vi.fn>;
	onEdit: ReturnType<typeof vi.fn>;
	onFixFolder: ReturnType<typeof vi.fn>;
} {
	const onOpenNote = vi.fn();
	const onFilterTag = vi.fn();
	const onDragEnd = vi.fn();
	const onRename = vi.fn();
	const onAddTask = vi.fn();
	const onEdit = vi.fn();
	const onFixFolder = vi.fn();
	render(
		<BoardBody
			{...boardProps({
				onOpenNote,
				onFilterTag,
				onDragEnd,
				onRename,
				onAddTask,
				onEdit,
				onFixFolder,
				...overrides,
			})}
		/>,
	);
	return { onOpenNote, onFilterTag, onDragEnd, onRename, onAddTask, onEdit, onFixFolder };
}

describe("BoardBody", () => {
	it("renders every column with its label and card count", () => {
		renderBoard();

		expect(screen.getByText("Todo")).toBeDefined();
		expect(screen.getByText("Done")).toBeDefined();
		expect(document.querySelectorAll(".task-flow-column")).toHaveLength(2);
		expect(document.querySelector(".task-flow-column-count")?.textContent).toBe("2");
	});

	it("renders the cards of each column", () => {
		renderBoard();

		expect(screen.getByText("Write copy")).toBeDefined();
		expect(screen.getByText("Buy milk")).toBeDefined();
	});

	it("shows a priority as a chip, never as the spine", () => {
		renderBoard();

		expect(screen.getByText("Urgent")).toBeDefined();
		// The spine belongs to the status, so no priority class may claim it.
		expect(document.querySelector(".task-flow-card-content.is-priority-urgent")).toBeNull();
	});

	it("shows at most three tags and summarises the rest", () => {
		renderBoard();

		expect(screen.getByText("#work")).toBeDefined();
		expect(screen.getByText("#launch")).toBeDefined();
		expect(screen.queryByText("#extra")).toBeNull();
		expect(screen.getByText("+1")).toBeDefined();
	});

	it("flags an overdue due date", () => {
		renderBoard();

		const overdue = screen.getByText("Due 2026-09-01");
		expect(overdue.className).toContain("is-overdue");
	});

	it("does not flag a future due date", () => {
		renderBoard();

		expect(screen.getByText("Due 2026-12-01").className).not.toContain("is-overdue");
	});

	it("shows the parent's note name and the child progress", () => {
		renderBoard();

		expect(screen.getByText("↑ 2026-W40 Launch website")).toBeDefined();
		expect(screen.getByText("2/3")).toBeDefined();
	});

	it("hints that all children are done", () => {
		renderBoard();
		expect(screen.getByText("All children are done")).toBeDefined();
	});

	it("hides the metadata the settings turn off", () => {
		renderBoard({
			display: { priority: false, tags: false, due: false, parent: false, childProgress: false, period: false },
		});

		expect(screen.queryByText("#work")).toBeNull();
		expect(screen.queryByText("Due 2026-09-01")).toBeNull();
		expect(screen.queryByText(/↑/)).toBeNull();
		expect(screen.queryByText("2/3")).toBeNull();
	});

	it("offers a drop hint in an empty column", () => {
		renderBoard();
		expect(screen.getByText("Drop a card here")).toBeDefined();
	});

	it("badges a card whose parent link is broken", () => {
		const [todo] = makeColumns();
		const [first] = todo.cards;
		render(
			<BoardBody
				{...boardProps({
					columns: [
						{
							...todo,
							cards: [
								{
									...first,
									issues: [
										{ code: "invalid-parent-level", severity: "warning", path: "x" },
									],
								},
							],
						},
					],
				})}
			/>,
		);

		expect(document.querySelector(".task-flow-card-warning")).not.toBeNull();
	});

	it("colours the card from its status, not its priority", () => {
		renderBoard();

		const card = document.querySelector(".task-flow-card-content");
		expect(card?.getAttribute("style")).toContain("#58a6ff");
		// The urgent card keeps the status colour on its edge and gets a dot of its
		// own on top of it.
		expect(document.querySelector(".task-flow-card-urgent")).not.toBeNull();
	});

	it("marks a done card as done and a cancelled card as cancelled", () => {
		const [todo] = makeColumns();
		const [first] = todo.cards;
		render(
			<BoardBody
				{...boardProps({
					columns: [
						{ ...todo, cards: [{ ...first, statusCategory: "done" }], id: "done" },
						{ ...todo, cards: [{ ...first, path: "Tasks/Dropped.md", statusCategory: "cancelled" }] },
					],
				})}
			/>,
		);

		expect(document.querySelector(".task-flow-card-content.is-done")).not.toBeNull();
		expect(document.querySelector(".task-flow-card-content.is-cancelled")).not.toBeNull();
	});

	it("offers the one-click folder fix on a mismatched card", () => {
		const { onFixFolder } = renderBoard({
			columns: [
				{
					...makeColumns()[0],
					cards: [
						{
							...makeColumns()[0].cards[0],
							folderMismatch: "Tasks/Weekly",
						},
					],
				},
			],
		});

		fireEvent.click(screen.getByLabelText("Move to correct folder"));
		expect(onFixFolder).toHaveBeenCalledWith("Tasks/Write copy.md");
	});
});

describe("BoardBody interactions", () => {
	it("opens the quick edit popup when a card is clicked", () => {
		vi.useFakeTimers();
		try {
			const { onEdit, onOpenNote } = renderBoard();

			fireEvent.click(screen.getByText("Due 2026-09-01"));
			// The click waits out the double-click window before it becomes an edit.
			expect(onEdit).not.toHaveBeenCalled();

			vi.advanceTimersByTime(300);
			expect(onEdit).toHaveBeenCalledTimes(1);
			expect(onEdit.mock.calls[0][0]).toBe("Tasks/Write copy.md");
			expect(onOpenNote).not.toHaveBeenCalled();
		} finally {
			vi.useRealTimers();
		}
	});

	it("opens the note on a double click", () => {
		const { onOpenNote, onEdit } = renderBoard();

		fireEvent.doubleClick(screen.getByText("Due 2026-09-01"));

		expect(onOpenNote).toHaveBeenCalledWith("Tasks/Write copy.md");
		expect(onEdit).not.toHaveBeenCalled();
	});

	it("opens the note on a ctrl click", () => {
		const { onOpenNote, onEdit } = renderBoard();

		fireEvent.click(screen.getByText("Due 2026-09-01"), { ctrlKey: true });

		expect(onOpenNote).toHaveBeenCalledWith("Tasks/Write copy.md");
		expect(onEdit).not.toHaveBeenCalled();
	});

	it("opens the parent note from the parent chip", () => {
		const { onOpenNote, onEdit } = renderBoard();

		fireEvent.click(screen.getByText("↑ 2026-W40 Launch website"));

		expect(onOpenNote).toHaveBeenCalledWith("Tasks/2026-W40 Launch website.md");
		expect(onEdit).not.toHaveBeenCalled();
	});

	it("waits out the double-click window before the title opens the popup", () => {
		vi.useFakeTimers();
		try {
			const { onEdit } = renderBoard();

			fireEvent.click(screen.getByText("Write copy"));
			// A double click would follow within this window, and a rename must not
			// also open the popup.
			expect(onEdit).not.toHaveBeenCalled();

			vi.advanceTimersByTime(300);
			expect(onEdit).toHaveBeenCalledTimes(1);
		} finally {
			vi.useRealTimers();
		}
	});

	it("opens the note from the card's own button", () => {
		const { onOpenNote } = renderBoard();

		fireEvent.click(screen.getAllByLabelText("Open task note")[0]);
		expect(onOpenNote).toHaveBeenCalledWith("Tasks/Write copy.md");
	});

	it("does not open the popup when the click ended a drag", () => {
		// `consumeDrag` is internal to BoardBody and is driven by dnd-kit's drag
		// start, which cannot be simulated in a headless DOM. The contract it
		// implements is checked here, against the card itself.
		const onEdit = vi.fn();
		render(
			<CardContent
				card={makeColumns()[0].cards[0]}
				display={{ priority: true, tags: true, due: true, parent: true, childProgress: true, period: false }}
				today={TODAY}
				showMenuButton={false}
				consumeDrag={(): boolean => true}
				onOpenNote={vi.fn()}
				onFilterTag={vi.fn()}
				onContextMenu={vi.fn()}
				onRename={vi.fn()}
				onEdit={onEdit}
				onFixFolder={vi.fn()}
			/>,
		);

		fireEvent.click(screen.getByText("Due 2026-09-01"));
		expect(onEdit).not.toHaveBeenCalled();
	});

	it("filters by tag without opening the popup", () => {
		const { onFilterTag, onEdit } = renderBoard();

		fireEvent.click(screen.getByText("#work"));
		expect(onFilterTag).toHaveBeenCalledWith("work");
		expect(onEdit).not.toHaveBeenCalled();
	});

	it("shows an actions button only when the platform needs one", () => {
		renderBoard({ showMenuButton: false });
		expect(screen.queryByLabelText("Task actions")).toBeNull();

		cleanup();
		renderBoard({ showMenuButton: true });
		expect(screen.getAllByLabelText("Task actions").length).toBeGreaterThan(0);
	});

	it("reports a context menu request with a screen position", () => {
		const onContextMenu = vi.fn();
		renderBoard({ onContextMenu });

		fireEvent.contextMenu(screen.getByText("Write copy"), { clientX: 12, clientY: 34 });
		expect(onContextMenu).toHaveBeenCalledWith("Tasks/Write copy.md", { x: 12, y: 34 });
	});
});

describe("column add button", () => {
	it("opens the task form for the column it belongs to", () => {
		const { onAddTask } = renderBoard();

		const button = screen.getByLabelText("Add a task to Todo");
		fireEvent.click(button);
		expect(onAddTask).toHaveBeenCalledWith("todo");
	});

	it("gives every column its own button", () => {
		renderBoard();
		expect(screen.getByLabelText("Add a task to Done")).toBeDefined();
	});
});

describe("inline rename", () => {
	it("edits the title on double click and commits on enter", () => {
		const { onRename, onEdit } = renderBoard();

		fireEvent.doubleClick(screen.getByText("Write copy"));
		const input = screen.getByLabelText("Title");
		fireEvent.change(input, { target: { value: "Write better copy" } });
		fireEvent.keyDown(input, { key: "Enter" });

		expect(onRename).toHaveBeenCalledWith("Tasks/Write copy.md", "Write better copy");
		// Renaming a title must not also open the popup.
		expect(onEdit).not.toHaveBeenCalled();
	});

	it("abandons the edit on escape", () => {
		const { onRename } = renderBoard();

		fireEvent.doubleClick(screen.getByText("Write copy"));
		const input = screen.getByLabelText("Title");
		fireEvent.change(input, { target: { value: "Discarded" } });
		fireEvent.keyDown(input, { key: "Escape" });

		expect(onRename).not.toHaveBeenCalled();
		expect(screen.getByText("Write copy")).toBeDefined();
	});

	it("does not save an unchanged or empty title", () => {
		const { onRename } = renderBoard();

		fireEvent.doubleClick(screen.getByText("Write copy"));
		fireEvent.keyDown(screen.getByLabelText("Title"), { key: "Enter" });
		expect(onRename).not.toHaveBeenCalled();

		fireEvent.doubleClick(screen.getByText("Write copy"));
		const input = screen.getByLabelText("Title");
		fireEvent.change(input, { target: { value: "   " } });
		fireEvent.keyDown(input, { key: "Enter" });
		expect(onRename).not.toHaveBeenCalled();
	});
});
