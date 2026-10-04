import { describe, expect, it } from "vitest";

import {
	ARCHIVE_FOLDER_NAME,
	DEFAULT_LEVEL_FOLDER_NAMES,
	archiveFolderForLevel,
	correctedPathFor,
	folderForLevel,
	isFolderMismatch,
	isInLevelFolder,
	isLevelFolder,
	levelFolders,
	normalizeLevelFolderName,
	type LevelFolderLayout,
} from "../src/domain";

const LAYOUT: LevelFolderLayout = {
	enabled: true,
	root: "Tasks/",
	names: { ...DEFAULT_LEVEL_FOLDER_NAMES },
};

/** The flat layout: everything in the root, and no warnings ever. */
const FLAT: LevelFolderLayout = { ...LAYOUT, enabled: false };

describe("folderForLevel", () => {
	it("gives each horizon its own folder under the task root", () => {
		expect(folderForLevel(LAYOUT, "daily")).toBe("Tasks/Daily/");
		expect(folderForLevel(LAYOUT, "weekly")).toBe("Tasks/Weekly/");
		expect(folderForLevel(LAYOUT, "objective")).toBe("Tasks/Objectives/");
	});

	it("puts every horizon in the root when the layout is flat", () => {
		expect(folderForLevel(FLAT, "weekly")).toBe("Tasks/");
		expect(folderForLevel(FLAT, "objective")).toBe("Tasks/");
	});

	it("follows a renamed folder", () => {
		const renamed: LevelFolderLayout = {
			...LAYOUT,
			names: { ...LAYOUT.names, weekly: "Sprints" },
		};
		expect(folderForLevel(renamed, "weekly")).toBe("Tasks/Sprints/");
	});
});

describe("isInLevelFolder", () => {
	it("accepts a file in its own level folder", () => {
		expect(isInLevelFolder(LAYOUT, "Tasks/Weekly/2026-W40 Launch.md", "weekly")).toBe(
			true,
		);
	});

	it("rejects a file in another level folder", () => {
		expect(isInLevelFolder(LAYOUT, "Tasks/Daily/2026-09-28 Launch.md", "weekly")).toBe(
			false,
		);
	});

	it("rejects a file sitting loose in the task root", () => {
		expect(isInLevelFolder(LAYOUT, "Tasks/Launch.md", "weekly")).toBe(false);
	});

	it("accepts anything at all when the layout is flat", () => {
		expect(isInLevelFolder(FLAT, "Tasks/Daily/2026-09-28 Launch.md", "weekly")).toBe(
			true,
		);
		expect(isInLevelFolder(FLAT, "Elsewhere/Launch.md", "weekly")).toBe(true);
	});
});

describe("isFolderMismatch", () => {
	it("flags a file in the wrong folder", () => {
		expect(isFolderMismatch(LAYOUT, "Tasks/Daily/2026-09-28 Launch.md", "weekly")).toBe(
			true,
		);
	});

	it("never flags anything in the flat layout", () => {
		expect(isFolderMismatch(FLAT, "Tasks/Daily/2026-09-28 Launch.md", "weekly")).toBe(
			false,
		);
	});
});

describe("correctedPathFor", () => {
	it("moves the file into the folder its horizon calls for", () => {
		expect(correctedPathFor(LAYOUT, "Tasks/Daily/2026-09-28 Launch.md", "weekly")).toBe(
			"Tasks/Weekly/2026-09-28 Launch.md",
		);
	});

	it("leaves the file name exactly as the user wrote it", () => {
		// Renaming during a move would break the links the move is about to fix.
		const path = "Tasks/Daily/Vacation \u2013 reise, Tag 2 (final).md";
		expect(correctedPathFor(LAYOUT, path, "daily")).toBeNull();
		expect(correctedPathFor(LAYOUT, path, "monthly")).toBe(
			`Tasks/Monthly/Vacation \u2013 reise, Tag 2 (final).md`,
		);
	});

	it("returns nothing to do for a file that is already in place", () => {
		expect(correctedPathFor(LAYOUT, "Tasks/Weekly/2026-W40 Launch.md", "weekly")).toBeNull();
		expect(correctedPathFor(FLAT, "Tasks/Daily/2026-09-28 Launch.md", "weekly")).toBeNull();
	});
});

describe("archiveFolderForLevel", () => {
	it("mirrors the level folders under Archive", () => {
		expect(archiveFolderForLevel(LAYOUT, "daily")).toBe("Tasks/Archive/Daily/");
		expect(archiveFolderForLevel(LAYOUT, "objective")).toBe("Tasks/Archive/Objectives/");
	});

	it("keeps every horizon apart rather than sharing one folder", () => {
		const folders = new Set(
			(["daily", "weekly", "monthly", "quarterly", "yearly", "objective"] as const).map(
				(level) => archiveFolderForLevel(LAYOUT, level),
			),
		);
		expect(folders.size).toBe(6);
	});

	it("follows a renamed folder, like the level folder does", () => {
		const renamed: LevelFolderLayout = {
			...LAYOUT,
			names: { ...LAYOUT.names, weekly: "Sprints" },
		};
		expect(archiveFolderForLevel(renamed, "weekly")).toBe("Tasks/Archive/Sprints/");
	});

	it("still archives under the root when the layout is flat", () => {
		expect(archiveFolderForLevel(FLAT, "weekly")).toBe(
			`Tasks/${ARCHIVE_FOLDER_NAME}/Weekly/`,
		);
	});

	it("is not one of the level folders, so an archived note is never 'mismatched'", () => {
		expect(isLevelFolder(LAYOUT, archiveFolderForLevel(LAYOUT, "daily"))).toBe(false);
	});
});

describe("levelFolders", () => {
	it("lists the root and one folder per horizon, in horizon order", () => {
		expect(levelFolders(LAYOUT)).toEqual([
			"Tasks/Daily/",
			"Tasks/Weekly/",
			"Tasks/Monthly/",
			"Tasks/Quarterly/",
			"Tasks/Yearly/",
			"Tasks/Objectives/",
		]);
	});

	it("is just the root in the flat layout", () => {
		expect(levelFolders(FLAT)).toEqual(["Tasks/"]);
	});
});

describe("isLevelFolder", () => {
	it("knows the folders the plugin owns", () => {
		expect(isLevelFolder(LAYOUT, "Tasks/Weekly/")).toBe(true);
		expect(isLevelFolder(LAYOUT, "Tasks/")).toBe(false);
		expect(isLevelFolder(LAYOUT, "Elsewhere/")).toBe(false);
	});

	it("owns nothing but the root when the layout is flat", () => {
		expect(isLevelFolder(FLAT, "Tasks/Weekly/")).toBe(false);
	});
});

describe("normalizeLevelFolderName", () => {
	it("keeps a usable name", () => {
		expect(normalizeLevelFolderName("Sprints", "weekly")).toBe("Sprints");
	});

	it("strips characters a file name cannot hold", () => {
		expect(normalizeLevelFolderName("Week/ly: Sprints?", "weekly")).toBe("Week ly Sprints");
	});

	it("falls back to the default when nothing usable is left", () => {
		expect(normalizeLevelFolderName("   ", "objective")).toBe("Objectives");
		expect(normalizeLevelFolderName("///", "daily")).toBe("Daily");
	});
});
