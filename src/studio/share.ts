/**
 * Structural sharing for plain JSON values.
 *
 * The validator hands back a fresh design every time it checks one, so a
 * change to the logo would otherwise give a new `modules`, a new `regions`
 * and a new everything, and every view memoised on any of them would draw
 * again. `share` walks the new value against the old and keeps each old
 * subtree that is equal, so only the path that really changed has new
 * objects on it. Values are compared as JSON compares them: own enumerable
 * keys in any order, arrays by position.
 */

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Deep equality of two JSON values. */
export function sameJson(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (Array.isArray(a)) {
		if (!Array.isArray(b) || a.length !== b.length) return false;
		for (let i = 0; i < a.length; i += 1) if (!sameJson(a[i], b[i])) return false;
		return true;
	}
	if (isPlainObject(a)) {
		if (!isPlainObject(b)) return false;
		const keys = Object.keys(a);
		if (keys.length !== Object.keys(b).length) return false;
		for (const key of keys) {
			if (!Object.prototype.hasOwnProperty.call(b, key) || !sameJson(a[key], b[key])) return false;
		}
		return true;
	}
	// Distinct numbers, strings and booleans, or one of them against an object.
	return false;
}

/** `next`, with every subtree equal to the one at the same place in `previous` replaced by that one. */
export function share<T>(previous: unknown, next: T): T {
	if (sameJson(previous, next)) return previous as T;
	if (Array.isArray(next) && Array.isArray(previous)) {
		return next.map((item, i) => share(previous[i], item)) as T;
	}
	if (isPlainObject(next) && isPlainObject(previous)) {
		const out: Record<string, unknown> = {};
		for (const key of Object.keys(next)) out[key] = share(previous[key], next[key]);
		return out as T;
	}
	return next;
}
