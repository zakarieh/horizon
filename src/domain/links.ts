/**
 * Wikilink helpers.
 *
 * Parent links are stored as Obsidian wikilinks (`"[[2026-W40 Launch]]"`) in
 * frontmatter. Frontmatter is user-editable, so parsing must tolerate aliases,
 * heading anchors and plain (non-linked) strings.
 */

/**
 * Wraps a link target in a wikilink when it is not already one.
 *
 * @param target A vault path or note basename.
 * @returns The target as `[[target]]`.
 */
export function toLinkRef(target: string): string {
	const trimmed = target.trim();
	if (trimmed.startsWith("[[") && trimmed.endsWith("]]")) {
		return trimmed;
	}
	return `[[${trimmed}]]`;
}

/**
 * Extracts the link target from a raw frontmatter value.
 *
 * Handles `[[Target]]`, `[[Target|alias]]`, `[[Target#heading]]`,
 * `[[Target#^block]]` and bare strings such as `Target`.
 *
 * @param raw The raw frontmatter value, of unknown type.
 * @returns The link target, or `null` when there is no usable target.
 */
export function parseLinkRef(raw: unknown): string | null {
	if (typeof raw !== "string") {
		return null;
	}

	let value = raw.trim();
	const wikilink = /^\[\[([\s\S]*)\]\]$/.exec(value);
	if (wikilink) {
		value = wikilink[1];
	}

	const alias = value.indexOf("|");
	if (alias >= 0) {
		value = value.slice(0, alias);
	}

	const heading = value.indexOf("#");
	if (heading >= 0) {
		value = value.slice(0, heading);
	}

	value = value.trim();
	return value === "" ? null : value;
}
