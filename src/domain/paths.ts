/**
 * Vault path helpers.
 *
 * Pure string handling only: no vault access, so these are unit-testable and
 * safe to use in the domain layer.
 */

/** The note name of a vault path: no folders, no `.md` extension. */
export function basename(path: string): string {
	const name = path.slice(path.lastIndexOf("/") + 1);
	return name.toLowerCase().endsWith(".md") ? name.slice(0, -3) : name;
}

/** The folder part of a vault path, with a trailing slash, or `""` at the root. */
export function folderOf(path: string): string {
	const index = path.lastIndexOf("/");
	return index < 0 ? "" : path.slice(0, index + 1);
}

/**
 * Anything that is not a letter, a number, a space, an underscore, a dash or a
 * dot is replaced by a space.
 *
 * An allow-list rather than a list of banned characters: Obsidian's forbidden
 * set varies by platform, and this way an exotic character the plugin has never
 * heard of is neutralised instead of sneaking into a file name. The Unicode
 * property escapes keep non-Latin titles intact.
 */
const DISALLOWED_IN_FILE_NAME = /[^\p{L}\p{N} _.-]/gu;

/** Longest note name the plugin will generate. */
const MAX_FILE_NAME_LENGTH = 96;

/**
 * Turns a task title into a note file name, without the `.md` extension.
 *
 * Disallowed characters become spaces rather than disappearing, so `Ship: v1`
 * reads as `Ship v1` and not as `Shipv1`. Leading and trailing dots and spaces
 * are stripped because Windows rejects them and Obsidian hides dot-files.
 *
 * @param title The task title.
 * @param fallback Name used when nothing usable is left.
 */
export function toNoteFileName(title: string, fallback: string): string {
	const cleaned = title
		.replace(DISALLOWED_IN_FILE_NAME, " ")
		.replace(/\s+/g, " ")
		.slice(0, MAX_FILE_NAME_LENGTH)
		.replace(/^[.\s]+/, "")
		.replace(/[.\s]+$/, "");
	return cleaned === "" ? fallback : cleaned;
}
