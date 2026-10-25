/**
 * Finding a 5 by 5 bullseye near where a fit predicts it: QR's bottom right
 * alignment pattern, and rMQR's finder sub-pattern, which has the same rings.
 *
 * Lifted from the authenticator package's reader
 * (google-auth-secret-retriever, `src/qr/decode/sample.ts`), where the
 * ranking below is the fix for the failure that tool was actually shipping: a
 * photograph held at an angle, all three finders found precisely, and a
 * symbol whose modules were perfectly legible refused as too damaged, because
 * the fourth correspondence had landed on an ordinary dark data module.
 */

import { hypot } from '../core/math.js';
import type { Binarised } from './binarise.js';
import type { Point } from './types.js';

export interface AlignmentMatch {
	/** Where it was found, in image pixels. */
	readonly point: Point;
	/** How much it fails to look like a bullseye. Lower is better; zero is a perfect one. */
	readonly score: number;
	/** How far it sits from the prediction, in modules. */
	readonly offset: number;
}

/**
 * Scores within this of each other are the same score. A genuine pattern
 * measured 0.01 to 0.05 and the best data-module impostor 0.29, so a tenth
 * separates the populations and not two genuine patterns.
 */
const SCORE_BAND = 0.1;
/** Both axes and both diagonals. */
const SCORE_DIRECTIONS = 4;
/**
 * What a direction with no measurable run costs. Charged rather than refused,
 * because blur erodes the light ring at a pattern's corners before its axes,
 * and a real pattern at three pixels a module can lose a diagonal.
 */
const MISSING_DIRECTION = 2;

function isDark(image: Binarised, x: number, y: number): boolean {
	return image.bits[y * image.width + x] === 1;
}

/**
 * Candidates within `radius` pixels of `expected`, best looking first.
 *
 * Quality first, and position only between candidates of equal quality. An
 * isolated dark data module passes the two axis tests surprisingly often, and
 * dozens of them sit inside a window wide enough to cover an affine
 * prediction's error, so ranking by distance from that prediction is a
 * lottery: the true pattern came seventh at version 18 and fourteenth at 26 on
 * measured scenes. Position still matters when two genuine patterns both score
 * near zero, and then it is all there is.
 */
export function searchBullseye(
	image: Binarised,
	expected: Point,
	radius: number,
	moduleSize: number,
	limit: number,
): AlignmentMatch[] {
	const found: AlignmentMatch[] = [];
	const cx = Math.floor(expected.x);
	const cy = Math.floor(expected.y);
	for (let y = Math.max(0, cy - radius); y <= Math.min(image.height - 1, cy + radius); y += 1) {
		for (let x = Math.max(0, cx - radius); x <= Math.min(image.width - 1, cx + radius); x += 1) {
			if (!isDark(image, x, y)) continue;
			const measured = scoreAt(image, x, y, moduleSize);
			if (measured === null) continue;
			const { point, score } = measured;
			const offset = hypot(point.x - expected.x, point.y - expected.y) / moduleSize;
			// Many starting pixels inside one pattern resolve to the same centre, and
			// those are one candidate rather than hundreds; keep the best of them.
			const existing = found.findIndex(
				(candidate) => hypot(candidate.point.x - point.x, candidate.point.y - point.y) < moduleSize,
			);
			if (existing < 0) found.push({ point, score, offset });
			else if (score < (found[existing] as AlignmentMatch).score) {
				found[existing] = { point, score, offset };
			}
		}
	}
	return found
		.sort((a, b) => {
			// Adding a weighted distance to the score looks tidier and cannot work:
			// the weight would have to be small enough not to swamp the gap between
			// a pattern and a data module, and large enough to separate two
			// patterns that both score near zero, and no number is both.
			const band = Math.floor(a.score / SCORE_BAND) - Math.floor(b.score / SCORE_BAND);
			return band !== 0 ? band : a.offset - b.offset;
		})
		.slice(0, limit);
}

/**
 * Score a candidate centre, and refine it.
 *
 * Null means not a plausible pattern at all: both axes have to show a light,
 * dark, light triple of roughly equal runs at roughly the expected module
 * size. The diagonals do not gate, they only score, and nearly all of the
 * discrimination comes from them.
 */
function scoreAt(
	image: Binarised,
	x: number,
	y: number,
	moduleSize: number,
): { point: Point; score: number } | null {
	const horizontal = runTriple(image, x, y, 1, 0, moduleSize);
	if (horizontal === null || !plausible(horizontal, moduleSize)) return null;
	const vertical = runTriple(image, x, y, 0, 1, moduleSize);
	if (vertical === null || !plausible(vertical, moduleSize)) return null;
	const down = runTriple(image, x, y, 1, 1, moduleSize);
	const up = runTriple(image, x, y, 1, -1, moduleSize);

	let error = horizontal.error + vertical.error;
	error += down === null ? MISSING_DIRECTION : down.error;
	error += up === null ? MISSING_DIRECTION : up.error;
	// Opposite directions of one pair cross the same rings, so a real pattern
	// shows the same module size along both. The two pairs only agree with each
	// other at 22.5 degrees, which is why the comparison is within a pair.
	const axisPair = disagreement(horizontal.size, vertical.size);
	const diagonalPair =
		down === null || up === null ? MISSING_DIRECTION / 2 : disagreement(down.size, up.size);
	return {
		// Pixel centres: the walk counts whole pixels either side of (x, y).
		point: { x: x + 0.5 + horizontal.offset, y: y + 0.5 + vertical.offset },
		score: error / SCORE_DIRECTIONS + axisPair + diagonalPair,
	};
}

function disagreement(a: number, b: number): number {
	return Math.abs(a - b) / ((a + b) / 2);
}

interface RunTriple {
	/** Light, dark centre, light, in steps along the direction. */
	readonly runs: readonly [number, number, number];
	/** Implied module size, in pixels. */
	readonly size: number;
	/** How far the three runs are from equal, scale free. */
	readonly error: number;
	/** Where the middle of the dark run sits, in steps from the start point. */
	readonly offset: number;
}

/**
 * The light, dark, light triple through a point along one direction.
 *
 * The outer dark ring is required but not measured: reaching it is what tells
 * a pattern from a dark module with a wide light gap beside it, while its
 * width says nothing, because it touches data modules more often than not.
 */
function runTriple(
	image: Binarised,
	x: number,
	y: number,
	dx: number,
	dy: number,
	moduleSize: number,
): RunTriple | null {
	// A diagonal step covers root two pixels.
	const stepLength = dx !== 0 && dy !== 0 ? Math.SQRT2 : 1;
	const limit = (moduleSize * 3) / stepLength;
	const walk = (sign: number): { centre: number; light: number } | null => {
		let centre = 0;
		let light = 0;
		let inLight = false;
		let px = x + sign * dx;
		let py = y + sign * dy;
		while (px >= 0 && py >= 0 && px < image.width && py < image.height) {
			const dark = isDark(image, px, py);
			if (!inLight) {
				if (dark) centre += 1;
				else {
					inLight = true;
					light += 1;
				}
			} else if (!dark) light += 1;
			else return { centre, light };
			if (centre > limit || light > limit) return null;
			px += sign * dx;
			py += sign * dy;
		}
		return null;
	};
	const back = walk(-1);
	if (back === null) return null;
	const forward = walk(1);
	if (forward === null) return null;
	const runs: [number, number, number] = [
		back.light,
		back.centre + 1 + forward.centre,
		forward.light,
	];
	const mean = (runs[0] + runs[1] + runs[2]) / 3;
	let error = 0;
	for (const run of runs) {
		const relative = (run - mean) / mean;
		error += relative * relative;
	}
	return { runs, size: mean * stepLength, error, offset: (forward.centre - back.centre) / 2 };
}

/**
 * Whether a triple is worth scoring. The runs are compared with each other
 * rather than with `moduleSize`, because a scan across a rotated symbol
 * stretches all three by the same factor, but the size still has to be in the
 * right neighbourhood or a large smudge would qualify.
 */
function plausible(triple: RunTriple, moduleSize: number): boolean {
	const mean = (triple.runs[0] + triple.runs[1] + triple.runs[2]) / 3;
	for (const run of triple.runs) if (Math.abs(run - mean) > mean * 0.6) return false;
	return triple.size >= moduleSize * 0.5 && triple.size <= moduleSize * 2.2;
}
