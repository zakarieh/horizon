/**
 * Fractional indexing over base-62 string keys.
 *
 * Keys are short, lexicographically sortable strings. Inserting a card between
 * two neighbours only rewrites that one card, which is what makes drag-and-drop
 * reordering cheap in a file-per-task vault.
 *
 * Floating point indices are deliberately avoided: they run out of precision
 * after ~50 insertions in the same gap.
 *
 * This is the classic algorithm popularised by Figma and used by Excalidraw. It
 * has an optional integer head (`a0`, `a1`, ... `b00`) so that keys can also be
 * grown to the left and right without bound.
 */

/** The base-62 alphabet, ordered by ASCII code so string comparison is correct. */
const BASE_62_DIGITS =
	"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/**
 * The smallest key that can ever be generated; no key may sort before it.
 * `A` has a 27 character integer head, so this is `A` plus 26 zero digits.
 */
const SMALLEST_KEY = `A${"0".repeat(26)}`;

/**
 * Splits a key into its integer head and its fractional tail.
 * `a0` has head `a0` and no tail; `a0V` has head `a0` and tail `V`.
 */
function getIntegerLength(head: string): number {
	if (head >= "a" && head <= "z") {
		return head.charCodeAt(0) - "a".charCodeAt(0) + 2;
	}
	if (head >= "A" && head <= "Z") {
		return "Z".charCodeAt(0) - head.charCodeAt(0) + 2;
	}
	throw new Error(`invalid order key head: ${head}`);
}

function getIntegerPart(key: string): string {
	const length = getIntegerLength(key.charAt(0));
	if (length > key.length) {
		throw new Error(`invalid order key: ${key}`);
	}
	return key.slice(0, length);
}

function validateInteger(int: string): void {
	if (int.length !== getIntegerLength(int.charAt(0))) {
		throw new Error(`invalid integer part of order key: ${int}`);
	}
}

/**
 * Computes a key strictly between `a` and `b`.
 *
 * @param a Lower bound (exclusive); `null` means "before everything".
 * @param b Upper bound (exclusive); `null` means "after everything".
 * @param digits Alphabet to use, ordered by ascending character code.
 */
function midpoint(a: string, b: string | null, digits: string): string {
	const zero = digits.charAt(0);

	if (b !== null && a >= b) {
		throw new Error(`${a} >= ${b}`);
	}
	if (a.slice(-1) === zero || (b !== null && b.slice(-1) === zero)) {
		throw new Error("trailing zero");
	}

	if (b !== null) {
		// Strip the longest common prefix; it is identical in the result.
		let n = 0;
		while ((a.charAt(n) || zero) === b.charAt(n)) {
			n++;
		}
		if (n > 0) {
			return b.slice(0, n) + midpoint(a.slice(n), b.slice(n), digits);
		}
	}

	const digitA = a ? digits.indexOf(a.charAt(0)) : 0;
	const digitB = b !== null ? digits.indexOf(b.charAt(0)) : digits.length;

	if (digitB - digitA > 1) {
		const midDigit = Math.round(0.5 * (digitA + digitB));
		return digits.charAt(midDigit);
	}

	// The leading digits are adjacent, so recurse into the tail.
	if (b !== null && b.length > 1) {
		return b.slice(0, 1);
	}
	return digits.charAt(digitA) + midpoint(a.slice(1), null, digits);
}

function incrementInteger(x: string, digits: string): string | null {
	validateInteger(x);
	const head = x.charAt(0);
	const digs = x.slice(1).split("");
	let carry = true;

	for (let i = digs.length - 1; carry && i >= 0; i--) {
		const d = digits.indexOf(digs[i]) + 1;
		if (d === digits.length) {
			digs[i] = digits.charAt(0);
		} else {
			digs[i] = digits.charAt(d);
			carry = false;
		}
	}

	if (!carry) {
		return head + digs.join("");
	}
	if (head === "Z") {
		return `a${digits.charAt(0)}`;
	}
	if (head === "z") {
		return null;
	}

	const nextHead = String.fromCharCode(head.charCodeAt(0) + 1);
	if (nextHead > "a") {
		digs.push(digits.charAt(0));
	} else {
		digs.pop();
	}
	return nextHead + digs.join("");
}

function decrementInteger(x: string, digits: string): string | null {
	validateInteger(x);
	const head = x.charAt(0);
	const digs = x.slice(1).split("");
	let borrow = true;

	for (let i = digs.length - 1; borrow && i >= 0; i--) {
		const d = digits.indexOf(digs[i]) - 1;
		if (d === -1) {
			digs[i] = digits.charAt(digits.length - 1);
		} else {
			digs[i] = digits.charAt(d);
			borrow = false;
		}
	}

	if (!borrow) {
		return head + digs.join("");
	}
	if (head === "a") {
		return `Z${digits.charAt(digits.length - 1)}`;
	}
	if (head === "A") {
		return null;
	}

	const prevHead = String.fromCharCode(head.charCodeAt(0) - 1);
	if (prevHead < "Z") {
		digs.push(digits.charAt(digits.length - 1));
	} else {
		digs.pop();
	}
	return prevHead + digs.join("");
}

/**
 * Throws when `key` is not a well-formed order key.
 * Exposed indirectly through {@link isValidOrderKey}.
 */
function assertOrderKey(key: string): void {
	if (key === SMALLEST_KEY) {
		throw new Error(`invalid order key: ${key}`);
	}
	const integerPart = getIntegerPart(key);
	const fractionalPart = key.slice(integerPart.length);
	if (fractionalPart.slice(-1) === BASE_62_DIGITS.charAt(0)) {
		throw new Error(`invalid order key: ${key}`);
	}
}

/**
 * Generates a key that sorts strictly between `a` and `b`.
 *
 * @param a Lower bound, or `null` for "insert at the very start".
 * @param b Upper bound, or `null` for "insert at the very end".
 * @returns A base-62 key `k` with `a < k < b`.
 * @throws When both bounds are non-`null` and `a >= b`, or when a bound is not
 * a valid order key.
 */
export function generateKeyBetween(a: string | null, b: string | null): string {
	const digits = BASE_62_DIGITS;

	if (a !== null) {
		assertOrderKey(a);
	}
	if (b !== null) {
		assertOrderKey(b);
	}
	if (a !== null && b !== null && a >= b) {
		throw new Error(`${a} >= ${b}`);
	}

	if (a === null) {
		if (b === null) {
			return `a${digits.charAt(0)}`;
		}
		const integerB = getIntegerPart(b);
		const fractionalB = b.slice(integerB.length);
		if (integerB === SMALLEST_KEY) {
			return integerB + midpoint("", fractionalB, digits);
		}
		if (integerB < b) {
			return integerB;
		}
		const decremented = decrementInteger(integerB, digits);
		if (decremented === null) {
			throw new Error("cannot decrement any more");
		}
		return decremented;
	}

	if (b === null) {
		const integerA = getIntegerPart(a);
		const fractionalA = a.slice(integerA.length);
		const incremented = incrementInteger(integerA, digits);
		return incremented === null ? integerA + midpoint(fractionalA, null, digits) : incremented;
	}

	const integerA = getIntegerPart(a);
	const fractionalA = a.slice(integerA.length);
	const integerB = getIntegerPart(b);
	const fractionalB = b.slice(integerB.length);

	if (integerA === integerB) {
		return integerA + midpoint(fractionalA, fractionalB, digits);
	}

	const incremented = incrementInteger(integerA, digits);
	if (incremented === null) {
		throw new Error("cannot increment any more");
	}
	if (incremented < b) {
		return incremented;
	}
	return integerA + midpoint(fractionalA, null, digits);
}

/**
 * Generates `n` evenly distributed keys, all strictly between `a` and `b` and
 * in ascending order. Used when importing or bulk-creating cards.
 *
 * @param a Lower bound, or `null`.
 * @param b Upper bound, or `null`.
 * @param n How many keys to generate; must be a non-negative integer.
 */
export function generateNKeysBetween(
	a: string | null,
	b: string | null,
	n: number,
): string[] {
	if (!Number.isInteger(n) || n < 0) {
		throw new Error(`n must be a non-negative integer, got ${n}`);
	}
	if (n === 0) {
		return [];
	}
	if (n === 1) {
		return [generateKeyBetween(a, b)];
	}

	if (b === null) {
		let current = generateKeyBetween(a, b);
		const keys = [current];
		for (let i = 0; i < n - 1; i++) {
			current = generateKeyBetween(current, b);
			keys.push(current);
		}
		return keys;
	}

	if (a === null) {
		let current = generateKeyBetween(a, b);
		const keys = [current];
		for (let i = 0; i < n - 1; i++) {
			current = generateKeyBetween(a, current);
			keys.push(current);
		}
		return keys.reverse();
	}

	const middle = Math.floor(n / 2);
	const pivot = generateKeyBetween(a, b);
	return [
		...generateNKeysBetween(a, pivot, middle),
		pivot,
		...generateNKeysBetween(pivot, b, n - middle - 1),
	];
}

/**
 * Returns the key used for the first card ever created in a column.
 */
export function firstOrderKey(): string {
	return generateKeyBetween(null, null);
}

/**
 * Whether `key` is a syntactically valid order key produced by this module.
 * Useful when validating hand-edited frontmatter.
 */
export function isValidOrderKey(key: unknown): boolean {
	if (typeof key !== "string" || key === "") {
		return false;
	}
	try {
		assertOrderKey(key);
		return true;
	} catch {
		return false;
	}
}
