import { Menu, type App } from "obsidian";

import type { StatusDefinition } from "../../domain";
import { strings } from "../../strings";
import { formatTemplate } from "../../util/text";

/** Everything the card context menu needs to act. */
export interface CardMenuParams {
	app: App;
	/** Screen position to open at. */
	position: { x: number; y: number };
	/** Status the card is in now, so its entry can be ticked. */
	currentStatus: string;
	registry: readonly StatusDefinition[];
	onOpenNote: () => void;
	onEdit: () => void;
	onDelete: () => void;
	onMoveToStatus: (statusId: string) => void;
	onMoveToTop: () => void;
	onMoveToBottom: () => void;
	onChangeParent: () => void;
	onDuplicate: () => void;
	onCopyLink: () => void;
}

/**
 * The card's context menu.
 *
 * This is the non-drag path, and deliberately a full peer of dragging rather
 * than a degraded fallback: it works on every device, needs no gesture, and is
 * reachable by keyboard through the actions button on a card. Dragging can be
 * unreliable on a touch device or impossible for a user who cannot hold a
 * pointer down, so nothing may be reachable *only* by dragging.
 *
 * Statuses are listed flat instead of in a submenu, so moving a card is one
 * click, and the card's current column is ticked and disabled.
 */
export function showCardMenu(params: CardMenuParams): void {
	const menu = new Menu();

	menu.addItem((item) => {
		item.setTitle(strings.board.openNote).setIcon("file-text").onClick(() => {
			params.onOpenNote();
		});
	});
	menu.addItem((item) => {
		item.setTitle(strings.board.editTask).setIcon("pencil").onClick(() => {
			params.onEdit();
		});
	});
	menu.addItem((item) => {
		item.setTitle(strings.board.changeParent).setIcon("git-branch").onClick(() => {
			params.onChangeParent();
		});
	});

	menu.addSeparator();

	for (const status of params.registry) {
		const isCurrent = status.id === params.currentStatus;
		menu.addItem((item) => {
			item.setTitle(
				formatTemplate(strings.board.moveToStatus, { status: status.label }),
			)
				.setIcon("arrow-right")
				.setChecked(isCurrent)
				.setDisabled(isCurrent)
				.onClick(() => {
					params.onMoveToStatus(status.id);
				});
		});
	}

	menu.addSeparator();

	menu.addItem((item) => {
		item.setTitle(strings.board.moveToTop).setIcon("arrow-up").onClick(() => {
			params.onMoveToTop();
		});
	});
	menu.addItem((item) => {
		item.setTitle(strings.board.moveToBottom).setIcon("arrow-down").onClick(() => {
			params.onMoveToBottom();
		});
	});

	menu.addSeparator();

	menu.addItem((item) => {
		item.setTitle(strings.board.duplicateTask).setIcon("copy").onClick(() => {
			params.onDuplicate();
		});
	});
	menu.addItem((item) => {
		item.setTitle(strings.board.copyLink).setIcon("link").onClick(() => {
			params.onCopyLink();
		});
	});

	menu.addSeparator();

	// Last, and visually set apart: deleting is the only destructive action here.
	menu.addItem((item) => {
		item.setTitle(strings.board.deleteTask).setIcon("trash").onClick(() => {
			params.onDelete();
		});
	});

	menu.showAtPosition(params.position);
}
