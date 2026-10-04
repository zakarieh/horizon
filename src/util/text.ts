/**
 * Tiny text helpers, kept pure and dependency-free.
 */

/**
 * Fills `{placeholder}` slots in a string.
 *
 * Used so counts and names can live in `strings.ts` as plain templates rather
 * than as functions, which keeps the copy file purely data.
 *
 * @param template Copy containing `{name}` slots.
 * @param values Replacement values keyed by slot name.
 * @returns The filled string; unknown slots are left untouched.
 */
export function formatTemplate(
	template: string,
	values: Readonly<Record<string, string | number>>,
): string {
	return template.replace(/\{(\w+)\}/g, (match, key: string) =>
		key in values ? String(values[key]) : match,
	);
}
