import {
	Notice,
	TFile,
	normalizePath,
	type App,
	type CachedMetadata,
	type Component,
} from "obsidian";

import {
	archiveFolderForLevel,
	correctedPathFor,
	folderForLevel,
	generateKeyBetween,
	getPeriodFor,
	isFolderMismatch,
	normalizeFramework,
	toNoteFileName,
	type Level,
	type LevelFolderLayout,
	type ObjectiveFramework,
	type Priority,
	type StatusCategory,
	type Task,
	type TaskFields,
} from "../domain";
import { logError, warn } from "../log";
import { strings } from "../strings";
import { asRecord } from "../util/records";
import {
	applyTaskFields,
	buildTaskFileContent,
	readTask,
	splitFrontmatter,
	stripFrontmatter,
	type TaskFieldKey,
	type TaskProblem,
} from "./frontmatter";

/** Fields the caller may patch on an existing task. */
export type TaskPatch = Partial<TaskFields>;

/** Everything needed to create a task note. */
export interface NewTaskInit {
	title: string;
	level: Level;
	period: string | null;
	status: string;
	priority?: Priority;
	parent?: string | null;
	order?: string;
	tags?: string[];
	due?: string | null;
	body?: string;
	/** Goal/execution framework; only meaningful for objectives. */
	framework?: ObjectiveFramework;
}

/** Wiring the repository needs from the plugin, so it stays testable and free of settings. */
export interface TaskRepositoryOptions {
	/** Resolves a status id to its category, using a board's registry. */
	statusCategory: (level: Level, id: string) => StatusCategory | null;
	/** Status id new tasks start in, and the fallback for notes without one. */
	fallbackStatus: (level: Level) => string;
	/** Where tasks live, and whether each horizon gets its own folder. */
	folderLayout: () => LevelFolderLayout;
	/** How long writes are coalesced for, in milliseconds. */
	writeDebounceMs?: number;
}

const DEFAULT_WRITE_DEBOUNCE_MS = 300;

function today(): string {
	return getPeriodFor(new Date(), "daily");
}

/**
 * Reads every task note in the vault and writes changes back to frontmatter.
 *
 * Reads come from `MetadataCache`, never from re-reading file contents, and
 * writes go through `FileManager.processFrontMatter`, so two writers editing
 * the same note cannot clobber each other - and unrecognised frontmatter is
 * preserved automatically.
 *
 * Mutations are **optimistic**: the in-memory store is updated and listeners
 * are notified immediately, while the frontmatter write is coalesced over a
 * short debounce. Dragging a card across five columns therefore costs one
 * write, not five. If a write fails, the store is reloaded from what is
 * actually on disk, so the UI snaps back to the truth rather than lying.
 */
export class TaskRepository {
	private readonly app: App;
	private readonly owner: Component;
	private readonly options: TaskRepositoryOptions;
	private readonly writeDebounceMs: number;

	private readonly tasksByPath = new Map<string, Task>();
	private readonly problemsByPath = new Map<string, readonly TaskProblem[]>();
	private readonly listeners = new Set<() => void>();

	/** Paths with optimistic changes that have not been written yet. */
	private readonly dirtyPaths = new Set<string>();
	/** Which fields are pending per path, so writes touch nothing else. */
	private readonly pendingKeys = new Map<string, Set<TaskFieldKey>>();
	private flushTimer: number | null = null;
	private started = false;

	/**
	 * @param app The host app.
	 * @param owner Component the metadata listeners are registered on, so they
	 * are released with it. Pass the plugin.
	 * @param options Hooks back into the plugin's settings.
	 */
	constructor(app: App, owner: Component, options: TaskRepositoryOptions) {
		this.app = app;
		this.owner = owner;
		this.options = options;
		this.writeDebounceMs = options.writeDebounceMs ?? DEFAULT_WRITE_DEBOUNCE_MS;
	}

	/**
	 * Performs the initial scan and subscribes to the metadata cache.
	 *
	 * `changed` is used rather than the vault's `modify` event on purpose: it
	 * fires once the cache already reflects the new content, so a task is never
	 * indexed from stale metadata. It covers both creation and modification.
	 */
	start(): void {
		if (this.started) {
			return;
		}
		this.started = true;

		this.owner.registerEvent(
			this.app.metadataCache.on("changed", (file, _data, cache) => {
				this.indexFile(file, cache);
			}),
		);
		// Deletion of a file, or of its cached metadata.
		this.owner.registerEvent(
			this.app.metadataCache.on("deleted", (file) => {
				this.forget(file.path);
			}),
		);
		// A move changes the path, which is the task's identity.
		this.owner.registerEvent(
			this.app.vault.on("rename", (file, oldPath) => {
				this.forget(oldPath);
				if (file instanceof TFile) {
					this.indexFile(file);
				}
			}),
		);
		// Fired once the cache has finished its initial indexing.
		this.owner.registerEvent(
			this.app.metadataCache.on("resolved", () => {
				this.rescan();
			}),
		);

		this.rescan();
	}

	/** Every task, ordered by path so renders are deterministic. Archived tasks are hidden. */
	get tasks(): readonly Task[] {
		return [...this.tasksByPath.values()]
			.filter((task) => task.archived !== true)
			.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
	}

	/** One task by path, if the vault holds it. */
	getTask(path: string): Task | undefined {
		return this.tasksByPath.get(path);
	}

	/**
	 * Notes that are marked as tasks but cannot be placed on a board - an
	 * invalid `level`, or a missing/unusable `period`. Surfaced in the UI so a
	 * task can never disappear without explanation.
	 */
	problemNotes(): readonly TaskProblem[] {
		return [...this.problemsByPath.values()].flat();
	}

	/** True while a write is pending, e.g. for a "saving" indicator. */
	get hasPendingWrites(): boolean {
		return this.dirtyPaths.size > 0;
	}

	/**
	 * Subscribes to store changes.
	 *
	 * @returns An unsubscribe function; views must call it on close.
	 */
	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	/**
	 * Applies a patch in memory and schedules the frontmatter write.
	 *
	 * Moving a task into a `done` status stamps `completed`; moving it out
	 * clears the field again.
	 */
	updateFields(path: string, patch: TaskPatch): void {
		const current = this.tasksByPath.get(path);
		if (current === undefined) {
			warn(`Ignoring a patch for an unknown task: ${path}`);
			return;
		}

		const updated: Task = { ...current, ...patch };
		const keys = Object.keys(patch) as TaskFieldKey[];
		if (patch.status !== undefined) {
			const category = this.options.statusCategory(current.level, patch.status);
			updated.completed = category === "done" ? (current.completed ?? today()) : null;
			// A timestamp is needed to archive after N minutes; `completed` is only
			// a day, so it cannot drive a minute-accurate sweep.
			updated.completedAt =
				category === "done"
					? (current.completedAt ?? new Date().toISOString())
					: null;
			for (const key of ["completed", "completedAt"] as const) {
				if (!keys.includes(key)) {
					keys.push(key);
				}
			}
		}

		this.tasksByPath.set(path, updated);
		this.markDirty(path, keys);
		this.notify();
	}

	/** Moves a card to a column and a position: the drag-and-drop write path. */
	moveCard(path: string, statusId: string, order: string): void {
		this.updateFields(path, { status: statusId, order });
	}

	/**
	 * Creates a task note, in the folder its horizon calls for.
	 *
	 * @returns The new path, or `null` when the note could not be written.
	 */
	async createTask(init: NewTaskInit): Promise<string | null> {
		const title = init.title.trim() === "" ? strings.board.untitledTask : init.title.trim();
		const seed: Task = {
			path: "",
			title,
			status: init.status,
			priority: init.priority ?? "none",
			level: init.level,
			period: init.period,
			parent: init.parent ?? null,
			order: init.order ?? this.appendOrderKey(init.level, init.period, init.status),
			tags: init.tags ?? [],
			bodyTags: [],
			due: init.due ?? null,
			created: today(),
			completed: null,
			carriedFrom: null,
			framework: normalizeFramework(init.framework),
		};
		return this.writeNewNote(seed, init.body ?? "");
	}

	/**
	 * Copies a task note, body and all, into the same horizon folder.
	 *
	 * The copy is a sibling rather than a child: duplicating is a way to save work,
	 * not to build a hierarchy, so the parent link is deliberately not carried
	 * over twice - the copy keeps the original's parent.
	 *
	 * @returns The new path, or `null` when it could not be written.
	 */
	async duplicateTask(path: string): Promise<string | null> {
		const task = this.tasksByPath.get(path);
		const file = this.app.vault.getFileByPath(path);
		if (task === undefined || file === null) {
			return null;
		}

		let body = "";
		try {
			body = stripFrontmatter(await this.app.vault.cachedRead(file));
		} catch (error) {
			warn(`Could not read ${path} while duplicating`, error);
		}

		return this.writeNewNote(
			{
				...task,
				path: "",
				title: `${task.title} ${strings.board.copySuffix}`,
				order: this.appendOrderKey(task.level, task.period, task.status),
				created: today(),
				completed: null,
				carriedFrom: null,
			},
			body,
		);
	}

	/**
	 * Reads a task's note text.
	 *
	 * The index deliberately never reads note bodies - they are not needed to put
	 * a card on a board - so the form asks for the text itself, and only when it
	 * is about to show it.
	 */
	async readBody(path: string): Promise<string> {
		const file = this.app.vault.getFileByPath(path);
		if (file === null) {
			return "";
		}
		try {
			return stripFrontmatter(await this.app.vault.cachedRead(file));
		} catch (error) {
			warn(`Could not read the body of ${path}`, error);
			return "";
		}
	}

	/**
	 * Replaces a task's note text, leaving its frontmatter exactly as it was.
	 *
	 * The frontmatter block is copied through as raw text rather than written
	 * field by field, so editing the body can never drop, reorder or reformat a
	 * key. Pending frontmatter changes are flushed first, because both writes
	 * touch the same file.
	 */
	async writeBody(path: string, body: string): Promise<void> {
		await this.flush();
		const file = this.app.vault.getFileByPath(path);
		if (file === null) {
			new Notice(strings.notices.writeFailed);
			return;
		}
		try {
			const { frontmatter } = splitFrontmatter(await this.app.vault.read(file));
			const text = body.trim() === "" ? frontmatter : `${frontmatter}${body}`;
			await this.app.vault.modify(file, text);
		} catch (error) {
			logError(`Failed to write the body of ${path}`, error);
			new Notice(strings.notices.writeFailed);
		}
	}

	/**
	 * Moves a task's note into the folder its horizon calls for.
	 *
	 * `FileManager.renameFile` is used rather than `Vault.rename` because it also
	 * rewrites every wikilink that points at the note, so parent links and
	 * backlinks survive the move with nothing broken behind them.
	 *
	 * @returns The new path, or `null` when the note was already in place or the
	 * move failed.
	 */
	async moveToLevelFolder(path: string): Promise<string | null> {
		const task = this.tasksByPath.get(path);
		const file = this.app.vault.getFileByPath(path);
		if (task === undefined || file === null) {
			return null;
		}

		const layout = this.options.folderLayout();
		const target = correctedPathFor(layout, path, task.level);
		if (target === null) {
			return null;
		}

		try {
			await this.ensureFolder(folderForLevel(layout, task.level));
			await this.app.fileManager.renameFile(file, target);
		} catch (error) {
			logError(`Failed to move ${path} to ${target}`, error);
			new Notice(strings.notices.moveFailed);
			return null;
		}

		return target;
	}

	/**
	 * Moves an archived note into the archive folder for its horizon.
	 *
	 * The archive mirrors the level folders one for one - `Archive/Daily`,
	 * `Archive/Weekly` and so on - so archiving keeps the horizon on the note
	 * instead of flattening everything into one heap.
	 *
	 * @returns The new path, or `null` when the note is already filed there or the
	 * move failed.
	 */
	async moveToArchiveFolder(path: string): Promise<string | null> {
		const task = this.tasksByPath.get(path);
		const file = this.app.vault.getFileByPath(path);
		if (task === undefined || file === null) {
			return null;
		}

		const layout = this.options.folderLayout();
		const folder = archiveFolderForLevel(layout, task.level);
		const name = path.slice(path.lastIndexOf("/") + 1);
		if (path.slice(0, path.lastIndexOf("/") + 1) === folder) {
			return null;
		}
		const target = `${folder}${name}`;

		try {
			await this.ensureFolder(folder);
			await this.app.fileManager.renameFile(file, target);
		} catch (error) {
			logError(`Failed to archive ${path} to ${target}`, error);
			new Notice(strings.notices.moveFailed);
			return null;
		}

		return target;
	}

	/**
	 * Re-reads every task.
	 *
	 * Needed after a settings change that alters the layout, because whether a
	 * note is in the wrong folder is worked out when it is indexed.
	 */
	refresh(): void {
		this.rescan();
	}

	/**
	 * Moves a task note to the trash, honouring the user's trash preference.
	 *
	 * @returns Whether the note was trashed.
	 */
	async deleteTask(path: string): Promise<boolean> {
		const file = this.app.vault.getFileByPath(path);
		if (file === null) {
			this.forget(path);
			return true;
		}
		try {
			await this.app.fileManager.trashFile(file);
			this.forget(path);
			return true;
		} catch (error) {
			logError(`Failed to trash ${path}`, error);
			new Notice(strings.notices.deleteFailed);
			return false;
		}
	}

	/** Writes every pending change immediately. */
	async flush(): Promise<void> {
		this.cancelFlush();
		const paths = [...this.dirtyPaths];
		this.dirtyPaths.clear();
		if (paths.length === 0) {
			return;
		}
		await Promise.all(paths.map((path) => this.persist(path)));
		this.notify();
	}

	/** Cancels pending work; the caller flushes first if it cares about them. */
	dispose(): void {
		this.cancelFlush();
		this.listeners.clear();
	}

	private rescan(): void {
		for (const file of this.app.vault.getMarkdownFiles()) {
			this.indexFile(file);
		}
		// Drop tasks for notes that no longer exist (deleted while unloaded).
		const present = new Set(this.app.vault.getMarkdownFiles().map((file) => file.path));
		for (const path of [...this.tasksByPath.keys()]) {
			if (!present.has(path)) {
				this.tasksByPath.delete(path);
			}
		}
		this.notify();
	}

	private indexFile(file: TFile, cache?: CachedMetadata): void {
		if (file.extension !== "md") {
			return;
		}
		// Never clobber optimistic changes that have not been written yet.
		if (this.dirtyPaths.has(file.path)) {
			return;
		}

		const metadata = cache ?? this.app.metadataCache.getFileCache(file);
		const inlineTags = (metadata?.tags ?? []).map((tag) => tag.tag);
		const outcome = readTask(file.path, metadata?.frontmatter, inlineTags, {
			fallbackStatus: this.options.fallbackStatus,
		});

		switch (outcome.kind) {
			case "not-a-task":
				this.tasksByPath.delete(file.path);
				this.problemsByPath.delete(file.path);
				break;
			case "unusable":
				this.tasksByPath.delete(file.path);
				this.problemsByPath.set(file.path, [outcome.problem]);
				break;
			case "task": {
				this.tasksByPath.set(file.path, outcome.task);
				const problems = [...outcome.problems];
				// A note is filed by hand, so it can sit in the wrong folder. That is
				// reported, never corrected silently: moving a user's file while they
				// are not looking is exactly the kind of surprise this plugin avoids.
				// Archived notes are exempt: the sweep files them under `Archive/`, so
				// flagging that as wrong would make the archive report itself.
				const layout = this.options.folderLayout();
				if (
					outcome.task.archived !== true &&
					isFolderMismatch(layout, file.path, outcome.task.level)
				) {
					problems.push({
						path: file.path,
						kind: "folder-mismatch",
						expectedFolder: folderForLevel(layout, outcome.task.level),
					});
				}

				if (problems.length === 0) {
					this.problemsByPath.delete(file.path);
				} else {
					this.problemsByPath.set(file.path, problems);
				}
				break;
			}
		}
		this.notify();
	}

	/** Removes a path from the store and from the pending bookkeeping. */
	private forget(path: string): void {
		const had = this.tasksByPath.delete(path);
		this.problemsByPath.delete(path);
		this.dirtyPaths.delete(path);
		this.pendingKeys.delete(path);
		if (had) {
			this.notify();
		}
	}

	private markDirty(path: string, keys: readonly TaskFieldKey[]): void {
		this.dirtyPaths.add(path);
		const pending = this.pendingKeys.get(path) ?? new Set<TaskFieldKey>();
		for (const key of keys) {
			pending.add(key);
		}
		this.pendingKeys.set(path, pending);
		this.scheduleFlush();
	}

	private scheduleFlush(): void {
		if (this.flushTimer !== null) {
			return;
		}
		this.flushTimer = window.setTimeout(() => {
			this.flushTimer = null;
			void this.flush();
		}, this.writeDebounceMs);
	}

	private cancelFlush(): void {
		if (this.flushTimer !== null) {
			window.clearTimeout(this.flushTimer);
			this.flushTimer = null;
		}
	}

	private async persist(path: string): Promise<void> {
		const task = this.tasksByPath.get(path);
		const keys = this.pendingKeys.get(path);
		this.pendingKeys.delete(path);
		if (task === undefined) {
			return;
		}
		const file = this.app.vault.getFileByPath(path);
		if (file === null) {
			// The note is gone; drop it rather than resurrecting it.
			this.tasksByPath.delete(path);
			return;
		}

		try {
			await this.app.fileManager.processFrontMatter(file, (frontmatter: unknown) => {
				applyTaskFields(asRecord(frontmatter), task, keys === undefined ? undefined : [...keys]);
			});
		} catch (error) {
			logError(`Failed to write ${path}`, error);
			new Notice(strings.notices.writeFailed);
			// Roll the visual state back to whatever is actually on disk.
			this.indexFile(file);
		}
	}

	/**
	 * Appends a new card to the end of its column.
	 *
	 * The order key is derived from the current maximum, so it sorts after
	 * every existing card without touching their keys.
	 */
	private appendOrderKey(level: Level, period: string | null, statusId: string): string {
		let max: string | null = null;
		for (const task of this.tasksByPath.values()) {
			const sameColumn =
				task.status === statusId && task.level === level && task.period === period;
			if (sameColumn && (max === null || task.order > max)) {
				max = task.order;
			}
		}
		return generateKeyBetween(max, null);
	}

	/**
	 * Writes a brand new note, into the folder its horizon calls for.
	 *
	 * The path is derived from the level and the title, never from a folder the
	 * caller picked, which is what guarantees a task can never be created in the
	 * wrong place.
	 */
	private async writeNewNote(seed: Task, body: string): Promise<string | null> {
		const layout = this.options.folderLayout();
		const path = this.uniquePathFor(seed.title, seed.level);
		const task: Task = { ...seed, path };

		try {
			await this.ensureFolder(folderForLevel(layout, seed.level));
			const file = await this.app.vault.create(path, buildTaskFileContent(task, body));
			// Show it straight away; the cache event will confirm it moments later.
			this.tasksByPath.set(file.path, { ...task, path: file.path });
			this.problemsByPath.delete(file.path);
			this.notify();
			return file.path;
		} catch (error) {
			logError(`Failed to create ${path}`, error);
			new Notice(strings.notices.createFailed);
			return null;
		}
	}

	/** Creates a folder path, including any missing parents. */
	private async ensureFolder(folder: string): Promise<void> {
		let current = "";
		for (const segment of folder.split("/")) {
			if (segment === "") {
				continue;
			}
			current = current === "" ? segment : `${current}/${segment}`;
			if (this.app.vault.getAbstractFileByPath(current) !== null) {
				continue;
			}
			try {
				await this.app.vault.createFolder(current);
			} catch (error) {
				// Racing another writer is harmless: the folder exists either way.
				warn(`Could not create folder ${current}`, error);
			}
		}
	}

	/** A free path for a new note, never overwriting an existing file. */
	private uniquePathFor(title: string, level: Level): string {
		const folder = folderForLevel(this.options.folderLayout(), level);
		const base = toNoteFileName(title, strings.board.untitledTask);
		let path = normalizePath(`${folder}${base}.md`);
		for (let counter = 2; this.app.vault.getAbstractFileByPath(path) !== null; counter++) {
			path = normalizePath(`${folder}${base} ${String(counter)}.md`);
		}
		return path;
	}

	private notify(): void {
		for (const listener of this.listeners) {
			listener();
		}
	}
}
