/**
 * Applying a path-addressed patch to a plain value.
 *
 * `{ path: ['modules', 'shape'], value: { id: 'dot' } }` replaces one part of
 * a design, and an empty path the whole of it, as verify's `applyDesignPatch`
 * reads a patch. It copies only the objects on the way down, so everything
 * beside the path keeps its identity. A missing step on the way is created,
 * an object for a string key and an array for a number, and a value of
 * `undefined` removes the key. Whether the result is a good design is the
 * validator's question; this only refuses paths no design could have, so a
 * patch can never reach an object's prototype.
 */

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
/** Deeper than any design goes; a longer path is a mistake or an attack. */
const MAX_DEPTH = 16;

/** Why a path cannot be applied, or null when it can. */
export function pathProblem(path: unknown): 'shape' | 'key' | null {
	// An empty path is the whole design, as verify's applyDesignPatch reads one.
	if (!Array.isArray(path) || path.length > MAX_DEPTH) return 'shape';
	for (const step of path) {
		if (typeof step === 'number') {
			if (!Number.isInteger(step) || step < 0 || step > 1024) return 'shape';
		} else if (typeof step !== 'string' || step.length === 0 || step.length > 64) {
			return 'shape';
		} else if (FORBIDDEN_KEYS.has(step)) {
			return 'key';
		}
	}
	return null;
}

function setAt(
	target: unknown,
	path: readonly (string | number)[],
	at: number,
	value: unknown,
): unknown {
	const step = path[at] as string | number;
	const container: Record<string | number, unknown> | unknown[] = Array.isArray(target)
		? [...target]
		: typeof target === 'object' && target !== null
			? { ...(target as Record<string, unknown>) }
			: typeof step === 'number'
				? []
				: {};
	const record = container as Record<string | number, unknown>;
	if (at === path.length - 1) {
		if (value === undefined) {
			if (Array.isArray(container)) container.splice(step as number, 1);
			else delete record[step];
		} else {
			record[step] = value;
		}
		return container;
	}
	record[step] = setAt(record[step], path, at + 1, value);
	return container;
}

/** `target` with `value` at `path`. Call only with a path `pathProblem` accepts. */
export function applyPatch(
	target: unknown,
	path: readonly (string | number)[],
	value: unknown,
): unknown {
	return path.length === 0 ? value : setAt(target, path, 0, value);
}
