/**
 * The conformance gate's scan check: every preset must scan at its own
 * `minSizeMm` with a short, a medium and a long link, through the
 * `checkPreset` hook, held to everything but the shortfalls recorded for it
 * in tests/verify/shortfalls.ts.
 *
 * Split over tests/verify/gate-*.test.ts so the presets are checked in
 * parallel. The ordinary run reads one seed of each axis at its everyday
 * level, at the level the preset's design asks for; QRS_VERIFY_NIGHTLY=1
 * reads all eight seeds of every level up to the everyday one, at every
 * level the preset allows.
 */

import { describe, expect, it } from 'vitest';
import { checkPreset } from '../../src/conformance/preset.js';
import { createDesignRegistries } from '../../src/design/registries.js';
import { presetVerifier } from '../../src/verify/preset.js';
import { PRESET_SHORTFALLS } from './shortfalls.js';

export const GATE_SHARDS = 4;

const NIGHTLY = process.env.QRS_VERIFY_NIGHTLY === '1';

export function gateShard(index: number): void {
	const registries = createDesignRegistries();
	const scanCheck = presetVerifier(
		NIGHTLY
			? { seeds: 8, stopAtTypical: true, levels: 'all', known: PRESET_SHORTFALLS }
			: { seeds: 1, onlyTypical: true, levels: 'design', known: PRESET_SHORTFALLS },
	);
	describe(`presets scan at their own size (${index + 1} of ${GATE_SHARDS})`, () => {
		registries.presets.list().forEach((preset, i) => {
			if (i % GATE_SHARDS !== index) return;
			it(
				preset.id,
				() => {
					expect(checkPreset(preset, scanCheck, registries)).toEqual([]);
				},
				600_000,
			);
		});
	});
}
