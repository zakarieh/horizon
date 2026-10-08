import {
	ConfirmationModal,
	ItemView,
	Notice,
	Platform,
	Scope,
	setTooltip,
	type KeymapEventHandler,
	type WorkspaceLeaf,
} from "obsidian";
import { createRoot, type Root } from "react-dom/client";

import {
	OBJECTIVE_BOARD_LABEL,
	basename,
	buildKanbanBoard,
	buildTaskLookup,
	collectHierarchyIssues,
	defaultStatusId,
	draftFromTask,
	findStatus,
	folderOf,
	formatPeriodLabel,
	getCurrentPeriod,
	getPeriodFor,
	isPeriodLevel,
	isPriority,
	movePatch,
	orderAtBottom,
	orderAtTop,
	parentCandidates,
	reorderStatus,
	resolveDropTarget,
	shiftPeriod,
	splitKanbanCellId,
	statusCategory,
	toLinkRef,
	type CardView,
	type DragBoard,
	type KanbanCell,
	type KanbanColumn,
	type Level,
	type TaskDraft,
} from "../domain";
import { warn } from "../log";
import type TaskFlowPlugin from "../main";
import { strings } from "../strings";
import { formatTemplate } from "../util/text";
import { BoardBody } from "./board/BoardBody";
import { showCardMenu } from "./board/menu";
import type {
	BoardCardModel,
	BoardColumnModel,
	BoardDisplayOptions,
	BoardRowModel,
} from "./board/model";
import { prefersReducedMotion } from "./board/motion";
import { ParentPickerModal } from "./parent-picker";

/** The `ItemView` type the board registers under. */
export const BOARD_VIEW_TYPE = "task-flow-board";

/** Icon used for the ribbon button and the board's tab. */
export const BOARD_VIEW_ICON = "layers";

/** Persistent parts of the view, built once when the leaf opens. */
interface BoardShell {
	header: HTMLElement;
	/** Home of the problems banner and the empty state. */
	banners: HTMLElement;
	/** React root host - the columns live in here. */
	host: HTMLElement;
	tagSelect: HTMLSelectElement | null;
}

/**
 * The board: one Kanban board per horizon and period.
 *
 * The view owns the shell - header, tag filter, search, banners - and the
 * current selection, and it translates the store into a plain model. The
 * columns and cards are rendered by React so that the drag-and-drop library can
 * own their layout and animation, and the model is pushed in through
 * `root.render` rather than by remounting the tree, so a drag in progress is
 * never interrupted.
 *
 * Which card belongs where is decided by `domain/board.ts`, where a drop lands
 * is decided by `domain/drag.ts`, and the vault is only ever touched through
 * the repository. This file is glue.
 */
export class BoardView extends ItemView {
	private readonly plugin: TaskFlowPlugin;
	private level: Level;
	private period: string | null;
	private tag: string | null = null;
	private query = "";

	private shell: BoardShell | null = null;
	private root: Root | null = null;
	/** The board exactly as rendered, so drop indexes line up with it. */
	private model: readonly BoardColumnModel[] = [];
	/** Swimlane rows when the board has a second grouping dimension. */
	private rows: readonly BoardRowModel[] | undefined;
	/** The board as cells, which is what drop resolution works on. */
	private dragBoardModel: DragBoard = [];

	private unsubscribe: (() => void) | null = null;
	private renderFrame: number | null = null;
	private readonly keyHandlers: KeymapEventHandler[] = [];
	private readonly reducedMotion = prefersReducedMotion();
	/** No right click on a phone, so those cards carry an actions button. */
	private readonly showMenuButton = Platform.isMobile;

	constructor(leaf: WorkspaceLeaf, plugin: TaskFlowPlugin) {
		super(leaf);
		this.plugin = plugin;
		const state = plugin.settings.boardState;
		this.level = state.level;
		this.period = state.period ?? currentPeriodFor(state.level);
	}

	override getViewType(): string {
		return BOARD_VIEW_TYPE;
	}

	override getDisplayText(): string {
		return strings.board.viewTitle;
	}

	override getIcon(): string {
		return BOARD_VIEW_ICON;
	}

	/** Rendering is synchronous, so the promise is already resolved. */
	protected override onOpen(): Promise<void> {
		this.contentEl.addClass("task-flow-board");

		// A view-local scope means the board's shortcuts only apply while the
		// board is the active view.
		this.scope = new Scope(this.app.scope);
		this.registerScopeKeys();

		this.unsubscribe = this.plugin.tasks.subscribe(() => {
			this.scheduleRender();
		});

		const header = this.contentEl.createDiv({ cls: "task-flow-board-header" });
		const banners = this.contentEl.createDiv({ cls: "task-flow-board-banners" });
		const host = this.contentEl.createDiv({ cls: "task-flow-board-body" });
		this.shell = { header, banners, host, tagSelect: null };
		this.root = createRoot(host);

		this.renderHeader();
		this.renderBody();
		return Promise.resolve();
	}

	protected override onClose(): Promise<void> {
		this.unsubscribe?.();
		this.unsubscribe = null;

		if (this.renderFrame !== null) {
			window.cancelAnimationFrame(this.renderFrame);
			this.renderFrame = null;
		}

		const scope = this.scope;
		if (scope !== null) {
			for (const handler of this.keyHandlers) {
				scope.unregister(handler);
			}
		}
		this.keyHandlers.length = 0;

		// Unmount React before the host element goes away so effects run.
		this.root?.unmount();
		this.root = null;
		this.shell = null;
		this.model = [];
		this.contentEl.empty();
		return Promise.resolve();
	}

	/**
	 * Period navigation shortcuts.
	 *
	 * Registered on the view's scope rather than as command hotkeys: the plugin
	 * guidelines ask plugins not to claim default hotkeys, and view-scoped keys
	 * only fire while the board is focused.
	 */
	private registerScopeKeys(): void {
		const scope = this.scope;
		if (scope === null) {
			return;
		}
		const bind = (key: string, action: () => void): void => {
			this.keyHandlers.push(
				scope.register(["Mod", "Alt"], key, (event: KeyboardEvent) => {
					event.preventDefault();
					action();
					return false;
				}),
			);
		};
		bind("ArrowLeft", () => {
			this.stepPeriod(-1);
		});
		bind("ArrowRight", () => {
			this.stepPeriod(1);
		});
		bind("t", () => {
			this.goToToday();
		});
	}

	private renderHeader(): void {
		const shell = this.shell;
		if (shell === null) {
			return;
		}
		shell.header.empty();
		shell.tagSelect = null;

		const tabsRow = shell.header.createDiv({ cls: "task-flow-header-bar" });
		const tabs = tabsRow.createDiv({ cls: "task-flow-tabs" });
		for (const level of this.plugin.settings.enabledLevels) {
			const tab = tabs.createEl("button", {
				cls: "task-flow-tab",
				text: strings.levels[level],
			});
			if (level === this.level) {
				tab.addClass("is-active");
			}
			tab.addEventListener("click", () => {
				this.setLevel(level);
			});
		}

		// The one primary action sits on the top row, where it is found without
		// reading the controls underneath it.
		tabsRow
			.createEl("button", { cls: "mod-cta task-flow-new-task", text: strings.board.newTask })
			.addEventListener("click", () => {
				// Pre-filled with this board's horizon and period, so the new task
				// appears exactly where the user is looking.
				this.plugin.openNewTaskDialog({ level: this.level, period: this.period });
			});

		const controls = shell.header.createDiv({ cls: "task-flow-controls" });
		if (isPeriodLevel(this.level)) {
			const previous = controls.createEl("button", { cls: "task-flow-nav", text: "‹" });
			setTooltip(previous, strings.board.previousPeriod);
			previous.addEventListener("click", () => {
				this.stepPeriod(-1);
			});

			controls.createSpan({
				cls: "task-flow-period",
				text: formatPeriodLabel(this.period, this.level),
			});

			const next = controls.createEl("button", { cls: "task-flow-nav", text: "›" });
			setTooltip(next, strings.board.nextPeriod);
			next.addEventListener("click", () => {
				this.stepPeriod(1);
			});

			controls
				.createEl("button", { cls: "task-flow-today", text: strings.board.today })
				.addEventListener("click", () => {
					this.goToToday();
				});
		} else {
			controls.createSpan({
				cls: "task-flow-period",
				text: OBJECTIVE_BOARD_LABEL,
			});
		}

		// Period navigation on the left, the two filter controls pushed right, so
		// the row reads as "where am I" then "what am I looking at".
		const end = controls.createDiv({ cls: "task-flow-controls-end" });
		const select = end.createEl("select", { cls: "dropdown task-flow-tag-filter" });
		select.setAttribute("aria-label", strings.board.tagFilterAria);
		select.addEventListener("change", () => {
			this.tag = select.value === "" ? null : select.value;
			this.renderBody();
		});
		shell.tagSelect = select;
		this.refreshTagOptions();

		const search = end.createEl("input", {
			type: "search",
			cls: "task-flow-search",
			placeholder: strings.board.searchPlaceholder,
		});
		search.value = this.query;
		search.addEventListener("input", () => {
			this.query = search.value;
			this.renderBody();
		});
	}

	/** Rebuilds the tag choices from the tasks that exist right now. */
	private refreshTagOptions(): void {
		const select = this.shell?.tagSelect ?? null;
		if (select === null) {
			return;
		}
		const tags = new Set<string>();
		for (const task of this.plugin.tasks.tasks) {
			for (const tag of task.tags) {
				tags.add(tag);
			}
		}
		select.empty();
		select.createEl("option", { text: strings.board.allTags, value: "" });
		for (const tag of [...tags].sort()) {
			select.createEl("option", { text: `#${tag}`, value: tag });
		}
		select.value = this.tag ?? "";
	}

	private renderBody(): void {
		const shell = this.shell;
		const root = this.root;
		if (shell === null || root === null) {
			return;
		}
		const settings = this.plugin.settings;
		const tasks = this.plugin.tasks.tasks;

		shell.banners.empty();

		const kanban = settings.kanban[this.level];
		const board = buildKanbanBoard(tasks, {
			level: this.level,
			period: this.period,
			registries: settings.statuses,
			groupBy: kanban.groupBy,
			swimLane: kanban.swimLane,
			enabledPriorities: settings.enabledPriorities,
			explodeListColumns: kanban.explodeListColumns,
			hideEmptyColumns: settings.hideEmptyColumns,
			collapseEmptyTerminalColumns: settings.collapseEmptyTerminalColumns,
			hideEmptySwimLanes: kanban.hideEmptySwimLanes,
			pinnedColumns: kanban.pinnedColumns,
			wipLimits: kanban.wipLimits,
			columnOrder: kanban.columnOrder,
			filter: { tag: this.tag, query: this.query },
			sortMode: settings.sortWithinColumn,
		});
		const resolve = buildTaskLookup(tasks);

		// A note filed in the wrong folder is flagged rather than moved behind the
		// user's back, so the card can offer the move where the reason is visible.
		const mismatches = new Map<string, string>();
		for (const problem of this.plugin.tasks.problemNotes()) {
			if (problem.expectedFolder !== undefined) {
				mismatches.set(problem.path, problem.expectedFolder);
			}
		}

		const toCard = (card: CardView): BoardCardModel => {
			const task = card.task;
			const status = findStatus(settings.statuses[task.level], task.status);
			return {
				path: task.path,
				title: task.title,
				order: task.order,
				status: task.status,
				statusColor: status?.color ?? null,
				statusCategory: statusCategory(settings.statuses[task.level], task.status),
				priority: task.priority,
				level: task.level,
				period: task.period,
				due: task.due,
				parent: task.parent,
				parentPath:
					task.parent === null ? null : (resolve(task.parent)?.path ?? null),
				tags: task.tags,
				bodyTags: task.bodyTags,
				folderMismatch: mismatches.get(task.path) ?? null,
				done: card.done,
				total: card.total,
				allChildrenDone: card.allChildrenDone,
				unknownStatus: card.unknownStatus,
				issues: collectHierarchyIssues(task, resolve),
			};
		};

		const headerOf = (columnKey: string): KanbanColumn | undefined =>
			board.columns.find((entry) => entry.key === columnKey);
		const toColumn = (cell: KanbanCell): BoardColumnModel => {
			const header = headerOf(cell.columnKey);
			return {
				id: cell.columnKey,
				label: this.columnLabel(cell.columnKey),
				color: header?.color ?? "var(--background-modifier-border)",
				cards: cell.cards.map(toCard),
				// Always the composite cell id, so the rendered droppable id and
				// the drag board's column id agree in both modes.
				cellId: cell.id,
				wipLimit: header?.wipLimit ?? null,
				pinned: header?.pinned ?? false,
			};
		};

		const flatRow = board.rows[0];
		const model: BoardColumnModel[] =
			board.swimLanes || flatRow === undefined ? [] : flatRow.cells.map(toColumn);
		const rows: BoardRowModel[] | undefined = board.swimLanes
			? board.rows.map((row) => ({
					key: row.key,
					label: this.rowLabel(row.key),
					total: row.total,
					columns: row.cells.map(toColumn),
				}))
			: undefined;

		this.model = model;
		this.rows = rows;
		// Drop resolution works on cells, so both modes share one shape.
		this.dragBoardModel = board.rows.flatMap((row) =>
			row.cells.map((cell) => ({
				id: cell.id,
				cards: cell.cards.map((card) => ({
					path: card.task.path,
					order: card.task.order,
				})),
			})),
		);

		this.renderProblems(shell.banners);
		if (!board.rows.some((row) => row.total > 0)) {
			this.renderEmptyState(shell.banners);
		}

		const display: BoardDisplayOptions = {
			...settings.showCardMetadata,
			tagColors: settings.tagColors,
		};
		root.render(
			<BoardBody
				columns={model}
				rows={rows}
				columnWidth={kanban.columnWidth}
				maxSwimLaneHeight={kanban.maxSwimLaneHeight}
				compact={kanban.cardLayout === "compact"}
				onReorderColumns={(fromId, toId) => {
					this.reorderColumns(fromId, toId);
				}}
				display={display}
				mobile={Platform.isMobile}
				today={getPeriodFor(new Date(), "daily")}
				reducedMotion={this.reducedMotion}
				showMenuButton={this.showMenuButton}
				onDragEnd={(activePath, overId) => {
					this.handleDragEnd(activePath, overId);
				}}
				onOpenNote={(path, newPane) => {
					this.openNote(path, newPane === true);
				}}
				onFilterTag={(tag) => {
					this.filterByTag(tag);
				}}
				onContextMenu={(path, position) => {
					this.openCardMenu(path, position);
				}}
				onRename={(path, title) => {
					this.renameTask(path, title);
				}}
				onAddTask={(columnKey) => {
					this.addTask(columnKey);
				}}
				onEdit={(path) => {
					this.editTask(path);
				}}
				onFixFolder={(path) => {
					this.fixFolder(path);
				}}
			/>,
		);
	}

	/** The board as rendered, in the shape the drop resolver expects. */
	private dragBoard(): DragBoard {
		return this.dragBoardModel;
	}

	/** The cell a card currently sits in, or `null` when it is not on the board. */
	private cellOf(path: string): { columnKey: string; rowKey: string } | null {
		for (const column of this.dragBoardModel) {
			if (column.cards.some((card) => card.path === path)) {
				return splitKanbanCellId(column.id);
			}
		}
		return null;
	}

	/** Column header label for the current grouping property. */
	private columnLabel(key: string): string {
		const kanban = this.plugin.settings.kanban[this.level];
		if (kanban.groupBy === "status") {
			return findStatus(this.plugin.settings.statuses[this.level], key)?.label ?? key;
		}
		if (key === "") {
			return strings.board.uncategorized;
		}
		if (kanban.groupBy === "priority" && isPriority(key)) {
			return strings.priorities[key];
		}
		return key;
	}

	/** Swimlane label for the current swimlane property. */
	private rowLabel(key: string): string {
		if (key === "") {
			return strings.board.uncategorized;
		}
		const kanban = this.plugin.settings.kanban[this.level];
		if (kanban.swimLane === "priority" && isPriority(key)) {
			return strings.priorities[key];
		}
		return key;
	}

	/** Column keys in the order currently rendered. */
	private renderedColumnKeys(): string[] {
		const columns = this.rows?.[0]?.columns ?? this.model;
		return columns.map((column) => column.id);
	}

	/**
	 * Persists a column header drag.
	 *
	 * Status columns are the board's registry, so reordering them rewrites the
	 * registry `order`; the other properties cannot be reordered that way, so the
	 * order is stored per grouping property in the board's Kanban settings.
	 */
	private reorderColumns(fromId: string, toId: string): void {
		const kanban = this.plugin.settings.kanban[this.level];
		if (kanban.groupBy === "status") {
			const registry = this.plugin.settings.statuses[this.level];
			const toIndex = registry.findIndex((status) => status.id === toId);
			if (toIndex < 0 || !registry.some((status) => status.id === fromId)) {
				return;
			}
			this.plugin.settings.statuses[this.level] = reorderStatus(
				registry,
				fromId,
				toIndex,
			);
		} else {
			const current = this.renderedColumnKeys();
			const fromIndex = current.indexOf(fromId);
			const toIndex = current.indexOf(toId);
			if (fromIndex < 0 || toIndex < 0) {
				return;
			}
			const next = [...current];
			next.splice(fromIndex, 1);
			next.splice(toIndex, 0, fromId);
			this.plugin.settings.kanban[this.level] = {
				...kanban,
				columnOrder: { ...kanban.columnOrder, [kanban.groupBy]: next },
			};
		}
		void this.plugin.saveSettings();
		this.renderBody();
	}

	/**
	 * Resolves a finished drag and writes it.
	 *
	 * The repository updates memory and notifies immediately, so the card stays
	 * where it was dropped; the frontmatter write follows on a short debounce.
	 *
	 * The re-render is forced here rather than left to the next animation frame:
	 * dnd-kit measures the card's slot the moment the drop animation starts, so
	 * if the card has not moved yet the overlay animates all the way back to
	 * where the drag began before snapping to its new column.
	 */
	private handleDragEnd(activePath: string, overId: string | null): void {
		if (overId === null) {
			return;
		}
		const target = resolveDropTarget(this.dragBoardModel, activePath, overId);
		if (target === null) {
			return;
		}
		const cell = splitKanbanCellId(target.columnId);
		const task = this.plugin.tasks.getTask(activePath);
		if (cell === null || task === undefined) {
			return;
		}
		// Dropping between cells updates the grouping property, the swimlane
		// property, or both - `movePatch` decides which.
		const kanban = this.plugin.settings.kanban[this.level];
		const source = this.cellOf(activePath) ?? {
			columnKey: cell.columnKey,
			rowKey: cell.rowKey,
		};
		const patch = movePatch(
			{
				groupBy: kanban.groupBy,
				swimLane: kanban.swimLane,
				explodeListColumns: kanban.explodeListColumns,
			},
			task,
			source,
			{ columnKey: cell.columnKey, rowKey: cell.rowKey },
		);
		this.plugin.tasks.updateFields(activePath, { ...patch, order: target.order });
		this.renderNow();
		// Write on drop instead of waiting for the debounce, so the note reflects
		// the board even if Obsidian is closed immediately afterwards.
		void this.plugin.tasks.flush();
	}

	/**
	 * Paints the board immediately, cancelling any frame a store change queued,
	 * so the DOM already shows the new layout before dnd-kit animates the card
	 * into it.
	 */
	private renderNow(): void {
		if (this.renderFrame !== null) {
			window.cancelAnimationFrame(this.renderFrame);
			this.renderFrame = null;
		}
		this.renderBody();
	}

	/** The non-drag path: right click, or the actions button on touch. */
	private openCardMenu(path: string, position: { x: number; y: number }): void {
		const task = this.plugin.tasks.getTask(path);
		if (task === undefined) {
			return;
		}
		showCardMenu({
			app: this.app,
			position,
			currentStatus: task.status,
			registry: this.plugin.settings.statuses[task.level],
			onOpenNote: () => {
				this.openNote(path, false);
			},
			onEdit: () => {
				this.editTask(path);
			},
			onDelete: () => {
				this.confirmDelete(path);
			},
			onMoveToStatus: (statusId) => {
				this.moveToStatus(path, statusId);
			},
			onMoveToTop: () => {
				this.moveWithinColumn(path, "top");
			},
			onMoveToBottom: () => {
				this.moveWithinColumn(path, "bottom");
			},
			onChangeParent: () => {
				this.changeParent(path);
			},
			onDuplicate: () => {
				void this.duplicateTask(path);
			},
			onCopyLink: () => {
				void this.copyLink(path);
			},
		});
	}

	/** Copies a task note, body and all, and says where the copy landed. */
	private async duplicateTask(path: string): Promise<void> {
		const created = await this.plugin.tasks.duplicateTask(path);
		if (created === null) {
			return;
		}
		new Notice(formatTemplate(strings.notices.duplicated, { title: basename(created) }));
	}

	/** Copies a wikilink to the note, for pasting into another note. */
	private async copyLink(path: string): Promise<void> {
		const link = toLinkRef(path);
		// A browser build without clipboard permission must still leave the user
		// with the link itself rather than a failure they cannot act on.
		try {
			await navigator.clipboard.writeText(link);
			new Notice(strings.notices.linkCopied);
		} catch (error) {
			warn("Could not write to the clipboard", error);
			new Notice(formatTemplate(strings.notices.copyFailed, { link }));
		}
	}

	/**
	 * Opens the task form for a new task in a column.
	 *
	 * The same form as the header's New task button, pre-filled with the column's
	 * value so the task lands where the user clicked: the status when grouping by
	 * status, otherwise the priority or the tag.
	 */
	private addTask(columnKey: string): void {
		const kanban = this.plugin.settings.kanban[this.level];
		const registry = this.plugin.settings.statuses[this.level];
		const initial: Partial<TaskDraft> = {
			status: kanban.groupBy === "status" ? columnKey : defaultStatusId(registry),
		};
		if (kanban.groupBy === "priority" && isPriority(columnKey)) {
			initial.priority = columnKey;
		}
		if (kanban.groupBy === "tags" && columnKey !== "") {
			initial.tags = [columnKey];
		}
		this.plugin.openNewTaskDialog({ level: this.level, period: this.period, initial });
	}

	/** Opens the task form for an existing card, pre-filled from its note. */
	private editTask(path: string): void {
		const task = this.plugin.tasks.getTask(path);
		if (task !== undefined) {
			this.plugin.openTaskModal({ task });
		}
	}

	/** Commits an inline title edit from a card. */
	private renameTask(path: string, title: string): void {
		this.plugin.tasks.updateFields(path, { title });
	}

	/**
	 * Deletes a task, after asking.
	 *
	 * The note goes to the trash rather than being destroyed, and the dialog says
	 * so, because other tasks may be linking to it.
	 */
	private confirmDelete(path: string): void {
		const modal = new ConfirmationModal(this.app);
		modal.setTitle(strings.notices.deleteTitle);
		modal.contentEl.createEl("p", { text: strings.notices.deleteBody });
		modal.addButton((button) => {
			button
				.setButtonText(strings.notices.deleteConfirm)
				.setDestructive()
				.onClick(() => {
					void this.plugin.tasks.deleteTask(path);
				});
		});
		modal.addCancelButton(strings.task.cancel);
		modal.open();
	}

	private moveToStatus(path: string, statusId: string): void {
		const task = this.plugin.tasks.getTask(path);
		if (task === undefined || task.status === statusId) {
			return;
		}
		this.plugin.tasks.moveCard(path, statusId, orderAtBottom(this.dragBoard(), statusId, path));
	}

	private moveWithinColumn(path: string, edge: "top" | "bottom"): void {
		const task = this.plugin.tasks.getTask(path);
		if (task === undefined) {
			return;
		}
		const board = this.dragBoard();
		const order =
			edge === "top"
				? orderAtTop(board, task.status, path)
				: orderAtBottom(board, task.status, path);
		this.plugin.tasks.moveCard(path, task.status, order);
	}

	/**
	 * Reports notes that are marked as tasks but cannot be placed on a board.
	 * Without this a task with a typo in its period would simply vanish.
	 */
	private renderProblems(parentEl: HTMLElement): void {
		// A folder mismatch is not a task that cannot be placed: that card is on the
		// board, carrying its own badge, so it must not be counted here as well.
		const problems = this.plugin.tasks
			.problemNotes()
			.filter((problem) => problem.kind !== "folder-mismatch");
		if (problems.length === 0) {
			return;
		}
		const paths = [...new Set(problems.map((problem) => problem.path))];
		const shown = paths.slice(0, 3).map((path) => basename(path));
		let body = formatTemplate(strings.board.problemsBody, { paths: shown.join(", ") });
		if (paths.length > shown.length) {
			body += ` ${formatTemplate(strings.board.problemsMore, {
				count: paths.length - shown.length,
			})}`;
		}

		const banner = parentEl.createDiv({ cls: "task-flow-banner is-warning" });
		banner.createDiv({
			cls: "task-flow-banner-title",
			text: formatTemplate(strings.board.problemsTitle, { count: paths.length }),
		});
		banner.createEl("p", { text: body });
	}

	private renderEmptyState(parentEl: HTMLElement): void {
		const empty = parentEl.createDiv({ cls: "task-flow-empty" });
		empty.createEl("h3", { text: strings.board.emptyTitle });
		empty.createEl("p", { text: strings.board.emptyBody });
		empty
			.createEl("button", { text: strings.board.emptyAction })
			.addEventListener("click", () => {
				this.plugin.openUserGuide();
			});
	}

	private setLevel(level: Level): void {
		if (level === this.level) {
			return;
		}
		this.level = level;
		this.period = currentPeriodFor(level);
		this.persistState();
		this.renderHeader();
		this.renderBody();
	}

	private stepPeriod(delta: number): void {
		if (!isPeriodLevel(this.level) || this.period === null) {
			return;
		}
		this.period = shiftPeriod(this.period, this.level, delta);
		this.persistState();
		this.renderHeader();
		this.renderBody();
	}

	private goToToday(): void {
		if (!isPeriodLevel(this.level)) {
			return;
		}
		this.period = getCurrentPeriod(this.level);
		this.persistState();
		this.renderHeader();
		this.renderBody();
	}

	private filterByTag(tag: string): void {
		this.tag = tag;
		this.refreshTagOptions();
		this.renderBody();
	}

	/** Remembers the board so reopening the app restores it. */
	private persistState(): void {
		this.plugin.settings.boardState = { level: this.level, period: this.period };
		void this.plugin.saveSettings();
	}

	/** Opens the note behind a card in a new tab, or beside the board. */
	private openNote(path: string, newPane: boolean): void {
		const file = this.app.vault.getFileByPath(path);
		if (file === null) {
			warn(`Task note is missing: ${path}`);
			return;
		}
		void this.app.workspace.getLeaf(newPane ? "split" : "tab").openFile(file);
	}

	/** Moves a mismatched note into the folder its horizon calls for. */
	private fixFolder(path: string): void {
		void this.plugin.tasks.moveToLevelFolder(path).then((moved) => {
			if (moved !== null) {
				new Notice(formatTemplate(strings.notices.folderMoved, { folder: folderOf(moved) }));
			}
		});
	}

	/**
	 * Offers a new parent, restricted to the horizons this task may link to.
	 *
	 * With one folder per horizon, that restriction is also what keeps the picker
	 * to the folders the task is allowed to point at.
	 */
	private changeParent(path: string): void {
		const task = this.plugin.tasks.getTask(path);
		if (task === undefined) {
			return;
		}
		const tasks = this.plugin.tasks.tasks;
		const settings = this.plugin.settings;
		const candidates = parentCandidates(draftFromTask(task), {
			tasks,
			registries: settings.statuses,
			selfPath: path,
			strictHierarchy: settings.strictHierarchy,
		});
		new ParentPickerModal(this.app, {
			candidates,
			registries: settings.statuses,
			enabledLevels: settings.enabledLevels,
			childLevel: task.level,
			currentParent: task.parent,
			onPick: (parent) => {
				this.plugin.tasks.updateFields(path, { parent });
				new Notice(strings.notices.parentChanged);
			},
		}).open();
	}

	/**
	 * Coalesces store changes into one render per frame: a drag across five
	 * columns, or a burst of vault events, paints once.
	 */
	private scheduleRender(): void {
		if (this.renderFrame !== null) {
			return;
		}
		this.renderFrame = window.requestAnimationFrame(() => {
			this.renderFrame = null;
			this.renderBody();
		});
	}
}

/** The period to show when a horizon is selected. */
function currentPeriodFor(level: Level): string | null {
	return isPeriodLevel(level) ? getCurrentPeriod(level) : null;
}
