/**
 * The orientation and module size of one finder pattern on its own.
 *
 * QR gets its frame from three finders, and a triangle has an orientation.
 * Micro QR and rMQR have one finder each, and a square bullseye says only
 * which way its sides run, modulo a quarter turn. That is enough: the four
 * quarter turns are then tried, and the timing pattern or the far sub-pattern
 * says which is right.
 *
 * The sides are found by casting rays from the centre to the outer edge of
 * the pattern. A square of half-side h at angle t is h / max(|cos|, |sin|) of
 * the angle away from t along each ray, so the angle whose model best fits
 * the measured distances is the pattern's. Fitted rather than read off the
 * corners, because a corner is exactly where blur and thresholding eat the
 * pattern first.
 *
 * Clean images only, like the locators that use it: screenshots, scans, this
 * package's own renders and mild rotation. Perspective would bend the square
 * the model assumes, and is not in scope for Micro QR and rMQR in this version.
 */

import { cos, PI, sin } from '../core/math.js';
import type { Binarised } from './binarise.js';
import type { FinderPattern } from './finder.js';
import type { Homography } from './transform.js';
import type { Point } from './types.js';

export interface FinderFrame {
	readonly centre: Point;
	/** The angle of one side, in radians, in [0, pi / 2). */
	readonly angle: number;
	/** Pixels per module, from the pattern's measured side. */
	readonly module: number;
}

/** Rays per full turn, and the angle steps the fit tries per quarter turn. */
const RAYS = 180;
const ANGLE_STEPS = 180;
/** The fit's residual, relative to the half-side, beyond which this is not a square bullseye. */
const MAX_RESIDUAL = 0.12;
/** The walk's step, in pixels. */
const STEP = 0.5;

let modelTable: Float64Array | undefined;

/**
 * 1 / max(|cos a|, |sin a|) on a lattice of a quarter turn in ANGLE_STEPS
 * steps, built once. A ray every 2 degrees and an angle every half degree
 * both land on the lattice, so the fit is table lookups.
 */
function model(): Float64Array {
	if (modelTable !== undefined) return modelTable;
	const table = new Float64Array(ANGLE_STEPS);
	for (let i = 0; i < ANGLE_STEPS; i += 1) {
		const a = (i / ANGLE_STEPS) * (PI / 2);
		table[i] = 1 / Math.max(Math.abs(cos(a)), Math.abs(sin(a)));
	}
	modelTable = table;
	return table;
}

/** Distance from the centre to the outer edge of the pattern along one direction, or NaN. */
function outerEdge(image: Binarised, centre: Point, dx: number, dy: number, limit: number): number {
	// 0: in the core. 1: in the light ring. 2: in the outer dark ring.
	let state = 0;
	for (let travelled = 0; travelled <= limit; travelled += STEP) {
		const x = Math.floor(centre.x + dx * travelled);
		const y = Math.floor(centre.y + dy * travelled);
		if (x < 0 || y < 0 || x >= image.width || y >= image.height) return Number.NaN;
		const dark = image.bits[y * image.width + x] === 1;
		if (state === 0 && !dark) state = 1;
		else if (state === 1 && dark) state = 2;
		else if (state === 2 && !dark) return travelled - STEP / 2;
	}
	return Number.NaN;
}

/** The frame of one finder, or null when the pattern does not fit a square bullseye. */
export function finderFrame(image: Binarised, pattern: FinderPattern): FinderFrame | null {
	const table = model();
	const centre = { x: pattern.x, y: pattern.y };
	// The corners of a 7 module square are 4.95 modules out; allow for a poor
	// first estimate of the module from the row scan.
	const limit = pattern.moduleSize * 8;
	const distances = new Float64Array(RAYS);
	let measured = 0;
	for (let k = 0; k < RAYS; k += 1) {
		const angle = (k / RAYS) * 2 * PI;
		distances[k] = outerEdge(image, centre, cos(angle), sin(angle), limit);
		if (!Number.isNaN(distances[k] as number)) measured += 1;
	}
	if (measured < RAYS / 2) return null;

	// A ray k is at k * 2 degrees and a candidate angle j at j / 2 degrees, so the
	// angle between them is (4k - j) half degrees, taken a quarter turn round.
	const raysPerStep = (ANGLE_STEPS * 4) / RAYS;
	let bestCost = Number.POSITIVE_INFINITY;
	let bestStep = 0;
	let bestHalf = 0;
	for (let j = 0; j < ANGLE_STEPS; j += 1) {
		let rg = 0;
		let gg = 0;
		let rr = 0;
		for (let k = 0; k < RAYS; k += 1) {
			const r = distances[k] as number;
			if (Number.isNaN(r)) continue;
			const index = (((k * raysPerStep - j) % ANGLE_STEPS) + ANGLE_STEPS) % ANGLE_STEPS;
			const g = table[index] as number;
			rg += r * g;
			gg += g * g;
			rr += r * r;
		}
		// The best half-side for this angle by least squares, and what is left.
		const half = rg / gg;
		const cost = rr - half * rg;
		if (cost < bestCost) {
			bestCost = cost;
			bestStep = j;
			bestHalf = half;
		}
	}
	const residual = Math.sqrt(Math.max(0, bestCost) / measured) / bestHalf;
	if (!(residual <= MAX_RESIDUAL)) return null;
	return refine(distances, centre, (bestStep / ANGLE_STEPS) * (PI / 2), bestHalf);
}

/** Rays within this of a side's normal, in radians, count as on that side; the rest are near a corner. */
const SIDE_REACH = 0.5;

/**
 * Sharpen the coarse fit: the edge points the rays found, away from the
 * corners, lie on four lines, and the angle, centre and half-side that put
 * them there best are found by least squares, linearised about the current
 * estimate and repeated. The coarse search is good to a couple of degrees,
 * which over the 17 modules of a Micro QR symbol is half a module at the far
 * edge; this is good to a fraction of one.
 */
function refine(distances: Float64Array, origin: Point, angle: number, half: number): FinderFrame {
	let theta = angle;
	let cx = origin.x;
	let cy = origin.y;
	let h = half;
	for (let pass = 0; pass < 3; pass += 1) {
		// Normal equations for [d theta, d cx, d cy, h].
		const m = new Float64Array(16);
		const v = new Float64Array(4);
		for (let k = 0; k < RAYS; k += 1) {
			const r = distances[k] as number;
			if (Number.isNaN(r)) continue;
			const phi = (k / RAYS) * 2 * PI;
			const side = Math.round((phi - theta) / (PI / 2));
			if (Math.abs(phi - theta - (side * PI) / 2) > SIDE_REACH) continue;
			const normal = theta + (side * PI) / 2;
			const nx = cos(normal);
			const ny = sin(normal);
			const qx = origin.x + r * cos(phi) - cx;
			const qy = origin.y + r * sin(phi) - cy;
			// n.q - n.dc - h + d theta (t.q) = 0, t the normal turned a quarter.
			const row = [-ny * qx + nx * qy, -nx, -ny, -1];
			const target = -(nx * qx + ny * qy);
			for (let i = 0; i < 4; i += 1) {
				v[i] = (v[i] as number) + (row[i] as number) * target;
				for (let j = 0; j < 4; j += 1) {
					m[i * 4 + j] = (m[i * 4 + j] as number) + (row[i] as number) * (row[j] as number);
				}
			}
		}
		const step = solve4(m, v);
		if (step === null) break;
		theta += step[0] as number;
		cx += step[1] as number;
		cy += step[2] as number;
		h = step[3] as number;
	}
	const quarter = PI / 2;
	const wrapped = theta - Math.floor(theta / quarter) * quarter;
	return { centre: { x: cx, y: cy }, angle: wrapped, module: h / 3.5 };
}

/** Solve a 4 by 4 system by elimination with partial pivoting; null when it is singular. */
export function solve4(matrix: Float64Array, vector: Float64Array): number[] | null {
	const a = Array.from({ length: 4 }, (_, i) => [
		matrix[i * 4] as number,
		matrix[i * 4 + 1] as number,
		matrix[i * 4 + 2] as number,
		matrix[i * 4 + 3] as number,
		vector[i] as number,
	]);
	for (let column = 0; column < 4; column += 1) {
		let pivot = column;
		for (let row = column + 1; row < 4; row += 1) {
			if (Math.abs(a[row]![column]!) > Math.abs(a[pivot]![column]!)) pivot = row;
		}
		if (Math.abs(a[pivot]![column]!) < 1e-9) return null;
		[a[column], a[pivot]] = [a[pivot]!, a[column]!];
		for (let row = 0; row < 4; row += 1) {
			if (row === column) continue;
			const factor = a[row]![column]! / a[column]![column]!;
			for (let k = column; k < 5; k += 1) a[row]![k] = a[row]![k]! - factor * a[column]![k]!;
		}
	}
	return a.map((row, i) => row[4]! / row[i]!);
}

/** A unit vector along the frame's side `turns` quarter turns round from its angle. */
export function axis(frame: FinderFrame, turns: number): Point {
	const angle = frame.angle + (turns * PI) / 2;
	return { x: cos(angle), y: sin(angle) };
}

/**
 * The affine map from module coordinates to pixels with the finder's centre at
 * module (3.5, 3.5), x along `ex` and y along `ey`, each one `module` long.
 */
export function frameTransform(centre: Point, ex: Point, ey: Point): Homography {
	return [
		ex.x,
		ey.x,
		centre.x - 3.5 * (ex.x + ey.x),
		ex.y,
		ey.y,
		centre.y - 3.5 * (ex.y + ey.y),
		0,
		0,
		1,
	];
}

/**
 * The y axis for an x axis: a quarter turn clockwise on screen for a
 * right-handed frame, the way a symbol is drawn, or anticlockwise for the
 * mirror image of one.
 */
export function perpendicular(ex: Point, mirrored: boolean): Point {
	return mirrored ? { x: ex.y, y: -ex.x } : { x: -ex.y, y: ex.x };
}
