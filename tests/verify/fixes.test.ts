/**
 * Fixes: each one, applied, really improves the finding it answers.
 *
 * Static findings are re-measured by running the check again on the patched
 * design. Capture findings are measured with the strict reader, on the axis
 * the fix targets, before and after: a fix that is offered for an axis and
 * does not move it would be a button that does nothing.
 */

import { describe, expect, it } from 'vitest';
import type { DesignLogo, DesignPaint, QrDesignV1 } from '../../src/design/types.js';
import type { CaptureReader } from '../../src/verify/job.js';
import { applyDesignPatch, suggestFixes } from '../../src/verify/fixes.js';
import type {
	CaptureAxis,
	CheckId,
	Fix,
	VerifyCheck,
	VerifyJob,
	VerifyReport,
} from '../../src/verify/types.js';
import { alwaysReads, design, job, preset, registries, run } from './helpers.js';

const solid = (ink: string): DesignPaint => ({ kind: 'solid', ink });

function statics(overrides: Partial<VerifyJob>): VerifyReport {
	return run(overrides, { reader: alwaysReads, axes: [] });
}

function check(report: VerifyReport, id: CheckId): VerifyCheck {
	return report.checks.find((found) => found.id === id) as VerifyCheck;
}

function fix(fixes: readonly Fix[], id: string): Fix {
	const found = fixes.find((candidate) => candidate.id === id);
	expect(found, `${id} offered among ${fixes.map((f) => f.id).join(', ')}`).toBeDefined();
	return found as Fix;
}

const RANK = { fail: 0, warn: 1, pass: 2 } as const;

/** The design with the fix applied, checked again: the target check must get better. */
function improvesCheck(
	start: QrDesignV1,
	id: string,
	target: CheckId,
	extra: Partial<VerifyJob> = {},
): void {
	const before = statics({ ...extra, design: start });
	const chosen = fix(suggestFixes(before, start, registries.design), id);
	expect(chosen.targets).toBe(target);
	const patched = chosen.patch === null ? start : applyDesignPatch(start, chosen.patch);
	const after = statics({
		...extra,
		design: patched,
		...(chosen.conditions === undefined
			? {}
			: { conditions: { ...job().conditions, ...chosen.conditions } }),
	});
	const was = check(before, target);
	const now = check(after, target);
	const better =
		RANK[now.status] > RANK[was.status] ||
		(now.status === was.status && now.measured > was.measured);
	expect(better, `${id}: ${was.status} ${was.measured} then ${now.status} ${now.measured}`).toBe(
		true,
	);
}

const logo = (size: number, plate = true): DesignLogo => ({
	source: { kind: 'icon', id: 'link' },
	size,
	clear: 'box',
	padding: 1,
	plate: plate ? { paint: solid('#ffffff'), shape: 'square' } : null,
});

describe('fixes for static findings', () => {
	it('offers nothing for a design that passes', () => {
		expect(suggestFixes(statics({}), design({}))).toEqual([]);
	});

	it('raise the error correction, shrink the logo, or clear only its outline', () => {
		const big = design({ logo: logo(0.3) });
		improvesCheck(big, 'raise-ec', 'logo-budget');
		improvesCheck(big, 'shrink-logo', 'logo-budget');
		improvesCheck(design({ logo: logo(0.3, false) }), 'logo-clear-shape', 'logo-budget');
		// With a plate the plate hides the box anyway, so that fix is not offered.
		expect(suggestFixes(statics({ design: big }), big).map((f) => f.id)).not.toContain(
			'logo-clear-shape',
		);
	});

	it('shrink a logo that covers an alignment pattern', () => {
		const long = `https://example.com/${'a'.repeat(120)}`;
		const covering = design({ symbol: { symbology: 'qr', ecLevel: 'H' }, logo: logo(0.2) });
		const before = statics({ content: long, design: covering });
		const shrink = fix(suggestFixes(before, covering), 'shrink-logo');
		expect(shrink.targets).toBe('function-patterns');
	});

	it('darken weak modules, or print them black', () => {
		const grey = design({ modules: { ...design({}).modules, paint: solid('#d0d0d0') } });
		improvesCheck(grey, 'darken-modules', 'contrast');
		expect(fix(suggestFixes(statics({ design: grey }), grey), 'darken-modules').labelKey).toBe(
			'verify.fix.black-modules',
		);
		const fading: QrDesignV1 = design({
			modules: {
				...design({}).modules,
				paint: {
					kind: 'linear',
					angle: 0,
					space: 'symbol',
					stops: [
						{ offset: 0, ink: '#101820' },
						{ offset: 1, ink: '#c0c0c0' },
					],
				},
			},
		});
		improvesCheck(fading, 'darken-modules', 'contrast');
		expect(fix(suggestFixes(statics({ design: fading }), fading), 'darken-modules').labelKey).toBe(
			'verify.fix.darken-modules',
		);
	});

	it('darken a palette, comparing its colours only when it has the registries', () => {
		const pale: QrDesignV1 = design({
			modules: {
				...design({}).modules,
				paint: {
					kind: 'entry',
					ref: {
						id: 'palette-scatter',
						params: { 'colour-1': '#303030', 'colour-2': '#c8c8c8', count: 2 },
					},
				},
			},
		});
		const report = statics({ design: pale });
		const withColours = fix(suggestFixes(report, pale, registries.design), 'darken-modules');
		expect(withColours.labelKey).toBe('verify.fix.darken-modules');
		improvesCheck(pale, 'darken-modules', 'contrast');
		const blind = fix(suggestFixes(report, pale), 'darken-modules');
		expect(blind.labelKey).toBe('verify.fix.black-modules');
	});

	it('darken the modules for dim light and fading', () => {
		const grey = design({ modules: { ...design({}).modules, paint: solid('#404040') } });
		const shortLight = run(
			{ design: grey },
			{ reader: (_i, _p, spec) => ({ read: spec.axis !== 'light', margin: 1 }), axes: ['light'] },
		);
		expect(fix(suggestFixes(shortLight, grey), 'darken-modules').targets).toBe('light');
		const shortFade = run(
			{ design: grey },
			{
				reader: (_i, _p, spec) => ({ read: spec.axis !== 'contrast', margin: 1 }),
				axes: ['contrast'],
			},
		);
		expect(fix(suggestFixes(shortFade, grey), 'darken-modules').targets).toBe('contrast');
	});

	it('choose an ink red light can see', () => {
		improvesCheck(
			design({ modules: { ...design({}).modules, paint: solid('#ff0000') } }),
			'low-red-ink',
			'colour-red-channel',
		);
		const mixed = design({
			modules: { ...design({}).modules, paint: solid('#ff2020') },
			regions: {
				finder: {
					outer: { id: 'square' },
					inner: { id: 'square-centre' },
					outerPaint: solid('#002244'),
					innerPaint: solid('#ff0000'),
				},
			},
		});
		const offered = fix(
			suggestFixes(statics({ design: mixed }), mixed, registries.design),
			'low-red-ink',
		);
		expect(offered.labelKey).toBe('verify.fix.low-red-ink');
		improvesCheck(mixed, 'low-red-ink', 'colour-red-channel');
	});

	it('widen the quiet zone, swap light on dark round, square the finders', () => {
		improvesCheck(design({ quietZone: 2 }), 'widen-quiet-zone', 'quiet-zone');
		improvesCheck(
			design({
				background: solid('#101010'),
				modules: { ...design({}).modules, paint: solid('#f0f0f0') },
			}),
			'dark-on-light',
			'polarity',
		);
		improvesCheck(
			design({ regions: { finder: { outer: { id: 'circle' }, inner: { id: 'square-centre' } } } }),
			'square-finders',
			'finder-shape',
		);
	});

	it('print larger, as a change of conditions', () => {
		const tooSmall = { conditions: { sizeMm: 8, dpi: null, distanceMm: null } };
		const before = statics({ ...tooSmall, design: design({}) });
		const larger = fix(suggestFixes(before, design({})), 'print-larger');
		expect(larger.patch).toBeNull();
		expect(larger.conditions?.sizeMm).toBe(10);
		improvesCheck(design({}), 'print-larger', 'module-size', tooSmall);
		improvesCheck(design({}), 'print-larger', 'module-size', {
			conditions: { sizeMm: 13, dpi: null, distanceMm: null },
		});
		improvesCheck(design({}), 'print-larger', 'module-size', {
			conditions: { sizeMm: 30, dpi: null, distanceMm: 600 },
		});
		// A code that did not scan from any distance has no size that would do.
		const unread = run({}, { reader: () => ({ read: false, margin: null }), axes: ['distance'] });
		expect(unread.checks.find((c) => c.id === 'module-size')?.messageKey).toBe(
			'verify.check.module-size.unread',
		);
		expect(suggestFixes(unread, design({})).map((f) => f.id)).not.toContain('print-larger');
		// No size, no size to suggest.
		const unsized = statics({ conditions: { sizeMm: null, dpi: null, distanceMm: null } });
		expect(suggestFixes(unsized, design({})).map((f) => f.id)).not.toContain('print-larger');
	});
});

/** The strict reader's verdict on one axis of a design. */
function axis(start: QrDesignV1, which: CaptureAxis, seeds = 1) {
	const report = run({ design: start, captureSeeds: seeds }, { axes: [which] });
	return report.captures.find(
		(capture) => capture.axis === which,
	) as VerifyReport['captures'][number];
}

/** A report in which `which` gave out at its first level, so the fix for it is offered. */
function shortOn(start: QrDesignV1, which: CaptureAxis): VerifyReport {
	const reader: CaptureReader = (_i, _p, spec) =>
		spec.axis === which ? { read: false, margin: null } : { read: true, margin: 2 };
	return run({ design: start }, { reader, axes: [which] });
}

function rank(capture: VerifyReport['captures'][number]): number {
	return capture.worstPassed ?? Number.NEGATIVE_INFINITY;
}

describe('fixes for capture findings, measured with the strict reader', () => {
	it('more error correction holds out against more glare', () => {
		const start = design({});
		const chosen = fix(suggestFixes(shortOn(start, 'glare'), start), 'raise-ec');
		expect(chosen.targets).toBe('glare');
		const after = applyDesignPatch(start, chosen.patch as NonNullable<Fix['patch']>);
		expect(rank(axis(after, 'glare'))).toBeGreaterThan(rank(axis(start, 'glare')));
	});

	it('square finders take away what styled finders cost', () => {
		// Midnight dots with the round centre it had before its finder was made
		// sturdier, which is what costs it under a defocus. That pair is no
		// longer offered among dots (captures there miss it), so the finder check
		// fails as well, and the fix is offered for that first.
		const start: QrDesignV1 = {
			...preset('midnight-dots'),
			regions: { finder: { outer: { id: 'squircle' }, inner: { id: 'circle-centre' } } },
		};
		const chosen = fix(suggestFixes(shortOn(start, 'focus'), start), 'square-finders');
		expect(chosen.targets).toBe('finder-shape');
		const after = applyDesignPatch(start, chosen.patch as NonNullable<Fix['patch']>);
		expect(rank(axis(after, 'focus'))).toBeGreaterThan(rank(axis(start, 'focus')));
	});

	it('square finders are offered when even the clean capture fails', () => {
		const start = preset('midnight-dots');
		const failed = run(
			{ design: start },
			{ reader: () => ({ read: false, margin: null }), axes: [] },
		);
		expect(failed.baseline.passed).toBe(false);
		expect(fix(suggestFixes(failed, start), 'square-finders').targets).toBe('finder-shape');
	});

	it('solid modules hold out against more blur than thin ones', () => {
		const start = design({
			modules: { ...design({}).modules, shape: { id: 'dot', params: { size: 0.6 } } },
		});
		const chosen = fix(suggestFixes(shortOn(start, 'focus'), start), 'solid-modules');
		expect(chosen.targets).toBe('focus');
		const after = applyDesignPatch(start, chosen.patch as NonNullable<Fix['patch']>);
		expect(rank(axis(after, 'focus'))).toBeGreaterThan(rank(axis(start, 'focus')));
	});
});

describe('applyDesignPatch', () => {
	it('copies along the path and leaves the design alone', () => {
		const start = design({});
		const frozen = JSON.stringify(start);
		const patched = applyDesignPatch(start, { path: ['modules', 'shape'], value: { id: 'dot' } });
		expect(patched.modules.shape).toEqual({ id: 'dot' });
		expect(patched.modules.paint).toBe(start.modules.paint);
		expect(JSON.stringify(start)).toBe(frozen);
		expect(applyDesignPatch(start, { path: [], value: patched })).toBe(patched);
	});

	it('goes through lists by index', () => {
		const start = design({
			modules: {
				...design({}).modules,
				paint: {
					kind: 'linear',
					angle: 0,
					space: 'symbol',
					stops: [
						{ offset: 0, ink: '#000000' },
						{ offset: 1, ink: '#222222' },
					],
				},
			},
		});
		const patched = applyDesignPatch(start, {
			path: ['modules', 'paint', 'stops', 1, 'ink'],
			value: '#111111',
		});
		expect((patched.modules.paint as unknown as { stops: { ink: string }[] }).stops[1]?.ink).toBe(
			'#111111',
		);
		const swapped = applyDesignPatch(start, {
			path: ['modules', 'paint', 'stops', 0],
			value: { offset: 0, ink: '#333333' },
		});
		expect((swapped.modules.paint as unknown as { stops: { ink: string }[] }).stops[0]?.ink).toBe(
			'#333333',
		);
	});

	it('refuses a path that goes nowhere', () => {
		expect(() => applyDesignPatch(design({}), { path: ['logo', 'size'], value: 0.2 })).toThrow(
			TypeError,
		);
		expect(() => applyDesignPatch(design({}), { path: 'logo' as never, value: 1 })).toThrow(
			TypeError,
		);
	});
});
