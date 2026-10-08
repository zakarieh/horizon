/**
 * The tag dropdown the task form attaches to its tag box.
 *
 * Obsidian's own input suggest, reused rather than reimplemented: it draws the
 * popover, filters as the user types and closes when the box loses focus, so
 * this class only decides what a tag looks like in the list and what picking one
 * means. It is multi-select because picking does not end the interaction - the
 * tag is handed to the form, the box is emptied and the list is reopened for the
 * next one.
 */

import { AbstractInputSuggest, type App } from "obsidian";

import { tagBaseColor, tagSuggestions, type TagColors } from "../domain";

/** What the picker needs from the form that owns it. */
export interface TagPickerOptions {
	/** Every tag that may be offered. */
	available: () => readonly string[];
	/** Tags already chosen, which are not offered again. */
	selected: () => readonly string[];
	/** Colour overrides, so a suggestion carries the tag's own colour. */
	tagColors: TagColors;
	/** Called with the tag when one is picked. */
	onPick: (tag: string) => void;
}

/**
 * A tag suggestion box: type to filter the tags the vault already uses, pick one
 * with the mouse or the keyboard.
 */
export class TagPicker extends AbstractInputSuggest<string> {
	private readonly options: TagPickerOptions;

	constructor(app: App, inputEl: HTMLInputElement, options: TagPickerOptions) {
		super(app, inputEl);
		this.options = options;
	}

	protected override getSuggestions(query: string): string[] {
		return tagSuggestions(this.options.available(), query, this.options.selected());
	}

	override renderSuggestion(tag: string, el: HTMLElement): void {
		el.addClass("task-flow-tag-suggestion");
		el.createSpan({ cls: "task-flow-tag-suggestion-dot" }).style.setProperty(
			"--tag-base",
			tagBaseColor(tag, this.options.tagColors),
		);
		el.createSpan({ text: `#${tag}` });
	}

	override selectSuggestion(tag: string): void {
		this.options.onPick(tag);
		// Multi-select: clearing and reopening the box is what lets the next tag be
		// typed or picked without another click.
		this.setValue("");
		this.open();
	}
}
