/**
 * The capture rule for finder pairs, over every pair the table offers on one
 * family of modules (src/conformance/region-captures.ts). Split by family
 * over tests/conformance/captures-*.test.ts so the families run in parallel.
 * The ordinary run reads two seeds of each condition, one with ink spread and
 * one with it starved; QRS_VERIFY_NIGHTLY=1 reads all eight, which is how the
 * `unpaired` tables were measured.
 */

import { describe, expect, it } from 'vitest';
import { checkRegionCaptures, familyPairs } from '../../src/conformance/region-captures.js';
import { createDesignRegistries } from '../../src/design/registries.js';
import type { ModuleFamily } from '../../src/design/types.js';
import { regionCaptureReader } from '../../src/verify/region.js';

const NIGHTLY = process.env.QRS_VERIFY_NIGHTLY === '1';

export function capturesFor(family: ModuleFamily): void {
	const registries = createDesignRegistries();
	const read = regionCaptureReader({ seeds: NIGHTLY ? 8 : 2 });
	describe(`finder pairs among ${family} modules, as the scan check captures them`, () => {
		const pairs = familyPairs(registries, family);
		it('are offered in number', () => {
			expect(pairs.length).toBeGreaterThan(15);
		});
		for (const [ring] of pairs.filter(([r], i, all) => all.findIndex(([o]) => o === r) === i)) {
			it(`read with the ${ring.id} ring and every centre it is offered with`, () => {
				expect(
					checkRegionCaptures(registries, read, { families: [family], only: ring.id }).filter(
						(violation) => violation.entry === ring.id,
					),
				).toEqual([]);
			}, 600_000);
		}
	});
}
