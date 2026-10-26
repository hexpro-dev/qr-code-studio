/**
 * The checks that need no capture, each at pass, warn and fail, from
 * designs built to sit on either side of each threshold.
 *
 * These run with a reader that reads everything and no capture axes, so
 * what they measure is the static checks alone.
 */

import { describe, expect, it } from 'vitest';
import type { DesignLogo, DesignPaint, QrDesignV1 } from '../../src/design/types.js';
import { prepare, renderMaster } from '../../src/verify/prepare.js';
import { gradeLetter, MOD_GRADES, SC_GRADES, staticChecks } from '../../src/verify/static.js';
import type { CheckId, VerifyCheck, VerifyJob } from '../../src/verify/types.js';
import { luma, paintInks, worstDifference } from '../../src/verify/inks.js';
import { alwaysReads, design, job, preset, registries, run } from './helpers.js';

const solid = (ink: string): DesignPaint => ({ kind: 'solid', ink });
const linear = (from: string, to: string): DesignPaint => ({
	kind: 'linear',
	angle: 0,
	space: 'symbol',
	stops: [
		{ offset: 0, ink: from },
		{ offset: 1, ink: to },
	],
});

function checks(overrides: Partial<VerifyJob>): VerifyCheck[] {
	return [...run(overrides, { reader: alwaysReads, axes: [] }).checks];
}

function only(list: readonly VerifyCheck[], id: CheckId): VerifyCheck[] {
	return list.filter((check) => check.id === id);
}

function one(list: readonly VerifyCheck[], id: CheckId, grade?: string): VerifyCheck {
	const found = only(list, id).filter((check) => grade === undefined || check.grade === grade);
	expect(found, id).toHaveLength(1);
	return found[0] as VerifyCheck;
}

const logo = (size: number, clear: DesignLogo['clear'] = 'box'): DesignLogo => ({
	source: { kind: 'icon', id: 'link' },
	size,
	clear,
	padding: 1,
	plate: { paint: solid('#ffffff'), shape: 'square' },
});

describe('a classic design', () => {
	it('passes everything, in the contract order', () => {
		const list = checks({});
		expect(list.map((check) => check.id)).toEqual([
			'quiet-zone',
			'contrast',
			'contrast',
			'polarity',
			'function-patterns',
			'logo-budget',
			'module-size',
			'finder-shape',
			'colour-red-channel',
			'reader-support',
		]);
		expect(list.every((check) => check.status === 'pass')).toBe(true);
		expect(one(list, 'contrast', 'SC')).toMatchObject({
			measured: 1,
			params: { grade: 'A', percent: 100 },
		});
		expect(one(list, 'contrast', 'MOD').params).toMatchObject({ grade: 'A' });
		expect(one(list, 'quiet-zone')).toMatchObject({ measured: 4, threshold: 4 });
	});
});

describe('quiet zone', () => {
	it('fails below the symbology minimum, measured from the picture', () => {
		const check = one(checks({ design: design({ quietZone: 2 }) }), 'quiet-zone');
		expect(check).toMatchObject({ status: 'fail', measured: 2, threshold: 4 });
	});

	it('counts ground beyond the quiet zone when a frame leaves it clear', () => {
		const framed = design({ quietZone: 4, frame: { ref: { id: 'rounded-card' } } });
		expect(one(checks({ design: framed }), 'quiet-zone').status).toBe('pass');
	});

	it('reads two modules as enough for Micro QR', () => {
		const micro = design({ quietZone: 2, symbol: { symbology: 'micro', ecLevel: 'L' } });
		expect(one(checks({ design: micro, content: '12345' }), 'quiet-zone')).toMatchObject({
			status: 'pass',
			threshold: 2,
		});
	});
});

describe('contrast', () => {
	it('grades symbol contrast', () => {
		expect(gradeLetter(0.71, SC_GRADES)).toBe('A');
		expect(gradeLetter(0.56, SC_GRADES)).toBe('B');
		expect(gradeLetter(0.41, SC_GRADES)).toBe('C');
		expect(gradeLetter(0.21, SC_GRADES)).toBe('D');
		expect(gradeLetter(0.1, SC_GRADES)).toBe('F');
		expect(gradeLetter(0.45, MOD_GRADES)).toBe('B');
	});

	it('warns and fails as the modules lighten', () => {
		const warn = one(
			checks({ design: design({ modules: { ...design({}).modules, paint: solid('#a0a0a0') } }) }),
			'contrast',
			'SC',
		);
		expect(warn).toMatchObject({ status: 'warn', grade: 'SC' });
		expect(warn.params?.grade).toBe('D');
		const fail = one(
			checks({ design: design({ modules: { ...design({}).modules, paint: solid('#d0d0d0') } }) }),
			'contrast',
			'SC',
		);
		expect(fail.status).toBe('fail');
	});

	it('takes every gradient stop, and catches a stop on the wrong side as modulation', () => {
		const base = design({});
		const warn = checks({
			design: { ...base, modules: { ...base.modules, paint: linear('#000000', '#606060') } },
		});
		expect(one(warn, 'contrast', 'MOD').status).toBe('warn');
		const fail = checks({
			design: { ...base, modules: { ...base.modules, paint: linear('#000000', '#6e6e6e') } },
		});
		expect(one(fail, 'contrast', 'MOD').status).toBe('fail');
		const wrong = checks({
			design: { ...base, modules: { ...base.modules, paint: linear('#000000', '#c0c0c0') } },
		});
		expect(one(wrong, 'contrast', 'MOD')).toMatchObject({
			status: 'fail',
			messageKey: 'verify.check.contrast.mod.wrong',
		});
		// The lightest stop still differs from the ground by a quarter: grade D.
		expect(one(wrong, 'contrast', 'SC').status).toBe('warn');
	});
});

describe('inks', () => {
	it('takes the colours an entry fill uses, and nothing from a fill this copy lacks', () => {
		expect(paintInks(preset('confetti-dots').modules.paint, registries.design)).toEqual([
			'#14213d',
			'#6a1b4d',
			'#1d5c4a',
			'#7a3b00',
		]);
		expect(paintInks({ kind: 'entry', ref: { id: 'nowhere' } }, registries.design)).toEqual([]);
		// With no params, the palette's own defaults and its default count.
		expect(
			paintInks({ kind: 'entry', ref: { id: 'palette-scatter' } }, registries.design).length,
		).toBeGreaterThan(0);
		const white = { r: 255, g: 255, b: 255, a: 1 };
		expect(worstDifference({ inks: [], grounds: [white] }, 'dark-on-light', luma, 255)).toBe(0);
		const twoTone = paintInks(preset('two-tone').modules.paint, registries.design);
		expect(twoTone).toEqual(['#14213d', '#6b1d3a']);
		expect(one(checks({ design: preset('confetti-dots') }), 'contrast', 'SC').status).toBe('pass');
	});

	it('counts drawn light modules as ground', () => {
		const lit = design({
			background: solid('#202020'),
			modules: {
				shape: { id: 'square' },
				paint: solid('#000000'),
				light: { shape: { id: 'square' }, paint: solid('#ffffff') },
			},
		});
		const list = checks({ design: lit });
		// Against the dark background the black ink has almost no contrast.
		expect(one(list, 'contrast', 'SC').status).toBe('fail');
	});

	it('measures no contrast at all when ink and ground are the same', () => {
		const blank = design({ modules: { ...design({}).modules, paint: solid('#ffffff') } });
		const list = checks({ design: blank });
		expect(one(list, 'contrast', 'SC').status).toBe('fail');
		expect(one(list, 'contrast', 'MOD').measured).toBeLessThanOrEqual(0);
	});
});

describe('polarity and red light', () => {
	it('warns about light on dark', () => {
		const inverted = design({
			background: solid('#000000'),
			modules: { ...design({}).modules, paint: solid('#ffffff') },
		});
		const list = checks({ design: inverted });
		expect(one(list, 'polarity').status).toBe('warn');
		// Measured in the design's own polarity, the contrast is still full.
		expect(one(list, 'contrast', 'SC').status).toBe('pass');
		expect(one(list, 'quiet-zone').status).toBe('pass');
	});

	it('treats a transparent background as white paper', () => {
		expect(one(checks({ design: design({ background: null }) }), 'polarity').status).toBe('pass');
	});

	it('warns about an ink red light cannot see', () => {
		const red = design({ modules: { ...design({}).modules, paint: solid('#ff0000') } });
		const check = one(checks({ design: red }), 'colour-red-channel');
		expect(check).toMatchObject({ status: 'warn', params: { percent: 0 } });
		const darkRed = design({ modules: { ...design({}).modules, paint: solid('#5a0000') } });
		expect(one(checks({ design: darkRed }), 'colour-red-channel').status).toBe('pass');
	});
});

describe('the logo budget', () => {
	it('passes a small logo, warns when real errors near the reserve, fails past it', () => {
		const at = (ecLevel: 'M' | 'H', size: number): VerifyCheck =>
			one(
				checks({ design: design({ symbol: { symbology: 'qr', ecLevel }, logo: logo(size) }) }),
				'logo-budget',
			);
		expect(at('M', 0.1)).toMatchObject({
			status: 'pass',
			messageKey: 'verify.check.logo-budget.pass',
			grade: 'UEC',
		});
		expect(at('H', 0.2)).toMatchObject({
			status: 'warn',
			messageKey: 'verify.check.logo-budget.warn',
		});
		const fail = at('M', 0.3);
		expect(fail.status).toBe('fail');
		expect(fail.measured).toBeLessThan(0);
	});

	it('reports each block', () => {
		const report = run(
			{ design: design({ symbol: { symbology: 'qr', ecLevel: 'H' }, logo: logo(0.2) }) },
			{ reader: alwaysReads, axes: [] },
		);
		expect(report.blocks).toHaveLength(4);
		for (const block of report.blocks) {
			expect(block.coveredExpected).toBeLessThanOrEqual(block.coveredWorst);
			expect(block.margin).toBe(block.t - Math.ceil(0.25 * block.t) - block.coveredWorst);
		}
	});
});

describe('function patterns and finders', () => {
	it('warns when a logo covers an alignment pattern', () => {
		const long = `https://example.com/${'a'.repeat(120)}`;
		const list = checks({
			content: long,
			design: design({ symbol: { symbology: 'qr', ecLevel: 'H' }, logo: logo(0.2) }),
		});
		expect(one(list, 'function-patterns')).toMatchObject({
			status: 'warn',
			messageKey: 'verify.check.function-patterns.alignment',
		});
	});

	it('fails a finder pair that does not make a finder', () => {
		const odd: QrDesignV1 = design({
			regions: { finder: { outer: { id: 'circle' }, inner: { id: 'square-centre' } } },
		});
		const list = checks({ design: odd });
		expect(one(list, 'finder-shape').status).toBe('fail');
		expect(one(list, 'function-patterns')).toMatchObject({
			status: 'fail',
			messageKey: 'verify.check.function-patterns.finder',
		});
	});

	it('fails a logo over a locating pattern, which the design layer never draws but a scene could', () => {
		const prepared = prepare(job(), registries);
		const obscured = new Uint8Array(prepared.built.obscured.length);
		obscured[0] = 1;
		const tampered = { ...prepared, built: { ...prepared.built, obscured } };
		const result = staticChecks(tampered, renderMaster(tampered, 10, false));
		expect(one(result.checks, 'function-patterns')).toMatchObject({
			status: 'fail',
			messageKey: 'verify.check.function-patterns.covered',
		});
	});

	it('measures nothing when every module is covered', () => {
		const prepared = prepare(job(), registries);
		const obscured = new Uint8Array(prepared.built.obscured.length).fill(1);
		const tampered = { ...prepared, built: { ...prepared.built, obscured } };
		const result = staticChecks(tampered, renderMaster(tampered, 10, false));
		expect(result.sampling).toMatchObject({ rmin: 0, rmax: 0, mod: 0 });
	});
});

describe('reader support', () => {
	it('warns that phones do not read Micro QR or rMQR', () => {
		const micro = checks({
			content: '12345',
			design: design({ quietZone: 2, symbol: { symbology: 'micro', ecLevel: 'L' } }),
		});
		expect(one(micro, 'reader-support')).toMatchObject({
			status: 'warn',
			messageKey: 'verify.check.reader-support.micro',
		});
		const rmqr = checks({
			content: 'HELLO',
			design: design({ quietZone: 2, symbol: { symbology: 'rmqr', ecLevel: 'M' } }),
		});
		expect(one(rmqr, 'reader-support').messageKey).toBe('verify.check.reader-support.rmqr');
	});

	it('warns about kanji and notes an ECI', () => {
		const kanji = checks({
			content: '\u6f22\u5b57\u6f22\u5b57\u6f22\u5b57',
			design: design({
				symbol: { symbology: 'qr', ecLevel: 'M', segmentation: { kanji: 'always' } },
			}),
		});
		expect(only(kanji, 'reader-support').map((check) => check.messageKey)).toContain(
			'verify.check.reader-support.kanji',
		);
		const eci = checks({
			design: design({ symbol: { symbology: 'qr', ecLevel: 'M', segmentation: { eci: 'utf-8' } } }),
		});
		expect(one(eci, 'reader-support')).toMatchObject({
			status: 'pass',
			messageKey: 'verify.check.reader-support.eci',
		});
	});
});

describe('module size', () => {
	it('asks for a size when it has none', () => {
		const check = one(
			checks({ conditions: { sizeMm: null, dpi: null, distanceMm: null } }),
			'module-size',
		);
		expect(check).toMatchObject({ status: 'warn', messageKey: 'verify.check.module-size.unknown' });
	});

	it('passes, warns close up and fails too small to focus on', () => {
		const at = (sizeMm: number, distanceMm: number | null = null) =>
			one(checks({ conditions: { sizeMm, dpi: null, distanceMm } }), 'module-size');
		expect(at(30)).toMatchObject({ status: 'pass', params: { sizeMm: 30, distanceCm: 31 } });
		expect(at(13).messageKey).toBe('verify.check.module-size.close');
		const small = at(9);
		expect(small).toMatchObject({ status: 'fail', messageKey: 'verify.check.module-size.fail' });
		expect(small.params?.minimumMm).toBe(10);
		const far = at(30, 600);
		expect(far).toMatchObject({ status: 'warn', messageKey: 'verify.check.module-size.short' });
		expect(far.params).toMatchObject({ expectedCm: 60, minimumMm: 59 });
	});

	it('takes the size from the design when the job gives none', () => {
		const sized = design({ output: { sizeMm: 30, colourSpace: 'srgb' } });
		const report = run(
			{ design: sized, conditions: { sizeMm: null, dpi: null, distanceMm: null } },
			{ reader: alwaysReads, axes: [] },
		);
		expect(report.conditions.sizeMm).toBe(30);
		expect(report.limits.maxDistanceMm).toBe(305);
	});
});
