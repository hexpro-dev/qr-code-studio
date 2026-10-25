/**
 * Entry parameters: checking a value against its schema and filling in the
 * defaults.
 *
 * A design file names an entry and some of its parameters, and the entry
 * draws with all of them. The two places that need the full set (the
 * validator and the scene builder) must agree about which given values count,
 * so both go through `paramProblem`: a value either fits its schema exactly or
 * is not used at all. Nothing is clamped here; a slider value one step past
 * its range is a problem to report, not a number to quietly move.
 */

import { parseColour } from '../render/colour.js';
import type { ParamSchema, ParamValue, ResolvedParams } from './types.js';

/** Why a value does not fit its schema, as a message key and the numbers a sentence needs. */
export interface ParamProblem {
	readonly code: string;
	readonly params?: Readonly<Record<string, number>>;
}

/** The bounds of a schema that has at least one, as a sentence's numbers. */
function range(schema: ParamSchema): Readonly<Record<string, number>> {
	const out: Record<string, number> = {};
	if (schema.min !== undefined) out.min = schema.min;
	if (schema.max !== undefined) out.max = schema.max;
	return out;
}

/** Null when `value` fits `schema`, otherwise what is wrong with it. Never the value itself. */
export function paramProblem(schema: ParamSchema, value: unknown): ParamProblem | null {
	switch (schema.kind) {
		case 'number':
		case 'angle':
		case 'integer': {
			if (typeof value !== 'number' || !Number.isFinite(value)) {
				return { code: 'design.issue.not-a-number' };
			}
			if (schema.kind === 'integer' && !Number.isInteger(value)) {
				return { code: 'design.issue.not-an-integer' };
			}
			if (
				(schema.min !== undefined && value < schema.min) ||
				(schema.max !== undefined && value > schema.max)
			) {
				return { code: 'design.issue.out-of-range', params: range(schema) };
			}
			return null;
		}
		case 'boolean':
			return typeof value === 'boolean' ? null : { code: 'design.issue.not-a-boolean' };
		case 'select':
			return typeof value === 'string' &&
				(schema.options ?? []).some((option) => option.value === value)
				? null
				: { code: 'design.issue.invalid-option' };
		case 'colour':
			if (typeof value !== 'string') return { code: 'design.issue.invalid-colour' };
			try {
				parseColour(value);
				return null;
			} catch {
				return { code: 'design.issue.invalid-colour' };
			}
	}
}

/**
 * Every parameter of an entry: the given value where it fits its schema, the
 * default otherwise. Keys the schema does not name are left out. Frozen, so
 * an entry cannot change what the next module receives.
 */
export function resolveParams(
	schema: readonly ParamSchema[],
	given: Readonly<Record<string, unknown>> | undefined,
): ResolvedParams {
	const out: Record<string, ParamValue> = {};
	for (const entry of schema) {
		const value =
			given !== undefined && Object.prototype.hasOwnProperty.call(given, entry.key)
				? given[entry.key]
				: undefined;
		out[entry.key] =
			value !== undefined && paramProblem(entry, value) === null
				? (value as ParamValue)
				: entry.default;
	}
	return Object.freeze(out);
}

/** A number parameter, for an entry's own use: its schema guarantees the kind. */
export function num(params: ResolvedParams, key: string): number {
	return params[key] as number;
}

/** A string parameter (select or colour). */
export function str(params: ResolvedParams, key: string): string {
	return params[key] as string;
}
