/**
 * Rollover: carrying unfinished tasks into the current period.
 *
 * Each horizon is scoped to a period (a day, an ISO week, a month, a quarter, a
 * year). When that period ends, a task that is still open does not disappear -
 * it belongs on the equivalent period that is now current. This module decides
 * *which* tasks that is, purely: it reads tasks and a clock and returns the
 * moves. Writing them, and asking the user when the per-horizon behaviour is
 * `ask`, is the repository's and the plugin's job.
 *
 * A task only ever moves forward, and only when its stored period is strictly
 * before the current one, so a catch-up after several missed periods lands the
 * task on today's period in one step instead of creeping forward one period at a
 * time. `objective` has no period by design and never rolls over.
 */

import { comparePeriods, getCurrentPeriod } from "./periods";
import { isTerminalCategory, statusCategory, type StatusRegistries } from "./statuses";
import { isPeriodLevel, type PeriodLevel, type Task } from "./types";

/** A still-open task whose period has passed, and where it should move to. */
export interface RolloverCandidate {
	/** Identity of the task: its vault path. */
	path: string;
	/** The task's horizon, which never changes when it rolls over. */
	level: PeriodLevel;
	/** The period the task sits on now. */
	from: string;
	/** The current period, which is where the task belongs. */
	to: string;
	/**
	 * The period to record in `carriedFrom`.
	 *
	 * The earliest period the task was carried from is kept, so a task that rolls
	 * several times still points back at where it started rather than at the last
	 * period it happened to sit on.
	 */
	carriedFrom: string;
}

/**
 * The tasks that should be carried into the current period.
 *
 * Finished tasks (a `done` or `cancelled` status) are left where they are, and so
 * are archived tasks, tasks on `objective`, and tasks whose period is the current
 * one or later.
 *
 * @param tasks The tasks to inspect, typically `repository.tasks`.
 * @param registries Status registries keyed by level, so a task's status is read
 * against its own board.
 * @param now The clock to use; injected so tests are deterministic.
 */
export function collectRollovers(
	tasks: readonly Task[],
	registries: StatusRegistries,
	now: Date = new Date(),
): RolloverCandidate[] {
	const candidates: RolloverCandidate[] = [];
	for (const task of tasks) {
		if (!isPeriodLevel(task.level) || task.period === null || task.archived === true) {
			continue;
		}
		// An unknown status is treated as open rather than finished: the card is
		// shown in the first column anyway, so carrying it forward is the safer
		// choice - a task never vanishes silently.
		const category = statusCategory(registries[task.level], task.status);
		if (category !== null && isTerminalCategory(category)) {
			continue;
		}

		const current = getCurrentPeriod(task.level, now);
		if (comparePeriods(task.period, current, task.level) >= 0) {
			continue;
		}

		candidates.push({
			path: task.path,
			level: task.level,
			from: task.period,
			to: current,
			carriedFrom: task.carriedFrom ?? task.period,
		});
	}
	return candidates;
}
