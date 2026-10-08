import { describe, expect, it } from "vitest";

import { cloneStatusesByLevel } from "../src/domain";
import { taskPanelData } from "../src/ui/note-panel";
import { makeTask } from "./helpers";

/** A fresh set of per-board registries, so status labels resolve. */
const registries = cloneStatusesByLevel();

describe("taskPanelData", () => {
	it("carries a filled framework through for an objective", () => {
		const task = makeTask({
			path: "Goals/launch.md",
			level: "objective",
			period: null,
			framework: { why: "Reach the right people", risks: "Scope creep" },
		});

		const data = taskPanelData(task, registries.objective);

		// Requirement: a filled term such as "Why" is what the note panel draws.
		expect(data.framework).toEqual({
			why: "Reach the right people",
			risks: "Scope creep",
		});
	});

	it("draws only the fields that are filled in", () => {
		const task = makeTask({
			path: "Tasks/Daily/write.md",
			status: "todo",
			priority: "none",
			period: "2026-09-30",
			parent: null,
			tags: [],
			created: null,
			completed: null,
		});

		const labels = taskPanelData(task, registries.daily).fields.map((field) => field.label);

		expect(labels).toEqual(["Status", "Horizon", "Period"]);
		expect(labels).not.toContain("Priority");
	});

	it("adds tags, priority, parent and dates when they are set", () => {
		const task = makeTask({
			path: "Tasks/Daily/write.md",
			status: "todo",
			priority: "high",
			period: "2026-09-30",
			parent: "[[2026-W40 Launch website]]",
			tags: ["work", "site"],
			created: "2026-09-29",
			completed: "2026-09-30",
		});

		const data = taskPanelData(task, registries.daily);

		expect(data.fields.map((field) => field.label)).toEqual([
			"Status",
			"Priority",
			"Horizon",
			"Period",
			"Parent",
			"Created",
			"Completed",
		]);
		// The parent is shown as its target, without the wikilink brackets.
		expect(data.fields.find((field) => field.label === "Parent")?.value).toBe(
			"2026-W40 Launch website",
		);
		expect(data.tags).toEqual(["work", "site"]);
	});
});
