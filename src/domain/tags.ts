/**
 * Tag colour overrides.
 *
 * A tag needs no setup: its chip takes a hue hashed from its own name, so
 * `#work` looks the same on every card and in every session. This module adds
 * the one thing a hash cannot know - the user's own choice - by letting a tag be
 * pinned to a colour. The hash stays as the fallback for every tag left alone.
 *
 * The key is the normalised tag name (trimmed, leading `#` stripped, lower-cased),
 * the same form the data layer stores tags in, so a pin cannot be lost to a stray
 * capital or a forgotten `#`.
 */

import { parseHexColor, tagHue } from "../util/color";
import { normalizeTag } from "./board";

/** Tag colour overrides, keyed by normalised tag name. */
export type TagColors = Record<string, string>;

/** Whether a stored value is a colour a chip can use. */
function isTagColor(value: unknown): value is string {
	return typeof value === "string" && parseHexColor(value) !== null;
}

/**
 * Repairs a stored tag-colour map.
 *
 * Keys are normalised and values must be hex colours; anything else is dropped
 * rather than kept as a promise the renderer cannot keep. Two spellings of the
 * same tag collapse onto one entry, and the later one wins.
 */
export function normalizeTagColors(stored: unknown): TagColors {
	const colors: TagColors = {};
	if (stored === null || typeof stored !== "object" || Array.isArray(stored)) {
		return colors;
	}
	for (const [key, value] of Object.entries(stored as Record<string, unknown>)) {
		const tag = normalizeTag(key);
		if (tag === "" || !isTagColor(value)) {
			continue;
		}
		colors[tag] = value.trim();
	}
	return colors;
}

/**
 * The colour a tag is pinned to.
 *
 * @returns The stored colour, or `null` when the tag has none and should keep
 * its hashed hue.
 */
export function tagColorOf(tag: string, colors: TagColors): string | null {
	return colors[normalizeTag(tag)] ?? null;
}

/**
 * The chip's base colour: the user's pin when there is one, otherwise the hue
 * hashed from the tag name. Every tint the chip draws is mixed from this value.
 */
export function tagBaseColor(tag: string, colors: TagColors): string {
	return tagColorOf(tag, colors) ?? `hsl(${String(tagHue(tag))} 70% 50%)`;
}
