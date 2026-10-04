import {
	PluginSettingTab,
	setIcon,
	type App,
	type Setting,
	type SettingDefinition,
	type SettingDefinitionItem,
} from "obsidian";

import {
	COLOR_BLIND_SAFE_STATUS_COLORS,
	DEFAULT_COLUMN_WIDTH,
	DEFAULT_LEVEL_FOLDER_NAMES,
	DEFAULT_STATUS_COLORS,
	DEFAULT_SWIMLANE_HEIGHT,
	LEVELS,
	MAX_COLUMN_WIDTH,
	MAX_SWIMLANE_HEIGHT,
	MIN_COLUMN_WIDTH,
	MIN_SWIMLANE_HEIGHT,
	PERIOD_LEVELS,
	PRIORITIES,
	ROLLOVER_BEHAVIORS,
	SORT_MODES,
	STATUS_CATEGORIES,
	addStatus,
	applyPalette,
	deleteStatus,
	isCardLayout,
	isKanbanGroupBy,
	isKanbanSwimLane,
	isLevel,
	isPriority,
	isRolloverBehavior,
	isSortMode,
	migrationTargets,
	normalizeLevelFolderName,
	reorderStatus,
	updateStatus,
	type Level,
	type Priority,
	type StatusCategory,
	type StatusDefinition,
	type StatusRegistries,
} from "./domain";
import { logError, warn } from "./log";
import type TaskFlowPlugin from "./main";
import { normalizeTaskFolder, type CardMetadataSettings } from "./settings";
import { strings } from "./strings";
import { meetsGraphicContrast } from "./util/color";
import { formatTemplate } from "./util/text";
import { GuideModal } from "./ui/guide-modal";
import { StatusDeleteModal } from "./ui/status-delete-modal";

/** The card metadata toggles, in display order. */
const CARD_METADATA_KEYS = [
	"priority",
	"tags",
	"due",
	"parent",
	"childProgress",
	"period",
] as const satisfies readonly (keyof CardMetadataSettings)[];

/** A key of {@link CardMetadataSettings}. */
type CardMetadataKey = (typeof CARD_METADATA_KEYS)[number];

function isCardMetadataKey(value: string): value is CardMetadataKey {
	return (CARD_METADATA_KEYS as readonly string[]).includes(value);
}

/**
 * Applies a membership change and returns the result in canonical order, so the
 * stored arrays never drift away from the declared level/priority order.
 */
function toggleInOrder<T extends string>(
	canonical: readonly T[],
	current: readonly T[],
	value: T,
	enabled: boolean,
): T[] {
	const next = new Set(current);
	if (enabled) {
		next.add(value);
	} else {
		next.delete(value);
	}
	return canonical.filter((entry) => next.has(entry));
}

/**
 * Parses the WIP-limits JSON field.
 *
 * @returns The limits, or `null` when the text is not usable, so the caller
 * keeps the previous value instead of discarding it.
 */
function parseWipLimits(value: string): Record<string, number> | null {
	const trimmed = value.trim();
	if (trimmed === "") {
		return {};
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(trimmed);
	} catch (error) {
		warn("Ignoring invalid WIP limits JSON", error);
		return null;
	}
	if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
		return null;
	}
	const limits: Record<string, number> = {};
	for (const [key, entry] of Object.entries(parsed as Record<string, unknown>)) {
		if (typeof entry === "number" && Number.isFinite(entry) && entry > 0) {
			limits[key] = Math.round(entry);
		}
	}
	return limits;
}

/**
 * The settings tab.
 *
 * Settings are declared rather than drawn: `getSettingDefinitions()` is the
 * single source of truth, which also gets the plugin's settings indexed by
 * Obsidian's settings search. Values are read and written through
 * {@link getControlValue} / {@link setControlValue}, which understand the dotted
 * keys used for nested settings (`rollover.weekly`, `showCardMetadata.tags`).
 *
 * The status registry is edited by {@link TaskFlowSettingTab.renderStatusEditor},
 * which is drawn imperatively because it needs live per-row controls rather than
 * a single key/value binding. Deleting a status rewrites task files, so it goes
 * through {@link StatusDeleteModal} to confirm the replacement first.
 */
export class TaskFlowSettingTab extends PluginSettingTab {
	private readonly plugin: TaskFlowPlugin;

	constructor(app: App, plugin: TaskFlowPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	override getSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{
				type: "page",
				name: strings.settings.pages.general,
				items: [
					{
						type: "group",
						items: [
							{ name: strings.plugin.name, desc: strings.settings.intro },
							{
								name: strings.settings.help.guide.name,
								desc: strings.settings.help.guide.desc,
								action: (): void => {
									new GuideModal(this.app, this.plugin.manifest.version).open();
								},
							},
						],
					},
					{
						// Every setting that decides where a note lives, in one place: the
						// root, whether horizons get folders, and what those folders are
						// called. Splitting them across pages is what made the old layout
						// hard to reason about.
						type: "group",
						heading: strings.settings.folders.heading,
						items: [
							{
								name: strings.settings.taskFolder.name,
								desc: strings.settings.taskFolder.desc,
								control: {
									type: "text",
									key: "taskFolder",
									placeholder: strings.settings.taskFolder.placeholder,
									defaultValue: "Tasks/",
									validate: (value: string): string | void =>
										value.trim() === ""
											? strings.settings.taskFolder.empty
											: undefined,
								},
							},
							{
								name: strings.settings.folders.folderPerLevel.name,
								desc: strings.settings.folders.folderPerLevel.desc,
								control: {
									type: "toggle",
									key: "folderPerLevel",
									defaultValue: true,
								},
							},
							...this.levelFolderDefinitions(),
						],
					},
					{
						type: "group",
						heading: strings.settings.hierarchy.heading,
						items: [
							this.toggle(
								strings.settings.hierarchy.strictHierarchy.name,
								strings.settings.hierarchy.strictHierarchy.desc,
								"strictHierarchy",
							),
						],
					},
					{
						// Rollover is about task lifecycle, not layout: it belongs with the
						// rules rather than with the columns it happens to affect.
						type: "group",
						heading: strings.settings.rollover.heading,
						items: this.rolloverDefinitions(),
					},
				],
			},
			{
				type: "page",
				name: strings.settings.pages.boards,
				items: [
					{
						// Which boards exist and which one opens, next to each other: the
						// pair is useless apart.
						type: "group",
						heading: strings.settings.board.heading,
						items: [
							...this.levelDefinitions(),
							{
								name: strings.settings.defaultLevel.name,
								desc: strings.settings.defaultLevel.desc,
								control: {
									type: "dropdown",
									key: "defaultLevel",
									options: this.levelOptions(),
								},
							},
						],
					},
					{
						// Column behaviour: the shape of the board rather than its cards.
						type: "group",
						heading: strings.settings.columns.heading,
						items: [
							{
								name: strings.settings.board.sortWithinColumn.name,
								desc: strings.settings.board.sortWithinColumn.desc,
								control: {
									type: "dropdown",
									key: "sortWithinColumn",
									options: this.sortModeOptions(),
								},
							},
							this.toggle(
								strings.settings.board.hideEmptyColumns.name,
								strings.settings.board.hideEmptyColumns.desc,
								"hideEmptyColumns",
							),
							this.toggle(
								strings.settings.board.collapseEmptyTerminalColumns.name,
								strings.settings.board.collapseEmptyTerminalColumns.desc,
								"collapseEmptyTerminalColumns",
							),
						],
					},
					{
						// What a card shows, then the values it can show: both are about
						// the card, so they read together.
						type: "group",
						heading: strings.settings.cards.heading,
						items: [
							...CARD_METADATA_KEYS.map(
								(key: CardMetadataKey): SettingDefinition => ({
									name: strings.settings.cards[key],
									control: { type: "toggle", key: `showCardMetadata.${key}` },
								}),
							),
							{
								name: strings.settings.colors.colorBlindSafe.name,
								desc: strings.settings.colors.colorBlindSafe.desc,
								control: {
									type: "toggle",
									key: "colorBlindSafe",
									defaultValue: false,
								},
							},
						],
					},
					{
						type: "group",
						heading: strings.settings.priorities.heading,
						items: this.priorityDefinitions(),
					},
				],
			},
			...LEVELS.map(
				(level: Level): SettingDefinitionItem => ({
					type: "page",
					name: strings.levels[level],
					desc: strings.settings.statuses.boardDesc,
					items: [
						{
							type: "group",
							heading: strings.settings.kanban.heading,
							items: this.kanbanDefinitions(level),
						},
						{
							type: "group",
							heading: strings.settings.statuses.heading,
							items: [
								{
									name: strings.settings.statuses.listName,
									desc: strings.settings.statuses.desc,
									render: (setting: Setting): void => {
										this.renderStatusEditor(level, setting.controlEl);
									},
								},
							],
						},
					],
				}),
			),
		];
	}

	/**
	 * Reads a control value.
	 *
	 * Dotted keys address nested settings: `rollover.weekly` is
	 * `settings.rollover.weekly`, while `enabledLevels.daily` is a membership
	 * test against the `enabledLevels` array.
	 */
	override getControlValue(key: string): unknown {
		const settings = this.plugin.settings;
		const [head, leaf, field] = key.split(".");

		switch (head) {
			case "taskFolder":
				return settings.taskFolder;
			case "defaultLevel":
				return settings.defaultLevel;
			case "sortWithinColumn":
				return settings.sortWithinColumn;
			case "strictHierarchy":
				return settings.strictHierarchy;
			case "hideEmptyColumns":
				return settings.hideEmptyColumns;
			case "collapseEmptyTerminalColumns":
				return settings.collapseEmptyTerminalColumns;
			case "folderPerLevel":
				return settings.folderPerLevel;
			case "colorBlindSafe":
				return settings.colorBlindSafe;
			case "levelFolderNames":
				return isLevel(leaf) ? settings.levelFolderNames[leaf] : undefined;
			case "enabledLevels":
				return isLevel(leaf) && settings.enabledLevels.includes(leaf);
			case "enabledPriorities":
				return isPriority(leaf) && settings.enabledPriorities.includes(leaf);
			case "showCardMetadata":
				return isCardMetadataKey(leaf) && settings.showCardMetadata[leaf];
			case "rollover":
				return isLevel(leaf) ? settings.rollover[leaf] : undefined;
			case "kanban":
				return isLevel(leaf) ? this.kanbanValue(leaf, field) : undefined;
			default:
				return undefined;
		}
	}

	/** Reads one Kanban option for a board. */
	private kanbanValue(level: Level, field: string | undefined): unknown {
		const kanban = this.plugin.settings.kanban[level];
		switch (field) {
			case "groupBy":
				return kanban.groupBy;
			case "swimLane":
				return kanban.swimLane;
			case "columnWidth":
				return kanban.columnWidth;
			case "maxSwimLaneHeight":
				return kanban.maxSwimLaneHeight;
			case "hideEmptySwimLanes":
				return kanban.hideEmptySwimLanes;
			case "cardLayout":
				return kanban.cardLayout;
			case "explodeListColumns":
				return kanban.explodeListColumns;
			case "pinnedColumns":
				return kanban.pinnedColumns.join(", ");
			case "wipLimits":
				return Object.keys(kanban.wipLimits).length === 0
					? ""
					: JSON.stringify(kanban.wipLimits);
			default:
				return undefined;
		}
	}

	/** Writes one Kanban option for a board. */
	private setKanbanValue(level: Level, field: string | undefined, value: unknown): void {
		const next = { ...this.plugin.settings.kanban[level] };
		switch (field) {
			case "groupBy":
				if (isKanbanGroupBy(value)) {
					next.groupBy = value;
				}
				break;
			case "swimLane":
				if (isKanbanSwimLane(value)) {
					next.swimLane = value;
				}
				break;
			case "columnWidth":
				if (typeof value === "number") {
					next.columnWidth = value;
				}
				break;
			case "maxSwimLaneHeight":
				if (typeof value === "number") {
					next.maxSwimLaneHeight = value;
				}
				break;
			case "hideEmptySwimLanes":
				next.hideEmptySwimLanes = value === true;
				break;
			case "cardLayout":
				if (isCardLayout(value)) {
					next.cardLayout = value;
				}
				break;
			case "explodeListColumns":
				next.explodeListColumns = value === true;
				break;
			case "pinnedColumns":
				if (typeof value === "string") {
					next.pinnedColumns = value
						.split(",")
						.map((entry) => entry.trim())
						.filter((entry) => entry !== "");
				}
				break;
			case "wipLimits":
				if (typeof value === "string") {
					const parsed = parseWipLimits(value);
					if (parsed !== null) {
						next.wipLimits = parsed;
					}
				}
				break;
			default:
				return;
		}
		// A property cannot be both the column axis and the row axis.
		if (next.swimLane === next.groupBy) {
			next.swimLane = "none";
		}
		this.plugin.settings.kanban[level] = next;
	}

	/** One Kanban control per option, for a single board. */
	private kanbanDefinitions(level: Level): SettingDefinition[] {
		const key = (field: string): string => `kanban.${level}.${field}`;
		return [
			{
				name: strings.settings.kanban.groupBy.name,
				desc: strings.settings.kanban.groupBy.desc,
				control: {
					type: "dropdown",
					key: key("groupBy"),
					options: strings.settings.kanbanOptions.groupBy,
				},
			},
			{
				name: strings.settings.kanban.swimLane.name,
				desc: strings.settings.kanban.swimLane.desc,
				control: {
					type: "dropdown",
					key: key("swimLane"),
					options: strings.settings.kanbanOptions.swimLane,
				},
			},
			{
				name: strings.settings.kanban.columnWidth.name,
				desc: strings.settings.kanban.columnWidth.desc,
				control: {
					type: "slider",
					key: key("columnWidth"),
					min: MIN_COLUMN_WIDTH,
					max: MAX_COLUMN_WIDTH,
					step: 10,
					defaultValue: DEFAULT_COLUMN_WIDTH,
				},
			},
			{
				name: strings.settings.kanban.maxSwimLaneHeight.name,
				desc: strings.settings.kanban.maxSwimLaneHeight.desc,
				control: {
					type: "slider",
					key: key("maxSwimLaneHeight"),
					min: MIN_SWIMLANE_HEIGHT,
					max: MAX_SWIMLANE_HEIGHT,
					step: 20,
					defaultValue: DEFAULT_SWIMLANE_HEIGHT,
				},
			},
			this.toggle(
				strings.settings.kanban.hideEmptySwimLanes.name,
				strings.settings.kanban.hideEmptySwimLanes.desc,
				key("hideEmptySwimLanes"),
			),
			{
				name: strings.settings.kanban.cardLayout.name,
				desc: strings.settings.kanban.cardLayout.desc,
				control: {
					type: "dropdown",
					key: key("cardLayout"),
					options: strings.settings.kanbanOptions.cardLayout,
				},
			},
			{
				name: strings.settings.kanban.explodeListColumns.name,
				desc: strings.settings.kanban.explodeListColumns.desc,
				control: {
					type: "toggle",
					key: key("explodeListColumns"),
					defaultValue: true,
				},
			},
			{
				name: strings.settings.kanban.pinnedColumns.name,
				desc: strings.settings.kanban.pinnedColumns.desc,
				control: {
					type: "text",
					key: key("pinnedColumns"),
					placeholder: "todo, in-progress",
				},
			},
			{
				name: strings.settings.kanban.wipLimits.name,
				desc: strings.settings.kanban.wipLimits.desc,
				control: {
					type: "text",
					key: key("wipLimits"),
					placeholder: '{"in-progress":5}',
				},
			},
		];
	}

	/** Writes a control value and persists it. */
	override async setControlValue(key: string, value: unknown): Promise<void> {		const settings = this.plugin.settings;
		const [head, leaf, field] = key.split(".");
		let refresh = false;
		let reindex = false;
		let recolour = false;

		switch (head) {
			case "taskFolder":
				if (typeof value === "string") {
					settings.taskFolder = normalizeTaskFolder(value);
				}
				break;
			case "defaultLevel":
				if (isLevel(value) && settings.enabledLevels.includes(value)) {
					settings.defaultLevel = value;
				}
				break;
			case "sortWithinColumn":
				if (isSortMode(value)) {
					settings.sortWithinColumn = value;
				}
				break;
			case "strictHierarchy":
				settings.strictHierarchy = value === true;
				break;
			case "hideEmptyColumns":
				settings.hideEmptyColumns = value === true;
				break;
			case "collapseEmptyTerminalColumns":
				settings.collapseEmptyTerminalColumns = value === true;
				break;
			case "folderPerLevel":
				settings.folderPerLevel = value === true;
				// Whether a note sits in the wrong folder is derived from the layout,
				// so every task has to be read again.
				reindex = true;
				break;
			case "levelFolderNames":
				if (isLevel(leaf) && typeof value === "string") {
					settings.levelFolderNames[leaf] = normalizeLevelFolderName(value, leaf);
					reindex = true;
				}
				break;
			case "colorBlindSafe":
				settings.colorBlindSafe = value === true;
				// Only statuses still on a palette colour move; the user's own choices
				// are theirs. Every board is recoloured from its own registry.
				settings.statuses = this.recolourStatuses(
					settings.colorBlindSafe
						? COLOR_BLIND_SAFE_STATUS_COLORS
						: DEFAULT_STATUS_COLORS,
				);
				recolour = true;
				break;
			case "enabledLevels":
				if (isLevel(leaf) && typeof value === "boolean") {
					settings.enabledLevels = toggleInOrder(
						LEVELS,
						settings.enabledLevels,
						leaf,
						value,
					);
					this.repairDefaultLevel();
					refresh = true;
				}
				break;
			case "enabledPriorities":
				if (isPriority(leaf) && typeof value === "boolean") {
					settings.enabledPriorities = toggleInOrder(
						PRIORITIES,
						settings.enabledPriorities,
						leaf,
						value,
					);
				}
				break;
			case "showCardMetadata":
				if (isCardMetadataKey(leaf) && typeof value === "boolean") {
					settings.showCardMetadata[leaf] = value;
				}
				break;
			case "rollover":
				if (isLevel(leaf) && isRolloverBehavior(value)) {
					settings.rollover[leaf] = value;
				}
				break;
			case "kanban":
				if (isLevel(leaf)) {
					this.setKanbanValue(leaf, field, value);
					refresh = true;
					// Redraws every open board with the new grouping.
					recolour = true;
				}
				break;
			default:
				return;
		}

		await this.plugin.saveSettings();

		if (reindex) {
			// Re-reading the vault is what re-raises or clears the folder warnings.
			void this.plugin.tasks.refresh();
		}
		if (recolour) {
			// Redrawing the board is what makes new status colours appear at once.
			void this.plugin.tasks.refresh();
		}

		if (refresh) {
			// The board options derive from the enabled horizons, so re-render.
			this.update();
		}
	}

	/** One folder-name field per horizon, shown only when the layout is on. */
	private levelFolderDefinitions(): SettingDefinition[] {
		return LEVELS.map(
			(level: Level): SettingDefinition => ({
				name: formatTemplate(strings.settings.folders.levelFolder.name, {
					level: strings.levels[level],
				}),
				desc: strings.settings.folders.levelFolder.desc,
				visible: (): boolean => this.plugin.settings.folderPerLevel,
				control: {
					type: "text",
					key: `levelFolderNames.${level}`,
					placeholder: DEFAULT_LEVEL_FOLDER_NAMES[level],
					defaultValue: DEFAULT_LEVEL_FOLDER_NAMES[level],
				},
			}),
		);
	}

	/** One toggle per horizon, refusing to disable the last one. */
	private levelDefinitions(): SettingDefinition[] {
		return LEVELS.map(
			(level: Level): SettingDefinition => ({
				name: strings.levels[level],
				desc: strings.levelDescriptions[level],
				control: {
					type: "toggle",
					key: `enabledLevels.${level}`,
					defaultValue: true,
					validate: (enabled: boolean): string | void =>
						!enabled && this.plugin.settings.enabledLevels.length <= 1
							? strings.settings.board.enabledLevels.atLeastOne
							: undefined,
				},
			}),
		);
	}

	/** One toggle per priority, refusing to disable the last one. */
	private priorityDefinitions(): SettingDefinition[] {
		return PRIORITIES.map(
			(priority: Priority, index: number): SettingDefinition => ({
				name: strings.priorities[priority],
				desc: index === 0 ? strings.settings.priorities.intro : undefined,
				control: {
					type: "toggle",
					key: `enabledPriorities.${priority}`,
					defaultValue: true,
					validate: (enabled: boolean): string | void =>
						!enabled && this.plugin.settings.enabledPriorities.length <= 1
							? strings.settings.priorities.atLeastOne
							: undefined,
				},
			}),
		);
	}

	/** One rollover dropdown per period-scoped horizon. */
	private rolloverDefinitions(): SettingDefinition[] {
		return PERIOD_LEVELS.map(
			(level, index): SettingDefinition => ({
				name: strings.levels[level],
				desc: index === 0 ? strings.settings.rollover.intro : undefined,
				control: {
					type: "dropdown",
					key: `rollover.${level}`,
					options: this.rolloverOptions(),
				},
			}),
		);
	}

	private toggle(name: string, desc: string, key: string): SettingDefinition {
		return { name, desc, control: { type: "toggle", key, defaultValue: false } };
	}

	private levelOptions(): Record<string, string> {
		const options: Record<string, string> = {};
		for (const level of this.plugin.settings.enabledLevels) {
			options[level] = strings.levels[level];
		}
		return options;
	}

	private sortModeOptions(): Record<string, string> {
		const options: Record<string, string> = {};
		for (const mode of SORT_MODES) {
			options[mode] = strings.sortModes[mode];
		}
		return options;
	}

	private rolloverOptions(): Record<string, string> {
		const options: Record<string, string> = {};
		for (const behavior of ROLLOVER_BEHAVIORS) {
			options[behavior] = strings.rolloverBehaviors[behavior];
		}
		return options;
	}

	/** Keeps `defaultLevel` pointing at a horizon that is still enabled. */
	private repairDefaultLevel(): void {
		const settings = this.plugin.settings;
		if (!settings.enabledLevels.includes(settings.defaultLevel)) {
			settings.defaultLevel = settings.enabledLevels[0] ?? "daily";
		}
	}

	/**
	 * The interactive status registry editor.
	 *
	 * Each row edits one status. Ids are immutable, so renaming or recolouring
	 * never touches task notes; order is the column order. Deleting is the only
	 * destructive action and asks for a replacement first.
	 */
	private renderStatusEditor(level: Level, containerEl: HTMLElement): void {
		const statuses = this.plugin.settings.statuses[level];
		const editor = containerEl.createDiv({
			cls: "task-flow-status-list task-flow-status-editor",
		});

		statuses.forEach((status, index) => {
			const row = editor.createDiv({ cls: "task-flow-status-row" });

			row.createEl("input", {
				cls: "task-flow-status-color",
				attr: {
					type: "color",
					"aria-label": strings.settings.statuses.color,
					value: status.color,
				},
			}).addEventListener("input", (event) => {
				const color = (event.currentTarget as HTMLInputElement).value;
				void this.applyStatuses(level, updateStatus(statuses, status.id, { color }));
			});

			const label = row.createEl("input", {
				cls: "task-flow-status-label-input",
				attr: {
					type: "text",
					"aria-label": strings.settings.statuses.label,
					value: status.label,
				},
			});
			label.addEventListener("change", () => {
				const value = label.value.trim();
				if (value !== "" && value !== status.label) {
					void this.applyStatuses(level, updateStatus(statuses, status.id, { label: value }));
				} else {
					label.value = status.label;
				}
			});

			const category = row.createEl("select", {
				cls: "dropdown task-flow-status-category",
				attr: { "aria-label": strings.settings.statuses.category },
			});
			for (const value of STATUS_CATEGORIES) {
				category.createEl("option", {
					value,
					text: strings.statusCategories[value],
				});
			}
			category.value = status.category;
			category.addEventListener("change", () => {
				void this.applyStatuses(
					level,
					updateStatus(statuses, status.id, {
						category: category.value as StatusCategory,
					}),
				);
			});

			this.statusWarning(row, status.color);

			// Only a done status can auto-archive: the sweep keys off `completedAt`.
			if (status.category === "done") {
				const archive = row.createEl("input", {
					cls: "task-flow-status-archive",
					attr: {
						type: "number",
						min: "0",
						placeholder: "0",
						"aria-label": strings.settings.statuses.archiveAfter,
						value:
							status.archiveAfterMinutes == null
								? ""
								: String(status.archiveAfterMinutes),
					},
				});
				archive.addEventListener("change", () => {
					const parsed = Number(archive.value.trim());
					const minutes =
						archive.value.trim() !== "" && Number.isFinite(parsed) && parsed > 0
							? Math.round(parsed)
							: null;
					void this.applyStatuses(
						level,
						updateStatus(statuses, status.id, {
							archiveAfterMinutes: minutes,
						}),
					);
				});
			}

			this.statusIconButton(
				row,
				"chevron-up",
				strings.settings.statuses.moveUp,
				index === 0,
				() => this.applyStatuses(level, reorderStatus(statuses, status.id, index - 1)),
			);
			this.statusIconButton(
				row,
				"chevron-down",
				strings.settings.statuses.moveDown,
				index === statuses.length - 1,
				() => this.applyStatuses(level, reorderStatus(statuses, status.id, index + 1)),
			);
			this.statusIconButton(
				row,
				"trash-2",
				strings.settings.statuses.delete,
				statuses.length <= 1,
				() => this.confirmDeleteStatus(level, status),
			);
		});

		const footer = editor.createDiv({ cls: "task-flow-status-add" });
		footer
			.createEl("button", { text: strings.settings.statuses.add, cls: "mod-cta" })
			.addEventListener("click", () => {
				const { registry, status } = addStatus(statuses, {
					label: strings.settings.statuses.newLabel,
					color: DEFAULT_STATUS_COLORS.todo,
					category: "todo",
				});
				void this.applyStatuses(level, registry).then(() => {
					window.setTimeout(() => this.highlightStatus(level, status.id), 0);
				});
			});
	}

	/** A small icon button in a status row, disabled when the action is unavailable. */
	private statusIconButton(
		row: HTMLElement,
		icon: string,
		label: string,
		disabled: boolean,
		action: () => void | Promise<void>,
	): void {
		const button = row.createEl("button", { cls: "clickable-icon task-flow-status-action" });
		setIcon(button, icon);
		button.setAttribute("aria-label", label);
		button.disabled = disabled;
		button.addEventListener("click", () => {
			void action();
		});
	}

	/** Focuses the label field of a freshly added status so it can be typed over. */
	private highlightStatus(level: Level, id: string): void {
		const rows = this.containerEl.querySelectorAll<HTMLElement>(
			".task-flow-status-editor .task-flow-status-row",
		);
		const index = this.plugin.settings.statuses[level].findIndex(
			(status) => status.id === id,
		);
		rows[index]?.querySelector<HTMLInputElement>(".task-flow-status-label-input")?.select();
	}

	/** Shows the contrast warning for a status colour, if it needs one. */
	private statusWarning(containerEl: HTMLElement, color: string): void {
		// A colour that disappears into one of the themes is worth saying out
		// loud here, where it can be changed, rather than only on the board.
		if (meetsGraphicContrast(color).ok) {
			return;
		}
		containerEl.createDiv({
			cls: "task-flow-status-warning",
			text: formatTemplate(strings.settings.colors.contrastWarning, { color }),
		});
	}

	/** Applies a palette to every board that is still on default colours. */
	private recolourStatuses(palette: Record<string, string>): StatusRegistries {
		const next = {} as StatusRegistries;
		for (const level of LEVELS) {
			next[level] = applyPalette(this.plugin.settings.statuses[level], palette);
		}
		return next;
	}

	/** Persists one board's registry and redraws whatever is showing it. */
	private async applyStatuses(
		level: Level,
		statuses: readonly StatusDefinition[],
	): Promise<void> {
		this.plugin.settings.statuses[level] = statuses.map((status) => ({ ...status }));
		await this.plugin.saveSettings();
		// Redrawing every open board is what makes new or recoloured columns appear.
		this.plugin.tasks.refresh();
		this.update();
	}

	/** Asks which status should replace one before deleting it. */
	private confirmDeleteStatus(level: Level, status: StatusDefinition): void {
		const targets = migrationTargets(this.plugin.settings.statuses[level], status.id);
		new StatusDeleteModal(this.app, status, targets, (replacementId) => {
			void this.deleteStatus(level, status.id, replacementId);
		}).open();
	}

	/** Moves this board's tasks off a status, then removes it from the registry. */
	private async deleteStatus(
		level: Level,
		id: string,
		replacementId: string,
	): Promise<void> {
		for (const task of this.plugin.tasks.tasks) {
			if (task.level === level && task.status === id) {
				this.plugin.tasks.updateFields(task.path, { status: replacementId });
			}
		}
		await this.plugin.tasks.flush();

		try {
			this.plugin.settings.statuses[level] = deleteStatus(
				this.plugin.settings.statuses[level],
				id,
				replacementId,
			);
		} catch (error) {
			logError(`Could not delete status "${id}"`, error);
			return;
		}

		await this.plugin.saveSettings();
		this.plugin.tasks.refresh();
		this.update();
	}
}
