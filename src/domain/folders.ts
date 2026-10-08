/**
 * Folder-per-level storage.
 *
 * A task's `level` frontmatter field is the source of truth; the folder is
 * derived from it, never the other way around. That ordering is what makes the
 * layout safe to change and what lets the plugin tell the user when a file has
 * been dropped in the wrong place instead of quietly disagreeing with them.
 *
 * Pure: no vault access, so every path rule is unit tested.
 */

import { toNoteFileName } from "./paths";
import { LEVELS, type Level } from "./types";

/** Default folder name per horizon. */
export const DEFAULT_LEVEL_FOLDER_NAMES: Record<Level, string> = {
	daily: "Daily",
	weekly: "Weekly",
	monthly: "Monthly",
	quarterly: "Quarterly",
	yearly: "Yearly",
	objective: "Objectives",
};

/**
 * The layout settings describe where tasks live.
 *
 * `enabled: false` means the flat layout: every task sits directly in the root
 * and no folder warnings are ever raised.
 */
export interface LevelFolderLayout {
	enabled: boolean;
	/** Root folder, always with a trailing slash. */
	root: string;
	/** Folder name per horizon, without slashes. */
	names: Record<Level, string>;
}

/** Normalises a user-supplied folder name for one horizon. */
export function normalizeLevelFolderName(name: string, level: Level): string {
	return toNoteFileName(name, DEFAULT_LEVEL_FOLDER_NAMES[level]);
}

/**
 * The folder a task of `level` belongs in, with a trailing slash.
 *
 * With the flat layout every horizon shares the root.
 */
export function folderForLevel(layout: LevelFolderLayout, level: Level): string {
	if (!layout.enabled) {
		return layout.root;
	}
	return `${layout.root}${layout.names[level]}/`;
}

/**
 * Whether a task file sits where its level says it should.
 *
 * Always true for the flat layout: the layout is the user's choice, so it never
 * produces warnings.
 */
export function isInLevelFolder(
	layout: LevelFolderLayout,
	path: string,
	level: Level,
): boolean {
	if (!layout.enabled) {
		return true;
	}
	const folder = path.slice(0, path.lastIndexOf("/") + 1);
	return folder === folderForLevel(layout, level);
}

/** Whether a task file is in the wrong folder for its level. */
export function isFolderMismatch(
	layout: LevelFolderLayout,
	path: string,
	level: Level,
): boolean {
	return layout.enabled && !isInLevelFolder(layout, path, level);
}

/** Folder that archived notes are filed under, inside the task root. */
export const ARCHIVE_FOLDER_NAME = "Archive";

/**
 * The folder an archived task of `level` belongs in.
 *
 * The archive mirrors the level folders one for one, so an archived note is
 * still filed by the horizon it belonged to rather than piling up in one heap -
 * and the level folders keep holding nothing but live work.
 */
export function archiveFolderForLevel(
	layout: LevelFolderLayout,
	level: Level,
): string {
	return `${layout.root}${ARCHIVE_FOLDER_NAME}/${layout.names[level]}/`;
}

/**
 * Where a mismatched task should be moved to.
 *
 * The file name is kept exactly as it is: the user chose it, and renaming on a
 * move would break the wikilinks that are about to be updated for the move.
 *
 * @returns The corrected path, or `null` when the task is already in place.
 */
export function correctedPathFor(
	layout: LevelFolderLayout,
	path: string,
	level: Level,
): string | null {
	if (!isFolderMismatch(layout, path, level)) {
		return null;
	}
	const name = path.slice(path.lastIndexOf("/") + 1);
	return `${folderForLevel(layout, level)}${name}`;
}

/**
 * The task root and every level folder it contains.
 *
 * Used to create the folders on demand, and to know which folders the plugin
 * owns when it walks the vault.
 */
export function levelFolders(layout: LevelFolderLayout): string[] {
	if (!layout.enabled) {
		return [layout.root];
	}
	return LEVELS.map((level) => folderForLevel(layout, level));
}

/** Whether `folder` is one of the level folders the plugin manages. */
export function isLevelFolder(layout: LevelFolderLayout, folder: string): boolean {
	return layout.enabled && levelFolders(layout).includes(folder);
}
