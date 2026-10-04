import { ConfirmationModal, Modal, Setting, type App, type ButtonComponent } from "obsidian";

import {
	applyLevelChange,
	basename,
	changedFields,
	draftFromTask,
	formatTagInput,
	isDraftSaveable,
	isLevel,
	isPriority,
	parentCandidates,
	parseTagInput,
	FRAMEWORK_LAYERS,
	validateDraft,
	type DraftContext,
	type DraftIssue,
	type Level,
	type LevelChangeNote,
	type Task,
	type TaskDraft,
	type TaskEditKey,
} from "../domain";
import { warn } from "../log";
import type { TaskFlowSettings } from "../settings";
import { strings } from "../strings";
import { formatTemplate } from "../util/text";
import { ParentPickerModal } from "./parent-picker";

/** Everything the task form needs. */
export interface TaskModalParams {
	app: App;
	/** Existing task to edit; omitted when creating a new one. */
	task?: Task;
	/** Defaults for a new task, normally the board's horizon and period. */
	initial?: Partial<TaskDraft>;
	context: DraftContext;
	settings: TaskFlowSettings;
	/**
	 * Reads the note's text, for the details column.
	 *
	 * Only used when editing. The index deliberately never reads note bodies, so
	 * the text is fetched when the form opens and not a moment sooner.
	 */
	loadBody?: (path: string) => Promise<string>;
	/** Opens the note being edited; drives the footer's Open note action. */
	openNote?: (path: string) => void;
	/** Deletes the note being edited; the form asks before calling this. */
	onDelete?: (path: string) => void;
	/**
	 * Persists the result.
	 *
	 * `changed` lists what actually moved, and includes `"body"` when the note
	 * text was edited. A new task ignores it: everything is written anyway.
	 */
	onSubmit: (draft: TaskDraft, changed: readonly TaskEditKey[]) => Promise<void>;
}

/**
 * The task form, used for both creating and editing.
 *
 * Everything it decides is delegated: validation, parent candidates and the
 * repair work a horizon change needs all live in `domain/task-edit.ts`, which is
 * unit tested. This class is the form around those rules, which is why it can be
 * thin enough to be read in one go.
 *
 * The layout is two columns: the frontmatter fields on the left, the note's own
 * text on the right. The body is the only part of the form that is not
 * frontmatter, and it is treated accordingly - written through its own call, and
 * loaded only when the form is opened for an existing task.
 */
export class TaskModal extends Modal {
	private readonly params: TaskModalParams;
	private readonly original: TaskDraft;
	private draft: TaskDraft;
	/** Consequences of the last horizon change, shown until the next one. */
	private notes: readonly LevelChangeNote[] = [];

	private periodSetting: Setting | null = null;
	private parentValueEl: HTMLElement | null = null;
	private notesEl: HTMLElement | null = null;
	private issuesEl: HTMLElement | null = null;
	private saveButton: ButtonComponent | null = null;
	/** Whether the user has typed into the body, which beats a late load. */
	private bodyTouched = false;

	constructor(params: TaskModalParams) {
		super(params.app);
		this.params = params;
		this.original =
			params.task === undefined ? newDraft(params.initial) : draftFromTask(params.task);
		// `framework` and `tags` are cloned: the form mutates them in place, and a
		// shared reference would make the change invisible to `changedFields`.
		this.draft = {
			...this.original,
			tags: [...this.original.tags],
			framework: { ...this.original.framework },
		};
	}

	override onOpen(): void {
		this.modalEl.addClass("task-flow-task-modal");
		this.setTitle(
			this.params.task === undefined ? strings.task.createTitle : strings.task.editTitle,
		);
		this.render();
	}

	private get isNew(): boolean {
		return this.params.task === undefined;
	}

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("task-flow-task-modal");

		// Two columns: everything that ends up in frontmatter on the left, the
		// note's own text on the right.
		const form = contentEl.createDiv({ cls: "task-flow-form" });
		const main = form.createDiv({ cls: "task-flow-form-main" });
		const details = form.createDiv({ cls: "task-flow-form-details" });
		const task = this.params.task;

		const label = (parent: HTMLElement, text: string): void => {
			parent.createDiv({ cls: "task-flow-form-label", text });
		};

		label(main, strings.task.title.name);
		// The title is the one field that always matters, so it gets a full-width
		// input of its own instead of a label/control row.
		const titleInput = main.createEl("input", {
			cls: "task-flow-form-title",
			attr: {
				type: "text",
				placeholder: strings.task.titlePlaceholder,
				"aria-label": strings.task.title.name,
				value: this.draft.title,
			},
		});
		titleInput.addEventListener("input", () => {
			this.draft.title = titleInput.value;
			this.refresh();
		});
		main.createEl("p", {
			cls: "task-flow-form-hint",
			text: this.isNew ? strings.task.introCreate : strings.task.introEdit,
		});
		if (this.isNew) {
			window.setTimeout(() => {
				titleInput.focus();
			}, 0);
		}

		const fields = main.createDiv({ cls: "task-flow-form-rows" });

		// Tags lead: on a board they are the quickest way to say what a card is
		// about, so they sit directly under the title.
		new Setting(fields)
			.setName(strings.task.tags.name)
			.setDesc(strings.task.tags.desc)
			.addText((text) => {
				text
					.setValue(formatTagInput(this.draft.tags))
					.setPlaceholder(strings.task.tags.placeholder)
					.onChange((value) => {
						this.draft.tags = parseTagInput(value);
						this.refresh();
					});
			});

		new Setting(fields).setName(strings.task.status.name).addDropdown((dropdown) => {
			for (const status of this.params.context.registries[this.draft.level]) {
				dropdown.addOption(status.id, status.label);
			}
			dropdown.setValue(this.draft.status).onChange((value) => {
				this.draft.status = value;
				this.refresh();
			});
		});

		new Setting(fields).setName(strings.task.priority.name).addDropdown((dropdown) => {
			for (const priority of this.params.settings.enabledPriorities) {
				dropdown.addOption(priority, strings.priorities[priority]);
			}
			dropdown.setValue(this.draft.priority).onChange((value) => {
				if (isPriority(value)) {
					this.draft.priority = value;
					this.refresh();
				}
			});
		});

		new Setting(fields).setName(strings.task.level.name).addDropdown((dropdown) => {
			for (const level of this.params.settings.enabledLevels) {
				dropdown.addOption(level, strings.levels[level]);
			}
			dropdown.setValue(this.draft.level).onChange((value) => {
				if (isLevel(value)) {
					this.changeLevel(value);
				}
			});
		});

		// Objectives are not time bound, so they have no period field at all.
		if (this.draft.level !== "objective") {
			this.periodSetting = new Setting(fields)
				.setName(strings.task.period.name)
				.addText((text) => {
					text.setValue(this.draft.period ?? "").onChange((value) => {
						const trimmed = value.trim();
						this.draft.period = trimmed === "" ? null : trimmed;
						this.refresh();
					});
				});
		} else {
			this.periodSetting = null;
		}

		new Setting(fields)
			.setName(strings.task.due.name)
			.setDesc(strings.task.due.desc)
			.addText((text) => {
				text.setValue(this.draft.due ?? "").onChange((value) => {
					const trimmed = value.trim();
					this.draft.due = trimmed === "" ? null : trimmed;
					this.refresh();
				});
			});

		const parentSetting = new Setting(fields).setName(strings.task.parent.name);
		parentSetting
			.addButton((button) => {
				button.setButtonText(strings.task.parent.choose).onClick(() => {
					this.chooseParent();
				});
			})
			.addButton((button) => {
				button.setButtonText(strings.task.parent.clear).onClick(() => {
					this.draft.parent = null;
					this.refresh();
				});
			});
		// The current link belongs with its label rather than in the button row:
		// the buttons are actions, the value is state.
		this.parentValueEl = parentSetting.nameEl.createDiv({ cls: "task-flow-parent-value" });

		this.notesEl = main.createDiv({ cls: "task-flow-modal-notes" });
		this.issuesEl = main.createDiv({ cls: "task-flow-modal-issues" });

		if (!this.isNew && this.params.task !== undefined) {
			const info = main.createDiv({ cls: "task-flow-info" });
			label(info, strings.task.information);
			const row = (name: string, value: string): void => {
				const line = info.createDiv({ cls: "task-flow-info-row" });
				line.createSpan({ cls: "task-flow-info-label", text: name });
				line.createSpan({ cls: "task-flow-info-value", text: value });
			};
			row(strings.task.noteLabel, this.params.task.path);
			if (this.params.task.created !== null) {
				row(strings.task.createdLabel, this.params.task.created);
			}
		}

		label(details, strings.task.detailsHeading);
		const bodyArea = details.createEl("textarea", {
			cls: "task-flow-form-body",
			attr: {
				"aria-label": strings.task.body.name,
				placeholder: strings.task.body.placeholder,
			},
		});
		bodyArea.value = this.draft.body;
		bodyArea.addEventListener("input", () => {
			this.bodyTouched = true;
			this.draft.body = bodyArea.value;
		});
		details.createEl("p", {
			cls: "task-flow-form-hint",
			text: this.isNew ? strings.task.body.desc : strings.task.body.editDesc,
		});
		if (!this.isNew && task !== undefined) {
			void this.loadBodyInto(bodyArea, task.path);
		}

		this.renderFramework(form);

		const footer = contentEl.createDiv({ cls: "task-flow-modal-footer" });
		const footerStart = footer.createDiv({ cls: "task-flow-modal-footer-start" });
		if (!this.isNew && task !== undefined && this.params.openNote !== undefined) {
			const openButton = footerStart.createEl("button", {
				cls: "task-flow-modal-open",
				text: strings.task.openNote,
				attr: { type: "button" },
			});
			openButton.addEventListener("click", () => {
				this.params.openNote?.(task.path);
			});
		}
		if (!this.isNew && task !== undefined && this.params.onDelete !== undefined) {
			const deleteButton = footerStart.createEl("button", {
				cls: "mod-warning task-flow-modal-delete",
				text: strings.task.delete,
				attr: { type: "button" },
			});
			deleteButton.addEventListener("click", () => {
				this.confirmDelete(task.path);
			});
		}

		const footerEnd = footer.createDiv({ cls: "task-flow-modal-footer-end" });
		new Setting(footerEnd)
			.addButton((button) => {
				button.setButtonText(strings.task.cancel).onClick(() => {
					this.close();
				});
			})
			.addButton((button) => {
				this.saveButton = button;
				button
					.setButtonText(this.isNew ? strings.task.create : strings.task.save)
					.setCta()
					.onClick(() => {
						void this.submit();
					});
			});

		this.refresh();
	}

	/**
	 * Asks before deleting, then closes the form.
	 *
	 * The note goes to the trash rather than being destroyed, which the dialog
	 * says, because other tasks may be linking to it.
	 */
	private confirmDelete(path: string): void {
		const remove = this.params.onDelete;
		if (remove === undefined) {
			return;
		}
		const modal = new ConfirmationModal(this.app);
		modal.setTitle(strings.notices.deleteTitle);
		modal.contentEl.createEl("p", { text: strings.notices.deleteBody });
		modal.addButton((button) => {
			button
				.setButtonText(strings.notices.deleteConfirm)
				.setDestructive()
				.onClick(() => {
					this.close();
					remove(path);
				});
		});
		modal.addCancelButton(strings.task.cancel);
		modal.open();
	}

	/**
	 * The goal/execution framework: two layers of six terms.
	 *
	 * Only an objective gets one, so the section appears and disappears with the
	 * horizon. Nothing here is required: a half-filled framework is valid, and an
	 * empty one is simply absent from the note.
	 */
	private renderFramework(parent: HTMLElement): void {
		if (this.draft.level !== "objective") {
			return;
		}

		const section = parent.createDiv({ cls: "task-flow-framework" });
		section.createDiv({
			cls: "task-flow-form-label",
			text: strings.task.framework.heading,
		});
		section.createEl("p", {
			cls: "task-flow-form-hint",
			text: strings.task.framework.intro,
		});

		const layers = section.createDiv({ cls: "task-flow-framework-layers" });
		for (const { layer, terms } of FRAMEWORK_LAYERS) {
			const block = layers.createDiv({ cls: "task-flow-framework-layer" });
			block.createDiv({
				cls: "task-flow-framework-layer-title",
				text: strings.task.framework.layers[layer],
			});

			for (const term of terms) {
				new Setting(block)
					.setName(strings.task.framework.terms[term].name)
					.setDesc(strings.task.framework.terms[term].desc)
					.addTextArea((area) => {
						area.setValue(this.draft.framework[term] ?? "").onChange((value) => {
							// Stored raw so a trailing space survives typing; the draft is
							// normalised when the note is written.
							this.draft.framework[term] = value;
						});
					});
			}
		}
	}

	/**
	 * Fills the body field once the note has been read.
	 *
	 * The read is asynchronous, so the user can start typing before it lands. When
	 * that happens the typed text wins and the loaded text is dropped: replacing
	 * what someone is actively writing is the one thing this must never do.
	 */
	private async loadBodyInto(area: HTMLTextAreaElement, path: string): Promise<void> {
		const loader = this.params.loadBody;
		if (loader === undefined) {
			return;
		}
		try {
			const body = await loader(path);
			if (this.bodyTouched) {
				return;
			}
			this.original.body = body;
			this.draft.body = body;
			area.value = body;
		} catch (error) {
			warn(`Could not load the body of ${path}`, error);
		}
	}

	/**
	 * Applies a horizon change, then re-renders: the period field appears,
	 * disappears or changes format, so the form has to be rebuilt around it.
	 */
	private changeLevel(level: Level): void {
		const result = applyLevelChange(
			this.draft,
			level,
			this.params.context,
			new Date(),
		);
		this.draft = result.draft;
		this.notes = result.notes;
		this.render();
	}

	private chooseParent(): void {
		const context = this.params.context;
		new ParentPickerModal(this.app, {
			candidates: parentCandidates(this.draft, context),
			registries: context.registries,
			enabledLevels: this.params.settings.enabledLevels,
			childLevel: this.draft.level,
			currentParent: this.draft.parent,
			onPick: (parent) => {
				// The picker hands back a ref; the form stores the shortest form of it
				// that still resolves uniquely.
				this.draft.parent = parent === null ? null : this.linkTargetFor(parent);
				this.refresh();
			},
		}).open();
	}

	/**
	 * Shortens a parent ref the way Obsidian itself writes one: the note name
	 * when it is unique in the vault, the full path otherwise.
	 */
	private linkTargetFor(target: string): string {
		const task = this.params.context.tasks.find(
			(candidate) => candidate.path === target || basename(candidate.path) === target,
		);
		if (task === undefined) {
			return target;
		}
		const name = basename(task.path);
		const sameName = this.params.context.tasks.filter(
			(candidate) => basename(candidate.path) === name,
		);
		return sameName.length === 1 ? name : task.path;
	}

	/** Re-validates and repaints only the parts that can change per keystroke. */
	private refresh(): void {
		const issues = validateDraft(this.draft, this.params.context);

		if (this.periodSetting !== null) {
			const format = strings.periodFormats[this.draft.level];
			this.periodSetting.setDesc(
				formatTemplate(strings.task.periodFormat, {
					format: format.format,
					example: format.example,
				}),
			);
		}

		const parentEl = this.parentValueEl;
		if (parentEl !== null) {
			parentEl.empty();
			parentEl.setText(this.draft.parent ?? strings.task.parent.none);
			if (this.draft.parent === null) {
				parentEl.addClass("is-empty");
			} else {
				parentEl.removeClass("is-empty");
			}
		}

		this.renderNotes();
		this.renderIssues(issues);

		this.saveButton?.setDisabled(!isDraftSaveable(issues));
	}

	private renderNotes(): void {
		const el = this.notesEl;
		if (el === null) {
			return;
		}
		el.empty();
		if (this.notes.length === 0) {
			return;
		}
		el.createDiv({ cls: "task-flow-modal-notes-title", text: strings.task.notesTitle });
		const list = el.createEl("ul");
		for (const note of this.notes) {
			list.createEl("li", {
				text: formatTemplate(strings.taskNotes[note.code], {
					level: strings.levels[this.draft.level],
					parent: note.parentTitle ?? "",
				}),
			});
		}
	}

	private renderIssues(issues: readonly DraftIssue[]): void {
		const el = this.issuesEl;
		if (el === null) {
			return;
		}
		el.empty();
		if (issues.length === 0) {
			return;
		}
		const errors = issues.filter((issue) => issue.severity === "error");
		if (errors.length > 0) {
			el.createDiv({
				cls: "task-flow-modal-issues-title",
				text: strings.task.issuesTitle,
			});
		}
		const list = el.createEl("ul");
		for (const issue of issues) {
			list.createEl("li", {
				cls: issue.severity === "warning" ? "is-warning" : "is-error",
				text: strings.taskIssues[issue.code],
			});
		}
	}

	private async submit(): Promise<void> {
		const issues = validateDraft(this.draft, this.params.context);
		if (!isDraftSaveable(issues)) {
			this.refresh();
			return;
		}
		const changed = changedFields(this.original, this.draft);
		if (!this.isNew && changed.length === 0) {
			this.close();
			return;
		}
		await this.params.onSubmit(this.draft, changed);
		this.close();
	}
}

/** Builds a draft for a new task from the caller's defaults. */
function newDraft(initial: Partial<TaskDraft> | undefined): TaskDraft {
	return {
		title: "",
		status: "",
		priority: "none",
		level: "daily",
		period: null,
		parent: null,
		tags: [],
		due: null,
		body: "",
		framework: {},
		...initial,
	};
}
