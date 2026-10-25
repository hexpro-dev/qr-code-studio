/**
 * Grids for the one-finder symbologies, Micro QR and rMQR.
 *
 * Both start from `finderFrame`: the finder's centre, the angle of its sides
 * and its module size, with the right quarter turn still to find. Micro QR
 * then reads its size off the timing patterns that run from the finder along
 * the top row and down the left column. rMQR reads its height down the left
 * column the same way, and then looks for its finder sub-pattern, the 5 by 5
 * bullseye in the far corner, at each width its height allows; the two
 * patterns' centres fix the grid, since they are the whole symbol apart.
 *
 * Clean images only: screenshots, scans, this package's own renders and mild
 * rotation. Perspective is not in scope for these two in this version. Micro
 * QR is at most 17 modules, so an affine grid from the one finder holds
 * across it; rMQR is up to 139 long and only two points far apart keep its
 * grid on the modules, which perspective would bend away from between them.
 */

import { searchBullseye } from './alignment.js';
import type { Binarised } from './binarise.js';
import type { FinderFrame } from './frame.js';
import { axis, frameTransform, perpendicular } from './frame.js';
import type { GridHypothesis } from './locate-qr.js';
import type { Homography } from './transform.js';
import { apply } from './transform.js';
import type { Point } from './types.js';

/** How much of a timing pattern and its quiet zone has to read right, as for QR's. */
export const TIMING_AGREEMENT = 0.85;

/** A sub-pattern candidate scoring worse than this is not one: genuine ones score under 0.1. */
const MAX_BULLSEYE_SCORE = 0.3;

export interface SingleHypothesis extends GridHypothesis {
	/** Sampled in a left-handed frame: the picture is a mirror image of the symbol. */
	readonly mirrored: boolean;
}

function isDark(image: Binarised, transform: Homography, u: number, v: number): boolean | null {
	const p = apply(transform, u + 0.5, v + 0.5);
	const x = Math.floor(p.x);
	const y = Math.floor(p.y);
	if (x < 0 || y < 0 || x >= image.width || y >= image.height) return null;
	return image.bits[y * image.width + x] === 1;
}

/** Fraction of `checks` (module, expected darkness) that read as expected; off the picture counts as light. */
function agreement(
	image: Binarised,
	transform: Homography,
	checks: readonly (readonly [number, number, boolean])[],
): number {
	let matched = 0;
	for (const [u, v, dark] of checks)
		if ((isDark(image, transform, u, v) ?? false) === dark) matched += 1;
	return matched / checks.length;
}

/** The transform for a frame turned `turns` quarter turns, in either handedness. */
function turned(frame: FinderFrame, turns: number, mirrored: boolean): Homography {
	const unit = axis(frame, turns);
	const ex = { x: unit.x * frame.module, y: unit.y * frame.module };
	return frameTransform(frame.centre, ex, perpendicular(ex, mirrored));
}

/**
 * The timing checks for a Micro QR symbol of `size`: the separator at 7, the
 * timing pattern from 8 (dark on even modules) along row 0 and column 0, and
 * two modules of quiet zone past the end of each.
 */
function microChecks(size: number): (readonly [number, number, boolean])[] {
	const checks: (readonly [number, number, boolean])[] = [];
	for (let i = 7; i < size + 2; i += 1) {
		const dark = i < size && i % 2 === 0;
		checks.push([i, 0, dark], [0, i, dark]);
	}
	return checks;
}

/**
 * Micro QR grids for one finder, best first: each quarter turn, and each size
 * whose timing patterns read there, the best agreement first. Right-handed
 * only: a mirrored symbol samples as its transpose, which the symbology's
 * lenient read turns back, as it does for QR.
 */
export function microHypotheses(
	image: Binarised,
	frame: FinderFrame,
	sizes: readonly number[],
): SingleHypothesis[] {
	const found: { hypothesis: SingleHypothesis; score: number }[] = [];
	for (let turns = 0; turns < 4; turns += 1) {
		const transform = turned(frame, turns, false);
		for (const size of sizes) {
			const score = agreement(image, transform, microChecks(size));
			if (score < TIMING_AGREEMENT) continue;
			found.push({
				hypothesis: { width: size, height: size, transform, mirrored: false },
				score,
			});
		}
	}
	return found.sort((a, b) => b.score - a.score).map(({ hypothesis }) => hypothesis);
}

/**
 * The height of an rMQR symbol read down its left column: below the finder
 * comes the separator, then timing and the bottom left corner pattern, with no
 * two light modules in a row until the quiet zone. The first such pair marks
 * the bottom edge.
 */
function rmqrHeight(
	image: Binarised,
	transform: Homography,
	heights: ReadonlySet<number>,
): number | null {
	let previousLight = false;
	const tallest = Math.max(...heights);
	for (let v = 7; v <= tallest + 1; v += 1) {
		const light = isDark(image, transform, 0, v) !== true;
		if (light && previousLight) return heights.has(v - 1) ? v - 1 : null;
		previousLight = light;
	}
	return null;
}

/**
 * The similarity transform through two points: the finder centre at module
 * (3.5, 3.5) and the sub-pattern centre at (width - 2.5, height - 2.5). Square
 * modules and no perspective, which is the scope.
 */
function twoPointTransform(
	finder: Point,
	sub: Point,
	width: number,
	height: number,
	mirrored: boolean,
): Homography {
	const a = width - 6;
	const b = height - 6;
	const dx = sub.x - finder.x;
	const dy = sub.y - finder.y;
	const norm = a * a + b * b;
	// Solve a e + b perpendicular(e) = (dx, dy) for the module vector e.
	const ex = mirrored
		? { x: (a * dx - b * dy) / norm, y: (b * dx + a * dy) / norm }
		: { x: (a * dx + b * dy) / norm, y: (a * dy - b * dx) / norm };
	return frameTransform(finder, ex, perpendicular(ex, mirrored));
}

/**
 * rMQR grids for one finder, best first.
 *
 * For each quarter turn and handedness the left column gives the height, and
 * each width that height comes in is tried by looking for the sub-pattern
 * where it would be. The window grows with the width, because the frame's
 * angle and module size are estimated over seven modules and extrapolated
 * over up to 139.
 */
export function rmqrHypotheses(
	image: Binarised,
	frame: FinderFrame,
	sizes: readonly { readonly width: number; readonly height: number }[],
	mirroredToo: boolean,
): SingleHypothesis[] {
	const heights = new Set(sizes.map((size) => size.height));
	const out: SingleHypothesis[] = [];
	for (const mirrored of mirroredToo ? [false, true] : [false]) {
		for (let turns = 0; turns < 4; turns += 1) {
			const transform = turned(frame, turns, mirrored);
			const height = rmqrHeight(image, transform, heights);
			if (height === null) continue;
			for (const { width } of sizes.filter((size) => size.height === height)) {
				const predicted = apply(transform, width - 2.5, height - 2.5);
				const radius = Math.ceil((2 + width * 0.04) * frame.module);
				const [best] = searchBullseye(image, predicted, radius, frame.module, 1);
				if (best === undefined || best.score > MAX_BULLSEYE_SCORE) continue;
				const grid = twoPointTransform(frame.centre, best.point, width, height, mirrored);
				// The sub-pattern sits in the corner: quiet zone beyond it on both sides.
				const quiet: (readonly [number, number, boolean])[] = [];
				for (let i = 0; i < 5; i += 1) {
					quiet.push([width, height - 1 - i, false], [width - 1 - i, height, false]);
				}
				if (agreement(image, grid, quiet) < TIMING_AGREEMENT) continue;
				if (rmqrTimingAgreement(image, grid, width, height) < TIMING_AGREEMENT) continue;
				out.push({ width, height, transform: grid, mirrored });
			}
		}
	}
	return out;
}

/**
 * Whether an rMQR grid landed on the symbol: the top and bottom rows alternate
 * from the finder's separator to the corner patterns, dark on even modules,
 * broken only where an alignment pattern's three dark modules cross them, and
 * a symbol has few enough of those that the alternation still dominates.
 */
function rmqrTimingAgreement(
	image: Binarised,
	transform: Homography,
	width: number,
	height: number,
): number {
	const checks: (readonly [number, number, boolean])[] = [];
	for (let u = 8; u <= width - 4; u += 1) {
		checks.push([u, 0, u % 2 === 0], [u, height - 1, u % 2 === 0]);
	}
	return agreement(image, transform, checks);
}
