import { Component, MarkdownRenderer, Modal, type App } from "obsidian";

import { buildGuideMarkdown } from "../guide";
import { strings } from "../strings";

/**
 * The in-app user guide, opened from the command palette or the settings tab.
 *
 * The guide is authored once as markdown and rendered here with Obsidian's own
 * renderer rather than being hand-built from DOM nodes. That means it inherits
 * the user's theme, fonts, code-block styling and table styling for free, and
 * it is one text document to review instead of a tree of `createEl` calls.
 *
 * Nothing is written to the vault: the guide is a read-only modal, so it is
 * available on mobile and leaves no note behind.
 */
export class GuideModal extends Modal {
	private readonly version: string;

	/**
	 * Owns whatever the markdown renderer registers (embedded components and
	 * the like). A dedicated child component means that state is released when
	 * the modal closes, rather than accumulating on the plugin.
	 */
	private readonly markdownOwner = new Component();

	/**
	 * @param app The host app.
	 * @param version Plugin version, shown so screenshots and bug reports can be
	 * matched to a release.
	 */
	constructor(app: App, version: string) {
		super(app);
		this.version = version;
	}

	override async onOpen(): Promise<void> {
		this.modalEl.addClass("task-flow-guide-modal");
		this.setTitle(strings.guide.title);

		this.markdownOwner.load();
		await MarkdownRenderer.render(
			this.app,
			buildGuideMarkdown(this.version),
			this.contentEl,
			"",
			this.markdownOwner,
		);
	}

	override onClose(): void {
		this.markdownOwner.unload();
		this.contentEl.empty();
	}
}
