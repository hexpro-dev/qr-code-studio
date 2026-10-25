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
