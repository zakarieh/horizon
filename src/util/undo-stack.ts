/**
 * A small bounded undo stack.
 *
 * The vault is the source of truth, so "undo" here means "write the previous
 * values back", not "roll back a transaction". Keeping the last few changes
 * makes the surprising ones - a task jumping to another board because its period
 * changed, or a status migration - reversible with one command.
 *
 * Generic on purpose: it holds whatever a caller wants to restore.
 */
export class UndoStack<T> {
	private readonly entries: T[] = [];
	private readonly limit: number;

	/**
	 * @param limit How many entries to keep. Must be at least 1.
	 */
	constructor(limit = 20) {
		this.limit = Math.max(1, Math.floor(limit));
	}

	/** Records a change, dropping the oldest entry once the stack is full. */
	push(entry: T): void {
		this.entries.push(entry);
		if (this.entries.length > this.limit) {
			this.entries.shift();
		}
	}

	/** Removes and returns the most recent entry. */
	pop(): T | undefined {
		return this.entries.pop();
	}

	/** Looks at the most recent entry without removing it. */
	peek(): T | undefined {
		return this.entries[this.entries.length - 1];
	}

	/** How many changes can still be undone. */
	get size(): number {
		return this.entries.length;
	}

	/** Forgets everything. */
	clear(): void {
		this.entries.length = 0;
	}
}
