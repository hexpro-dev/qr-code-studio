/**
 * The nightly check that every preset's recorded sizes and shortfalls still
 * hold: calibrated at every level it allows, with the strict reader and all
 * eight seeds of every axis up to its everyday level, each preset gives the
 * sizes in its `sizesMm`, and measured at 40 mm it has exactly the shortfalls
 * tests/verify/shortfalls.ts records. Split over tests/verify/sizes-*.test.ts
 * so the presets are calibrated in parallel; only QRS_VERIFY_NIGHTLY=1 runs
 * it, and `pnpm verify:sizes` and `pnpm verify:shortfalls` measure the same
 * things when a value has to change.
 */

import { describe, expect, it } from 'vitest';
import { presetSizeMm } from '../../src/design/preset-size.js';
import { LADDERS } from '../../src/verify/ladders.js';
import {
	PRESET_CONTENT,
	calibratePreset,
	presetReport,
	shortfalls,
} from '../../src/verify/preset.js';
import { registries } from './helpers.js';
import { PRESET_SHORTFALLS } from './shortfalls.js';

export const SIZE_SHARDS = 8;

const NIGHTLY = process.env.QRS_VERIFY_NIGHTLY === '1';

export function sizesShard(index: number): void {
	describe.runIf(NIGHTLY)(
		`the recorded sizes and shortfalls (${index + 1} of ${SIZE_SHARDS})`,
		() => {
			registries.design.presets.list().forEach((preset, i) => {
				if (i % SIZE_SHARDS !== index) return;
				it(`${preset.id} calibrates to the size it records at every level it allows`, () => {
					const found: Record<string, number | null> = {};
					for (const level of preset.ecLevels) {
						found[level] = calibratePreset(preset, registries, {
							stopAtTypical: true,
							seeds: 8,
							known: PRESET_SHORTFALLS,
							ecLevel: level,
						}).minSizeMm;
					}
					expect(found).toEqual(
						Object.fromEntries(
							preset.ecLevels.map((level) => [level, presetSizeMm(preset, level)]),
						),
					);
				}, 3_600_000);

				it(`${preset.id} still has exactly its recorded shortfalls`, () => {
					const found = new Set<string>();
					const level = preset.design.symbol.ecLevel ?? 'M';
					for (const size of ['small', 'medium', 'large'] as const) {
						const report = presetReport(preset, PRESET_CONTENT[size], 40, level, registries, {
							stopAtTypical: true,
							seeds: 8,
						});
						for (const shortfall of shortfalls(report)) found.add(shortfall);
					}
					const order = ['baseline', ...LADDERS.map((ladder) => ladder.axis)];
					expect([...found].sort((a, b) => order.indexOf(a) - order.indexOf(b))).toEqual(
						PRESET_SHORTFALLS[preset.id] ?? [],
					);
				}, 1_800_000);
			});
		},
	);
}
