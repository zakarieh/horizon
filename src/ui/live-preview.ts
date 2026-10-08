/**
 * Live-preview rendering of the note panel.
 *
 * Obsidian's markdown post-processor only runs in Reading view, but notes open
 * in Live Preview by default - so an objective's Goal/execution framework would
 * be invisible until the reader switched modes. This registers a CodeMirror
 * extension that adds the same panel as a block widget just below the
 * frontmatter, so the Goal section is there the moment the note opens, in either
 * mode.
 *
 * CodeMirror forbids block widgets from a `ViewPlugin` ("Block decorations may
 * not be specified via plugins"), so the decoration is owned by a `StateField`
 * and the plugin only tracks the open editors, letting the plugin ask them to
 * rebuild when the metadata cache changes. Reading view still uses the
 * post-processor in `main.ts`; the two never overlap, because reading view does
 * not use a CodeMirror editor.
 */

import {
	StateEffect,
	StateField,
	type EditorState,
	type Extension,
	type Text,
} from "@codemirror/state";
import {
	Decoration,
	type DecorationSet,
	EditorView,
	ViewPlugin,
	WidgetType,
} from "@codemirror/view";
import { editorInfoField, editorLivePreviewField } from "obsidian";

import { warn } from "../log";
import type TaskFlowPlugin from "../main";
import { buildNotePanel, notePanelDataFor } from "./note-panel";

/** The DOM the widget shows; comparing it is how `eq` spots a real change. */
class NotePanelWidget extends WidgetType {
	constructor(private readonly dom: HTMLElement) {
		super();
	}

	override eq(other: WidgetType): boolean {
		return other instanceof NotePanelWidget && other.dom === this.dom;
	}

	override toDOM(): HTMLElement {
		return this.dom;
	}
}

/**
 * The position a block widget may sit at without landing inside Obsidian's own
 * frontmatter widget: the line just after the closing `---`, or 0 when the note
 * has no frontmatter.
 */
function afterFrontmatter(doc: Text): number {
	if (doc.lines < 2 || doc.line(1).text.trim() !== "---") {
		return 0;
	}
	for (let n = 2; n <= doc.lines; n++) {
		if (doc.line(n).text.trim() === "---") {
			return n < doc.lines ? doc.line(n + 1).from : doc.length;
		}
	}
	return 0;
}

/** What `main.ts` gets back: the extension to register and a way to refresh it. */
export interface NotePanelController {
	/** Register with `this.registerEditorExtension(...)`. */
	extension: Extension;
	/** Ask every open editor to rebuild its panel, e.g. after the cache changed. */
	refresh(): void;
}

/**
 * Builds the Live Preview panel extension for one plugin instance.
 *
 * Everything is guarded so a panel problem can never stop a note from opening:
 * `compute` swallows and logs its own errors and falls back to no decoration.
 */
export function createNotePanelExtension(plugin: TaskFlowPlugin): NotePanelController {
	const views = new Set<EditorView>();
	const refreshEffect = StateEffect.define<null>();
	// The last decorations built per file, so an unchanged panel is not rebuilt
	// (and its widget not re-measured) on every keystroke. The position is part of
	// the signature, so a frontmatter edit that shifts the widget rebuilds it.
	const cache = new Map<string, { signature: string; decorations: DecorationSet }>();

	const compute = (state: EditorState): DecorationSet => {
		try {
			if (state.field(editorLivePreviewField, false) !== true) {
				return Decoration.none;
			}
			const file = state.field(editorInfoField, false)?.file ?? null;
			if (file === null) {
				return Decoration.none;
			}

			const data = notePanelDataFor(
				plugin.app.metadataCache.getFileCache(file)?.frontmatter,
				plugin.tasks.getTask(file.path),
				plugin.settings.statuses,
			);
			const position = afterFrontmatter(state.doc);
			const signature = `${position}\u001f${JSON.stringify(data)}`;
			const cached = cache.get(file.path);
			if (cached !== undefined && cached.signature === signature) {
				return cached.decorations;
			}

			const dom = buildNotePanel(data);
			const decorations =
				dom === null
					? Decoration.none
					: Decoration.set([
							Decoration.widget({
								widget: new NotePanelWidget(dom),
								block: true,
								side: 1,
							}).range(position),
						]);
			cache.set(file.path, { signature, decorations });
			return decorations;
		} catch (error) {
			warn("Could not build the note panel", error);
			return Decoration.none;
		}
	};

	const field = StateField.define<DecorationSet>({
		create: (state) => compute(state),
		update: (value, tr) => {
			try {
				const liveChanged =
					tr.startState.field(editorLivePreviewField, false) !==
					tr.state.field(editorLivePreviewField, false);
				const fileChanged =
					tr.startState.field(editorInfoField, false)?.file?.path !==
					tr.state.field(editorInfoField, false)?.file?.path;
				if (
					tr.docChanged ||
					liveChanged ||
					fileChanged ||
					tr.effects.some((effect) => effect.is(refreshEffect))
				) {
					return compute(tr.state);
				}
				return value;
			} catch (error) {
				warn("Could not update the note panel", error);
				return value;
			}
		},
		provide: (value) => EditorView.decorations.from(value),
	});

	// A block widget may not come from a ViewPlugin, so this only tracks the open
	// editors; the StateField above owns the decoration itself.
	const tracker = ViewPlugin.fromClass(
		class {
			constructor(readonly view: EditorView) {
				views.add(view);
			}

			destroy(): void {
				views.delete(this.view);
			}
		},
	);

	return {
		extension: [field, tracker],
		refresh: () => {
			for (const view of views) {
				try {
					view.dispatch({ effects: refreshEffect.of(null) });
				} catch (error) {
					warn("Could not refresh the note panel", error);
				}
			}
		},
	};
}
