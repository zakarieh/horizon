import { Notice, Plugin } from "obsidian";

import { TaskRepository } from "./data";
import {
	EDITABLE_FIELD_KEYS,
	defaultStatusId,
	draftFromTask,
	findStatus,
	getCurrentPeriod,
	isPeriodLevel,
	normalizeFramework,
	pickFields,
	statusCategory,
	type DraftContext,
	type Level,
	type Task,
	type TaskDraft,
	type TaskEditKey,
	type TaskFields,
} from "./domain";
import { warn } from "./log";
import {
	DEFAULT_SETTINGS,
	folderLayoutOf,
	mergeSettings,
	type TaskFlowSettings,
} from "./settings";
import { TaskFlowSettingTab } from "./settings-tab";
import { strings } from "./strings";
import { asRecord } from "./util/records";
import { UndoStack } from "./util/undo-stack";
import { BOARD_VIEW_ICON, BOARD_VIEW_TYPE, BoardView } from "./ui/board-view";
import { GuideModal } from "./ui/guide-modal";
import { buildFrameworkPanel, FRAMEWORK_PANEL_CLASS } from "./ui/framework-panel";
import { TaskModal } from "./ui/task-modal";

/** One reversible change: the fields a task had before they were edited. */
interface UndoEntry {
	path: string;
	fields: Partial<TaskFields>;
}

/**
 * Horizon Task entry point.
 *
 * Everything the plugin registers goes through the `Component` lifecycle
 * (`registerView`, `registerEvent`, `addCommand`, `addSettingTab`), so Obsidian
 * tears it all down on unload: the repository's metadata listeners are
 * registered on this plugin, and the board unsubscribes from the store when its
 * leaf closes.
 *
 * The only thing unload has to do by hand is flush pending debounced writes.
 */
export default class TaskFlowPlugin extends Plugin {
	/**
	 * Live settings. Always fully populated: {@link mergeSettings} validates the
	 * persisted data and fills in defaults, so views never need to guard.
	 */
	override settings: TaskFlowSettings = DEFAULT_SETTINGS;

	/** The vault-backed task store. Assigned in {@link onload}. */
	tasks!: TaskRepository;

	/**
	 * The last few edits, so a surprising one can be taken back.
	 *
	 * Frontmatter writes are not part of the editor's undo history, so the plugin
	 * keeps its own: an edit records the previous values of the fields it is
	 * about to change, and the undo command writes them back.
	 */
	private readonly undoStack = new UndoStack<UndoEntry>();

	override async onload(): Promise<void> {
		await this.loadSettings();

		this.tasks = new TaskRepository(this.app, this, {
			statusCategory: (level, id) => statusCategory(this.settings.statuses[level], id),
			fallbackStatus: (level) => defaultStatusId(this.settings.statuses[level]),
			folderLayout: () => folderLayoutOf(this.settings),
		});
		this.tasks.start();

		// Archiving is time based, so it is swept on a timer rather than only when
		// data changes: a card that has sat in Done long enough is archived even if
		// the user never touches the board again.
		this.registerInterval(
			window.setInterval(() => {
				void this.archiveSweep();
			}, 60_000),
		);

		this.registerView(BOARD_VIEW_TYPE, (leaf) => new BoardView(leaf, this));
		this.addSettingTab(new TaskFlowSettingTab(this.app, this));

		// The framework is frontmatter, and frontmatter renders as a nested object.
		// Showing it in the note itself is what makes an objective readable without
		// opening the form. Reading view only: in live preview the container belongs
		// to CodeMirror, and injecting DOM there fights the editor.
		this.registerMarkdownPostProcessor((element, context) => {
			const raw: unknown =
				context.frontmatter ??
				this.app.metadataCache.getCache(context.sourcePath)?.frontmatter;
			const panel = buildFrameworkPanel(normalizeFramework(asRecord(raw).framework));
			if (panel === null) {
				return;
			}
			const sizer = element.closest(".markdown-preview-sizer");
			// The processor runs once per block, so the panel is added by whichever
			// block comes first and the rest find it already there.
			if (sizer === null || sizer.querySelector(`.${FRAMEWORK_PANEL_CLASS}`) !== null) {
				return;
			}
			sizer.prepend(panel);
		});

		this.addRibbonIcon(BOARD_VIEW_ICON, strings.plugin.ribbonTooltip, () => {
			void this.openBoard();
		});

		this.addCommand({
			id: "open-board",
			name: strings.commands.openBoard,
			callback: () => {
				void this.openBoard();
			},
		});
		this.addCommand({
			id: "new-task",
			name: strings.commands.newTask,
			callback: () => {
				this.openNewTaskDialog();
			},
		});
		this.addCommand({
			id: "undo-last-task-change",
			name: strings.commands.undoLastChange,
			callback: () => {
				void this.undoLastChange();
			},
		});
		this.addCommand({
			id: "open-user-guide",
			name: strings.commands.openUserGuide,
			callback: () => {
				this.openUserGuide();
			},
		});
	}

	override onunload(): void {
		// Debounced writes would otherwise be lost on the way out. `dispose`
		// only cancels the timer, never the writes already in flight.
		const tasks: TaskRepository | undefined = this.tasks;
		if (tasks === undefined) {
			return;
		}
		void tasks.flush();
		tasks.dispose();
	}

	/**
	 * Opens the board.
	 *
	 * Reuses the existing board tab when there is one, so the ribbon button
	 * never piles up duplicate boards.
	 */
	async openBoard(): Promise<void> {
		const existing = this.app.workspace.getLeavesOfType(BOARD_VIEW_TYPE)[0];
		if (existing !== undefined) {
			await this.app.workspace.revealLeaf(existing);
			return;
		}
		const leaf = this.app.workspace.getLeaf("tab");
		await leaf.setViewState({ type: BOARD_VIEW_TYPE, active: true });
		await this.app.workspace.revealLeaf(leaf);
	}

	/** Opens the read-only, in-app user guide. */
	openUserGuide(): void {
		new GuideModal(this.app, this.manifest.version).open();
	}

	/**
	 * Archives tasks that have sat in a `done` status past its configured limit.
	 *
	 * The limit lives on the status (`archiveAfterMinutes`), so it is per board and
	 * only applies to statuses in the `done` category. Archiving sets the flag and
	 * then files the note under `Archive/<horizon>`, so the flag is still what
	 * hides it from the boards and a note can be brought back by hand.
	 */
	private async archiveSweep(): Promise<void> {
		const now = Date.now();
		const archived: string[] = [];
		for (const task of this.tasks.tasks) {
			if (task.archived === true || task.completedAt == null) {
				continue;
			}
			const minutes = findStatus(
				this.settings.statuses[task.level],
				task.status,
			)?.archiveAfterMinutes;
			if (minutes == null || minutes <= 0) {
				continue;
			}
			const at = Date.parse(task.completedAt);
			if (Number.isNaN(at) || now - at < minutes * 60_000) {
				continue;
			}
			this.tasks.updateFields(task.path, { archived: true });
			archived.push(task.path);
		}
		if (archived.length === 0) {
			return;
		}

		// The flag has to reach disk before the move: a rename clears the pending
		// write for the old path, and the note would be archived in the index only.
		await this.tasks.flush();
		for (const path of archived) {
			await this.tasks.moveToArchiveFolder(path);
		}
	}

	/**
	 * Opens the form for a new task.
	 *
	 * @param defaults Horizon and period to pre-fill; the board passes its own
	 * so a task created from a board lands on that board. Without them, the last
	 * board the user looked at is used.
	 * @param defaults Also accepts `initial` overrides, so a column's "+" button
	 * can pre-fill the column's value as well as the horizon and period.
	 */
	openNewTaskDialog(
		defaults: {
			level?: Level;
			period?: string | null;
			initial?: Partial<TaskDraft>;
		} = {},
	): void {
		const state = this.settings.boardState;
		const requested = defaults.level ?? state.level;
		const level = this.settings.enabledLevels.includes(requested)
			? requested
			: this.settings.defaultLevel;

		let period: string | null = null;
		if (isPeriodLevel(level)) {
			period =
				defaults.period ?? (level === state.level ? state.period : null) ?? getCurrentPeriod(level);
		}

		this.openTaskModal({
			initial: {
				level,
				period,
				status: defaultStatusId(this.settings.statuses[level]),
				...defaults.initial,
			},
		});
	}

	/**
	 * Opens the task form, for a new task or an existing one.
	 *
	 * The context is snapshotted when the form opens: validation happens against
	 * the vault as the user saw it, so a note edited elsewhere mid-edit cannot
	 * make the form contradict itself.
	 */
	openTaskModal(options: { task?: Task; initial?: Partial<TaskDraft> }): void {
		const task = options.task;
		const context: DraftContext = {
			registries: this.settings.statuses,
			tasks: [...this.tasks.tasks],
			strictHierarchy: this.settings.strictHierarchy,
			selfPath: task?.path,
		};

		new TaskModal({
			app: this.app,
			task,
			initial: options.initial,
			context,
			settings: this.settings,
			loadBody: task === undefined ? undefined : (path) => this.tasks.readBody(path),
			openNote:
				task === undefined
					? undefined
					: (path) => {
						this.openNote(path);
					},
			onDelete:
				task === undefined
					? undefined
					: (path) => {
						void this.tasks.deleteTask(path);
					},
			onSubmit: async (draft, changed): Promise<void> => {
				await this.applyDraft(task, draft, changed);
			},
		}).open();
	}

	/** Opens a task's note in a new tab, if the note is still there. */
	private openNote(path: string): void {
		const file = this.app.vault.getFileByPath(path);
		if (file === null) {
			warn(`Task note is missing: ${path}`);
			return;
		}
		void this.app.workspace.getLeaf("tab").openFile(file);
	}

	/**
	 * Starts an undoable edit session on a task.
	 *
	 * A quick edit writes field by field as the user works, so the snapshot taken
	 * here is what makes the whole session one step to undo - and the caller can
	 * also use it to put things back if the session is cancelled.
	 *
	 * @returns The fields to restore, in the shape `updateFields` accepts.
	 */
	beginEdit(task: Task): Partial<TaskFields> {
		const fields = pickFields(draftFromTask(task), EDITABLE_FIELD_KEYS);
		this.undoStack.push({ path: task.path, fields });
		return fields;
	}

	/** Writes the undo stack back one step, moving the note if the horizon changed. */
	async undoLastChange(): Promise<void> {
		const entry = this.undoStack.pop();
		if (entry === undefined) {
			new Notice(strings.notices.nothingToUndo);
			return;
		}

		const current = this.tasks.getTask(entry.path);
		const horizonReturns =
			entry.fields.level !== undefined &&
			current !== undefined &&
			entry.fields.level !== current.level;

		this.tasks.updateFields(entry.path, entry.fields);

		// Undoing a horizon change has to put the note back in its old folder too,
		// or the undo would leave behind the very mismatch it was meant to fix.
		if (horizonReturns) {
			await this.tasks.flush();
			await this.tasks.moveToLevelFolder(entry.path);
		}

		new Notice(strings.notices.undoDone);
	}

	/** Loads `data.json`, repairing anything missing or malformed. */
	async loadSettings(): Promise<void> {
		const stored: unknown = await this.loadData();
		this.settings = mergeSettings(stored);
	}

	/** Persists settings to `data.json`. */
	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	/**
	 * Saves the form.
	 *
	 * An existing task is written with only the fields that changed, so nothing
	 * else in its frontmatter - including fields the plugin does not understand -
	 * is touched. A new task is created from the folder setting and lands on the
	 * board for its horizon and period.
	 *
	 * The note body is not frontmatter, so it is written through its own call, and
	 * before anything that could move the note: the body is written by path, and
	 * the path is about to change.
	 */
	private async applyDraft(
		existing: Task | undefined,
		draft: TaskDraft,
		changed: readonly TaskEditKey[],
	): Promise<void> {
		if (existing === undefined) {
			await this.tasks.createTask({
				title: draft.title.trim(),
				level: draft.level,
				period: draft.period,
				status: draft.status,
				priority: draft.priority,
				parent: draft.parent,
				tags: draft.tags,
				due: draft.due,
				body: draft.body,
				framework: draft.framework,
			});
			return;
		}

		if (changed.includes("body")) {
			await this.tasks.writeBody(existing.path, draft.body);
		}

		const patch = pickFields(draft, changed);
		if (Object.keys(patch).length === 0) {
			// A body-only edit: the frontmatter has nothing to say about it.
			return;
		}

		// Remember the previous state before writing, so this is undoable.
		const previous = pickFields(draftFromTask(existing), EDITABLE_FIELD_KEYS);
		this.tasks.updateFields(existing.path, patch);

		let undoPath = existing.path;
		if (changed.includes("level")) {
			// The frontmatter has to reach disk before the move: a rename clears the
			// pending-write bookkeeping for the old path, and the debounced level
			// change would be lost with it.
			await this.tasks.flush();
			undoPath = (await this.tasks.moveToLevelFolder(existing.path)) ?? existing.path;
		}

		this.undoStack.push({ path: undoPath, fields: previous });

		// Moving a task to another board is the change most likely to surprise,
		// so it is the one that offers an undo up front.
		if (changed.includes("period") || changed.includes("level")) {
			this.showUndoNotice(strings.notices.taskMoved);
		}
	}

	/**
	 * A notice with an Undo button.
	 *
	 * A plain toast plus a command would satisfy the letter of the rule, but the
	 * button is what makes an accidental move cheap to reverse.
	 */
	private showUndoNotice(message: string): void {
		// `createFragment` and the `createEl` family are Obsidian globals, not
		// module exports: the app augments the DOM with them at runtime.
		const fragment = createFragment((el) => {
			el.createSpan({ text: `${message} ` });
			el.createEl(
				"button",
				{ text: strings.notices.undo, cls: "mod-cta" },
				(button) => {
					button.addEventListener("click", () => {
						void this.undoLastChange();
					});
				},
			);
		});

		new Notice(fragment, 10000);
	}
}
