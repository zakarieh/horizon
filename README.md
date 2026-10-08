# Horizon Task

Hierarchical, multi-horizon task management for [Obsidian](https://obsidian.md), with
drag-and-drop Kanban boards per time horizon and a goal tree that rolls child progress up
to parent cards.

- **Plugin id:** `task-flow`
- **Repository folder:** `task-horizon`
- **Requires:** Obsidian 1.13.0+ (the settings tab uses the declarative settings API so
  every setting is indexed by Obsidian's settings search)

> **Where the project is:** Phases 0–5 are complete, so tasks can be created, edited, dragged
> and deleted entirely from inside Obsidian, with one folder per horizon by default and a quick
> edit popup on every card. Unfinished tasks roll over into the current period automatically, per
> horizon. The remaining Phase 6 work (rollup popovers, orphan tools) and the status-registry
> editor are still to come — see [Status](#status).

## The idea in one paragraph

Every task lives in its own markdown note and belongs to exactly **one time horizon**
(`daily`, `weekly`, `monthly`, `quarterly`, `yearly`, `objective`). Each horizon has a
Kanban board scoped to a period, so the daily board for `2026-09-28` and the weekly board
for `2026-W40` both exist and both work. A task may link upward to a single coarser-horizon
parent, forming a goal tree. Parents show `done/total` progress from their direct children
rather than duplicating child cards onto their own board.

## Design decisions worth knowing

| Decision | Why |
| --- | --- |
| **One note per task**, not inline checkboxes | Tasks become linkable, searchable, taggable and backlinkable with native Obsidian features. |
| **Task identity is the file path** | Stable id; parent/child links are ordinary wikilinks in frontmatter. |
| **Detected by `tf-task: true`**, not by folder | You can move task notes anywhere without breaking the plugin. |
| **The `level` decides the folder, never the reverse** | One folder per horizon by default, so the vault reads like the goal tree. A note in the wrong folder is badged and moved with one click, never moved silently. |
| **Status owns the card's colour; priority never does** | One signal per meaning: a 4px status spine, a priority chip, an urgent dot. |
| **A task appears on exactly one board** — the board for its own level | No card duplication. Cross-horizon context comes from rollups and parent links. |
| **One parent, maximum** | A strict tree. No many-to-many links, ever. |
| **Linking is optional at every level** | A parentless task is valid on every board and never produces a warning. |
| **Invalid links warn, they are never rewritten** | The graph is validated at link-creation time, and pre-existing bad links get a badge plus an explicit "Fix hierarchy" action. User data is never silently changed. |
| **Writes go through `FileManager.processFrontMatter`** | Concurrent edits (including from other plugins) cannot clobber each other. |
| **Ordering uses fractional indexing**, never floats | Base-62 keys keep their precision after hundreds of insertions in the same gap. |
| **Optimistic UI for drag and drop** | The board re-renders immediately and persists debounced; a failed write rolls back and raises a `Notice`. |

## Data model

```yaml
---
tf-task: true
title: Ship v1 landing page        # optional; falls back to the file name
status: in-progress                # must exist in the status registry
priority: high                     # none | low | medium | high | urgent
level: daily                       # daily|weekly|monthly|quarterly|yearly|objective
period: 2026-09-28                 # format depends on level; omitted for objective
parent: "[[2026-W40 Launch website]]"   # optional, single parent, wikilink
order: "a0"                        # fractional index within the column
tags: [work, website]              # inline #tags in the body are read too, never copied here
due: 2026-09-30                    # optional
created: 2026-09-28
completed: null                    # set when status enters a `done` status
carriedFrom: 2026-W39              # set by rollover
---
```

Unknown frontmatter fields are preserved on write.

### Where the notes live

With **One folder per horizon** on (the default), each horizon gets its own folder under the
task root, and the `level` in frontmatter is the source of truth for which one:

```text
Tasks/
  Daily/        2026-09-28 Ship v1 landing page.md
  Weekly/       2026-W40 Launch website.md
  Monthly/      2026-09  Harden the API.md
  Quarterly/
  Yearly/
  Objectives/
```

Changing a task's horizon moves its note with `FileManager.renameFile`, which also rewrites
the wikilinks that point at it, so parent links and backlinks survive the move. A note that
is in the wrong folder for its `level` is flagged on its card with an explicit one-click
move. Turning the setting off gives the flat layout: every task in the root, no warnings.

### Period formats

| Level | Format | Example | Board scope |
| --- | --- | --- | --- |
| `daily` | `yyyy-MM-dd` | `2026-09-28` | one calendar day |
| `weekly` | `yyyy-'W'ww` | `2026-W40` | Mon–Sun, ISO 8601 |
| `monthly` | `yyyy-MM` | `2026-09` | one calendar month |
| `quarterly` | `yyyy-'Q'q` | `2026-Q4` | one calendar quarter |
| `yearly` | `yyyy` | `2026` | one calendar year |
| `objective` | *(none)* | — | one permanent board, no period |

Weeks are ISO 8601 weeks, so the week-numbering year is not always the calendar year:
`2021-01-01` is `2020-W53`, and `2026` is a 53-week year.

### Allowed parent links

| Child level | Allowed parent levels |
| --- | --- |
| `daily` | `weekly`, `monthly` |
| `weekly` | `monthly`, `quarterly` |
| `monthly` | `quarterly`, `yearly` |
| `quarterly` | `yearly`, `objective` |
| `yearly` | `objective` |
| `objective` | *(none — objectives are roots)* |

A parent is therefore always on a strictly coarser horizon, which makes cycles impossible by
construction. Hand-edited frontmatter that breaks the invariant is detected and flagged
(self links and loops) but never rewritten automatically.

## Statuses

Statuses are defined once, globally, and become the board columns in order:

`Backlog` and `Todo` (`todo`), `In Progress` and `Blocked` (`active`), `Done` (`done`),
`Cancelled` (`cancelled`).

Ids are stable and are what frontmatter stores, so renaming a label or recolouring a status
never touches a task file. Deleting a status requires choosing a replacement and migrates
every task that used it — that is why the registry editor ships with the task repository
rather than earlier.

A status's colour drives its column dot, the 4px spine on every card in that column, and the
chip beside it in the parent picker and quick edit popup — one value per status, everywhere.
Because colour is carrying meaning, the defaults are checked rather than assumed: every one
meets WCAG AA (3:1) against both a light and a dark background, `tests/palette.test.ts` holds
them to it, and a colour that fails the check is called out in the settings tab. The
**Colour-blind-safe palette** setting recolours every status that is still on a default
colour; statuses the user recoloured themselves are left alone.

Done and cancelled are additionally readable without any colour at all: a done card is
dimmed, and a cancelled card's title is struck through.

## Using the board

Open it from the **stacked-layers ribbon icon** or the command palette (**Horizon Task: Open
board**). It opens as a normal tab, and only one board tab is ever created.

The header carries the horizon tabs, `‹ ›` period navigation with a **Today** button, a tag
filter and a search box. While the board is focused, `Ctrl/Cmd+Alt+←/→` steps periods and
`Ctrl/Cmd+Alt+T` jumps to today. Those keys are registered on the *view's* scope rather than
as default command hotkeys, because the Obsidian plugin guidelines ask plugins not to claim
global hotkeys.

Each column is a status from the registry, in order. A card's leading edge is a 4px bar in
its status's colour, and on top of that it shows priority as a chip, up to three tag chips
(`+N` beyond that), its due date (red when overdue), its parent, and — for a parent task —
child progress as `3/7` with a thin bar. Clicking a card opens its **quick edit popup**;
clicking a tag chip filters the board by that tag.

Two details worth knowing:

- **Rollups cross boards.** Child progress is computed from a task's direct children even
  when those children are cards on a finer board, which is why a weekly parent can read
  `2/3` while its children live on the daily board.
- **Nothing disappears silently.** A note marked as a task but with a missing or malformed
  `level`/`period` cannot be placed on any board, so the board shows a banner naming it
  instead of dropping it. A card whose `status` is not in the registry is shown in the first
  column with a warning badge.

### Drag and drop

Dragging a card between columns updates its `status`; dragging within a column updates its
`order` key. Both are written back to frontmatter, and both survive a restart.

| Sensor | Activation | Why |
| --- | --- | --- |
| Mouse | 6px of movement | A plain click opens the quick edit popup |
| Touch | 200ms press | A tap opens the quick edit popup and a swipe scrolls the column |
| Keyboard | Space/Enter to lift, arrows to move, Space/Enter to drop, Escape to cancel | dnd-kit's own sensor, not re-implemented |

A few decisions worth naming:

- **The drop is resolved by tested code, not by the UI.** `domain/drag.ts` takes the board as
  rendered, the dragged card and the dnd-kit `over` id, and returns the target column, index
  and fractional `order` key. Its insertion rule reproduces dnd-kit's own `arrayMove`, so a
  card settles exactly where the drag preview showed it.
- **Keyboard dragging is a first-class path**, and so is not dragging at all: every card has a
  context menu (right-click, or the actions button on touch) with *Move to …* for each status.
- **`prefers-reduced-motion` is honoured twice**: the JS drops the sort/drop springs and the
  CSS drops the overlay tilt.
- **Writes stay cheap.** A drop updates the in-memory store and re-renders immediately; the
  frontmatter write is coalesced by the repository's 300ms debounce.

### Creating and editing tasks

| To | Do this |
| --- | --- |
| Add a task to the board | **New task** in the header, or the **New task** command |
| Add several | **+** in a column header, then type; enter saves and the box stays open |
| Rename a card | Double-click its title; enter commits, escape abandons |
| Change a field or two | Click the card: the quick edit popup opens against it |
| Everything else | Right-click a card (or its actions button on touch) → **Edit task…** |
| Move it, duplicate it, copy a link | The same menu: *Move to …*, *Change parent…*, *Duplicate*, *Copy link* |
| Delete | The same menu → **Delete task…**, confirmed, and it goes to the trash |

### The quick edit popup

Clicking a card opens a popup **anchored to that card** (`position: fixed` against the card's
rect, portalled to `document.body`, so the column's `overflow` cannot clip it; a bottom sheet
on mobile). It edits the title, status, priority, parent, tags and due date, shows horizon,
period and child rollup read-only — changing a horizon moves a note and rescopes the parent
link, which belongs in the full form — and carries *Open note*, *Open in new pane*, *Delete*,
*Save* and *Cancel* in its footer.

- **Optimistic, then debounced.** Every field is patched into the store as it changes, so the
  card behind the popup updates live; the repository's 300ms debounce coalesces the
  frontmatter writes, and a failed write re-indexes the file, which is what makes the card
  revert. *Save* just flushes, so it is never lost.
- **Cancel is a real restore.** Because edits are already written, cancelling puts the fields
  the card had when the popup opened back. The snapshot taken at open doubles as the undo
  entry, so one `Undo last task change` reverses a whole session.
- **Keyboard-first.** The title is focused on open with the caret at the end (a stray
  keystroke must not wipe a title nobody meant to edit), tab cycles inside the dialog, escape
  cancels, `Ctrl/Cmd+Enter` saves, and a backdrop click is the mouse equivalent of escape.
- **Double-click still renames.** A click on the title waits out the double-click window
  (`TITLE_CLICK_GRACE_MS`) before opening the popup, so a rename never opens it too.

The form writes **only the fields that changed**, so a note's other frontmatter — including
fields from other plugins — is never touched. The parent picker is a fuzzy search over the
candidates `domain/task-edit.ts` allows: the right horizon, never the task itself, never one
of its descendants.

Changing a task's horizon repairs what it would break and says so: the period is
re-expressed on the new horizon (`2026-09-28` → `2026-W40`), and a parent on a horizon the
task may no longer link to is cleared and named. Because frontmatter writes are not part of
the editor's undo history, the plugin keeps its own: **Undo last task change** restores the
previous values, and the notification after a board-to-board move carries an Undo button.

## In-app user guide

There is a detailed guide **inside Obsidian**, so users never have to leave the app to find
out how the plugin works. It is a read-only modal opened from either of two places:

- the command palette: **Horizon Task: Open user guide**
- **Settings → Horizon Task → Help → User guide**

It covers what is available today versus what is still coming, the horizon and period
formats, the goal tree and its parent table, the full frontmatter reference with a copyable
YAML example, statuses, ordering, rollover, a settings reference, keyboard shortcuts,
troubleshooting and the privacy stance.

The guide is authored once as markdown in `src/strings.ts` (`GUIDE_BODY`, alongside the rest
of the copy so a translation is a single-file change) and assembled by the pure
`buildGuideMarkdown(version)` in `src/guide.ts`, which substitutes the `{{version}}`
placeholder. `src/ui/guide-modal.ts` renders it with Obsidian's own `MarkdownRenderer`, so
it inherits the user's theme, fonts, table and code-block styling, and it writes nothing to
the vault — which also makes it work unchanged on mobile.

`tests/guide.test.ts` keeps the documentation honest: it asserts that every horizon, every
priority, every status category and every frontmatter field is documented, that the guide
mirrors `ALLOWED_PARENT_LEVELS`, and that its markdown tables and code fences are well
formed.
## Development

```bash
npm install          # install dependencies
npm run dev          # esbuild watch -> main.js
npm run build        # typecheck + minified production bundle
npm run typecheck    # tsc --noEmit (strict)
npm test             # vitest run
npm run test:watch   # vitest in watch mode
npm run lint         # eslint (eslint-plugin-obsidianmd recommended)
npm run check        # typecheck + tests + lint, the pre-commit gate
```

To load the plugin into a vault, put (or symlink) this folder at
`<vault>/.obsidian/plugins/task-flow/` and enable it in **Settings → Community plugins**.
`manifest.json`, `main.js` and `styles.css` are the only files the vault needs.

### Toolchain notes

These are deliberate, and each one is load-bearing:

- **No `"type": "module"` in `package.json`.** Obsidian loads `main.js` with `require()`,
  which a `"type": "module"` package would break. ESM-only config files therefore use the
  `.mjs` / `.mts` extensions instead.
- **`.npmrc` sets `legacy-peer-deps=true`.** `eslint-plugin-obsidianmd` declares an *exact*
  peer on `obsidian@1.8.7` while this project tracks the current typings. Every peer the
  lint preset needs is declared explicitly in `devDependencies`, so skipping npm's
  automatic peer installation is safe here.
- **TypeScript is pinned to `~5.9.3`.** `typescript-eslint@8` requires
  `typescript >=4.8.4 <6.1.0`.
- **`date-fns` is a runtime dependency and is bundled** into `main.js`; nothing else is.
- **React 18 + `@dnd-kit` are bundled** for the board, which is why `main.js` is ~270 KB
  rather than ~76 KB. The spec allowed React or Preact; React was chosen because dnd-kit is
  a React library and a Preact alias would add a compatibility surface that cannot be
  verified without a running Obsidian.
- **`process.env.NODE_ENV` is replaced at build time** (`define` in `esbuild.config.mjs`).
  React reads it, and mobile Obsidian has no Node `process` object, so leaving the reference
  in the bundle would break the plugin on phones. `grep -c 'process\.env' main.js` must
  stay `0`.
- **No `node:*` imports, no `fs`, no Electron APIs** in anything that ships. Only the
  desktop-only build scripts touch Node builtins.

## Architecture

```
src/
  domain/     pure, vault-free business logic — 100% unit-testable
              types · links · paths · periods · fractional indexing · hierarchy · statuses · board · drag
  data/       vault I/O: pure frontmatter mapping + the TaskRepository
  ui/         the board ItemView and its chrome
    board/    the React tree: DndContext, columns, cards, card menu
  util/       tiny pure helpers (record guards, template formatting)
  main.ts     plugin entry point
  settings.ts persisted settings shape, defaults and repair logic
  strings.ts  every user-facing string, including the in-app guide
```

The dependency rule is one-way: `ui → data → domain`, and **`domain/` imports neither
Obsidian nor Node**. That is what lets the period maths, fractional indexing, hierarchy
rules, status registry, board scoping and rollups be tested without a vault, and it is
enforced by keeping the Vitest suite free of mocks.

Reads come from `MetadataCache` and writes go through `FileManager.processFrontMatter`, so
unrecognised frontmatter is preserved and two writers cannot clobber each other. Mutations
are optimistic: the in-memory store updates and the board re-renders immediately, while the
frontmatter write is coalesced over a 300 ms debounce — so dragging a card across five
columns costs one write, not five. A failed write reloads the card from what is actually on
disk and raises a `Notice`.

Errors surface as a `Notice` with actionable text and are logged once with the
`[task-flow]` prefix. There is no telemetry and no network access anywhere in the plugin.

## Non-goals

Not planned for v1, and deliberately out of scope: a recurring-task engine, time tracking,
sync or any network calls, a Gantt or calendar view, many-to-many parent links, and
compatibility with the community Kanban plugin's file format.

## Status

| Phase | Scope | State |
| --- | --- | --- |
| 0 | Scaffold: manifest, build, plugin shell, settings tab, in-app user guide, README, ESLint | **Done** |
| 1 | Domain layer: types, periods, fractional indexing, hierarchy, statuses + tests | **Done** |
| 2 | Data layer: task repository over `MetadataCache` + `processFrontMatter` | **Done** |
| 3 | Read-only board view: horizon tabs, period navigation, columns, cards, rollups | **Done** |
| 4 | Drag and drop: dnd-kit, mouse/touch/keyboard sensors, move-to menu, reduced motion | **Done** |
| 5 | CRUD: task form, quick add, inline rename, parent picker, delete, undo | **Done** |
| 5b | Revision: folder-per-level storage with wikilink-safe moves, quick edit popup, status-coloured cards, colour-blind-safe palette | **Done** |
| 6 | Rollover of unfinished tasks (per-horizon auto/ask/never) | **Done** |
| 7 | Rollups popover, orphan filter, suggest parents | Next |
| — | Status registry editor (add, rename, recolour, reorder, delete with migration) | Outstanding |
