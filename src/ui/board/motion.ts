/**
 * Whether the user has asked the system to reduce motion.
 *
 * Guards `matchMedia`, which is missing in some test and embedded environments,
 * so the board still renders there.
 */
export function prefersReducedMotion(): boolean {
	if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
		return false;
	}
	return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
