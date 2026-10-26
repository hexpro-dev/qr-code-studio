/**
 * Preset calibration: the climb to the smallest size, the margin, what counts
 * as scanning at a size, and the verifier the conformance gate plugs in.
 *
 * The ordinary run drives the calibration with stand-in readers, which makes
 * it fast and exact about the bookkeeping. The real calibration of every
 * preset at every level, with the strict reader, is the nightly run in
 * tests/verify/sizes-*.test.ts.
 */

import { describe, expect, it } from 'vitest';
import type { Preset } from '../../src/design/types.js';
import { minModuleMm } from '../../src/verify/camera.js';
import type { CaptureReader } from '../../src/verify/job.js';
import {
	CALIBRATION_LIMIT_MM,
	PRESET_CONTENT,
	calibratePreset,
	describe as describeReport,
	floorMm,
	presetReport,
	presetVerifier,
	saturationMm,
	presetOptions,
	scansAtSize,
	shortfalls,
	withMargin,
} from '../../src/verify/preset.js';
import type { VerifyReport } from '../../src/verify/types.js';
import { alwaysReads, neverReads, registries } from './helpers.js';

const classic = registries.design.presets.require('classic-black');

describe('the calibration rules', () => {
	it('adds a tenth, and at least two millimetres', () => {
		expect(withMargin(14)).toBe(16);
		expect(withMargin(30)).toBe(33);
		expect(withMargin(19.5)).toBe(22);
	});

	it('climbs from the smallest module a phone resolves to where larger stops helping', () => {
		expect(floorMm(33)).toBe(Math.floor(minModuleMm() * 33));
		expect(floorMm(10)).toBe(5);
		// 540 pixels over 33 modules is past the 10 a module cap, reached at 100 mm when a module is 0.66 mm.
		expect(saturationMm(33)).toBe(22);
		expect(saturationMm(105)).toBe(36);
		expect(CALIBRATION_LIMIT_MM).toBeGreaterThan(saturationMm(185));
	});

	it('uses three contents of growing size', () => {
		const versions = (['small', 'medium', 'large'] as const).map(
			(size) =>
				presetReport(classic, PRESET_CONTENT[size], 30, 'M', registries, {
					reader: alwaysReads,
					axes: [],
				}).symbol.version,
		);
		expect(versions.map(Number)).toEqual([...versions.map(Number)].sort((a, b) => a - b));
		expect(new Set(versions).size).toBe(3);
	});
});

describe('scansAtSize', () => {
	const at = (sizeMm: number, reader: CaptureReader = alwaysReads): VerifyReport =>
		presetReport(classic, PRESET_CONTENT.small, sizeMm, 'M', registries, {
			reader,
			axes: ['focus', 'distance'],
		});

	it('needs no failure, a clean read, a comfortable distance and every axis to its everyday level', () => {
		expect(scansAtSize(at(30))).toBe(true);
		// Too small to hold comfortably.
		expect(scansAtSize(at(12))).toBe(false);
		expect(scansAtSize(at(30, neverReads))).toBe(false);
		const shortFocus = at(30, (_i, _p, spec) => ({
			read: !(spec.axis === 'focus' && spec.level >= 0.2),
			margin: 1,
		}));
		expect(scansAtSize(shortFocus)).toBe(false);
		expect(describeReport(shortFocus)).toBe('focus failed at 0.2 (typical 0.2)');
		const late = at(30, (_i, _p, spec) => ({
			read: !(spec.axis === 'focus' && spec.level >= 0.3),
			margin: 1,
		}));
		expect(scansAtSize(late)).toBe(true);
		expect(describeReport(late)).toBe('no reason recorded');
		expect(describeReport(at(30, neverReads))).toContain('the clean capture did not read');
		expect(describeReport(at(12))).toContain('verify.check.module-size.close warned');
	});

	it('does not count a design warning that has nothing to do with size', () => {
		const red = {
			...classic,
			design: {
				...classic.design,
				modules: { ...classic.design.modules, paint: { kind: 'solid' as const, ink: '#ff0000' } },
			},
		};
		const report = presetReport(red, PRESET_CONTENT.small, 30, 'M', registries, {
			reader: alwaysReads,
			axes: [],
		});
		expect(report.verdict).toBe('warn');
		expect(scansAtSize(report)).toBe(true);
	});
});

describe('calibratePreset', () => {
	it('finds the smallest size for each content, in whole millimetres, and the same twice', () => {
		const first = calibratePreset(classic, registries, { reader: alwaysReads, axes: [] });
		// With every capture reading, the limit is holding the phone comfortably: 150 mm at four pixels a module.
		const comfortable = (modules: number) => Math.ceil((150 / 376.72) * modules);
		expect(first.passedMm.small).toBe(comfortable(33));
		expect(first).toEqual(
			calibratePreset(classic, registries, { reader: alwaysReads, axes: ['distance'] }),
		);
		expect(first.minSizeMm).toBe(withMargin(first.passedMm.large as number));
	});

	it('gives up on a content that never scans, and on everything after it', () => {
		const never = calibratePreset(classic, registries, { reader: neverReads, axes: [] });
		expect(never).toEqual({
			id: 'classic-black',
			level: 'M',
			passedMm: { small: null, medium: null, large: null },
			minSizeMm: null,
		});
		const largeOnly = calibratePreset(classic, registries, {
			reader: (_i, prepared) => ({
				read: prepared.symbol.version !== PRESET_LARGE_VERSION,
				margin: 1,
			}),
			axes: [],
		});
		expect(largeOnly.passedMm.large).toBeNull();
		expect(largeOnly.passedMm.medium).not.toBeNull();
		expect(largeOnly.minSizeMm).toBeNull();
	});
});

const PRESET_LARGE_VERSION = presetReport(classic, PRESET_CONTENT.large, 30, 'M', registries, {
	reader: alwaysReads,
	axes: [],
}).symbol.version;

describe('the climb past saturation and the confirmation', () => {
	it('names the shortfalls of a report, the clean capture first', () => {
		const report = presetReport(classic, PRESET_CONTENT.small, 30, 'M', registries, {
			reader: (_c, _p, spec) => ({
				read: spec.axis !== 'baseline' && spec.axis !== 'glare',
				margin: 1,
			}),
			axes: ['focus', 'glare'],
		});
		expect(shortfalls(report)).toEqual(['baseline', 'glare']);
	});

	it('leaves distance out for a preset with a recorded distance shortfall', () => {
		const known = { 'classic-black': ['distance'] as const };
		expect(presetOptions(classic, { known }).axes).not.toContain('distance');
		expect(presetOptions(classic, { known, axes: ['glare'] }).axes).toEqual(['glare']);
		expect(presetOptions(classic, {}).axes).toBeUndefined();
	});

	it('records no size when the preset fails at its own size, however far it climbs', () => {
		// Reads only small prints: the climb finds each content a size, and the
		// size with its margin never passes.
		const reader: CaptureReader = (_c, prepared) => ({
			read: (prepared.conditions.sizeMm as number) <= 23,
			margin: 1,
		});
		const calibration = calibratePreset(classic, registries, { reader, axes: [] });
		expect(calibration.passedMm.large).not.toBeNull();
		expect(calibration.minSizeMm).toBeNull();
	});
});

describe('a preset that names no level', () => {
	it('is calibrated and checked at M', () => {
		const unnamed = { ...classic, design: { ...classic.design, symbol: { symbology: 'qr' } } };
		const calibration = calibratePreset(unnamed, registries, { reader: alwaysReads, axes: [] });
		expect(calibration.passedMm.small).not.toBeNull();
		const violations = presetVerifier({ reader: neverReads, axes: [] })(
			{ ...unnamed, minSizeMm: 40, sizesMm: {} },
			registries.design,
		);
		expect(violations[0]?.detail).toContain('at level M');
	});
});

describe('presetVerifier', () => {
	const sized = (mm: number): Preset => ({ ...classic, minSizeMm: mm, sizesMm: { M: mm } });

	it('passes a preset at its own size and reports one that does not scan, per content and level', () => {
		const verifier = presetVerifier({ reader: alwaysReads, axes: [] });
		expect(verifier(sized(40), registries.design)).toEqual([]);
		const tooSmall = verifier(sized(10), registries.design);
		expect(tooSmall.map((v) => v.rule)).toEqual(['scan-check', 'scan-check', 'scan-check']);
		expect(tooSmall[0]?.detail).toContain('small content at level M does not scan at 10 mm');
		const every = presetVerifier({ reader: neverReads, axes: [], levels: 'all' })(
			sized(40),
			registries.design,
		);
		expect(every).toHaveLength(3 * classic.ecLevels.length);
	});

	it('checks each level at the size recorded for it', () => {
		// Reads any print of 30 mm or more: the level with the smaller size fails.
		const reader: CaptureReader = (_c, prepared) => ({
			read: (prepared.conditions.sizeMm as number) >= 30,
			margin: 1,
		});
		const levels: Preset = {
			...classic,
			ecLevels: ['M', 'H'],
			minSizeMm: 40,
			sizesMm: { M: 40, H: 20 },
		};
		const found = presetVerifier({ reader, axes: [], levels: 'all' })(levels, registries.design);
		expect(found.map((v) => v.detail.split(':')[0])).toEqual([
			'small content at level H does not scan at 20 mm',
			'medium content at level H does not scan at 20 mm',
			'large content at level H does not scan at 20 mm',
		]);
	});

	it('calibrates the level it is asked for', () => {
		const high = calibratePreset(classic, registries, {
			reader: alwaysReads,
			axes: [],
			ecLevel: 'H',
		});
		expect(high.level).toBe('H');
		const own = calibratePreset(classic, registries, { reader: alwaysReads, axes: [] });
		// Level H fits the long link in a larger symbol, so its size is no smaller.
		expect(high.minSizeMm as number).toBeGreaterThanOrEqual(own.minSizeMm as number);
	});
});
