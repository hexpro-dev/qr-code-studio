/**
 * The projective transform between symbol coordinates and image coordinates.
 *
 * A photograph of a flat code is a projective view of a plane, not an affine
 * one: the far edge really is smaller than the near edge. An affine fit gets
 * the corners right and the middle wrong, which shows up as the sampling grid
 * drifting off the modules halfway across. Eight coefficients fix that exactly
 * for any planar target.
 *
 * Lifted from the authenticator package's reader
 * (google-auth-secret-retriever, `src/qr/decode/transform.ts`), as plain
 * tuples rather than a class, so a transform crosses a worker boundary and
 * reaches a telemetry consumer as the numbers it is.
 */

import { hypot } from '../core/math.js';
import type { Point } from './types.js';

/**
 * Nine coefficients, a11 a21 a31 a12 a22 a32 a13 a23 a33: a point (x, y) maps to
 * ((a11 x + a21 y + a31) / d, (a12 x + a22 y + a32) / d), d = a13 x + a23 y + a33.
 */
export type Homography = readonly [
	number,
	number,
	number,
	number,
	number,
	number,
	number,
	number,
	number,
];

export type Quad = readonly [Point, Point, Point, Point];

export function apply(h: Homography, x: number, y: number): Point {
	const d = h[6] * x + h[7] * y + h[8];
	return { x: (h[0] * x + h[1] * y + h[2]) / d, y: (h[3] * x + h[4] * y + h[5]) / d };
}

/** A module's width in pixels at (u, v) of a grid: the mean length of its two sides there. */
export function moduleWidth(transform: Homography, u: number, v: number): number {
	const here = apply(transform, u, v);
	const across = apply(transform, u + 1, v);
	const down = apply(transform, u, v + 1);
	return (
		(hypot(across.x - here.x, across.y - here.y) + hypot(down.x - here.x, down.y - here.y)) / 2
	);
}

function times(a: Homography, b: Homography): Homography {
	return [
		a[0] * b[0] + a[1] * b[3] + a[2] * b[6],
		a[0] * b[1] + a[1] * b[4] + a[2] * b[7],
		a[0] * b[2] + a[1] * b[5] + a[2] * b[8],
		a[3] * b[0] + a[4] * b[3] + a[5] * b[6],
		a[3] * b[1] + a[4] * b[4] + a[5] * b[7],
		a[3] * b[2] + a[4] * b[5] + a[5] * b[8],
		a[6] * b[0] + a[7] * b[3] + a[8] * b[6],
		a[6] * b[1] + a[7] * b[4] + a[8] * b[7],
		a[6] * b[2] + a[7] * b[5] + a[8] * b[8],
	];
}

/** The adjoint, which inverts a projective map up to a scale that does not matter. */
function adjoint(h: Homography): Homography {
	return [
		h[4] * h[8] - h[5] * h[7],
		h[2] * h[7] - h[1] * h[8],
		h[1] * h[5] - h[2] * h[4],
		h[5] * h[6] - h[3] * h[8],
		h[0] * h[8] - h[2] * h[6],
		h[2] * h[3] - h[0] * h[5],
		h[3] * h[7] - h[4] * h[6],
		h[1] * h[6] - h[0] * h[7],
		h[0] * h[4] - h[1] * h[3],
	];
}

/**
 * The unit square onto a quadrilateral, corners in order (0,0), (1,0), (1,1),
 * (0,1). The standard construction: the two projective terms come from how
 * far the quadrilateral is from a parallelogram, and the rest follows.
 */
function squareToQuad(q: Quad): Homography {
	const [p0, p1, p2, p3] = q;
	const dx3 = p0.x - p1.x + p2.x - p3.x;
	const dy3 = p0.y - p1.y + p2.y - p3.y;
	if (dx3 === 0 && dy3 === 0) {
		return [p1.x - p0.x, p2.x - p1.x, p0.x, p1.y - p0.y, p2.y - p1.y, p0.y, 0, 0, 1];
	}
	const dx1 = p1.x - p2.x;
	const dx2 = p3.x - p2.x;
	const dy1 = p1.y - p2.y;
	const dy2 = p3.y - p2.y;
	const denominator = dx1 * dy2 - dx2 * dy1;
	const a13 = (dx3 * dy2 - dx2 * dy3) / denominator;
	const a23 = (dx1 * dy3 - dx3 * dy1) / denominator;
	return [
		p1.x - p0.x + a13 * p1.x,
		p3.x - p0.x + a23 * p3.x,
		p0.x,
		p1.y - p0.y + a13 * p1.y,
		p3.y - p0.y + a23 * p3.y,
		p0.y,
		a13,
		a23,
		1,
	];
}

/** The transform taking one quadrilateral onto another, corner for corner, through the unit square. */
export function quadToQuad(source: Quad, destination: Quad): Homography {
	return times(squareToQuad(destination), adjoint(squareToQuad(source)));
}

/**
 * The projective map that best takes `source` to `destination` in the least
 * squares sense, from four or more correspondences, or null when they do not
 * pin one down (fewer than four, or all on a line).
 *
 * The direct linear method with the last coefficient fixed at one, each
 * point set first moved to its centroid and scaled to unit spread, as Hartley
 * recommends, so pixel and module coordinates of very different sizes do not
 * swamp each other in the normal equations.
 */
export function fitHomography(
	source: readonly Point[],
	destination: readonly Point[],
): Homography | null {
	if (source.length < 4 || source.length !== destination.length) return null;
	const normalise = (points: readonly Point[]): { scale: number; cx: number; cy: number } => {
		let cx = 0;
		let cy = 0;
		for (const p of points) {
			cx += p.x / points.length;
			cy += p.y / points.length;
		}
		let spread = 0;
		for (const p of points) spread += Math.sqrt((p.x - cx) * (p.x - cx) + (p.y - cy) * (p.y - cy));
		spread /= points.length;
		return { scale: spread > 0 ? Math.SQRT2 / spread : 1, cx, cy };
	};
	const s = normalise(source);
	const d = normalise(destination);
	// Normal equations for h = [a11 a21 a31 a12 a22 a32 a13 a23], a33 = 1.
	const m = new Float64Array(64);
	const v = new Float64Array(8);
	const add = (row: readonly number[], target: number): void => {
		for (let i = 0; i < 8; i += 1) {
			v[i] = (v[i] as number) + (row[i] as number) * target;
			for (let j = 0; j < 8; j += 1) {
				m[i * 8 + j] = (m[i * 8 + j] as number) + (row[i] as number) * (row[j] as number);
			}
		}
	};
	for (let i = 0; i < source.length; i += 1) {
		const x = ((source[i] as Point).x - s.cx) * s.scale;
		const y = ((source[i] as Point).y - s.cy) * s.scale;
		const u = ((destination[i] as Point).x - d.cx) * d.scale;
		const w = ((destination[i] as Point).y - d.cy) * d.scale;
		add([x, y, 1, 0, 0, 0, -u * x, -u * y], u);
		add([0, 0, 0, x, y, 1, -w * x, -w * y], w);
	}
	const h = solveLinear(m, v, 8);
	if (h === null) return null;
	const normal: Homography = [h[0]!, h[1]!, h[2]!, h[3]!, h[4]!, h[5]!, h[6]!, h[7]!, 1];
	// Undo the normalisations: destination = D^-1 H S source.
	const sourceFrame: Homography = [
		s.scale,
		0,
		-s.cx * s.scale,
		0,
		s.scale,
		-s.cy * s.scale,
		0,
		0,
		1,
	];
	const back: Homography = [1 / d.scale, 0, d.cx, 0, 1 / d.scale, d.cy, 0, 0, 1];
	return times(back, times(normal, sourceFrame));
}

/** Solve an n by n system by elimination with partial pivoting; null when it is singular. */
function solveLinear(matrix: Float64Array, vector: Float64Array, n: number): number[] | null {
	const a = Array.from({ length: n }, (_, i) => [
		...Array.from(matrix.subarray(i * n, i * n + n)),
		vector[i] as number,
	]);
	for (let column = 0; column < n; column += 1) {
		let pivot = column;
		for (let row = column + 1; row < n; row += 1) {
			if (Math.abs(a[row]![column]!) > Math.abs(a[pivot]![column]!)) pivot = row;
		}
		if (Math.abs(a[pivot]![column]!) < 1e-12) return null;
		[a[column], a[pivot]] = [a[pivot]!, a[column]!];
		for (let row = 0; row < n; row += 1) {
			if (row === column) continue;
			const factor = a[row]![column]! / a[column]![column]!;
			for (let k = column; k <= n; k += 1) a[row]![k] = a[row]![k]! - factor * a[column]![k]!;
		}
	}
	return a.map((row, i) => row[n]! / row[i]!);
}
