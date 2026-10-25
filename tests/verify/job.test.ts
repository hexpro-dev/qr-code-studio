/**
 * The job runner: the camera model, the plan of each axis, the verdict, the
 * progress a caller sees, the refusals, and that a report depends on the job
 * and its seed and nothing else.
 *
 * Most of this runs with stand-in readers that pass or fail chosen captures,
 * because the subject is the bookkeeping around reading; the last group runs
 * the real strict profile.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { QrStudioError } from '../../src/core/errors.js';
import { defaultDesign } from '../../src/design/document.js';
import type { QrDesignV1 } from '../../src/design/types.js';
import {
	CAMERA,
	distanceFor,
	maxDistanceMm,
	minModuleMm,
	pxPerModuleAt,
} from '../../src/verify/camera.js';
import type { CaptureSpec } from '../../src/verify/capture.js';
import { renderCapture } from '../../src/verify/capture.js';
import type { CaptureReader } from '../../src/verify/job.js';
import { planAxes, runVerifyJob, verify } from '../../src/verify/job.js';
import { DISTANCE_LADDER, LADDERS, framingPxPerModule } from '../../src/verify/ladders.js';
import { designRequirements, prepare, renderMaster } from '../../src/verify/prepare.js';
import { blockMargin, strictRead } from '../../src/verify/read.js';
import type { VerifyJob } from '../../src/verify/types.js';
import { alwaysReads, design, drive, job, neverReads, preset, registries, run } from './helpers.js';

describe('the camera model', () => {
	it('puts four pixels a module at about 377 module widths', () => {
		expect(maxDistanceMm(1)).toBeCloseTo(376.72, 2);
		expect(maxDistanceMm(1, 8)).toBeCloseTo(maxDistanceMm(1) / 2, 9);
		// Never fewer pixels than a reader needs.
		expect(maxDistanceMm(1, 2)).toBe(maxDistanceMm(1));
		expect(pxPerModuleAt(1, distanceFor(1, 5))).toBeCloseTo(5, 12);
		expect(minModuleMm()).toBeCloseTo(CAMERA.minFocusMm / 376.72, 4);
		expect(minModuleMm(8)).toBeCloseTo(2 * minModuleMm(), 12);
		expect(minModuleMm(1)).toBe(minModuleMm());
	});

	it('frames a code in the viewfinder, no closer than the lens focuses', () => {
		expect(framingPxPerModule(37, null)).toBe(10);
		expect(framingPxPerModule(105, null)).toBeCloseTo(540 / 105, 12);
		expect(framingPxPerModule(400, null)).toBe(4);
		expect(framingPxPerModule(37, 0.4)).toBeCloseTo(pxPerModuleAt(0.4, 100), 12);
	});
});

describe('the axis plans', () => {
	const sized = prepare(job(), registries);

	it('runs every ladder in order, distance in pixels a module from the framing outwards', () => {
		const plans = planAxes(sized, 10);
		expect(plans.map((plan) => plan.ladder.axis)).toEqual(LADDERS.map((ladder) => ladder.axis));
		const distance = plans[0];
		expect(distance?.levels).toEqual([10, ...DISTANCE_LADDER]);
		expect(distance?.levels[distance.typical]).toBe(4);
		for (const plan of plans.slice(1)) expect(plan.levels[plan.typical]).toBe(plan.ladder.typical);
		for (const ladder of LADDERS.slice(1)) {
			for (let i = 1; i < ladder.levels.length; i += 1) {
				expect(ladder.levels[i] as number).toBeGreaterThan(ladder.levels[i - 1] as number);
			}
		}
	});

	it('makes the expected distance a level of its own', () => {
		const far = prepare(
			job({ conditions: { sizeMm: 30, dpi: null, distanceMm: 500 } }),
			registries,
		);
		const plan = planAxes(far, 10)[0];
		const wanted = pxPerModuleAt(far.moduleMm as number, 500);
		expect(plan?.levels).toContain(wanted);
		expect(plan?.levels[plan.typical]).toBe(wanted);
		const near = prepare(
			job({ conditions: { sizeMm: 30, dpi: null, distanceMm: 50 } }),
			registries,
		);
		expect(planAxes(near, 10)[0]?.typical).toBe(0);
	});

	it('leaves distance out without a print size, and keeps only the axes asked for', () => {
		const unsized = prepare(
			job({ conditions: { sizeMm: null, dpi: null, distanceMm: null } }),
			registries,
		);
		expect(planAxes(unsized, 10).map((plan) => plan.ladder.axis)).not.toContain('distance');
		expect(planAxes(sized, 10, ['glare']).map((plan) => plan.ladder.axis)).toEqual(['glare']);
	});
});

/** A reader that fails the captures `fails` picks. */
const failing =
	(fails: (spec: CaptureSpec) => boolean): CaptureReader =>
	(_image, _prepared, spec) =>
		fails(spec) ? { read: false, margin: null } : { read: true, margin: 2 };

describe('the verdict and the ladders', () => {
	it('passes when every capture reads, and says so axis by axis', () => {
		const report = run({}, { reader: alwaysReads });
		expect(report.verdict).toBe('pass');
		expect(report.baseline).toEqual({ passed: true, minMargin: 3, seeds: 1 });
		for (const capture of report.captures) {
			expect(capture.firstFailed).toBeNull();
			expect(capture.minMargin).toBe(3);
			expect(capture.seeds).toBe(1);
		}
		const distance = report.captures[0];
		expect(distance?.worstPassed).toBe(Math.round(distanceFor(30 / 37, 2.5)));
		expect(distance?.typical).toBe(Math.round(distanceFor(30 / 37, 4)));
		expect(report.limits).toEqual({ maxDistanceMm: 305, minModuleMm: 0.27, inkFraction: 1 });
	});

	it('fails when the clean capture does not read, and stops there', () => {
		const report = run({}, { reader: neverReads });
		expect(report.verdict).toBe('fail');
		expect(report.baseline.passed).toBe(false);
		for (const capture of report.captures) {
			expect(capture.worstPassed).toBeNull();
			expect(capture.minMargin).toBeNull();
		}
		expect(report.limits.maxDistanceMm).toBe(0);
		expect(report.checks.find((check) => check.id === 'module-size')?.messageKey).toBe(
			'verify.check.module-size.unread',
		);
	});

	it('warns when an axis gives out at or before its everyday level, and not after', () => {
		const at = (level: number) =>
			run(
				{},
				{
					reader: failing((spec) => spec.axis === 'focus' && spec.level >= level),
					axes: ['focus'],
				},
			);
		const late = at(0.4);
		expect(late.verdict).toBe('pass');
		expect(late.captures.find((c) => c.axis === 'focus')).toMatchObject({
			worstPassed: 0.3,
			firstFailed: 0.4,
			typical: 0.2,
		});
		expect(at(0.2).verdict).toBe('warn');
		expect(at(0.1).captures.find((c) => c.axis === 'focus')?.worstPassed).toBeNull();
	});

	it('gives the furthest distance from the unbroken run of passes, never past four pixels a module', () => {
		const report = run(
			{},
			{
				reader: failing((spec) => spec.axis === 'distance' && spec.pxPerModule < 6),
				axes: ['distance'],
			},
		);
		expect(report.verdict).toBe('warn');
		expect(report.limits.maxDistanceMm).toBe(Math.round(distanceFor(30 / 37, 6)));
		expect(report.limits.minModuleMm).toBe(Math.round(minModuleMm(6) * 100) / 100);
	});

	it('fails a size whose modules a phone cannot focus on at the pixels it needs', () => {
		// 8 mm across 37 modules: the phone would have to be closer than it focuses.
		const report = run(
			{ conditions: { sizeMm: 8, dpi: null, distanceMm: null } },
			{ reader: alwaysReads, axes: ['distance'] },
		);
		expect(report.verdict).toBe('fail');
		const size = report.checks.find((check) => check.id === 'module-size');
		expect(size).toMatchObject({ status: 'fail', messageKey: 'verify.check.module-size.fail' });
	});

	it('stops at the typical level, or tries only that, when asked', () => {
		const stopped = run(
			{},
			{ reader: alwaysReads, stopAtTypical: true, axes: ['distance', 'focus', 'ink'] },
		);
		for (const capture of stopped.captures) expect(capture.worstPassed).toBe(capture.typical);
		const tried: string[] = [];
		run(
			{},
			{
				reader: (_i, _p, spec) => {
					tried.push(`${spec.axis}:${spec.level}`);
					return { read: true, margin: 1 };
				},
				onlyTypical: true,
				axes: ['focus', 'glare'],
			},
		);
		expect(tried).toContain('focus:0.2');
		expect(tried).not.toContain('focus:0.1');
		expect(tried.filter((entry) => entry.startsWith('focus'))).toHaveLength(1);
	});
});

describe('progress', () => {
	it('is one step for the static checks, then one per capture, ending at the total', () => {
		const { steps } = drive(prepare(job({ captureSeeds: 2 }), registries), {
			reader: alwaysReads,
			axes: ['glare', 'contrast'],
		});
		expect(steps[0]).toMatchObject({ done: 1, axis: 'static' });
		const total = steps[0]?.total as number;
		for (let i = 1; i < steps.length; i += 1) {
			expect(steps[i]?.done).toBe((steps[i - 1]?.done as number) + 1);
			expect(steps[i]?.total).toBe(total);
		}
		expect(steps.at(-1)?.done).toBe(total);
		expect(steps.slice(1, 3).map((step) => step.axis)).toEqual(['static', 'static']);
		expect(steps.at(-1)?.axis).toBe('contrast');
	});

	it('counts the captures an early stop skips, so it never runs past the total', () => {
		const { steps } = drive(prepare(job({ captureSeeds: 3 }), registries), { reader: neverReads });
		const total = steps[0]?.total as number;
		for (const step of steps) expect(step.done).toBeLessThanOrEqual(total);
		for (let i = 1; i < steps.length; i += 1) {
			expect(steps[i]?.done as number).toBeGreaterThan(steps[i - 1]?.done as number);
		}
		// One baseline capture, then the first capture of each axis.
		expect(steps).toHaveLength(1 + 1 + LADDERS.length);
	});
});

describe('refusals', () => {
	const missing = (overrides: Partial<VerifyJob>) => {
		try {
			runVerifyJob(job(overrides), registries);
		} catch (error) {
			expect(error).toBeInstanceOf(QrStudioError);
			return { code: (error as QrStudioError).code, params: (error as QrStudioError).params };
		}
		throw new Error('expected a refusal');
	};

	it('refuses, when handed the job, an entry this copy does not have', () => {
		expect(
			missing({
				design: design({ modules: { ...defaultDesign().modules, shape: { id: 'blob' } } }),
			}),
		).toEqual({
			code: 'verify/missing-entry',
			params: { kind: 'module-shape', id: 'blob' },
		});
		expect(missing({ requires: ['fill:nowhere'] }).params).toEqual({ kind: 'fill', id: 'nowhere' });
		expect(missing({ requires: ['nowhere'] }).params).toEqual({ kind: 'entry', id: 'nowhere' });
		expect(missing({ requires: ['planet:mars'] }).params).toEqual({ kind: 'entry', id: 'mars' });
		// Something that is not an identifier stays out of the params.
		expect(missing({ requires: ['icon:Not An Id'] }).params).toEqual({ kind: 'icon' });
		expect(missing({ design: design({ symbol: { symbology: 'aztec' } }) }).params).toEqual({
			kind: 'symbology',
			id: 'aztec',
		});
	});

	it('needs the decoded picture for a logo from an asset', () => {
		const png = 'iVBORw0KGgo=';
		const withAsset = design({
			assets: { mark: { png, width: 1, height: 1 } },
			logo: {
				source: { kind: 'asset', id: 'mark' },
				size: 0.2,
				clear: 'box',
				padding: 1,
				plate: null,
			},
		});
		expect(missing({ design: withAsset })).toEqual({
			code: 'verify/missing-entry',
			params: { kind: 'asset' },
		});
		expect(
			missing({
				design: withAsset,
				assets: { other: { width: 1, height: 1, data: new Uint8ClampedArray(4) } },
			}).params,
		).toEqual({ kind: 'asset' });
	});

	it('runs a logo from a decoded asset the job carries', async () => {
		const { encodePng } = await import('../../src/render/png.js');
		const pixels = { width: 2, height: 2, data: new Uint8ClampedArray(16).fill(40) };
		const png = Buffer.from(encodePng(pixels)).toString('base64');
		const withAsset = design({
			assets: { mark: { png, width: 2, height: 2 } },
			logo: {
				source: { kind: 'asset', id: 'mark' },
				size: 0.15,
				clear: 'box',
				padding: 1,
				plate: null,
			},
		});
		const report = run(
			{ design: withAsset, assets: { mark: pixels } },
			{ reader: alwaysReads, axes: [] },
		);
		expect(report.checks.find((check) => check.id === 'logo-budget')?.messageKey).not.toBe(
			'verify.check.logo-budget.none',
		);
	});

	it('accepts a plain id that some registry has', () => {
		expect(() =>
			runVerifyJob(job({ requires: ['square', 'qr', 'symbology:qr'] }), registries),
		).not.toThrow();
	});

	it('refuses a design that is not one', () => {
		expect(missing({ design: { schema: 'nope' } as never }).code).toBe('design/invalid');
		// Too malformed to walk for requirements, and still reported as invalid.
		expect(missing({ design: { schema: 'qr-design', version: 1 } as never }).code).toBe(
			'design/invalid',
		);
	});

	it('throws TypeError for a job built wrongly', () => {
		const bad: Partial<VerifyJob>[] = [
			{ content: 5 as never },
			{ seed: -1 },
			{ seed: 1.5 },
			{ requires: 'qr' as never },
			{ requires: [3] as never },
			{ conditions: null as never },
			{ captureSeeds: 9 },
			{ captureSeeds: 0 },
			{ conditions: { sizeMm: -3, dpi: null, distanceMm: null } },
			{ conditions: { sizeMm: 30, dpi: Number.NaN, distanceMm: null } },
		];
		for (const overrides of bad)
			expect(() => runVerifyJob(job(overrides), registries), JSON.stringify(overrides)).toThrow(
				TypeError,
			);
		expect(() => runVerifyJob(null as never, registries)).toThrow(TypeError);
		expect(() => runVerifyJob(job(), null as never)).toThrow(TypeError);
		expect(() => runVerifyJob(job(), { symbologies: registries.symbologies } as never)).toThrow(
			TypeError,
		);
	});

	it('names what a design needs', () => {
		const needs = designRequirements(preset('shop-tag'));
		expect(needs).toEqual([
			'frame:hang-tag',
			'icon:shop',
			'module-shape:squircle',
			'region-shape:squircle',
			'region-shape:squircle-centre',
			'symbology:qr',
		]);
		const rich = designRequirements({
			...preset('confetti-dots'),
			background: { kind: 'entry', ref: { id: 'two-tone-diagonal' } },
			modules: {
				shape: { id: 'dot' },
				paint: { kind: 'entry', ref: { id: 'palette-scatter' } },
				light: { shape: { id: 'square' }, paint: { kind: 'solid', ink: '#ffffff' } },
			},
			frame: { ref: { id: 'banner-bottom' }, text: { content: 'Scan me', fontId: 'plex' } },
		});
		expect(rich).toContain('fill:palette-scatter');
		expect(rich).toContain('fill:two-tone-diagonal');
		expect(rich).toContain('module-shape:square');
		expect(rich).toContain('frame:banner-bottom');
	});
});

describe('the encoding a design asks for', () => {
	it('passes every symbol option through to the encoder', () => {
		const asked = design({
			symbol: {
				symbology: 'qr',
				ecLevel: 'L',
				boostEc: true,
				mask: 3,
				minVersion: '4',
				maxVersion: '10',
			},
		});
		const prepared = prepare(job({ design: asked }), registries);
		expect(prepared.symbol).toMatchObject({ version: '4', mask: 3 });
		expect(prepared.symbol.ecLevel).not.toBe('L');
	});

	it('places rMQR without its frame, and with the empty frame', () => {
		const rmqr = (frame: string) =>
			prepare(
				job({
					content: 'HELLO',
					design: design({
						quietZone: 2,
						symbol: { symbology: 'rmqr' },
						frame: { ref: { id: frame } },
					}),
				}),
				registries,
			);
		expect(rmqr('banner-bottom').origin).toEqual({ x: 2, y: 2 });
		expect(rmqr('none').origin).toEqual({ x: 2, y: 2 });
	});
});

describe('what the size measures', () => {
	it('is the symbol with its quiet zone, frame or no frame', () => {
		const framed = prepare(job({ design: preset('poster-yellow') }), registries);
		expect(framed.moduleMm).toBeCloseTo(30 / 37, 12);
		const plain = prepare(job(), registries);
		expect(plain.moduleMm).toBeCloseTo(30 / 37, 12);
	});

	it('reads the size a design gives itself through its scene, on the basis it measures', () => {
		const at = (output: QrDesignV1['output'], frame: QrDesignV1['frame'] = null) =>
			prepare(
				job({
					design: design({ output, frame }),
					conditions: { sizeMm: null, dpi: null, distanceMm: null },
				}),
				registries,
			);
		const symbolOnly = at({ sizeMm: 46, sizeBasis: 'symbol', colourSpace: 'srgb' });
		expect(symbolOnly.moduleMm).toBeCloseTo(46 / 29, 12);
		expect(symbolOnly.conditions.sizeMm).toBeCloseTo((46 / 29) * 37, 9);
		const artwork = at({ sizeMm: 60, colourSpace: 'srgb' }, { ref: { id: 'rounded-card' } });
		expect(artwork.moduleMm).toBeCloseTo(60 / artwork.built.scene.width, 12);
		expect(at({ colourSpace: 'srgb' }).moduleMm).toBeNull();
	});

	it('counts the Swiss QR-bill cross against the logo budget', () => {
		const plain = run({}, { reader: alwaysReads, axes: [] });
		const crossed = run({ overlay: 'swiss-cross' }, { reader: alwaysReads, axes: [] });
		const covered = (report: typeof plain) =>
			report.blocks.reduce((sum, block) => sum + block.coveredWorst, 0);
		expect(covered(plain)).toBe(0);
		expect(covered(crossed)).toBeGreaterThan(0);
		expect(() => runVerifyJob(job({ overlay: 'flag' as never }), registries)).toThrow(TypeError);
	});
});

describe('printing a raster export', () => {
	it('draws the export at its own pixels and enlarges them as hard squares', () => {
		const prepared = prepare(
			job({ conditions: { sizeMm: 30, dpi: 150, distanceMm: null } }),
			registries,
		);
		const exported = renderMaster(prepared, 10);
		const clean = renderMaster(prepared, 10, false);
		// 30 mm at 150 dpi is 177 pixels across 37 modules, enlarged three times.
		expect(exported.plane.width).toBe(177 * 3);
		expect(clean.plane.width).toBe(370);
		expect(exported.scaleX).toBeCloseTo((177 * 3) / 37, 12);
		const report = run(
			{ conditions: { sizeMm: 30, dpi: 150, distanceMm: null } },
			{ reader: alwaysReads, axes: ['glare'] },
		);
		expect(report.conditions).toEqual({ sizeMm: 30, dpi: 150, distanceMm: null });
	});
});

describe('with the strict reader', () => {
	afterEach(() => vi.useRealTimers());

	it('gives the same report for the same job and seed, whatever the clock says', () => {
		const one = job({ captureSeeds: 1 });
		const axes = { axes: ['focus', 'glare'] as const };
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2001-02-03T04:05:06Z'));
		const first = drive(prepare(one, registries), axes).report;
		vi.setSystemTime(new Date('2031-12-31T23:59:59Z'));
		const second = drive(prepare(one, registries), axes).report;
		expect(second).toEqual(first);
		const other = drive(prepare(job({ captureSeeds: 1, seed: 8 }), registries), axes).report;
		expect(other.seed).toBe(8);
	});

	it('reads a classic design at everyday conditions', () => {
		const report = verify(job({ captureSeeds: 1 }), registries);
		expect(report.verdict).toBe('pass');
		expect(report.baseline.passed).toBe(true);
		for (const capture of report.captures) {
			expect(capture.worstPassed, capture.axis).not.toBeNull();
			if (capture.firstFailed !== null && capture.typical !== null) {
				expect(capture.firstFailed, capture.axis).toBeGreaterThan(capture.typical);
			}
		}
	});

	it('counts a capture that reads to something else as a failure', () => {
		const prepared = prepare(job(), registries);
		const master = renderMaster(prepared, 15);
		const { width, height } = prepared.built.scene;
		const { image } = renderCapture(master, width, height, 7, {
			axis: 'baseline',
			level: 0,
			seed: 0,
			pxPerModule: 8,
		});
		expect(strictRead(image, prepared).read).toBe(true);
		const other = prepare(job({ content: 'https://example.com/menu/table-13' }), registries);
		expect(strictRead(image, other)).toEqual({ read: false, margin: null });
		const longer = prepare(job({ content: 'https://example.com/menu/table-123' }), registries);
		expect(longer.symbol.version).toBe(prepared.symbol.version);
		expect(strictRead(image, longer)).toEqual({ read: false, margin: null });
		const bigger = prepare(
			job({ design: design({ symbol: { symbology: 'qr', minVersion: '5' } }) }),
			registries,
		);
		expect(strictRead(image, bigger)).toEqual({ read: false, margin: null });
	});

	it('counts a capture that reads past its reserve as a failure', () => {
		expect(blockMargin([0, 3], [4, 8])).toBe(3);
		expect(blockMargin([4], [4])).toBe(-1);
		expect(blockMargin([], [])).toBe(0);
	});

	it('makes captures that differ only in their damage from level to level', () => {
		const prepared = prepare(job(), registries);
		const master = renderMaster(prepared, 15);
		const { width, height } = prepared.built.scene;
		const at = (axis: CaptureSpec['axis'], level: number) =>
			renderCapture(master, width, height, 7, { axis, level, seed: 0, pxPerModule: 8 }).quad;
		// The same seed lands the artwork in the same place at every level.
		expect(at('glare', 0.25)).toEqual(at('glare', 2));
		expect(at('focus', 0.1)).toEqual(at('focus', 0.6));
		// Ink spreads on even seeds and starves on odd ones.
		const ink = (seed: number) =>
			renderCapture(master, width, height, 7, { axis: 'ink', level: 0.2, seed, pxPerModule: 8 })
				.image;
		const dark = (image: { data: Uint8ClampedArray }) =>
			image.data.filter((v, i) => i % 4 === 0 && v < 128).length;
		const plain = renderCapture(master, width, height, 7, {
			axis: 'baseline',
			level: 0,
			seed: 0,
			pxPerModule: 8,
		}).image;
		expect(dark(ink(0))).toBeGreaterThan(dark(plain));
		expect(dark(ink(1))).toBeLessThan(dark(plain));
	});
});
