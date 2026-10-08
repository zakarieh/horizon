import { Modal, Setting, type App } from "obsidian";

import type { StatusDefinition } from "../domain";
import { strings } from "../strings";
import { formatTemplate } from "../util/text";

/**
 * The confirmation dialog shown before a status is deleted.
 *
 * Deleting a status rewrites task notes, so it is never done silently: the
 * dialog names the status, asks which status should take over its tasks, and
 * reports the choice back to the caller only when the user confirms.
 */
export class StatusDeleteModal extends Modal {
	private readonly status: StatusDefinition;
	private readonly targets: readonly StatusDefinition[];
	private readonly onConfirm: (replacementId: string) => void;
	private replacementId: string;

	/**
	 * @param app The host app.
	 * @param status The status about to be deleted.
	 * @param targets Statuses that may take over its tasks, best match first.
	 * @param onConfirm Called with the chosen replacement id on confirmation.
	 */
	constructor(
		app: App,
		status: StatusDefinition,
		targets: readonly StatusDefinition[],
		onConfirm: (replacementId: string) => void,
	) {
		super(app);
		this.status = status;
		this.targets = targets;
		this.onConfirm = onConfirm;
		this.replacementId = targets[0]?.id ?? "";
	}

	override onOpen(): void {
		this.setTitle(
			formatTemplate(strings.settings.statuses.deleteTitle, {
				label: this.status.label,
			}),
		);
		this.contentEl.createEl("p", { text: strings.settings.statuses.deleteBody });

		new Setting(this.contentEl)
			.setName(strings.settings.statuses.deleteReplacement)
			.addDropdown((dropdown) => {
				for (const target of this.targets) {
					dropdown.addOption(target.id, target.label);
				}
				dropdown.setValue(this.replacementId);
				dropdown.onChange((value) => {
					this.replacementId = value;
				});
			});

		new Setting(this.contentEl)
			.addButton((button) => {
				button
					.setButtonText(strings.settings.statuses.deleteCancel)
					.onClick(() => this.close());
			})
			.addButton((button) => {
				button
					.setButtonText(strings.settings.statuses.deleteConfirm)
					.setDestructive()
					.onClick(() => {
						this.onConfirm(this.replacementId);
						this.close();
					});
			});
	}

	override onClose(): void {
		this.contentEl.empty();
	}
}
