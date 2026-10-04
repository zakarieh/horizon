import { SuggestModal, prepareFuzzySearch, type App, type SearchResult } from "obsidian";

import {
	basename,
	findStatus,
	formatPeriodLabel,
	parentFilterOptions,
	type Level,
	type StatusRegistries,
	type Task,
} from "../domain";
import { strings } from "../strings";
import { bestTextColorOn } from "../util/color";
import { formatTemplate } from "../util/text";

/**
 * One row of the picker: a candidate, or the offer to clear the link.
 *
 * Clearing is an explicit item rather than the empty query, so it can be
 * labelled and reached from the keyboard.
 */
type ParentChoice = { kind: "task"; task: Task } | { kind: "clear" };

/** Everything the picker needs; the caller does the filtering it can test. */
export interface ParentPickerOptions {
	/** Tasks that may legally be the parent, already filtered by the caller. */
	candidates: readonly Task[];
	/** Every board's statuses, for the colour chips in each row. */
	registries: StatusRegistries;
	/** Horizons the user has enabled on the board. */
	enabledLevels: readonly Level[];
	/** Horizon of the task being edited, which decides the filter chips. */
	childLevel: Level;
	/**
	 * Current parent ref as stored in frontmatter.
	 *
	 * A ref, not a wikilink: `parseLinkRef` strips the brackets on the way in,
	 * so this is what both the comparison and the write use.
	 */
	currentParent: string | null;
	/** Called with the new parent link, or `null` to clear it. */
	onPick: (parent: string | null) => void;
}

/**
 * Picks a parent for a task.
 *
 * A type-ahead over the candidates the caller already filtered, so the list can
 * only ever contain tasks on an allowed horizon - the rule lives in
 * `domain/task-edit.ts`, not here. The allowed horizons are offered as filter
 * chips, which with one folder per horizon are also the folders this task may
 * link to.
 *
 * Matching is Obsidian's own fuzzy search over the title, the note name and the
 * tags, and each row shows the horizon, the period, the status and the task's
 * own parent, because "Launch website" exists on several boards at once.
 *
 * The task being edited (and its descendants) never reach this list.
 */
export class ParentPickerModal extends SuggestModal<ParentChoice> {
	private readonly options: ParentPickerOptions;
	/** Horizons the user has narrowed to; empty means "all allowed". */
	private readonly selected = new Set<Level>();
	private readonly chipButtons = new Map<Level, HTMLButtonElement>();
	private allChip: HTMLButtonElement | null = null;

	constructor(app: App, options: ParentPickerOptions) {
		super(app);
		this.options = options;
		this.setPlaceholder(strings.parentPicker.placeholder);
		this.emptyStateText = strings.parentPicker.empty;
		this.limit = 50;
	}

	override onOpen(): void {
		// The base call fills the list; the chips are added on top of it.
		void super.onOpen();
		this.renderFilters();
	}

	/**
	 * Draws the horizon chips above the search box.
	 *
	 * Hidden when there is nothing to choose between: one allowed horizon is not
	 * a filter, and none at all means the empty state is the message.
	 */
	private renderFilters(): void {
		const filters = parentFilterOptions(
			this.options.childLevel,
			this.options.candidates,
			this.options.enabledLevels,
		);
		if (filters.length <= 1) {
			return;
		}

		const row = this.modalEl.createDiv({ cls: "task-flow-chip-row" });
		// Above the search box, so the chips read as the scope of the list below.
		this.modalEl.insertBefore(row, this.inputEl.parentElement);
		row.setAttribute("aria-label", strings.parentPicker.filterLabel);

		this.allChip = row.createEl("button", {
			cls: "task-flow-chip is-active",
			text: strings.parentPicker.allLevels,
			attr: { type: "button", "aria-pressed": "true" },
		});
		this.allChip.addEventListener("click", () => {
			this.selected.clear();
			this.refresh();
		});

		for (const filter of filters) {
			const button = row.createEl("button", {
				cls: "task-flow-chip",
				text: `${strings.levels[filter.level]} ${String(filter.count)}`,
				attr: { type: "button", "aria-pressed": "false" },
			});
			button.addEventListener("click", () => {
				if (this.selected.has(filter.level)) {
					this.selected.delete(filter.level);
				} else {
					this.selected.add(filter.level);
				}
				this.refresh();
			});
			this.chipButtons.set(filter.level, button);
		}
	}

	/** Redraws the chip states, then re-runs the search with the new scope. */
	private refresh(): void {
		this.applyChipState(this.allChip, this.selected.size === 0);
		for (const [level, button] of this.chipButtons) {
			this.applyChipState(button, this.selected.has(level));
		}
		// SuggestModal re-reads its query from this event, which is the only
		// public way to ask it to search again.
		this.inputEl.dispatchEvent(new Event("input"));
	}

	private applyChipState(button: HTMLButtonElement | null, active: boolean): void {
		if (button === null) {
			return;
		}
		button.setAttribute("aria-pressed", active ? "true" : "false");
		button.toggleClass("is-active", active);
	}

	override getSuggestions(query: string): ParentChoice[] {
		const pool = this.options.candidates.filter(
			(task) => this.selected.size === 0 || this.selected.has(task.level),
		);
		const needle = query.trim();

		const choices: ParentChoice[] = [];
		// Offered only before typing starts: a convenient first row when clearing
		// is the intent, but never what Enter picks in the middle of a search.
		if (needle === "" && this.options.currentParent !== null) {
			choices.push({ kind: "clear" });
		}
		if (needle === "") {
			return [...choices, ...pool.map((task): ParentChoice => ({ kind: "task", task }))];
		}

		const match = prepareFuzzySearch(needle);
		const scored: { task: Task; score: number }[] = [];
		for (const task of pool) {
			const results = [
				match(task.title),
				match(basename(task.path)),
				match(task.tags.map((tag) => `#${tag}`).join(" ")),
			].filter((result): result is SearchResult => result !== null);
			if (results.length === 0) {
				continue;
			}
			// Obsidian's fuzzy score is a distance: smaller is better, so the field
			// the query matched best is what ranks the row.
			const best = results.reduce((a, b) => (a.score <= b.score ? a : b));
			scored.push({ task, score: best.score });
		}
		scored.sort((a, b) => a.score - b.score);
		return [
			...choices,
			...scored.map((entry): ParentChoice => ({ kind: "task", task: entry.task })),
		];
	}

	override renderSuggestion(choice: ParentChoice, el: HTMLElement): void {
		if (choice.kind === "clear") {
			el.addClass("is-clear");
			el.createDiv({ cls: "task-flow-suggestion-title", text: strings.parentPicker.clear });
			return;
		}

		const { task } = choice;
		const name = basename(task.path);
		if (
			this.options.currentParent === task.path ||
			this.options.currentParent === name
		) {
			el.addClass("is-current");
			el.setAttribute(
				"aria-label",
				formatTemplate(strings.parentPicker.current, { title: task.title }),
			);
		}

		el.createDiv({ cls: "task-flow-suggestion-title", text: task.title });

		const badges = el.createDiv({ cls: "task-flow-suggestion-badges" });
		badges.createSpan({ cls: "task-flow-badge", text: strings.levels[task.level] });
		badges.createSpan({
			cls: "task-flow-suggestion-meta",
			text: formatPeriodLabel(task.period, task.level),
		});

		const status = findStatus(this.options.registries[task.level], task.status);
		if (status !== undefined) {
			const chip = badges.createSpan({ cls: "task-flow-status-chip", text: status.label });
			chip.style.backgroundColor = status.color;
			// Registry colours are the user's own, so the text colour is derived
			// from them rather than assumed.
			chip.style.color = bestTextColorOn(status.color);
		}

		if (task.parent !== null) {
			const parentTask = this.options.candidates.find(
				(candidate) =>
					candidate.path === task.parent || basename(candidate.path) === task.parent,
			);
			el.createDiv({
				cls: "task-flow-suggestion-meta",
				text: formatTemplate(strings.parentPicker.nestedUnder, {
					title: parentTask?.title ?? basename(task.parent),
				}),
			});
		}
	}

	override onChooseSuggestion(choice: ParentChoice): void {
		this.options.onPick(choice.kind === "clear" ? null : choice.task.path);
	}
}
