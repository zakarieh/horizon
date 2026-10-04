/**
 * The framework panel shown at the top of an objective's note.
 *
 * The framework lives in frontmatter, which Obsidian shows as a nested object -
 * readable only if you like YAML. This renders the same data as a panel in the
 * note's reading view, so opening the note is enough to read the goal. Which
 * terms to show is decided by `frameworkSections`; this file only draws them.
 */

import { frameworkIsEmpty, frameworkSections, type ObjectiveFramework } from "../domain";
import { strings } from "../strings";

/** Marks the panel, and is what stops it being added twice. */
export const FRAMEWORK_PANEL_CLASS = "task-flow-framework-panel";

/**
 * Builds the panel for a framework.
 *
 * @returns The panel, or `null` when there is nothing to show - an empty
 * framework is absent from the note rather than an empty box.
 */
export function buildFrameworkPanel(framework: ObjectiveFramework): HTMLElement | null {
	if (frameworkIsEmpty(framework)) {
		return null;
	}

	const panel = createDiv({ cls: FRAMEWORK_PANEL_CLASS });
	panel.createDiv({
		cls: "task-flow-framework-panel-title",
		text: strings.task.framework.heading,
	});

	const layers = panel.createDiv({ cls: "task-flow-framework-layers" });
	for (const { layer, terms } of frameworkSections(framework)) {
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
				text: framework[term] ?? "",
			});
		}
	}

	return panel;
}
