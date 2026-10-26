/**
 * Locating finder patterns.
 *
 * A finder pattern is a 7 by 7 bullseye, and every line through its centre
 * crosses dark, light, dark, light, dark in a 1:1:3:1:1 ratio. That ratio is
 * scale and rotation invariant, which is why the format chose it, and it is
 * the whole basis of finding a code in a photograph. QR has three, Micro QR
 * and rMQR one each.
 *
 * Lifted from the authenticator package's reader
 * (google-auth-secret-retriever, `src/qr/decode/finder.ts`), with the ratio
 * tolerance made a parameter: half a module for the scanner, as there, and
 * 0.35 of a module along the rows and columns for the strict profile, which
 * must refuse a pattern before a phone does.
 */

import { hypot } from '../core/math.js';
import type { Binarised } from './binarise.js';
import type { Point } from './types.js';

export interface FinderPattern {
	readonly x: number;
	readonly y: number;
	/** Estimated width of one module, in pixels. */
	readonly moduleSize: number;
	/** How many independent scan lines agreed on this centre. */
	readonly count: number;
}

export interface FinderTriple {
	readonly topLeft: FinderPattern;
	readonly topRight: FinderPattern;
	readonly bottomLeft: FinderPattern;
}

/** Slack per run, in modules: along the rows and columns, and along the two diagonal checks. */
export interface FinderTolerance {
	readonly runs: number;
	readonly diagonals: number;
}

/** Half a module of slack per run: tighter loses real patterns on a soft photograph, looser starts matching text. */
export const LENIENT_FINDER_TOLERANCE: FinderTolerance = Object.freeze({
	runs: 0.5,
	diagonals: 0.5,
});

/**
 * The strict profile's slack: a third tighter than the scanner's, and than
 * zxing's half module, along the rows and columns.
 *
 * Half a module on the diagonals, as the scanner has it and still tighter
 * than zxing's three quarters (jsQR does not check them at all). A diagonal
 * is walked a pixel step at a time, each step root two pixels long, from a
 * centre known only to the nearest pixel, so its runs carry a quantisation
 * error the axes do not: at 6 pixels a module one step is a quarter of a
 * module. Held to 0.35 there, the check refused the round, octagonal and
 * squircle finders the design layer draws, on some sub-pixel phases and not
 * others, with every reader that matters reading them; measured over the
 * styled corpus, 0.5 refuses none of them and the conservativeness property
 * holds. 0.6 also finds octagonal finders at 4 pixels a module, but as the
 * first look it let a patch of data through as a fourth finder on a version
 * 30 symbol tilted 20 degrees, and the strict reader, which commits to one
 * triple, chose the triple with it in: so 0.6 is the second look's alone
 * (`STRICT_WIDE_FINDER_TOLERANCE`).
 */
export const STRICT_FINDER_TOLERANCE: FinderTolerance = Object.freeze({
	runs: 0.35,
	diagonals: 0.5,
});

/**
 * The strict profile's second look, taken only when the first finds fewer
 * than three finders: 0.6 of a module on the diagonals, still short of the
 * three quarters and half a pixel zxing-cpp allows on each run. It finds the
 * octagonal finders at 4 pixels a module and the rounded ring round a round
 * centre with its ink starved by a twentieth of a module that the first look
 * misses and zxing-cpp and jsQR read every time; taken only then, it cannot
 * add a decoy finder to a picture the first look already found three in.
 */
export const STRICT_WIDE_FINDER_TOLERANCE: FinderTolerance = Object.freeze({
	runs: 0.35,
	diagonals: 0.6,
});

function isDark(image: Binarised, x: number, y: number): boolean {
	return image.bits[y * image.width + x] === 1;
}

/** Do five run lengths sit close enough to 1:1:3:1:1, within `tolerance` modules per run? */
function matchesRatio(runs: readonly number[], tolerance: number): boolean {
	const r0 = runs[0] as number;
	const r1 = runs[1] as number;
	const r2 = runs[2] as number;
	const r3 = runs[3] as number;
	const r4 = runs[4] as number;
	const total = r0 + r1 + r2 + r3 + r4;
	if (total < 7) return false;
	const module = total / 7;
	const slack = module * tolerance;
	return (
		Math.abs(module - r0) < slack &&
		Math.abs(module - r1) < slack &&
		Math.abs(3 * module - r2) < 3 * slack &&
		Math.abs(module - r3) < slack &&
		Math.abs(module - r4) < slack
	);
}

/** Centre of the middle run, in the scan direction, for runs that ended just before `end`. */
function centreOfRuns(end: number, runs: readonly number[]): number {
	return end - (runs[4] as number) - (runs[3] as number) - (runs[2] as number) / 2;
}

interface Candidate {
	x: number;
	y: number;
	moduleSize: number;
	count: number;
}

/**
 * Candidate finder centres, strongest first.
 *
 * Scans rows for the ratio, cross-checks each hit vertically and along both
 * diagonals, then clusters agreeing hits. `count` is how many rows agreed,
 * which is a decent proxy for confidence, and a centre seen on one row only
 * is dropped.
 */
export function findFinderPatterns(
	image: Binarised,
	tolerance: FinderTolerance,
	limit = 32,
): FinderPattern[] {
	const candidates: Candidate[] = [];
	// A finder is at least seven modules tall, so skipping rows on a large
	// picture still crosses it several times.
	const step = Math.max(1, Math.floor(image.height / 512));
	const runs = [0, 0, 0, 0, 0];

	for (let y = 0; y < image.height; y += step) {
		// The five runs are dark, light, dark, light, dark, so even indices are
		// dark. `state` is the run being counted, and its parity says whether a
		// colour change opens a new run. Written as a state machine because the
		// phase matters: run 0 has to be dark, and a loop that starts counting at
		// the first pixel puts the leading light margin there and never matches.
		runs.fill(0);
		let state = 0;
		const consider = (end: number): boolean => {
			if (!matchesRatio(runs, tolerance.runs)) return false;
			const cx = centreOfRuns(end, runs);
			const moduleSize = runs.reduce((sum, run) => sum + run, 0) / 7;
			const cy = verticalCentre(
				image,
				Math.floor(cx),
				y,
				Math.round(moduleSize * 7),
				tolerance.runs,
			);
			if (cy === null || !diagonalCheck(image, cx, cy, tolerance.diagonals)) {
				return false;
			}
			addCandidate(candidates, cx, cy, moduleSize);
			return true;
		};

		for (let x = 0; x < image.width; x += 1) {
			if (isDark(image, x, y)) {
				// Dark after light opens the next run.
				if (state % 2 === 1) state += 1;
				runs[state] = (runs[state] as number) + 1;
				continue;
			}
			if (state % 2 === 1) {
				runs[state] = (runs[state] as number) + 1;
				continue;
			}
			if (state !== 4) {
				// Light after the first dark of the row, or after a dark run in the middle.
				if (state === 0 && runs[0] === 0) continue;
				state += 1;
				runs[state] = (runs[state] as number) + 1;
				continue;
			}
			// A complete dark, light, dark, light, dark sequence has just ended.
			if (consider(x)) {
				runs.fill(0);
				state = 0;
			} else {
				// Slide along by two runs, so two finders sharing a row do not hide each
				// other and a near miss can still become a hit one run later.
				runs[0] = runs[2] as number;
				runs[1] = runs[3] as number;
				runs[2] = runs[4] as number;
				runs[3] = 1;
				runs[4] = 0;
				state = 3;
			}
		}
		if (state === 4) consider(image.width);
	}

	return candidates
		.filter((candidate) => candidate.count >= 2)
		.sort((a, b) => b.count - a.count)
		.slice(0, limit)
		.map(({ x, y, moduleSize, count }) => ({ x, y, moduleSize, count }));
}

/**
 * Refine the vertical centre of a candidate by walking its runs up and down.
 * `cx` is the column through the middle of the row's centre run, so it is on
 * the picture and dark at `cy`.
 */
function verticalCentre(
	image: Binarised,
	cx: number,
	cy: number,
	maxCount: number,
	tolerance: number,
): number | null {
	const runs = [0, 0, 0, 0, 0];
	let y = cy;
	while (y >= 0 && isDark(image, cx, y)) {
		runs[2] = (runs[2] as number) + 1;
		y -= 1;
	}
	while (y >= 0 && !isDark(image, cx, y) && (runs[1] as number) < maxCount) {
		runs[1] = (runs[1] as number) + 1;
		y -= 1;
	}
	while (y >= 0 && isDark(image, cx, y) && (runs[0] as number) < maxCount) {
		runs[0] = (runs[0] as number) + 1;
		y -= 1;
	}
	y = cy + 1;
	while (y < image.height && isDark(image, cx, y)) {
		runs[2] = (runs[2] as number) + 1;
		y += 1;
	}
	while (y < image.height && !isDark(image, cx, y) && (runs[3] as number) < maxCount) {
		runs[3] = (runs[3] as number) + 1;
		y += 1;
	}
	while (y < image.height && isDark(image, cx, y) && (runs[4] as number) < maxCount) {
		runs[4] = (runs[4] as number) + 1;
		y += 1;
	}
	return matchesRatio(runs, tolerance) ? centreOfRuns(y, runs) : null;
}

/**
 * The five runs through (cx, cy) along (dx, dy): the dark core walked both
 * ways, then light, then dark on each side.
 */
function runsThrough(image: Binarised, cx: number, cy: number, dx: number, dy: number): number[] {
	const runs = [0, 0, 0, 0, 0];
	const inside = (x: number, y: number): boolean =>
		x >= 0 && y >= 0 && x < image.width && y < image.height;
	for (const sign of [-1, 1]) {
		let x = sign < 0 ? cx : cx + dx;
		let y = sign < 0 ? cy : cy + dy;
		for (const [index, dark] of sign < 0
			? ([
					[2, true],
					[1, false],
					[0, true],
				] as const)
			: ([
					[2, true],
					[3, false],
					[4, true],
				] as const)) {
			while (inside(x, y) && isDark(image, x, y) === dark) {
				runs[index] = (runs[index] as number) + 1;
				x += sign * dx;
				y += sign * dy;
			}
		}
	}
	return runs;
}

/**
 * A real bullseye shows the ratio along both diagonals too, which text and
 * noise rarely do.
 *
 * Walked from each of the four pixels nearest the centre, and passed when
 * both diagonals hold from any one of them. The centre is known to a fraction
 * of a pixel and a diagonal is walked from a whole one, and through a round
 * or octagonal pattern the runs a pixel off the centre are not the runs
 * through it: from one pixel a light ring reads two steps where from the next
 * it reads three, which at 6 pixels a module is a whole quarter of a module.
 */
function diagonalCheck(image: Binarised, cx: number, cy: number, tolerance: number): boolean {
	const left = Math.floor(cx - 0.5);
	const top = Math.floor(cy - 0.5);
	for (let y = top; y <= top + 1; y += 1) {
		for (let x = left; x <= left + 1; x += 1) {
			if (x < 0 || y < 0 || x >= image.width || y >= image.height || !isDark(image, x, y)) continue;
			if (
				matchesRatio(runsThrough(image, x, y, 1, 1), tolerance) &&
				matchesRatio(runsThrough(image, x, y, 1, -1), tolerance)
			) {
				return true;
			}
		}
	}
	return false;
}

function addCandidate(candidates: Candidate[], x: number, y: number, moduleSize: number): void {
	for (const candidate of candidates) {
		if (
			hypot(candidate.x - x, candidate.y - y) < candidate.moduleSize * 2 &&
			Math.abs(candidate.moduleSize - moduleSize) < moduleSize * 0.5
		) {
			// A running mean, so repeated sightings pull the centre to sub-pixel
			// accuracy rather than the first one winning.
			const total = candidate.count + 1;
			candidate.x = (candidate.x * candidate.count + x) / total;
			candidate.y = (candidate.y * candidate.count + y) / total;
			candidate.moduleSize = (candidate.moduleSize * candidate.count + moduleSize) / total;
			candidate.count = total;
			return;
		}
	}
	candidates.push({ x, y, moduleSize, count: 1 });
}

/** The walk's step, in pixels. */
const RUN_STEP = 0.5;

function distance(a: Point, b: Point): number {
	return hypot(a.x - b.x, a.y - b.y);
}

/**
 * Distance from `from` to the far edge of the dark, light, dark run heading
 * towards `to`, or null if the run does not complete inside the picture.
 *
 * From a finder centre that run is half the core, one light module and one
 * dark: three and a half modules.
 */
function runTowards(image: Binarised, from: Point, to: Point): number | null {
	const dx = to.x - from.x;
	const dy = to.y - from.y;
	const length = hypot(dx, dy);
	if (length === 0) return null;
	const stepX = dx / length;
	const stepY = dy / length;
	// 0: still in the core. 1: in the light ring. 2: in the outer dark ring.
	let state = 0;
	for (let travelled = 0; travelled <= length; travelled += RUN_STEP) {
		const x = Math.floor(from.x + stepX * travelled);
		const y = Math.floor(from.y + stepY * travelled);
		if (x < 0 || y < 0 || x >= image.width || y >= image.height) return null;
		const dark = isDark(image, x, y);
		if (state === 0 && !dark) state = 1;
		else if (state === 1 && dark) state = 2;
		// The edge lies somewhere in the last step, so its middle is the estimate.
		// Taking the step that found light instead overshoots, and by more going
		// left or up than right or down, because a pixel is entered at its lower
		// edge from one side and its upper edge from the other: at two pixels a
		// module that bias alone put a 53-module symbol at 51.
		else if (state === 2 && !dark) return travelled - RUN_STEP / 2;
	}
	return null;
}

function moduleSizeBetween(image: Binarised, a: Point, b: Point): number | null {
	const forward = runTowards(image, a, b);
	if (forward === null) return null;
	// The same run the other way, so the estimate straddles all seven modules.
	const backward = runTowards(image, a, { x: 2 * a.x - b.x, y: 2 * a.y - b.y });
	// One side ran out of picture: half the pattern is still an estimate.
	return backward === null ? forward / 3.5 : (forward + backward) / 7;
}

/**
 * Module size measured along the axis joining two finder centres.
 *
 * The row scan's estimate is not rotation invariant: a horizontal scan across
 * a finder rotated by 33 degrees stretches every run by 1/cos, so an 8 pixel
 * module reads as 9.5, the symbol comes out several versions too small, and
 * the decode collapses although every pattern was found. Measured along the
 * axis the modules are actually counted on, the angle drops out. Both ends,
 * because under a keystone view the far finder really is a different size: 3.7
 * per cent apart on a 12 per cent keystone, a whole version step on a large
 * symbol.
 */
export function moduleSizeAcross(image: Binarised, a: Point, b: Point): number | null {
	const here = moduleSizeBetween(image, a, b);
	const there = moduleSizeBetween(image, b, a);
	if (here === null) return there;
	// The geometric mean of the two ends, not the arithmetic: along a line seen
	// in perspective, the modules between two points number exactly their
	// distance over the geometric mean of the module sizes at the ends. The
	// arithmetic mean put a version 30 symbol tilted 20 degrees two modules
	// short, at a size no symbol has.
	return there === null ? here : Math.sqrt(here * there);
}

/**
 * Assign three centres to corners.
 *
 * Purely geometric, which makes rotation free rather than a special case: the
 * corner not touching the longest side is the right angle, so it is the top
 * left, and the sign of a cross product puts the other two in the order that
 * makes the frame right-handed in image coordinates.
 *
 * That sign is not a mirror test. A reflected symbol has its three finders in
 * exactly the same L, so mirroring cannot be seen here; it is caught after
 * sampling, where a mirrored square symbol is the transpose of a readable one.
 */
export function orderFinders(a: FinderPattern, b: FinderPattern, c: FinderPattern): FinderTriple {
	const ab = distance(a, b);
	const bc = distance(b, c);
	const ca = distance(c, a);
	let corner: FinderPattern;
	let first: FinderPattern;
	let second: FinderPattern;
	if (bc >= ab && bc >= ca) {
		corner = a;
		first = b;
		second = c;
	} else if (ca >= ab && ca >= bc) {
		corner = b;
		first = a;
		second = c;
	} else {
		corner = c;
		first = a;
		second = b;
	}
	const cross =
		(first.x - corner.x) * (second.y - corner.y) - (first.y - corner.y) * (second.x - corner.x);
	return cross > 0
		? { topLeft: corner, topRight: first, bottomLeft: second }
		: { topLeft: corner, topRight: second, bottomLeft: first };
}

/**
 * Every ordered triple worth trying, best first.
 *
 * A busy picture, or one with several codes in it, leaves more than three
 * candidates, so rather than guess, the reader tries the plausible
 * combinations. Three parts of one symbol are the same size and stand in a
 * rough right-angled L, and three unrelated blobs generally do not, so a
 * triple is dropped when its sizes or its shape are far off and ranked by how
 * well the sizes agree.
 */
export function candidateTriples(patterns: readonly FinderPattern[], limit = 8): FinderTriple[] {
	const out: { triple: FinderTriple; score: number }[] = [];
	for (let i = 0; i < patterns.length; i += 1) {
		for (let j = i + 1; j < patterns.length; j += 1) {
			for (let k = j + 1; k < patterns.length; k += 1) {
				const trio = [patterns[i], patterns[j], patterns[k]] as const as readonly [
					FinderPattern,
					FinderPattern,
					FinderPattern,
				];
				const sizes = trio.map((p) => p.moduleSize);
				const mean = ((sizes[0] as number) + (sizes[1] as number) + (sizes[2] as number)) / 3;
				const spread = Math.max(...sizes) - Math.min(...sizes);
				if (spread > mean * 0.7) continue;
				const triple = orderFinders(...trio);
				if (!plausibleShape(triple, mean)) continue;
				const sightings = trio[0].count + trio[1].count + trio[2].count;
				out.push({ triple, score: spread / mean - sightings / 100 });
			}
		}
	}
	return out
		.sort((a, b) => a.score - b.score)
		.slice(0, limit)
		.map(({ triple }) => triple);
}

/**
 * Whether an ordered triple could be one symbol's finders: legs no more than
 * twice each other's length, a corner between 60 and 120 degrees, and a span
 * between the smallest and the largest symbol. Generous, because perspective
 * stretches all three, and exact checks come later.
 */
function plausibleShape(triple: FinderTriple, moduleSize: number): boolean {
	const { topLeft, topRight, bottomLeft } = triple;
	const ux = topRight.x - topLeft.x;
	const uy = topRight.y - topLeft.y;
	const vx = bottomLeft.x - topLeft.x;
	const vy = bottomLeft.y - topLeft.y;
	const across = hypot(ux, uy);
	const down = hypot(vx, vy);
	if (across === 0 || down === 0) return false;
	if (across > down * 2 || down > across * 2) return false;
	if (Math.abs((ux * vx + uy * vy) / (across * down)) > 0.5) return false;
	const span = (across + down) / 2 / moduleSize;
	// 21 - 7 modules for version 1, 177 - 7 for version 40, with room for a bad estimate.
	return span >= 10 && span <= 220;
}
