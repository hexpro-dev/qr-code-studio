/**
 * TrueType contours to paths.
 *
 * A TrueType contour is a ring of points, each on the curve or a quadratic
 * control point, and two control points in a row imply an on-curve point
 * halfway between them. This walks the ring the way FreeType does: start at
 * an on-curve point (or, when there is none, at the implied point between the
 * last and the first), then emit a line for each on-curve point and a
 * quadratic for each control point, closing back to the start.
 *
 * The result is quadratic throughout, through `PathBuilder`, so every writer
 * sees the same commands. Halving is exact in binary, so an implied point is
 * the same in every engine.
 */

import { PathBuilder } from '../geometry/path.js';
import type { Path } from '../geometry/path.js';
import type { GlyphOutline } from './types.js';

/** Draw one outline into `out`, through whatever transform `out` has. */
export function drawOutline(outline: GlyphOutline, out: PathBuilder): void {
	const { points, onCurve, ends } = outline;
	let first = 0;
	for (const end of ends) {
		drawContour(points, onCurve, first, end, out);
		first = end;
	}
}

function drawContour(
	points: Float64Array,
	onCurve: Uint8Array,
	first: number,
	end: number,
	out: PathBuilder,
): void {
	if (end - first < 2) return;
	const x = (i: number): number => points[i * 2] as number;
	const y = (i: number): number => points[i * 2 + 1] as number;
	let last = end - 1;
	let startX: number;
	let startY: number;
	let next = first;
	if (onCurve[first] === 1) {
		startX = x(first);
		startY = y(first);
		next = first + 1;
	} else if (onCurve[last] === 1) {
		startX = x(last);
		startY = y(last);
		last -= 1;
	} else {
		startX = (x(first) + x(last)) / 2;
		startY = (y(first) + y(last)) / 2;
	}
	out.moveTo(startX, startY);
	let control = false;
	let cx = 0;
	let cy = 0;
	for (let i = next; i <= last; i += 1) {
		const px = x(i);
		const py = y(i);
		if (onCurve[i] === 1) {
			if (control) out.quadTo(cx, cy, px, py);
			else out.lineTo(px, py);
			control = false;
			continue;
		}
		if (control) out.quadTo(cx, cy, (cx + px) / 2, (cy + py) / 2);
		cx = px;
		cy = py;
		control = true;
	}
	if (control) out.quadTo(cx, cy, startX, startY);
	out.close();
}

/** An outline as a path in its own units. */
export function outlinePath(outline: GlyphOutline): Path {
	const builder = new PathBuilder();
	drawOutline(outline, builder);
	return builder.build();
}
