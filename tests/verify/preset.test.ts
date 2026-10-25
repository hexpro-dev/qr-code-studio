/**
 * Preset calibration: the climb to the smallest size, the margin, what counts
 * as scanning at a size, and the verifier the conformance gate plugs in.
 *
 * The ordinary run drives the calibration with stand-in readers, which makes
 * it fast and exact about the bookkeeping. QRS_VERIFY_NIGHTLY=1 runs the
 * real calibration over every preset with the strict reader and checks it
 * reproduces the `minSizeMm` each preset records.
 */

import { describe, expect, it } from 'vitest';
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
	scansAtSize,
	withMargin,
} from '../../src/verify/preset.js';
import type { VerifyReport } from '../../src/verify/types.js';
import { alwaysReads, neverReads, registries } from './helpers.js';

const NIGHTLY = process.env.QRS_VERIFY_NIGHTLY === '1';
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

describe('a preset that names no level', () => {
	it('is calibrated and checked at M', () => {
		const unnamed = { ...classic, design: { ...classic.design, symbol: { symbology: 'qr' } } };
		const calibration = calibratePreset(unnamed, registries, { reader: alwaysReads, axes: [] });
		expect(calibration.passedMm.small).not.toBeNull();
		const violations = presetVerifier({ reader: neverReads, axes: [] })(
			{ ...unnamed, minSizeMm: 40 },
			registries.design,
		);
		expect(violations[0]?.detail).toContain('at level M');
	});
});

describe('presetVerifier', () => {
	it('passes a preset at its own size and reports one that does not scan, per content and level', () => {
		const verifier = presetVerifier({ reader: alwaysReads, axes: [] });
		expect(verifier({ ...classic, minSizeMm: 40 }, registries.design)).toEqual([]);
		const tooSmall = verifier({ ...classic, minSizeMm: 10 }, registries.design);
		expect(tooSmall.map((v) => v.rule)).toEqual(['scan-check', 'scan-check', 'scan-check']);
		expect(tooSmall[0]?.detail).toContain('small content at level M does not scan at 10 mm');
		const every = presetVerifier({ reader: neverReads, axes: [], levels: 'all' })(
			{ ...classic, minSizeMm: 40 },
			registries.design,
		);
		expect(every).toHaveLength(3 * classic.ecLevels.length);
	});
});

describe.runIf(NIGHTLY)('the recorded sizes', () => {
	for (const preset of registries.design.presets.list()) {
		it(`${preset.id} calibrates to its minSizeMm`, () => {
			const calibration = calibratePreset(preset, registries, { stopAtTypical: true, seeds: 8 });
			expect(calibration.minSizeMm).toBe(preset.minSizeMm);
		}, 1_800_000);
	}
});
