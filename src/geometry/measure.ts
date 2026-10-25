/**
 * Measuring a path: the box it occupies and the area it encloses.
 *
 * Both are worked out from the curves themselves rather than from a
 * flattened copy, so neither depends on a tolerance. The box is tight (the
 * extremes of each curve, not its control points), which is what centring a
 * logo or a caption on a shape needs. The area is the closed form of Green's
 * theorem over each segment, which needs only multiplication and addition.
 */

import { walkPath } from './path.js';
import type { Path } from './path.js';

export interface Box {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
}

/**
 * The parameters in (0, 1) where a quadratic in Bernstein form
 * a (1 - t)^2 + 2 b (1 - t) t + c t^2 has a turning point, for a quad's one
 * coordinate. At most one.
 */
function quadExtremum(p0: number, p1: number, p2: number, out: number[]): void {
	const denominator = p0 - 2 * p1 + p2;
	if (denominator === 0) return;
	const t = (p0 - p1) / denominator;
	if (t > 0 && t < 1) out.push(t);
}

/**
 * The parameters in (0, 1) where one coordinate of a cubic turns.
 *
 * The derivative is a quadratic, a t^2 + b t + c up to a factor of 3, solved
 * in the form that does not lose the small root to cancellation. Only `sqrt`
 * is used, which IEEE 754 fixes exactly, so the box is the same in every
 * engine.
 */
function cubicExtrema(p0: number, p1: number, p2: number, p3: number, out: number[]): void {
	const a = p3 - 3 * p2 + 3 * p1 - p0;
	const b = 2 * (p2 - 2 * p1 + p0);
	const c = p1 - p0;
	if (a === 0) {
		if (b === 0) return;
		const t = -c / b;
		if (t > 0 && t < 1) out.push(t);
		return;
	}
	const discriminant = b * b - 4 * a * c;
	if (discriminant < 0) return;
	const root = Math.sqrt(discriminant);
	const q = -0.5 * (b + (b < 0 ? -root : root));
	// q is zero only when b and the root both are, which puts the one turning
	// point at t = 0: an end point, already in the box.
	if (q === 0) return;
	const t1 = q / a;
	const t2 = c / q;
	if (t1 > 0 && t1 < 1) out.push(t1);
	if (t2 > 0 && t2 < 1) out.push(t2);
}

function quadAt(p0: number, p1: number, p2: number, t: number): number {
	const mt = 1 - t;
	return mt * mt * p0 + 2 * mt * t * p1 + t * t * p2;
}

function cubicAt(p0: number, p1: number, p2: number, p3: number, t: number): number {
	const mt = 1 - t;
	return mt * mt * mt * p0 + 3 * mt * mt * t * p1 + 3 * mt * t * t * p2 + t * t * t * p3;
}

/** The tight box around everything the path draws, or null when it draws nothing. */
export function bounds(path: Path): Box | null {
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	let lastX = 0;
	let lastY = 0;
	let any = false;
	const include = (x: number, y: number): void => {
		if (x < minX) minX = x;
		if (x > maxX) maxX = x;
		if (y < minY) minY = y;
		if (y > maxY) maxY = y;
	};
	const ts: number[] = [];

	walkPath(
		path,
		{
			move(x, y) {
				include(x, y);
				lastX = x;
				lastY = y;
				any = true;
			},
			line(x, y) {
				include(x, y);
				lastX = x;
				lastY = y;
			},
			quad(cx, cy, x, y) {
				ts.length = 0;
				quadExtremum(lastX, cx, x, ts);
				quadExtremum(lastY, cy, y, ts);
				for (const t of ts) include(quadAt(lastX, cx, x, t), quadAt(lastY, cy, y, t));
				include(x, y);
				lastX = x;
				lastY = y;
			},
			cubic(c1x, c1y, c2x, c2y, x, y) {
				ts.length = 0;
				cubicExtrema(lastX, c1x, c2x, x, ts);
				cubicExtrema(lastY, c1y, c2y, y, ts);
				for (const t of ts) {
					include(cubicAt(lastX, c1x, c2x, x, t), cubicAt(lastY, c1y, c2y, y, t));
				}
				include(x, y);
				lastX = x;
				lastY = y;
			},
			close() {},
		},
		'bounds',
	);
	if (!any) return null;
	return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * The signed area the path encloses, with every subpath closed.
 *
 * Positive for a shape wound clockwise as seen with y down, which is how
 * `rect`, `circle` and the outer edges from `traceGrid` are wound, and
 * negative for the holes. The sum is over the nonzero winding of each region,
 * so two overlapping shapes wound the same way count their overlap twice:
 * this measures the path, not the pixels it would fill.
 *
 * Exact for straight segments and the closed form for curves (the weights
 * below are the integrals of the Bernstein products in Green's theorem),
 * rather than a flattened approximation. Each subpath is measured from its
 * own first point, which keeps the products small when a shape sits far from
 * the origin.
 */
export function area(path: Path): number {
	let total = 0;
	let originX = 0;
	let originY = 0;
	let lastX = 0;
	let lastY = 0;
	// Twice the area, summed as cross products relative to the subpath start.
	let twice = 0;

	const finish = (): void => {
		// The closing edge back to the start contributes nothing: its end is
		// the origin, and a cross product with the zero vector is zero.
		total += twice / 2;
		twice = 0;
	};
	const cross = (ax: number, ay: number, bx: number, by: number): number => ax * by - ay * bx;

	walkPath(
		path,
		{
			move(x, y) {
				finish();
				originX = x;
				originY = y;
				lastX = 0;
				lastY = 0;
			},
			line(x, y) {
				const px = x - originX;
				const py = y - originY;
				twice += cross(lastX, lastY, px, py);
				lastX = px;
				lastY = py;
			},
			quad(cx, cy, x, y) {
				const ax = cx - originX;
				const ay = cy - originY;
				const bx = x - originX;
				const by = y - originY;
				twice +=
					(2 / 3) * cross(lastX, lastY, ax, ay) +
					(1 / 3) * cross(lastX, lastY, bx, by) +
					(2 / 3) * cross(ax, ay, bx, by);
				lastX = bx;
				lastY = by;
			},
			cubic(c1x, c1y, c2x, c2y, x, y) {
				const ax = c1x - originX;
				const ay = c1y - originY;
				const bx = c2x - originX;
				const by = c2y - originY;
				const ex = x - originX;
				const ey = y - originY;
				twice +=
					(3 / 5) * cross(lastX, lastY, ax, ay) +
					(3 / 10) * cross(lastX, lastY, bx, by) +
					(1 / 10) * cross(lastX, lastY, ex, ey) +
					(3 / 10) * cross(ax, ay, bx, by) +
					(3 / 10) * cross(ax, ay, ex, ey) +
					(3 / 5) * cross(bx, by, ex, ey);
				lastX = ex;
				lastY = ey;
			},
			close() {},
		},
		'area',
	);
	finish();
	return total;
}
