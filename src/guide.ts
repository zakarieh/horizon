import { GUIDE_BODY } from "./strings";

/** Placeholder in {@link GUIDE_BODY} that is replaced with the plugin version. */
const VERSION_PLACEHOLDER = "{{version}}";

/**
 * Assembles the in-app user guide.
 *
 * Deliberately free of Obsidian imports so the document itself can be unit
 * tested - the tests assert that the guide stays in sync with the domain (every
 * horizon, priority and frontmatter field is documented) and that its markdown
 * is well formed. Only the renderer needs a vault.
 *
 * @param version Plugin version, as reported by `manifest.json`.
 * @returns The guide as a single markdown document.
 */
export function buildGuideMarkdown(version: string): string {
	return GUIDE_BODY.join("\n").split(VERSION_PLACEHOLDER).join(version);
}
