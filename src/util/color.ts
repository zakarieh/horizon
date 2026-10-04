/**
 * Colour maths, kept pure so contrast is something the plugin can check rather
 * than assume.
 *
 * The card's status border and the status chips are the only purely colour-coded
 * signals in the plugin, so they have to stay legible in both of Obsidian's
 * themes and for users who cannot tell red from green.
 */

/** A parsed `#rgb` or `#rrggbb` colour. */
export interface Rgb {
	r: number;
	g: number;
	b: number;
}

/**
 * Parses a hex colour.
 *
 * @returns The channels, or `null` when the value is not a hex colour. Named
 * colours and CSS variables are deliberately not resolved: the plugin cannot
 * know what a theme's variable resolves to, so it only judges what it can read.
 */
export function parseHexColor(value: string): Rgb | null {
	const hex = value.trim().replace(/^#/, "");
	const expanded =
		hex.length === 3
			? hex
					.split("")
					.map((char) => char + char)
					.join("")
			: hex;
	if (!/^[0-9a-fA-F]{6}$/.test(expanded)) {
		return null;
	}
	return {
		r: Number.parseInt(expanded.slice(0, 2), 16),
		g: Number.parseInt(expanded.slice(2, 4), 16),
		b: Number.parseInt(expanded.slice(4, 6), 16),
	};
}

/** Relative luminance, per WCAG 2.1. */
export function relativeLuminance(color: Rgb): number {
	const channel = (value: number): number => {
		const scaled = value / 255;
		return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
	};
	return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
}

/**
 * Contrast ratio between two colours, from 1 to 21.
 *
 * @returns The ratio, or `null` when either colour cannot be parsed.
 */
export function contrastRatio(foreground: string, background: string): number | null {
	const a = parseHexColor(foreground);
	const b = parseHexColor(background);
	if (a === null || b === null) {
		return null;
	}
	const first = relativeLuminance(a);
	const second = relativeLuminance(b);
	const lighter = Math.max(first, second);
	const darker = Math.min(first, second);
	return (lighter + 0.05) / (darker + 0.05);
}

/** Backgrounds the plugin checks status colours against. */
export const THEME_BACKGROUNDS = {
	light: "#ffffff",
	dark: "#1e1e1e",
} as const;

/** WCAG AA for non-text graphics such as a border or a chart series. */
export const MIN_GRAPHIC_CONTRAST = 3;

/**
 * Whether a colour is distinguishable from both themes' backgrounds.
 *
 * @returns Whether every check passed, and the worst ratio found.
 */
export function meetsGraphicContrast(
	color: string,
	minimum: number = MIN_GRAPHIC_CONTRAST,
): { ok: boolean; worst: number } {
	const ratios = Object.values(THEME_BACKGROUNDS)
		.map((background) => contrastRatio(color, background))
		.filter((ratio): ratio is number => ratio !== null);
	if (ratios.length === 0) {
		return { ok: false, worst: 0 };
	}
	const worst = Math.min(...ratios);
	return { ok: worst >= minimum, worst };
}

/** Whether black or white text is more legible on `background`. */
export function bestTextColorOn(background: string): "#000000" | "#ffffff" {
	const ratio = contrastRatio("#000000", background);
	return ratio !== null && ratio >= 4.5 ? "#000000" : "#ffffff";
}

/**
 * The chip hue for a tag, in degrees from 0 to 359.
 *
 * A tag has to look the same on every card and in every session, so its hue
 * comes from a hash of the name rather than from where it happens to sit in a
 * list. The name is trimmed and lowercased first, so `#Work` and `#work` agree.
 */
export function tagHue(tag: string): number {
	const value = tag.trim().toLowerCase();
	let hash = 0;
	for (let index = 0; index < value.length; index += 1) {
		hash = (hash * 31 + value.charCodeAt(index)) % 360;
	}
	return hash;
}
