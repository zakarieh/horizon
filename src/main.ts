import { Notice, Plugin } from "obsidian";

import { TaskRepository } from "./data";
import {
	EDITABLE_FIELD_KEYS,
	collectRollovers,
	defaultStatusId,
	draftFromTask,
	findStatus,
	getCurrentPeriod,
	isPeriodLevel,
	pickFields,
	statusCategory,
	type DraftContext,
	type Level,
	type RolloverCandidate,
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
import { formatTemplate } from "./util/text";
import { UndoStack } from "./util/undo-stack";
import { BOARD_VIEW_ICON, BOARD_VIEW_TYPE, BoardView } from "./ui/board-view";
import { GuideModal } from "./ui/guide-modal";
import { createNotePanelExtension, type NotePanelController } from "./ui/live-preview";
import { buildNotePanel, NOTE_PANEL_CLASS, notePanelDataFor } from "./ui/note-panel";
import { TaskModal } from "./ui/task-modal";

/** One reversible change: the fields a task had before they were edited. */
interface UndoEntry {
	path: string;
	fields: Partial<TaskFields>;
}

/**
 * Identity of a rollover prompt: the task and the period it would leave.
 *
 * Used to remember which prompts the user has already seen, so the periodic
 * sweep does not stack up identical notices while they decide.
 */
function rolloverKey(candidate: RolloverCandidate): string {
	return `${candidate.path}\u001f${candidate.from}`;
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

	/** Rollover prompts already shown, so the timer does not repeat them. */
	private readonly dismissedRollovers = new Set<string>();

	/** The live-preview note panel extension, so settings can ask it to rebuild. */
	private notePanel: NotePanelController | null = null;

	override async onload(): Promise<void> {
		await this.loadSettings();

		this.tasks = new TaskRepository(this.app, this, {
			statusCategory: (level, id) => statusCategory(this.settings.statuses[level], id),
			fallbackStatus: (level) => defaultStatusId(this.settings.statuses[level]),
			folderLayout: () => folderLayoutOf(this.settings),
		});
		this.tasks.start();

		// Unfinished tasks from an ended period are carried into the current one.
		// The index may still be filling when the plugin loads, so this also runs
		// on the minute timer below.
		void this.rolloverSweep();

		// Archiving is time based, so it is swept on a timer rather than only when
		// data changes: a card that has sat in Done long enough is archived even if
		// the user never touches the board again.
		this.registerInterval(
			window.setInterval(() => {
				void this.archiveSweep();
				void this.rolloverSweep();
			}, 60_000),
		);

		this.registerView(BOARD_VIEW_TYPE, (leaf) => new BoardView(leaf, this));
		this.addSettingTab(new TaskFlowSettingTab(this.app, this));

		// The framework is frontmatter, and frontmatter renders as a nested object.
		// Showing it in the note itself is what makes an objective readable without
		// opening the form. Live Preview is handled by the editor extension below;
		// this post-processor covers Reading view. The two never overlap, because
		// reading view does not use a CodeMirror editor.
		this.registerMarkdownPostProcessor((element, context) => {
			const raw: unknown =
				context.frontmatter ??
				this.app.metadataCache.getCache(context.sourcePath)?.frontmatter;
			const panel = buildNotePanel(
				notePanelDataFor(
					raw,
					this.tasks.getTask(context.sourcePath),
					this.settings.statuses,
				),
			);
			if (panel === null) {
				return;
			}
			const sizer = element.closest(".markdown-preview-sizer");
			// The processor runs once per block, so the panel is added by whichever
			// block comes first and the rest find it already there.
			if (sizer === null || sizer.querySelector(`.${NOTE_PANEL_CLASS}`) !== null) {
				return;
			}
			sizer.prepend(panel);
		});

		// Notes open in Live Preview by default, so the panel is drawn there too.
		// A block widget may not come from a ViewPlugin, so the extension owns a
		// StateField; this controller lets the plugin ask it to rebuild whenever the
		// metadata cache changes (a note edited elsewhere, or the index catching up).
		const notePanel = createNotePanelExtension(this);
		this.notePanel = notePanel;
		this.registerEditorExtension(notePanel.extension);
		this.registerEvent(
			this.app.metadataCache.on("changed", () => {
				notePanel.refresh();
			}),
		);
		this.registerEvent(
			this.app.metadataCache.on("resolved", () => {
				notePanel.refresh();
			}),
		);

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
	 * Carries unfinished tasks into the period that is now current.
	 *
	 * Runs when the plugin loads and on the same minute timer as the archive
	 * sweep, so a task left open when a day (or week, month, quarter or year)
	 * ended lands on the current period rather than lingering on a board the user
	 * has already left. The per-level `rollover` setting decides what happens:
	 * `auto` moves silently, `ask` offers a one-click prompt, and `never` opts the
	 * horizon out. Objectives are not time bound and never roll over.
	 */
	private async rolloverSweep(): Promise<void> {
		const candidates = collectRollovers(this.tasks.tasks, this.settings.statuses);
		if (candidates.length === 0) {
			return;
		}

		const automatic: RolloverCandidate[] = [];
		const ask: RolloverCandidate[] = [];
		for (const candidate of candidates) {
			const behavior = this.settings.rollover[candidate.level];
			if (behavior === "never") {
				continue;
			}
			if (behavior === "auto") {
				automatic.push(candidate);
			} else if (!this.dismissedRollovers.has(rolloverKey(candidate))) {
				ask.push(candidate);
			}
		}

		this.applyRollovers(automatic);
		if (ask.length > 0) {
			this.promptRollovers(ask);
		}
	}

	/**
	 * Moves each candidate onto its current period and reports how many moved.
	 *
	 * Only the period changes - the level, and so the folder, stay the same - and
	 * `carriedFrom` records where the task came from.
	 */
	private applyRollovers(candidates: readonly RolloverCandidate[]): void {
		if (candidates.length === 0) {
			return;
		}
		for (const candidate of candidates) {
			this.tasks.updateFields(candidate.path, {
				period: candidate.to,
				carriedFrom: candidate.carriedFrom,
			});
		}
		new Notice(
			candidates.length === 1
				? strings.notices.rolledOverOne
				: formatTemplate(strings.notices.rolledOverMany, {
						count: String(candidates.length),
					}),
		);
	}

	/**
	 * Asks before carrying the `ask` horizons' tasks over.
	 *
	 * One notice covers them all, it stays up until it is acted on, and rolling
	 * over is a single click. The candidates are remembered the moment the notice
	 * is shown, so the minute timer does not open a second identical notice while
	 * the user decides.
	 */
	private promptRollovers(candidates: readonly RolloverCandidate[]): void {
		for (const candidate of candidates) {
			this.dismissedRollovers.add(rolloverKey(candidate));
		}

		const message =
			candidates.length === 1
				? strings.notices.rolloverAskOne
				: formatTemplate(strings.notices.rolloverAskMany, {
						count: String(candidates.length),
					});

		let notice: Notice | null = null;
		// `createFragment` and the `createEl` family are Obsidian globals, not
		// module exports: the app augments the DOM with them at runtime.
		const fragment = createFragment((el) => {
			el.createSpan({ text: `${message} ` });
			el.createEl(
				"button",
				{ text: strings.notices.rolloverAction, cls: "mod-cta" },
				(button) => {
					button.addEventListener("click", () => {
						notice?.hide();
						this.applyRollovers(candidates);
					});
				},
			);
		});
		// `0` keeps the notice up until it is acted on: a decision about moving
		// work should not time out.
		notice = new Notice(fragment, 0);
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
	 * Rebuilds the note panel in every open Live Preview editor.
	 *
	 * Needed after a settings change the panel draws from - a tag's colour - which
	 * is not a note edit, so no `metadataCache` event fires for it.
	 */
	refreshNotePanels(): void {
		this.notePanel?.refresh();
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
