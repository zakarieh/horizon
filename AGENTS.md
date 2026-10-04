# AGENTS.md — Horizon Task (task-flow)

Obsidian plugin. ID `task-flow`, display name "Horizon Task". Keep the id and
`task-flow-*` CSS classes stable; they own the folder, `data.json` and logs.

## Commands
- `npm run check` — typecheck + tests + lint. Run after every change.
- `npm run build` — bundles `main.js`. Assert `grep -c 'process\.env' main.js` is `0`.
- `npm test`, `npm run typecheck`, `npm run lint` individually.

## Layout
- `src/domain/` — pure logic, no Obsidian/Node imports, fully unit-tested.
- `src/domain/board.ts` — flat status columns, filtering, sorting, rollups.
- `src/domain/kanban.ts` — Kanban layout: `groupBy` columns, list-property explosion, empty/pinned columns, per-property column order, swimlanes, WIP limits, `movePatch`.
- `src/domain/drag.ts` — where a drop lands (insert index + fractional order key).
- `src/data/` — vault and frontmatter I/O (`task-repository.ts`, `frontmatter.ts`).
- `src/ui/` — Obsidian views/modals; `src/ui/board/` is React + dnd-kit and imports no Obsidian module.
- `src/strings.ts` — all user-facing copy (including the in-app guide).
- `src/settings.ts` — persisted shape, defaults, and the `mergeSettings` repair pass.
- `src/settings-tab.ts` — declarative setting definitions, plus the imperative per-board status editor.
- Tests live in `tests/`; React board tests use `// @vitest-environment happy-dom`.

Layering is one-way: `ui → data → domain`. Never import upward.

## Board model
- One board per horizon (`daily` … `objective`).
- `settings.statuses` is `Record<Level, StatusDefinition[]>` — statuses are **per board**, not global.
- `settings.kanban` is `Record<Level, KanbanSettings>` — grouping, swimlanes, width, pinned, WIP, density, explosion, column order.
- A task's status belongs to its own board's registry: resolve it with `statuses[task.level]`. `computeRollup` takes the whole `StatusRegistries` map so a child resolves against its own level.
- `buildKanbanBoard` produces columns + rows + cells; cell ids are `rowKey\u001fcolumnKey` (`kanbanCellId`) and are the dnd-kit droppable ids.
- One task form (`ui/task-modal.ts`) serves create *and* edit; the board opens it via `openNewTaskDialog`/`openTaskModal`. The bottom-of-column "+" passes the column value as `initial`; a card click passes the task. There are no separate quick-add/quick-edit popups.
- Settings are declared as `type: "page"` entries (Obsidian 1.13 has no horizontal-tab API): General, Boards, plus one page per horizon.
- The board header is two rows: horizon tabs with the primary **New task** action on the right, then period navigation on the left with the tag filter and search pushed right (`.task-flow-header-bar` / `.task-flow-controls-end`).
- The task form is a two-column grid (`.task-flow-form`) with the framework section spanning both columns; the details column is deliberately **not** sticky, or it would cover the framework as it scrolls.

## Behaviour spec

The rules below are the product. Anything a user can observe traces back to one
of them, and each lives in `domain/` (pure) unless stated otherwise.

### Horizons and periods
- Six levels, finest to coarsest: `daily, weekly, monthly, quarterly, yearly, objective`. `LEVEL_RANK` orders them; only `objective` is period-free (`isPeriodLevel`).
- One board per horizon, and a task appears on **exactly one** board — the one for its own level. Cross-horizon context is the parent link and the rollup, never a duplicated card.
- One period format per level: `daily` `yyyy-MM-dd` · `weekly` `yyyy-'W'ww` · `monthly` `yyyy-MM` · `quarterly` `yyyy-'Q'q` · `yearly` `yyyy` · `objective` none.
- Weeks are ISO-8601 (Monday start, `RRRR` week-year), so `2021-01-01` belongs to `2020-W53`. 53-week years (2015, 2020, 2026, 2032) are covered by tests.
- Periods are validated against real calendar dates; a `due` date is validated as a `daily` period. Period equality is string equality; `isInsidePeriod` answers range questions.
- All dates are local `Date` objects, compared only with other local dates. Never mix in UTC.

### Hierarchy
- Zero or one parent per task. Linking is optional everywhere: a parentless task is valid and never warns.
- Allowed parents, always strictly coarser — daily→weekly/monthly · weekly→monthly/quarterly · monthly→quarterly/yearly · quarterly→yearly/objective · yearly→objective · objective→none.
- Because the parent is always coarser, cycles are impossible by construction. The checks exist for hand-edited frontmatter: `collectHierarchyIssues` reports self-link, cycle, objective-with-parent, invalid-parent-level and parent-not-found.
- Severity: structural breakage (self-link, cycle, objective with a parent) is `error`; a link outside the table is `warning`.
- Issues are never auto-repaired: the card shows a badge and the user picks a valid parent or clears it.
- `strictHierarchy` (default on) enforces the table when a link is created. Off, any *different* level is allowed — invalid links still warn.
- A parent ref resolves path first, then note name; ambiguous names resolve to the alphabetically first path, so results are deterministic.

### Tasks and notes
- Every task is one markdown note marked `tf-task: true`. Identity is the **file path**: it is the dnd-kit id, the undo key, and what parent refs resolve to.
- Frontmatter keys: `title, status, priority, level, period, parent, order, tags, due, created, completed, completedAt, carriedFrom, archived`. Unknown keys are preserved, never re-serialised away.
- `title` may be absent (falls back to the file basename) and is only written when it differs from it.
- `tags:` frontmatter and inline body `#tags` are merged for display, but body tags are read-only and never copied into frontmatter.
- Note file names come from `toNoteFileName`: forbidden characters and `#` stripped, leading/trailing dots and spaces trimmed, 96-character cap, `Untitled task` fallback.
- Archiving: a status may set `archiveAfterMinutes` (only meaningful in the `done` category). The 60-second sweep sets `archived: true`, flushes, then files the note under `<root>/Archive/<horizon folder>/` with `renameFile`. Archived tasks are hidden from every board and exempt from folder-mismatch problems.
- Rollover: the settings (`rollover[level]` = ask/auto/never) and the `carriedFrom` field exist, but **no rollover behaviour is implemented** — the guide lists it as planned. Do not claim it works.

### Objectives and the framework
- Objectives are the only period-free horizon, so they are the only level that carries a **goal/execution framework**: twelve terms in two layers of six. Plan: `why, successState, keyResults, capabilities, constraints, risks`. Execute: `outcome, projects, habits, metrics, review, stopList`.
- Terms and their order live in `domain/framework.ts` (`FRAMEWORK_TERMS`, `FRAMEWORK_LAYERS`); copy lives in `strings.task.framework`. Never inline either list anywhere else.
- Storage is **one nested `framework:` key** rather than twelve flat ones, because the terms are generic words (`risks`, `metrics`) that would otherwise collide with whatever else the user keeps in frontmatter.
- `normalizeFramework` trims values, drops unknown keys and drops blank terms; `frameworkIsEmpty` counts whitespace as empty, so clearing every term removes the key instead of writing empty strings.
- Every term is optional: a half-filled framework is valid, and a non-objective task simply has none.
- `framework` is a `TaskEditKey`, not a frontmatter-only field: `changedFields`, `pickFields` and `EDITABLE_FIELD_KEYS` all carry it, so an edit is undoable like any other field.
- The same data is also readable in the note: `main.ts` registers a markdown post-processor that prepends a panel (`ui/framework-panel.ts`) to the **reading view** of any note with a non-empty framework. Reading view only - live preview's container belongs to CodeMirror, and injecting DOM there fights the editor.
- The raw `framework:` frontmatter is a nested object, which Obsidian's Properties panel would render as a JSON blob. `styles.css` hides that one row (`.metadata-property[data-property-key="framework"]`) so the note only shows the readable panel; the values stay in frontmatter and the task form is the editor.
- Which terms a panel shows is `frameworkSections` (domain), so the form, the note and the tests share one rule about what a half-filled framework looks like.

### Statuses
- `settings.statuses` is `Record<Level, StatusDefinition[]>`: per board, with its own ids, labels, colours and order.
- Categories `todo · active · done · cancelled` drive behaviour: entering `done` stamps `completed` (day) and `completedAt` (timestamp), leaving clears both; terminal cards render recessed or struck through.
- The status **id** is what frontmatter stores, so renaming or recolouring never touches a note. Deleting does, so `deleteStatus` demands a replacement id and the UI confirms first.
- A missing status is not an error: the card falls back to the board's first status and is flagged `unknownStatus`.
- `isDoneStatus` asks the category, never the id.

### Order, drag and drops
- Manual order is a fractional base-62 key (`order`) from `generateKeyBetween`; inserting between two neighbours rewrites exactly one note.
- Drop rule: the card lands at the index its target occupies *after* the dragged card is removed (matches dnd-kit's `arrayMove`); dropping on empty column space appends.
- Drop ids: a card is its path, a column's drop area is `tf-column:<id>` (`columnDroppableId`), a cell is `rowKey\u001fcolumnKey` (`kanbanCellId`). Resolve a card path first, then parse the prefix — the two id spaces must stay unambiguous.
- A cell drop is `splitKanbanCellId` → `movePatch` + `order`, then `flush()` so the note lands immediately.
- Sort modes: `manual` (the `order` key), `priority`, `due`, `created`. Only manual order is written by dragging.

### Board rendering
- `selectBoard` scopes to the board's level + period, filters (one tag, plus free text over title/tags/path), sorts, then drops empty columns or collapses empty terminal columns as configured.
- Rollup counts **direct** children only, each resolved against its own level's registry; `allChildrenDone` requires at least one child.
- Kanban `groupBy` is `status | priority | tags`; swimlanes are `none | priority | tags`; every cell is an independent drop target.
- With `explodeListColumns`, a card with several tags appears in each tag column — one task, several cells.
- Column width 200–500 px (default 280), swimlane height 300–1200 px (default 600). WIP limits show `current/limit` and only colour the count when over.
- Pinned and empty columns stay visible so they remain drop targets; the key for an unusable grouping value is `""`.
- Column order is stored per grouping property, in `columnOrder[groupBy]`.

### Colours
- One registry colour per status drives the card, the column header and the chip.
- Both shipped palettes sit in the luminance band that reaches 3:1 against `#ffffff` *and* `#1e1e1e`; `tests/palette.test.ts` enforces it, so any new default colour must too.
- `applyPalette` recolours only statuses still on a shipped palette colour — a user's own colour survives, and checking both palettes makes switching reversible.
- Tag chips take a hue hashed from the tag name (`tagHue`), so `#work` is the same colour everywhere and stable across sessions.
- State is never colour alone: cancelled is struck through, done recedes, the urgent badge is a shape as well as a colour.

### Storage and writes
- Reads come from `MetadataCache`; note text is never read for indexing. The one body read is the form's `readBody`, on demand.
- Frontmatter writes go through `FileManager.processFrontMatter` (foreign keys survive); moves go through `FileManager.renameFile` (wikilinks follow).
- Mutations are optimistic with a 300 ms coalesced write; a failed write reloads that file from disk instead of lying about it.
- The body is written separately (`writeBody`): flush first, then replace everything after the raw frontmatter block (`splitFrontmatter`), so a body edit can never reformat frontmatter.
- Flush before any rename: a rename clears the pending-write bookkeeping for the old path.
- Folder layout: `folderPerLevel` puts each horizon in `<root>/<name>/`; with it off everything sits flat and no folder warnings are raised. A mismatch is reported, never silently corrected — the one-click fix is the user's call.

### Settings model
- `mergeSettings` validates every field on read and falls back to the default; `data.json` is user-editable and survives upgrades.
- Invariants: `enabledLevels` is never empty, `defaultLevel` ∈ `enabledLevels`, `boardState.level` ∈ `enabledLevels`, `taskFolder` normalised to a trailing slash.
- A legacy `data.json` may hold a flat `statuses` array; `normalizeStatusRegistries` copies it onto every board. `kanban` is always filled with defaults.
- Settings are declared, not drawn: `getSettingDefinitions()` is the single source of truth (Obsidian's settings search reads it too). Dotted keys address nested settings, and `getControlValue`/`setControlValue` are the only readers and writers.
- Imperative exception: the per-board status editor, which needs live per-row controls.
- Pages: **General** (guide, notes and folders, hierarchy, rollover), **Boards** (boards + default, columns, cards, priorities), then one page per horizon (kanban, statuses).

## Conventions
- Tabs, double quotes, semicolons.
- Every export has a doc comment; new UI string goes in `strings.ts`.
- Only `console.warn`/`console.error` (via `log.ts`); `console.log` is a lint error.
- `domain/` functions each need a test in `tests/`.
- Do not upgrade TypeScript/vitest/eslint blindly; versions are pinned for Node 20 + npm 10.8.

## Gotchas
- Yearly periods are digits: write them quoted (`yamlScalar` handles it) and read numbers back as strings (`readScalar`), or YAML turns `2026` into a number.
- Colours must stay in WCAG luminance ~[0.139, 0.30] (`tests/palette.test.ts`).
- Folder moves: `await tasks.flush()` before `moveToLevelFolder()`; use `FileManager.renameFile`.
- Body `#tags` are read-only; only frontmatter tags are written.
- Statuses are per board: `settings.statuses[level]`. Never index the map with a task's status without using that task's own `level`.
- Old `data.json` has a flat `statuses` array; `normalizeStatusRegistries` migrates it to every board. `mergeSettings` also fills `kanban` with defaults, so never read those fields unguarded.
- dnd-kit: do not add `PointerSensor` next to `TouchSensor`; render synchronously on drag end so the drop animation measures the new slot.
- dnd-kit: **scope collision detection by drag kind**. Column headers are sortable, so dnd-kit registers each `<section>` as a droppable covering the whole column; unscoped `pointerWithin`/`closestCorners` then resolves card drops onto the header id, which `resolveColumnId` cannot map to a cell — cards silently fail to drop, worst over empty columns. See `COLLISION_DETECTION` in `BoardBody.tsx`.
- dnd-kit: the drop target id is a composite cell id; parse it with `splitKanbanCellId`, then write with `movePatch` + `order`. Flush after a drop (`tasks.flush()`) so the note is written immediately.
- Cell virtualization uses `content-visibility` (not windowing) so all droppables stay in the DOM; it must be disabled while dragging (`virtualize={activeCard === null}`) or dnd-kit measures approximate rects.
- `createEl`/`createFragment` are globals, not module exports. `Modal.onOpen()` is a Promise.
- No real Obsidian runtime here: pointer feel, popover anchoring, mobile touch and 60fps with 200 cards cannot be verified — say so instead of implying they were tested.
- Body editing replaces the note's **whole** text below the frontmatter. `TaskDraft.body` is the current body when editing (`loadBody` fills it), `changedFields` returns `TaskEditKey[]` including `"body"`, and `pickFields` drops `"body"` so it can never reach frontmatter. A body-only save skips the frontmatter write and is not undoable.
- `src/domain/statuses.ts` still has a stale header comment calling statuses global. The code is per board: trust `settings.statuses[level]`.
- `archiveSweep()` is async (`void this.archiveSweep()` from the interval) and moves notes into `Archive/<horizon>`; archived tasks are filtered out of `tasks` but stay in the store map.
- Previewing UI without Obsidian: load the real `styles.css` against static markup with mock theme variables, and include a global `box-sizing: border-box` plus `.theme-dark`/`.theme-light` — otherwise widths overflow and dark rules never match.
- Prod `main.js` is minified: top-level function names are mangled, so grepping the bundle for `tagHue` or `splitFrontmatter` proves nothing. Grep for class/property names (`readBody`, `writeBody`) instead.
- The framework post-processor runs once per rendered block: the panel is added by whichever block comes first and the rest skip it because `.task-flow-framework-panel` is already inside the preview sizer.
