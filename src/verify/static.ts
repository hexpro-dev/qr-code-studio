/**
 * The checks that need no camera: what the design itself guarantees or rules
 * out, measured from its paints, its layout and one clean picture of it.
 *
 * The clean picture is the scene drawn at ten pixels a module, and every
 * module is read at its centre the way the strict reader reads it: one
 * sample, thresholded halfway between the darkest and lightest module. That
 * gives ISO/IEC 15415's symbol contrast (SC, the range between them) and
 * modulation (MOD, how far the least certain module sits from the threshold,
 * as a share of half that range), and it says which modules under a logo
 * really read wrong, for the logo budget.
 */

import { ROLE_CODES } from '../symbology/roles.js';
import type { Coverage } from './coverage.js';
import { codewordCoverage } from './coverage.js';
import type { GreyPlane } from './degrade.js';
import { sampleBilinear } from './degrade.js';
import { luma, polaritySign, redReflectance, worstDifference } from './inks.js';
import type { Master, Prepared } from './prepare.js';
import type { CheckId, CheckStatus, VerifyCheck } from './types.js';

/** ISO/IEC 15415 grade floors for symbol contrast, A to D: below D is F. */
export const SC_GRADES = Object.freeze([0.7, 0.55, 0.4, 0.2]);
/** ISO/IEC 15415 grade floors for modulation, A to D. */
export const MOD_GRADES = Object.freeze([0.5, 0.4, 0.3, 0.2]);

/**
 * Red light contrast below this warns: the floor of ISO grade C for symbol
 * contrast, applied to red reflectance. Pure red on white has none at all; a
 * dark red keeps plenty.
 */
export const RED_CONTRAST_WARN = 0.4;

const SC_KEYS: Readonly<Record<CheckStatus, string>> = {
	pass: 'verify.check.contrast.sc.pass',
	warn: 'verify.check.contrast.sc.warn',
	fail: 'verify.check.contrast.sc.fail',
};
const MOD_KEYS: Readonly<Record<CheckStatus, string>> = {
	pass: 'verify.check.contrast.mod.pass',
	warn: 'verify.check.contrast.mod.warn',
	fail: 'verify.check.contrast.mod.fail',
};
const BUDGET_KEYS: Readonly<Record<CheckStatus, string>> = {
	pass: 'verify.check.logo-budget.pass',
	warn: 'verify.check.logo-budget.warn',
	fail: 'verify.check.logo-budget.fail',
};

/** A quiet zone pixel must sit this share of the symbol contrast past the threshold, towards the ground. */
const QUIET_TOLERANCE = 0.25;

export function gradeLetter(value: number, floors: readonly number[]): string {
	const letters = ['A', 'B', 'C', 'D'];
	for (let i = 0; i < floors.length; i += 1)
		if (value >= (floors[i] as number)) return letters[i] as string;
	return 'F';
}

export function makeCheck(
	id: CheckId,
	status: CheckStatus,
	measured: number,
	threshold: number,
	messageKey: string,
	params?: Readonly<Record<string, number | string>>,
	grade?: VerifyCheck['grade'],
): VerifyCheck {
	return {
		id,
		status,
		measured,
		threshold,
		...(grade === undefined ? {} : { grade }),
		messageKey,
		...(params === undefined ? {} : { params }),
	};
}

/** A whole percentage, for a sentence. */
function percent(fraction: number): number {
	return Math.round(fraction * 100);
}

export interface Sampling {
	/** One luma per module, row major over the symbol, read at its centre. */
	readonly samples: Float32Array;
	readonly rmin: number;
	readonly rmax: number;
	/** The global threshold, halfway between. */
	readonly threshold: number;
	/** 1 where a module reads as the other colour. */
	readonly wrong: Uint8Array;
	/** The least modulation over the modules the module shape draws and no logo covers, signed: below zero, one reads wrong. */
	readonly mod: number;
}

/**
 * Roles the finder shapes draw rather than the module shape: a round finder
 * leaves its corner cells light on purpose, and whether a ring and centre
 * make a finder is the finder checks' question, not modulation's. QR's 5 by
 * 5 alignment patterns are drawn in the finder's style too.
 */
function drawnAsRegion(role: number, symbology: string): boolean {
	return (
		role === ROLE_CODES.finder ||
		role === ROLE_CODES.separator ||
		role === ROLE_CODES['sub-finder'] ||
		role === ROLE_CODES['corner-finder'] ||
		(role === ROLE_CODES.alignment && symbology === 'qr')
	);
}

/** Each module's centre in the clean picture, read the way the strict reader reads it. */
export function sampleModules(prepared: Prepared, master: Master): Sampling {
	const { symbol, origin, polarity } = prepared;
	const { obscured } = prepared.built;
	const { width, height, data } = symbol.matrix;
	const samples = new Float32Array(width * height);
	let rmin = Number.POSITIVE_INFINITY;
	let rmax = Number.NEGATIVE_INFINITY;
	for (let y = 0; y < height; y += 1) {
		for (let x = 0; x < width; x += 1) {
			const v = sampleBilinear(
				master.plane,
				(origin.x + x + 0.5) * master.scaleX,
				(origin.y + y + 0.5) * master.scaleY,
			);
			const at = y * width + x;
			samples[at] = v;
			if (obscured[at] === 1) continue;
			if (v < rmin) rmin = v;
			if (v > rmax) rmax = v;
		}
	}
	if (rmin === Number.POSITIVE_INFINITY) {
		// Every module under the logo: nothing to measure, and nothing reads.
		rmin = 0;
		rmax = 0;
	}
	const threshold = (rmin + rmax) / 2;
	const sc = rmax - rmin;
	const wrong = new Uint8Array(width * height);
	let mod = Number.POSITIVE_INFINITY;
	for (let i = 0; i < samples.length; i += 1) {
		const v = samples[i] as number;
		const inkSide = polarity === 'dark-on-light' ? v < threshold : v > threshold;
		const right = (data[i] === 1) === inkSide;
		if (!right) wrong[i] = 1;
		if (obscured[i] === 1 || drawnAsRegion(symbol.layout.roles[i] as number, symbol.symbology))
			continue;
		const modulation = sc === 0 ? 0 : (2 * Math.abs(v - threshold)) / sc;
		const signed = right ? modulation : -modulation;
		if (signed < mod) mod = signed;
	}
	return {
		samples,
		rmin,
		rmax,
		threshold,
		wrong,
		mod: mod === Number.POSITIVE_INFINITY ? 0 : mod,
	};
}

/**
 * The clear margin round the symbol, in whole modules, on the ground side of
 * the threshold by at least a quarter of the symbol contrast. Counted ring
 * by ring outwards and stopped at the first ring with anything in it, or at
 * the edge of the picture.
 */
export function measureQuietZone(prepared: Prepared, master: Master, sampling: Sampling): number {
	const { plane, scaleX, scaleY } = master;
	const { origin, polarity } = prepared;
	const { width, height } = prepared.symbol.matrix;
	const sc = sampling.rmax - sampling.rmin;
	const limit =
		polarity === 'dark-on-light'
			? sampling.threshold + QUIET_TOLERANCE * sc
			: sampling.threshold - QUIET_TOLERANCE * sc;
	const clear = (v: number): boolean => (polarity === 'dark-on-light' ? v >= limit : v <= limit);
	// A ring is the pixels wholly inside it: any pixel the symbol (or the
	// ring before) touches belongs to that, so an edge that falls inside a
	// pixel is never mistaken for something printed in the margin.
	const outerBox = (k: number) => ({
		x0: Math.ceil((origin.x - k) * scaleX),
		y0: Math.ceil((origin.y - k) * scaleY),
		x1: Math.floor((origin.x + width + k) * scaleX),
		y1: Math.floor((origin.y + height + k) * scaleY),
	});
	const innerBox = (k: number) => ({
		x0: Math.floor((origin.x - k) * scaleX),
		y0: Math.floor((origin.y - k) * scaleY),
		x1: Math.ceil((origin.x + width + k) * scaleX),
		y1: Math.ceil((origin.y + height + k) * scaleY),
	});
	let rings = 0;
	for (let k = 1; k <= 20; k += 1) {
		const outer = outerBox(k);
		const inner = innerBox(k - 1);
		if (outer.x0 < 0 || outer.y0 < 0 || outer.x1 > plane.width || outer.y1 > plane.height) break;
		if (!ringClear(plane, outer, inner, clear)) break;
		rings = k;
	}
	return rings;
}

function ringClear(
	plane: GreyPlane,
	outer: { x0: number; y0: number; x1: number; y1: number },
	inner: { x0: number; y0: number; x1: number; y1: number },
	clear: (v: number) => boolean,
): boolean {
	for (let y = outer.y0; y < outer.y1; y += 1) {
		const inside = y >= inner.y0 && y < inner.y1;
		for (let x = outer.x0; x < outer.x1; x += 1) {
			if (inside && x >= inner.x0 && x < inner.x1) {
				x = inner.x1 - 1;
				continue;
			}
			if (!clear(plane.data[y * plane.width + x] as number)) return false;
		}
	}
	return true;
}

/** Function pattern roles a logo must never cover: everything a reader finds and orients the code by. */
const LOCATING_ROLES: ReadonlySet<number> = new Set([
	ROLE_CODES.finder,
	ROLE_CODES.separator,
	ROLE_CODES.timing,
	ROLE_CODES.format,
	ROLE_CODES.version,
	ROLE_CODES['dark-module'],
	ROLE_CODES['sub-finder'],
	ROLE_CODES['corner-finder'],
]);

export interface StaticResult {
	readonly checks: readonly VerifyCheck[];
	readonly coverage: Coverage;
	readonly sampling: Sampling;
}

/** Every check that needs no capture, except module size, which needs the distance captures. */
export function staticChecks(prepared: Prepared, master: Master): StaticResult {
	const { symbol, entry, built, polarity, inks, reference } = prepared;
	const checks: VerifyCheck[] = [];
	const sampling = sampleModules(prepared, master);

	// Quiet zone.
	const quiet = measureQuietZone(prepared, master, sampling);
	checks.push(
		makeCheck(
			'quiet-zone',
			quiet >= entry.quietZone ? 'pass' : 'fail',
			quiet,
			entry.quietZone,
			quiet >= entry.quietZone ? 'verify.check.quiet-zone.pass' : 'verify.check.quiet-zone.fail',
			{ modules: quiet, minimum: entry.quietZone },
		),
	);

	// Contrast, as symbol contrast: the worse of the paints, stop by stop, and
	// the clean picture.
	const scPaints = worstDifference(inks, polarity, luma, 255);
	const scPicture = (sampling.rmax - sampling.rmin) / 255;
	const sc = Math.min(scPaints, scPicture);
	const scStatus: CheckStatus =
		sc < (SC_GRADES[3] as number) ? 'fail' : sc < (SC_GRADES[2] as number) ? 'warn' : 'pass';
	checks.push(
		makeCheck(
			'contrast',
			scStatus,
			sc,
			SC_GRADES[2] as number,
			SC_KEYS[scStatus],
			{ percent: percent(Math.max(0, sc)), grade: gradeLetter(sc, SC_GRADES) },
			'SC',
		),
	);
	const mod = sampling.mod;
	const modStatus: CheckStatus =
		mod < (MOD_GRADES[3] as number) ? 'fail' : mod < (MOD_GRADES[2] as number) ? 'warn' : 'pass';
	checks.push(
		makeCheck(
			'contrast',
			modStatus,
			mod,
			MOD_GRADES[2] as number,
			mod < 0 ? 'verify.check.contrast.mod.wrong' : MOD_KEYS[modStatus],
			{ percent: percent(Math.max(0, mod)), grade: gradeLetter(mod, MOD_GRADES) },
			'MOD',
		),
	);

	// Polarity.
	const sign = polaritySign(inks);
	checks.push(
		makeCheck(
			'polarity',
			polarity === 'dark-on-light' ? 'pass' : 'warn',
			sign,
			0,
			polarity === 'dark-on-light' ? 'verify.check.polarity.pass' : 'verify.check.polarity.warn',
		),
	);

	// Function patterns: a logo or its plate over anything a reader finds the
	// code by, or over an alignment pattern, and finder pairs that do not make
	// a finder.
	const { obscured } = built;
	let locating = 0;
	let alignment = 0;
	for (let i = 0; i < obscured.length; i += 1) {
		if (obscured[i] === 0) continue;
		const role = symbol.layout.roles[i] as number;
		if (LOCATING_ROLES.has(role)) locating += 1;
		else if (role === ROLE_CODES.alignment) alignment += 1;
	}
	const pairs = built.issues.filter((found) => found.code === 'design.issue.region-pair').length;
	const patternStatus: CheckStatus =
		locating > 0 || pairs > 0 ? 'fail' : alignment > 0 ? 'warn' : 'pass';
	checks.push(
		makeCheck(
			'function-patterns',
			patternStatus,
			locating + pairs + alignment,
			0,
			locating > 0
				? 'verify.check.function-patterns.covered'
				: pairs > 0
					? 'verify.check.function-patterns.finder'
					: alignment > 0
						? 'verify.check.function-patterns.alignment'
						: 'verify.check.function-patterns.pass',
			{ modules: locating + alignment },
			'FPD',
		),
	);

	// Logo budget.
	const coverage = codewordCoverage(symbol, obscured, sampling.wrong);
	const margin = Math.min(...coverage.blocks.map((block) => block.margin));
	const covered = coverage.blocks.reduce((sum, block) => sum + block.coveredWorst, 0);
	const tight = coverage.blocks.some(
		(block) => block.coveredExpected > block.t - 2 * block.reserve,
	);
	const budgetStatus: CheckStatus = margin < 0 ? 'fail' : covered > 0 && tight ? 'warn' : 'pass';
	checks.push(
		makeCheck(
			'logo-budget',
			budgetStatus,
			margin,
			0,
			covered === 0 ? 'verify.check.logo-budget.none' : BUDGET_KEYS[budgetStatus],
			{ codewords: covered, spare: Math.max(0, margin) },
			'UEC',
		),
	);

	// Finder shape.
	checks.push(
		makeCheck(
			'finder-shape',
			pairs > 0 ? 'fail' : 'pass',
			pairs,
			0,
			pairs > 0 ? 'verify.check.finder-shape.fail' : 'verify.check.finder-shape.pass',
			undefined,
			'FPD',
		),
	);

	// Red light.
	const red = worstDifference(inks, polarity, redReflectance, 1);
	checks.push(
		makeCheck(
			'colour-red-channel',
			red < RED_CONTRAST_WARN ? 'warn' : 'pass',
			red,
			RED_CONTRAST_WARN,
			red < RED_CONTRAST_WARN
				? 'verify.check.colour-red-channel.warn'
				: 'verify.check.colour-red-channel.pass',
			{ percent: percent(Math.max(0, red)) },
		),
	);

	// Reader support.
	const support: VerifyCheck[] = [];
	if (!entry.phoneReadable) {
		support.push(
			makeCheck(
				'reader-support',
				'warn',
				0,
				1,
				entry.id === 'rmqr'
					? 'verify.check.reader-support.rmqr'
					: 'verify.check.reader-support.micro',
			),
		);
	}
	const segments = reference.bitstream.segments;
	if (segments.some((segment) => segment.mode === 'kanji')) {
		support.push(makeCheck('reader-support', 'warn', 1, 0, 'verify.check.reader-support.kanji'));
	}
	if (segments.some((segment) => segment.eci !== null)) {
		support.push(makeCheck('reader-support', 'pass', 1, 0, 'verify.check.reader-support.eci'));
	}
	if (support.length === 0) {
		support.push(makeCheck('reader-support', 'pass', 1, 1, 'verify.check.reader-support.pass'));
	}
	checks.push(...support);

	return { checks, coverage, sampling };
}
