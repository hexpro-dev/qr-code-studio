/**
 * Plane to plane projective maps, for photographing a printed code from an
 * angle.
 *
 * A real perspective view foreshortens both axes, so rows bunch up towards
 * the far edge as well as narrowing; tapering each row is not a projective
 * map at all, and a reader that handles photographs well fails on it. So
 * captures are made with the genuine eight coefficient homography taking one
 * quadrilateral to another, built as ZXing builds it (Heckbert's square to
 * quadrilateral and its adjoint), from + - * / alone.
 */

export interface Point {
	readonly x: number;
	readonly y: number;
}

export type Quad = readonly [Point, Point, Point, Point];

/** Row major 3 by 3: x' = (a x + b y + c) / (g x + h y + i), y' = (d x + e y + f) / (...). */
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

/** The unit square, corner for corner (0,0) (1,0) (1,1) (0,1), onto `quad`. */
function squareToQuad(quad: Quad): Homography {
	const [p0, p1, p2, p3] = quad;
	const dx3 = p0.x - p1.x + p2.x - p3.x;
	const dy3 = p0.y - p1.y + p2.y - p3.y;
	if (dx3 === 0 && dy3 === 0) {
		// Affine: the quadrilateral is a parallelogram.
		return [p1.x - p0.x, p2.x - p1.x, p0.x, p1.y - p0.y, p2.y - p1.y, p0.y, 0, 0, 1];
	}
	const dx1 = p1.x - p2.x;
	const dx2 = p3.x - p2.x;
	const dy1 = p1.y - p2.y;
	const dy2 = p3.y - p2.y;
	const denominator = dx1 * dy2 - dx2 * dy1;
	const g = (dx3 * dy2 - dx2 * dy3) / denominator;
	const h = (dx1 * dy3 - dx3 * dy1) / denominator;
	return [
		p1.x - p0.x + g * p1.x,
		p3.x - p0.x + h * p3.x,
		p0.x,
		p1.y - p0.y + g * p1.y,
		p3.y - p0.y + h * p3.y,
		p0.y,
		g,
		h,
		1,
	];
}

/** The adjoint, which inverts a homography up to scale. */
function adjoint(m: Homography): Homography {
	const [a, b, c, d, e, f, g, h, i] = m;
	return [
		e * i - f * h,
		c * h - b * i,
		b * f - c * e,
		f * g - d * i,
		a * i - c * g,
		c * d - a * f,
		d * h - e * g,
		b * g - a * h,
		a * e - b * d,
	];
}

function compose(first: Homography, second: Homography): Homography {
	// second after first: second * first.
	const [a1, b1, c1, d1, e1, f1, g1, h1, i1] = first;
	const [a2, b2, c2, d2, e2, f2, g2, h2, i2] = second;
	return [
		a2 * a1 + b2 * d1 + c2 * g1,
		a2 * b1 + b2 * e1 + c2 * h1,
		a2 * c1 + b2 * f1 + c2 * i1,
		d2 * a1 + e2 * d1 + f2 * g1,
		d2 * b1 + e2 * e1 + f2 * h1,
		d2 * c1 + e2 * f1 + f2 * i1,
		g2 * a1 + h2 * d1 + i2 * g1,
		g2 * b1 + h2 * e1 + i2 * h1,
		g2 * c1 + h2 * f1 + i2 * i1,
	];
}

/** The map taking each corner of `from` to the same corner of `to`. */
export function quadToQuad(from: Quad, to: Quad): Homography {
	return compose(adjoint(squareToQuad(from)), squareToQuad(to));
}

export function applyHomography(m: Homography, x: number, y: number): Point {
	const w = m[6] * x + m[7] * y + m[8];
	return { x: (m[0] * x + m[1] * y + m[2]) / w, y: (m[3] * x + m[4] * y + m[5]) / w };
}
