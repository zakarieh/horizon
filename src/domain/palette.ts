/**
 * The status colour palettes.
 *
 * Cards, column headers and the status chip in the quick-edit popup all take
 * their colour from the registry's `color` field, so one value per status drives
 * every surface. Two palettes ship:
 *
 * - the **default** one, which follows the usual grey/blue/amber/red/green
 *   convention;
 * - a **colour-blind-safe** one, which avoids relying on red versus green.
 *
 * A palette only recolours statuses that still use a default colour. Anything
 * the user has recoloured themselves is left alone, so switching palettes never
 * discards their choices.
 */

import type { StatusDefinition } from "./types";

/**
 * Default colour per default-status id.
 *
 * Every value sits in the narrow band of relative luminance that reaches 3:1
 * (WCAG AA for non-text graphics) against *both* `#ffffff` and `#1e1e1e`, so the
 * same status colour is legible whichever theme the user runs. Lighter, more
 * familiar greys and pastels fail on the light theme; darker ones fail on the
 * dark theme. `tests/palette.test.ts` holds this to account.
 */
export const DEFAULT_STATUS_COLORS: Record<string, string> = {
	backlog: "#7d8590",
	todo: "#1f6feb",
	"in-progress": "#b45309",
	blocked: "#d1242f",
	done: "#1a7f37",
	cancelled: "#6b7280",
};

/**
 * A palette distinguishable without red-green perception: blue, amber, teal and
 * magenta carry the meaning, and the two "not really work" categories are
 * greys.
 *
 * `cancelled` is shown with a strikethrough as well, so it is never identified
 * by colour alone. The same luminance band applies as for the default palette.
 */
export const COLOR_BLIND_SAFE_STATUS_COLORS: Record<string, string> = {
	backlog: "#767e8c",
	todo: "#2563eb",
	"in-progress": "#b45309",
	blocked: "#c026d3",
	done: "#0d9488",
	cancelled: "#838a95",
};

/**
 * Every colour either shipped palette hands out.
 *
 * Membership is what marks a status as "still on a palette colour": anything
 * else is a colour the user chose, and it survives a palette switch untouched.
 * Checking both palettes is what makes switching back and forth reversible.
 */
const PALETTE_COLORS = new Set(
	[...Object.values(DEFAULT_STATUS_COLORS), ...Object.values(COLOR_BLIND_SAFE_STATUS_COLORS)].map(
		(color) => color.toLowerCase(),
	),
);

/**
 * Recolours every status that is still on a palette colour.
 *
 * @param registry The current registry.
 * @param palette The colours to move to, keyed by status id.
 * @returns A new registry; statuses the user has recoloured are unchanged.
 */
export function applyPalette(
	registry: readonly StatusDefinition[],
	palette: Record<string, string>,
): StatusDefinition[] {
	return registry.map((status) => {
		if (!PALETTE_COLORS.has(status.color.toLowerCase())) {
			return status;
		}
		const replacement = palette[status.id];
		return replacement === undefined ? status : { ...status, color: replacement };
	});
}
