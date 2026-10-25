/**
 * Every type that can be made: a value generated from its field schema that
 * validates cleanly is written, read back as the same value, written again as
 * the same text, and recognised as its own type.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { hasErrors } from '../../src/core/issue.js';
import { detectPayload } from '../../src/payload/detect.js';
import { BUILT_IN_PAYLOAD_TYPES, createPayloadRegistry } from '../../src/payload/registry.js';
import { canonical, valueArbitrary } from './support.js';

const RUNS = Number(process.env.PROPERTY_RUNS ?? 300);
const registry = createPayloadRegistry();

describe('round trip from the field schema', () => {
	for (const type of BUILT_IN_PAYLOAD_TYPES.filter((entry) => entry.generate !== false)) {
		it(`${type.id}: parse(build(value)) is the value`, () => {
			let accepted = 0;
			fc.assert(
				fc.property(valueArbitrary(type), (value) => {
					if (hasErrors(type.validate(value))) return;
					accepted += 1;
					const { text } = type.build(value);
					const parsed = type.parse(text);
					expect(parsed).toEqual(canonical(type, value));
					expect(hasErrors(type.validate(parsed))).toBe(false);
					expect(type.build(parsed).text).toBe(text);
					if (type.id !== 'text') expect(detectPayload(text, registry).type.id).toBe(type.id);
				}),
				{ numRuns: RUNS },
			);
			// A generator that produced nothing valid would make this vacuous.
			expect(accepted, `${type.id} values that validated`).toBeGreaterThan(RUNS / 4);
		});
	}
});
