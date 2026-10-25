/**
 * Conformance for content types: each specification vector reads as its
 * value, and a value that validates is written and read back unchanged.
 *
 * The vectors come from the argument, or else from the type itself. The
 * built-in types carry none, because they would ship to every visitor as
 * test data; theirs are in `./payload/vectors` and the gate passes them in.
 * A type from somewhere else may still carry its own, and they are run when
 * present. A type with no vectors at all has nothing to check here.
 *
 * Specifications print examples that fail their own checks (BIP 21's
 * address fails its base58check checksum), and a reader must still read
 * them. So a vector whose value does not validate is held to reading, and
 * to `build` refusing it, and no more. Which vectors those are is for the
 * caller to pin, as the built-in gate does.
 *
 * Conformance may not import payload, so the parts of a content type this
 * uses are repeated here structurally, as design repeats PayloadConstraints.
 * A `PayloadType` is one of these without a cast.
 *
 * Details name a vector by its position and never quote its text or value:
 * a third party's vectors are theirs to keep out of a log.
 */

import { hasErrors } from '../core/issue.js';
import type { Issue } from '../core/issue.js';
import type { Violation } from './types.js';

/** A published example: the text as printed, the value it holds, and where it was printed. */
export interface PayloadVectorLike<V> {
	readonly text: string;
	readonly value: V;
	readonly source: string;
}

/** The parts of payload's `PayloadType` this check uses. */
export interface PayloadTypeLike<V> {
	readonly id: string;
	readonly generate?: boolean;
	validate(value: V): readonly Issue[];
	build(value: V): { readonly text: string };
	parse(text: string): V;
	readonly vectors?: readonly PayloadVectorLike<V>[];
}

/**
 * Equal as the test suite's `toEqual` compares: a key holding `undefined` is
 * the same as no key, and numbers compare with Object.is, so 0 is not -0.
 */
function same(a: unknown, b: unknown): boolean {
	if (Object.is(a, b)) return true;
	if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
	if (Array.isArray(a) !== Array.isArray(b)) return false;
	if (Array.isArray(a) && Array.isArray(b)) {
		return a.length === b.length && a.every((item, i) => same(item, b[i]));
	}
	const left = a as Record<string, unknown>;
	const right = b as Record<string, unknown>;
	const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
	return [...keys].every((key) => same(left[key], right[key]));
}

/** The field keys two values disagree on, which says where to look without saying what is there. */
function differing(a: unknown, b: unknown): string {
	if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) {
		return 'not a record';
	}
	const left = a as Record<string, unknown>;
	const right = b as Record<string, unknown>;
	const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])];
	return `fields ${keys.filter((key) => !same(left[key], right[key])).join(', ')}`;
}

/** What a thrown value was, by class and code, without its message, which may quote the text. */
function thrown(error: unknown): string {
	if (!(error instanceof Error)) return 'a non-error value';
	const code = (error as { code?: unknown }).code;
	return typeof code === 'string' ? `${error.name} ${code}` : error.name;
}

/**
 * Runs `vectors`, or the type's own when that is left out, and returns one
 * violation per rule a vector breaks. An empty list is a pass.
 */
export function checkPayloadType<V>(
	type: PayloadTypeLike<V>,
	vectors?: readonly PayloadVectorLike<V>[],
): Violation[] {
	const violations: Violation[] = [];
	const fail = (rule: string, detail: string): void => {
		violations.push({ entry: type.id, rule, detail });
	};
	(vectors ?? type.vectors ?? []).forEach((vector, index) => {
		const where = `vector ${index}`;
		if (vector.source.trim() === '') fail('vector-source', `${where} cites no source`);
		try {
			const read = type.parse(vector.text);
			if (!same(read, vector.value)) {
				fail(
					'vector-parse',
					`${where} reads as a different value (${differing(read, vector.value)})`,
				);
			}
		} catch (error) {
			fail('vector-parse', `${where} does not read: parse threw ${thrown(error)}`);
		}
		const invalid = hasErrors(type.validate(vector.value));
		if (invalid || type.generate === false) {
			// A value with error issues is a caller's mistake to `build`, and a
			// type that cannot be made has nothing honest to write: both throw
			// TypeError rather than write a code that scans and then fails.
			let outcome = 'returned a text';
			try {
				type.build(vector.value);
			} catch (error) {
				outcome = error instanceof TypeError ? '' : `threw ${thrown(error)}`;
			}
			if (outcome !== '') {
				const why = invalid ? 'a value with error issues' : 'a type that cannot be made';
				fail('vector-build', `${where}: build ${outcome} for ${why}, not a TypeError`);
			}
			return;
		}
		try {
			const again = type.parse(type.build(vector.value).text);
			if (!same(again, vector.value)) {
				fail(
					'vector-round-trip',
					`${where}: what build writes reads back differently (${differing(again, vector.value)})`,
				);
			}
		} catch (error) {
			fail('vector-round-trip', `${where}: writing and reading back threw ${thrown(error)}`);
		}
	});
	return violations;
}
