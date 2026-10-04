/**
 * Guards for values that come from outside the plugin: note frontmatter,
 * `data.json`, and Obsidian's own metadata cache. Everything that crosses that
 * boundary is `unknown` until one of these has been through it.
 */

/** Whether `value` is a plain, non-null, non-array object. */
export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Narrows a value to a mutable plain-object record.
 *
 * Returns the **same reference** when `value` already is one, so callers can
 * hand the result to `processFrontMatter` and mutate the real frontmatter.
 * Otherwise returns a fresh empty object, so callers never have to null-check.
 */
export function asRecord(value: unknown): Record<string, unknown> {
	return isRecord(value) ? value : {};
}

/** A trimmed string, or `null` when the value is not a usable string. */
export function trimmedOrNull(value: unknown): string | null {
	if (typeof value !== "string") {
		return null;
	}
	const trimmed = value.trim();
	return trimmed === "" ? null : trimmed;
}
