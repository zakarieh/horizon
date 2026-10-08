/**
 * The task panel shown at the top of a task's note (reading view).
 *
 * The task's fields live in frontmatter, which Obsidian shows as a table of
 * properties - true, but cluttered by the keys the plugin keeps for itself. This
 * renders the fields the user actually filled in, plus an objective's
 * goal/execution framework, as one panel, so opening the note is enough to read
 * the task. Which framework terms appear is decided by `frameworkSections`; this
 * file only draws what is there.
 */

import {
	findStatus,
	frameworkSections,
	normalizeFramework,
	parseLinkRef,
	tagBaseColor,
	type ObjectiveFramework,
	type StatusDefinition,
	type StatusRegistries,
	type TagColors,
	type Task,
} from "../domain";
import { strings } from "../strings";
import { asRecord } from "../util/records";

/** Marks the panel, and is what stops it being added twice. */
export const NOTE_PANEL_CLASS = "task-flow-note-panel";

/** One labelled row in the panel. */
export interface NotePanelField {
	label: string;
	value: string;
}

/** Everything the panel draws. Empty entries are never rendered. */
export interface NotePanelData {
	fields: readonly NotePanelField[];
	tags: readonly string[];
	/** Colour overrides for tags, so a pinned tag keeps its colour here too. */
	tagColors: TagColors;
	framework: ObjectiveFramework;
}

/**
 * Builds a panel's data from a task.
 *
 * Only fields with a value are returned: an absent due date or a `none` priority
 * is the default, not information, so it is left out rather than shown as a row
 * of dashes. `registry` must be the task's own board registry, because statuses
 * are per board.
 */
export function taskPanelData(
	task: Task,
	registry: readonly StatusDefinition[],
	tagColors: TagColors = {},
): NotePanelData {
	const fields: NotePanelField[] = [
		{
			label: strings.note.fields.status,
			value: findStatus(registry, task.status)?.label ?? task.status,
		},
	];
	if (task.priority !== "none") {
		fields.push({
			label: strings.note.fields.priority,
			value: strings.priorities[task.priority],
		});
	}
	fields.push({ label: strings.note.fields.level, value: strings.levels[task.level] });
	if (task.period !== null) {
		fields.push({ label: strings.note.fields.period, value: task.period });
	}
	if (task.parent !== null) {
		fields.push({
			label: strings.note.fields.parent,
			value: parseLinkRef(task.parent) ?? task.parent,
		});
	}
	if (task.created !== null) {
		fields.push({ label: strings.note.fields.created, value: task.created });
	}
	if (task.completed !== null) {
		fields.push({ label: strings.note.fields.completed, value: task.completed });
	}
	return { fields, tags: [...task.tags], tagColors, framework: task.framework ?? {} };
}

/**
 * The panel data for a note.
 *
 * A task is read from the index, so its status label and parent resolve against
 * the same data the boards see. A note that is not a task falls back to its raw
 * frontmatter, which is where a hand-written objective's `framework` lives.
 *
 * The reading-view post-processor and the live-preview extension share this, so
 * both surfaces agree on what a note shows.
 */
export function notePanelDataFor(
	frontmatter: unknown,
	task: Task | undefined,
	registries: StatusRegistries,
	tagColors: TagColors = {},
): NotePanelData {
	if (task !== undefined) {
		return taskPanelData(task, registries[task.level], tagColors);
	}
	return {
		fields: [],
		tags: [],
		tagColors,
		framework: normalizeFramework(asRecord(frontmatter).framework),
	};
}

/**
 * Builds the panel.
 *
 * @returns The panel, or `null` when there is nothing to show - a task with no
 * extra fields and no framework is absent from the note rather than an empty box.
 */
export function buildNotePanel(data: NotePanelData): HTMLElement | null {
	const sections = frameworkSections(data.framework);
	const hasFields = data.fields.length > 0 || data.tags.length > 0;
	if (!hasFields && sections.length === 0) {
		return null;
	}

	const panel = createDiv({ cls: NOTE_PANEL_CLASS });

	if (hasFields) {
		panel.createDiv({ cls: "task-flow-note-panel-title", text: strings.note.heading });
		const list = panel.createEl("dl", { cls: "task-flow-note-fields" });
		for (const field of data.fields) {
			list.createEl("dt", { cls: "task-flow-note-field-label", text: field.label });
			list.createEl("dd", { cls: "task-flow-note-field-value", text: field.value });
		}
		if (data.tags.length > 0) {
			list.createEl("dt", {
				cls: "task-flow-note-field-label",
				text: strings.note.fields.tags,
			});
			const value = list.createEl("dd", {
				cls: "task-flow-note-field-value task-flow-note-tags",
			});
			// The chip's colour is the tag's own, so `#work` looks the same here as
			// on the board, whether it was pinned or left to its hashed hue.
			for (const tag of data.tags) {
				const chip = value.createSpan({ cls: "task-flow-tag", text: `#${tag}` });
				chip.style.setProperty("--tag-base", tagBaseColor(tag, data.tagColors));
			}
		}
	}

	if (sections.length > 0) {
		const framework = panel.createDiv({ cls: "task-flow-note-framework" });
		framework.createDiv({
			cls: "task-flow-note-panel-title",
			text: strings.task.framework.heading,
		});

		const layers = framework.createDiv({ cls: "task-flow-framework-layers" });
		for (const { layer, terms } of sections) {
			const block = layers.createDiv({ cls: "task-flow-framework-layer" });
			block.createDiv({
				cls: "task-flow-framework-layer-title",
				text: strings.task.framework.layers[layer],
			});

			const list = block.createEl("dl", { cls: "task-flow-framework-terms" });
			for (const term of terms) {
				list.createEl("dt", {
					cls: "task-flow-framework-term",
					text: strings.task.framework.terms[term].name,
				});
				// `text`, never markup: this is the user's own prose.
				list.createEl("dd", {
					cls: "task-flow-framework-value",
					text: data.framework[term] ?? "",
				});
			}
		}
	}

	return panel;
}
