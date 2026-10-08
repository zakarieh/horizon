/**
 * Console diagnostics for Horizon Task.
 *
 * All messages carry the `[task-flow]` prefix - the plugin id, not the display
 * name, so the prefix stays stable if the plugin is ever renamed - so they can
 * be filtered in the developer console. There is no telemetry: nothing is ever
 * sent anywhere.
 *
 * The Obsidian plugin guidelines discourage informational logging, so only
 * failures and recoverable problems are reported here. Anything the user has to
 * act on must also surface as a `Notice`.
 */

const PREFIX = "[task-flow]";

/** Logs a recoverable problem, e.g. a parent link that cannot be resolved. */
export function warn(...args: unknown[]): void {
	console.warn(PREFIX, ...args);
}

/**
 * Logs a failure. Always pair this with a `Notice` at the call site so the user
 * sees something actionable rather than only a console entry.
 */
export function logError(message: string, cause?: unknown): void {
	if (cause === undefined) {
		console.error(PREFIX, message);
		return;
	}
	console.error(PREFIX, message, cause);
}
