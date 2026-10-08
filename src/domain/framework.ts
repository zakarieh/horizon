/**
 * The goal/execution framework that objectives carry.
 *
 * Objectives are the only horizon that is not time bound, so they are the only
 * one that holds a plan rather than a period. The framework is two layers of six
 * terms: the first six design the goal, the last six run and review it.
 *
 * | Layer   | Terms                                                        |
 * |---------|--------------------------------------------------------------|
 * | plan    | why, successState, keyResults, capabilities, constraints, risks |
 * | execute | outcome, projects, habits, metrics, review, stopList          |
 *
 * Pure: the terms, their order and the normalisation rules are all here, so the
 * form and the frontmatter writer agree without duplicating the list.
 */

/** The lifetime of a framework: design first, then run. */
export type FrameworkLayer = "plan" | "execute";

/** Every term, in the order the form shows them. */
export const FRAMEWORK_TERMS = [
	"why",
	"successState",
	"keyResults",
	"capabilities",
	"constraints",
	"risks",
	"outcome",
	"projects",
	"habits",
	"metrics",
	"review",
	"stopList",
] as const;

/** One term of the framework. */
export type FrameworkTerm = (typeof FRAMEWORK_TERMS)[number];

/** The framework as stored: one optional block of text per term. */
export type ObjectiveFramework = Partial<Record<FrameworkTerm, string>>;

/** The two layers, each with its own six terms. */
export const FRAMEWORK_LAYERS: readonly {
	layer: FrameworkLayer;
	terms: readonly FrameworkTerm[];
}[] = [
	{ layer: "plan", terms: FRAMEWORK_TERMS.slice(0, 6) },
	{ layer: "execute", terms: FRAMEWORK_TERMS.slice(6) },
];

/** Runtime guard for {@link FrameworkTerm}. */
export function isFrameworkTerm(value: string): value is FrameworkTerm {
	return (FRAMEWORK_TERMS as readonly string[]).includes(value);
}

/**
 * Cleans whatever was in frontmatter into a framework.
 *
 * Unknown keys are dropped, values are trimmed, and blank terms are removed
 * rather than stored as empty strings - so a term the user cleared disappears
 * from the note instead of lingering as `term: ""`.
 */
export function normalizeFramework(raw: unknown): ObjectiveFramework {
	if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
		return {};
	}
	const framework: ObjectiveFramework = {};
	for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
		if (!isFrameworkTerm(key) || typeof value !== "string") {
			continue;
		}
		const text = value.trim();
		if (text !== "") {
			framework[key] = text;
		}
	}
	return framework;
}

/** Whether every term is empty, counting whitespace as empty. */
export function frameworkIsEmpty(framework: ObjectiveFramework): boolean {
	return frameworkSections(framework).length === 0;
}

/**
 * The filled terms, grouped by layer, in framework order.
 *
 * A layer with nothing filled in is dropped rather than rendered as an empty
 * heading, which is what lets the form and the note panel share one rule about
 * what a half-filled framework looks like.
 */
export function frameworkSections(
	framework: ObjectiveFramework,
): readonly { layer: FrameworkLayer; terms: readonly FrameworkTerm[] }[] {
	const sections: { layer: FrameworkLayer; terms: FrameworkTerm[] }[] = [];
	for (const entry of FRAMEWORK_LAYERS) {
		const terms = entry.terms.filter((term) => (framework[term] ?? "").trim() !== "");
		if (terms.length > 0) {
			sections.push({ layer: entry.layer, terms });
		}
	}
	return sections;
}

/**
 * Whether two frameworks say the same thing.
 *
 * Compared term by term in canonical order rather than by key count, so the
 * result cannot depend on the order the keys happen to be in.
 */
export function sameFramework(a: ObjectiveFramework, b: ObjectiveFramework): boolean {
	const left = normalizeFramework(a);
	const right = normalizeFramework(b);
	return FRAMEWORK_TERMS.every((term) => (left[term] ?? "") === (right[term] ?? ""));
}
