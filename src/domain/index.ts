/**
 * The Horizon Task domain layer: pure, vault-free business logic.
 *
 * Nothing in this folder may import `obsidian` or any Node built-in, so the
 * whole layer is unit-testable with plain Vitest and no mocks.
 *
 * - `types` - the task shape, level and status unions, hierarchy issue codes
 * - `links` - wikilink parsing helpers
 * - `paths` - vault path string helpers
 * - `fractional` - base-62 fractional indexing for manual card order
 * - `periods` - period maths for the five period-scoped levels
 * - `hierarchy` - the allowed parent table and cycle detection
 * - `statuses` - the per-board status registries
 * - `board` - board scoping, filtering, sorting and progress rollups
 * - `drag` - where a dragged card lands, and the order key that puts it there
 * - `task-edit` - draft validation, parent candidates and level-change repair
 * - `folders` - the folder-per-level layout, derived from the task's level
 * - `palette` - the default and colour-blind-safe status palettes
 * - `framework` - the goal/execution terms an objective carries
 */

export * from "./types";
export * from "./links";
export * from "./paths";
export * from "./fractional";
export * from "./periods";
export * from "./hierarchy";
export * from "./statuses";
export * from "./framework";
export * from "./palette";
export * from "./folders";
export * from "./board";
export * from "./kanban";
export * from "./drag";
export * from "./task-edit";
