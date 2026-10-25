/**
 * Curves to straight lines, the same way in every engine.
 *
 * The rasteriser fills polygons, so every curve is cut into chords first. How
 * many chords is the part that has to be deterministic: a count worked out
 * with a transcendental function could differ by one between engines, move an
 * anti-aliased edge by a level, and change what the strict reader sees. So the
 * count comes from Wang's formula, which needs a square root and arithmetic
 * and nothing else.
 *
 * Wang's formula bounds the distance between a Bezier curve of degree d and
 * the polygon through n evenly spaced parameter values by
 * d (d - 1) / 8 * M / n^2, where M is the largest second difference of the
 * control points. Solving for n gives a count that meets a tolerance on every
 * curve, without measuring the result and without recursion. It is generous
 * (often by about a factor of two), which costs chords rather than accuracy.
 */

import { walkPath } from './path.js';
import type { Path } from './path.js';
import type { Box } from './measure.js';
import type { Matrix } from './matrix.js';

/** One straight edge of a filled outline, in output space. */
export type LineSink = (x0: number, y0: number, x1: number, y1: number) => void;

export interface FlattenOptions {
	/** Applied to the control points before flattening, so the tolerance is in output units. */
	readonly matrix?: Matrix;
	/** The furthest a chord may stray from its curve, in output units. */
	readonly tolerance: number;
	/**
	 * Curves whose control points all lie on one side of this box are drawn as
	 * their chord instead.
	 *
	 * For a filler this loses nothing. A curve wholly to the left of the
	 * picture changes the winding of the pixels to its right only through where
	 * it starts and ends, and a curve wholly above, below or to the right of the
	 * picture changes no pixel at all. Leaving those uncut keeps a stray
	 * enormous curve from turning into millions of edges.
	 */
	readonly cull?: Box;
}

/**
 * Output coordinates are held within this distance of the origin.
 *
 * Finite inputs can still overflow through a matrix, and an infinity meeting
 * a zero weight in the curve evaluation below is a NaN. 2^50 output units is
 * far beyond any surface this package allocates, so nothing that is drawn
 * moves.
 */
export const COORDINATE_LIMIT = 1125899906842624;

/** No curve is cut into more than this many chords, whatever its size. */
export const MAX_CHORDS = 8192;

function clamp(value: number): number {
	if (value > COORDINATE_LIMIT) return COORDINATE_LIMIT;
	if (value < -COORDINATE_LIMIT) return -COORDINATE_LIMIT;
	// NaN cannot arrive here: the inputs are checked finite, and an overflow
	// through the matrix is an infinity, which the two tests above catch.
	return value;
}

function chords(distance: number, factor: number, tolerance: number): number {
	const n = Math.ceil(Math.sqrt((factor * distance) / tolerance));
	if (!(n >= 1)) return 1;
	return n > MAX_CHORDS ? MAX_CHORDS : n;
}

function outside(box: Box | undefined, xs: readonly number[], ys: readonly number[]): boolean {
	if (box === undefined) return false;
	const right = box.x + box.width;
	const bottom = box.y + box.height;
	let left = true;
	let rightOf = true;
	let above = true;
	let below = true;
	for (let i = 0; i < xs.length; i += 1) {
		const x = xs[i] as number;
		const y = ys[i] as number;
		if (x >= box.x) left = false;
		if (x <= right) rightOf = false;
		if (y >= box.y) above = false;
		if (y <= bottom) below = false;
	}
	return left || rightOf || above || below;
}

/**
 * Every straight edge of the path's filled outline, curves cut into chords,
 * each subpath closed back to its start.
 *
 * The last chord of a curve ends exactly on the curve's end point rather than
 * on an evaluation of it at t = 1, so consecutive segments share their
 * vertices bit for bit and the outline is watertight.
 */
export function flattenPath(path: Path, options: FlattenOptions, sink: LineSink): void {
	const { matrix, cull } = options;
	const tolerance = options.tolerance;
	if (!(tolerance > 0) || !Number.isFinite(tolerance)) {
		throw new TypeError('flattenPath: tolerance is a positive finite number.');
	}
	const a = matrix ? matrix[0] : 1;
	const b = matrix ? matrix[1] : 0;
	const c = matrix ? matrix[2] : 0;
	const d = matrix ? matrix[3] : 1;
	const e = matrix ? matrix[4] : 0;
	const f = matrix ? matrix[5] : 0;
	const tx = (x: number, y: number): number => clamp(a * x + c * y + e);
	const ty = (x: number, y: number): number => clamp(b * x + d * y + f);

	let startX = 0;
	let startY = 0;
	let lastX = 0;
	let lastY = 0;
	let open = false;

	const closeSubpath = (): void => {
		if (open && (lastX !== startX || lastY !== startY)) sink(lastX, lastY, startX, startY);
		open = false;
	};
	const lineTo = (x: number, y: number): void => {
		sink(lastX, lastY, x, y);
		lastX = x;
		lastY = y;
	};

	walkPath(
		path,
		{
			move(x, y) {
				closeSubpath();
				startX = tx(x, y);
				startY = ty(x, y);
				lastX = startX;
				lastY = startY;
				open = true;
			},
			line(x, y) {
				lineTo(tx(x, y), ty(x, y));
			},
			quad(qx, qy, x, y) {
				const x0 = lastX;
				const y0 = lastY;
				const x1 = tx(qx, qy);
				const y1 = ty(qx, qy);
				const x2 = tx(x, y);
				const y2 = ty(x, y);
				if (outside(cull, [x0, x1, x2], [y0, y1, y2])) {
					lineTo(x2, y2);
					return;
				}
				const ddx = x0 - 2 * x1 + x2;
				const ddy = y0 - 2 * y1 + y2;
				const n = chords(Math.sqrt(ddx * ddx + ddy * ddy), 0.25, tolerance);
				for (let i = 1; i < n; i += 1) {
					const t = i / n;
					const mt = 1 - t;
					const w0 = mt * mt;
					const w1 = 2 * mt * t;
					const w2 = t * t;
					lineTo(w0 * x0 + w1 * x1 + w2 * x2, w0 * y0 + w1 * y1 + w2 * y2);
				}
				lineTo(x2, y2);
			},
			cubic(c1x, c1y, c2x, c2y, x, y) {
				const x0 = lastX;
				const y0 = lastY;
				const x1 = tx(c1x, c1y);
				const y1 = ty(c1x, c1y);
				const x2 = tx(c2x, c2y);
				const y2 = ty(c2x, c2y);
				const x3 = tx(x, y);
				const y3 = ty(x, y);
				if (outside(cull, [x0, x1, x2, x3], [y0, y1, y2, y3])) {
					lineTo(x3, y3);
					return;
				}
				const ax = x0 - 2 * x1 + x2;
				const ay = y0 - 2 * y1 + y2;
				const bx = x1 - 2 * x2 + x3;
				const by = y1 - 2 * y2 + y3;
				const m = Math.max(Math.sqrt(ax * ax + ay * ay), Math.sqrt(bx * bx + by * by));
				const n = chords(m, 0.75, tolerance);
				for (let i = 1; i < n; i += 1) {
					const t = i / n;
					const mt = 1 - t;
					const w0 = mt * mt * mt;
					const w1 = 3 * mt * mt * t;
					const w2 = 3 * mt * t * t;
					const w3 = t * t * t;
					lineTo(w0 * x0 + w1 * x1 + w2 * x2 + w3 * x3, w0 * y0 + w1 * y1 + w2 * y2 + w3 * y3);
				}
				lineTo(x3, y3);
			},
			close() {
				closeSubpath();
			},
		},
		'flattenPath',
	);
	closeSubpath();
}
