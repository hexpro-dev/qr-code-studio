/**
 * Affine transforms, as the six numbers SVG and PDF both use.
 *
 * `[a, b, c, d, e, f]` maps a point to `(a x + c y + e, b x + d y + f)`, which
 * is the order `transform="matrix(a b c d e f)"` and the PDF `cm` operator
 * take them in, so a matrix can be written to either without rearranging.
 *
 * Space here is y down, as it is on a screen and in SVG. A positive angle
 * therefore turns clockwise as the person sees it, which is also what the
 * design document means by an angle.
 */

import { PI, cos, sin } from '../core/math.js';

export type Matrix = readonly [number, number, number, number, number, number];

/** Throws a TypeError naming the caller when any entry is not a finite number. */
export function checkMatrix(m: Matrix, where: string): void {
	if (!Array.isArray(m) || m.length !== 6) {
		throw new TypeError(`${where}: a matrix is six numbers, a b c d e f.`);
	}
	for (let i = 0; i < 6; i += 1) {
		if (!Number.isFinite(m[i])) {
			throw new TypeError(`${where}: matrix entry ${i} is not a finite number.`);
		}
	}
}

function checkNumber(value: number, where: string, name: string): void {
	if (!Number.isFinite(value)) throw new TypeError(`${where}: ${name} is not a finite number.`);
}

export function identity(): Matrix {
	return [1, 0, 0, 1, 0, 0];
}

/**
 * The matrix that applies `second` and then `first`.
 *
 * The argument order is the mathematical product `first * second`, which is
 * also the order SVG reads a transform list in: `translate(5 0) scale(2)`
 * scales a point first and then moves it, and is `multiply(translate(5, 0),
 * scale(2))` here.
 */
export function multiply(first: Matrix, second: Matrix): Matrix {
	checkMatrix(first, 'multiply');
	checkMatrix(second, 'multiply');
	const [a1, b1, c1, d1, e1, f1] = first;
	const [a2, b2, c2, d2, e2, f2] = second;
	return [
		a1 * a2 + c1 * b2,
		b1 * a2 + d1 * b2,
		a1 * c2 + c1 * d2,
		b1 * c2 + d1 * d2,
		a1 * e2 + c1 * f2 + e1,
		b1 * e2 + d1 * f2 + f1,
	];
}

export function translate(tx: number, ty: number): Matrix {
	checkNumber(tx, 'translate', 'tx');
	checkNumber(ty, 'translate', 'ty');
	return [1, 0, 0, 1, tx, ty];
}

export function scale(sx: number, sy: number = sx): Matrix {
	checkNumber(sx, 'scale', 'sx');
	checkNumber(sy, 'scale', 'sy');
	return [sx, 0, 0, sy, 0, 0];
}

/**
 * A rotation by whole quarter turns, clockwise, about `(cx, cy)`.
 *
 * Exact, which a rotation through sine and cosine of a multiple of 90 degrees
 * is not: cos(pi / 2) in floating point is 6e-17, not zero, and a module shape
 * turned by it would land a hair off the cell grid it has to tile. Region
 * shapes are drawn once and turned to each corner, so this is the common case.
 */
export function rotateQuarter(turns: number, cx = 0, cy = 0): Matrix {
	if (!Number.isInteger(turns)) {
		throw new TypeError('rotateQuarter: turns is a whole number of quarter turns.');
	}
	checkNumber(cx, 'rotateQuarter', 'cx');
	checkNumber(cy, 'rotateQuarter', 'cy');
	const quarter = ((turns % 4) + 4) % 4;
	const cos = quarter === 0 ? 1 : quarter === 2 ? -1 : 0;
	const sin = quarter === 1 ? 1 : quarter === 3 ? -1 : 0;
	return aboutCentre(cos, sin, cx, cy);
}

/**
 * A rotation by `degrees`, clockwise as seen with y down, about `(cx, cy)`.
 *
 * Whole quarter turns go through `rotateQuarter` and are exact. Anything else
 * uses core's sine and cosine, which give the same bits in every engine; the
 * angle is reduced to within a turn first, which `%` does exactly, so 370 and
 * 10 degrees are the same matrix.
 */
export function rotate(degrees: number, cx = 0, cy = 0): Matrix {
	checkNumber(degrees, 'rotate', 'degrees');
	checkNumber(cx, 'rotate', 'cx');
	checkNumber(cy, 'rotate', 'cy');
	const reduced = degrees % 360;
	if (reduced % 90 === 0) return rotateQuarter(reduced / 90, cx, cy);
	const radians = reduced * (PI / 180);
	return aboutCentre(cos(radians), sin(radians), cx, cy);
}

/** Rotation by `cos` and `sin` about a centre: translate(c) * rotate * translate(-c). */
export function aboutCentre(cos: number, sin: number, cx: number, cy: number): Matrix {
	// Written out rather than built from three multiplies, so the exact case
	// above stays exact: 0 * cx is 0 and nothing else is added in.
	return [cos, sin, -sin, cos, cx - cos * cx + sin * cy, cy - sin * cx - cos * cy];
}

/** Where `m` takes the point `(x, y)`. */
export function transformPoint(m: Matrix, x: number, y: number): [number, number] {
	return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

export function isIdentity(m: Matrix): boolean {
	return m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 1 && m[4] === 0 && m[5] === 0;
}
