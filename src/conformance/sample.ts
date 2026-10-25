/**
 * The parameter sets every check draws an entry at.
 *
 * The defaults, then each parameter at both ends of its range (or at each of
 * its options) with the rest at their defaults, then every parameter at its
 * lowest together and at its highest together, then a few seeded mixtures.
 * Extremes are where a shape breaks: a dot at its smallest, a bar at its
 * thinnest. The mixtures catch the cases that only break in combination.
 * Duplicates are dropped, so an entry with no parameters is drawn once.
 */

import { createPrng } from '../core/prng.js';
import { resolveParams } from '../design/params.js';
import type { ParamSchema, ParamValue, ResolvedParams } from '../design/types.js';

function choices(schema: ParamSchema): ParamValue[] {
	switch (schema.kind) {
		case 'boolean':
			return [false, true];
		case 'select':
			return (schema.options ?? []).map((option) => option.value);
		case 'colour':
			return [schema.default];
		default:
			return [schema.min ?? schema.default, schema.max ?? schema.default];
	}
}

/** A value drawn from a parameter's range, on its step where it has one. */
function draw(schema: ParamSchema, random: () => number): ParamValue {
	const options = choices(schema);
	if (schema.kind === 'boolean' || schema.kind === 'select' || schema.kind === 'colour') {
		return options[Math.floor(random() * options.length)] as ParamValue;
	}
	const low = options[0] as number;
	const high = options[1] as number;
	const value = low + random() * (high - low);
	if (schema.kind === 'integer') return Math.round(value);
	const step = schema.step;
	if (step === undefined || step <= 0) return value;
	const stepped = low + Math.round((value - low) / step) * step;
	return Math.min(Math.max(Number(stepped.toFixed(10)), low), high);
}

export function sampleParams(
	schema: readonly ParamSchema[],
	seed = 1,
	mixtures = 3,
): readonly ResolvedParams[] {
	const out: ResolvedParams[] = [resolveParams(schema, undefined)];
	for (const entry of schema) {
		for (const value of choices(entry)) out.push(resolveParams(schema, { [entry.key]: value }));
	}
	if (schema.length > 1) {
		for (const end of [0, 1]) {
			const given: Record<string, ParamValue> = {};
			for (const entry of schema) given[entry.key] = choices(entry)[end] ?? entry.default;
			out.push(resolveParams(schema, given));
		}
	}
	const prng = createPrng(seed);
	const random = (): number => prng.next();
	if (schema.length > 0) {
		for (let i = 0; i < mixtures; i += 1) {
			const given: Record<string, ParamValue> = {};
			for (const entry of schema) given[entry.key] = draw(entry, random);
			out.push(resolveParams(schema, given));
		}
	}
	const seen = new Set<string>();
	return out.filter((params) => {
		const key = JSON.stringify(params);
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}
