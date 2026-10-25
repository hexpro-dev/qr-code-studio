/**
 * Drawing helpers shared by the built-in entries.
 *
 * Every built-in is a filled outline under the nonzero rule, so a hole is a
 * contour wound the other way and a union is two contours wound the same
 * way. `Contour` records an outline once and can write it either way round,
 * which is all a ring needs: the outer edge clockwise, the same kind of edge
 * a module in, anticlockwise.
 *
 * Clockwise means as seen with y down, the way `PathBuilder.rect` and
 * `circle` wind. Arcs are cubic Beziers of at most a quarter turn each, with
 * the control distance 4/3 tan(t / 4) that puts each piece's midpoint on the
 * circle; quarter-turn end points are exact, so a ring drawn this way meets
 * the module grid where the grid is.
 */

import { PI, atan2, cos, sin } from '../../core/math.js';
import type { PathBuilder } from '../../geometry/path.js';
import { direction } from '../paint.js';

type Segment =
	| { readonly kind: 'line'; readonly x: number; readonly y: number }
	| {
			readonly kind: 'cubic';
			readonly c1x: number;
			readonly c1y: number;
			readonly c2x: number;
			readonly c2y: number;
			readonly x: number;
			readonly y: number;
	  };

/** The control distance factor for an arc of `degrees`, signed with it. */
function arcFactor(degrees: number): number {
	const quarter = (degrees / 4) * (PI / 180);
	return (4 / 3) * (sin(quarter) / cos(quarter));
}

/** One closed outline, kept as segments so it can be written in either direction. */
export class Contour {
	private readonly startX: number;
	private readonly startY: number;
	private atX: number;
	private atY: number;
	private readonly segments: Segment[] = [];

	constructor(x: number, y: number) {
		this.startX = x;
		this.startY = y;
		this.atX = x;
		this.atY = y;
	}

	lineTo(x: number, y: number): this {
		if (x === this.atX && y === this.atY) return this;
		this.segments.push({ kind: 'line', x, y });
		this.atX = x;
		this.atY = y;
		return this;
	}

	cubicTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number): this {
		this.segments.push({ kind: 'cubic', c1x, c1y, c2x, c2y, x, y });
		this.atX = x;
		this.atY = y;
		return this;
	}

	/**
	 * An arc of the circle about (cx, cy) from `from` to `to` degrees, growing
	 * clockwise when `to` is larger. Joins from the current point with a line
	 * if the arc does not start there.
	 */
	arc(cx: number, cy: number, r: number, from: number, to: number): this {
		const [sx, sy] = direction(from);
		this.lineTo(cx + r * sx, cy + r * sy);
		const sweep = to - from;
		const pieces = Math.max(1, Math.ceil(Math.abs(sweep) / 90 - 1e-9));
		const step = sweep / pieces;
		const k = arcFactor(step) * r;
		for (let i = 0; i < pieces; i += 1) {
			const a = from + step * i;
			const b = from + step * (i + 1);
			const [ax, ay] = direction(a);
			const [bx, by] = direction(b);
			this.cubicTo(
				cx + r * ax - k * ay,
				cy + r * ay + k * ax,
				cx + r * bx + k * by,
				cy + r * by - k * bx,
				cx + r * bx,
				cy + r * by,
			);
		}
		return this;
	}

	/** Write the outline into `out`, closed, in the order it was drawn or reversed. */
	emit(out: PathBuilder, reverse = false): void {
		if (!reverse) {
			out.moveTo(this.startX, this.startY);
			for (const segment of this.segments) {
				if (segment.kind === 'line') out.lineTo(segment.x, segment.y);
				else {
					out.cubicTo(segment.c1x, segment.c1y, segment.c2x, segment.c2y, segment.x, segment.y);
				}
			}
			out.close();
			return;
		}
		// Walking backwards, each segment runs from its own end to the point
		// before it, with a cubic's control points swapped.
		const points: [number, number][] = [[this.startX, this.startY]];
		for (const segment of this.segments) points.push([segment.x, segment.y]);
		out.moveTo(this.atX, this.atY);
		for (let i = this.segments.length - 1; i >= 0; i -= 1) {
			const segment = this.segments[i] as Segment;
			const [px, py] = points[i] as [number, number];
			if (segment.kind === 'line') out.lineTo(px, py);
			else out.cubicTo(segment.c2x, segment.c2y, segment.c1x, segment.c1y, px, py);
		}
		out.close();
	}
}

/** A rectangle with four corner radii, top left first, clockwise. */
export function roundedBox(
	x: number,
	y: number,
	w: number,
	h: number,
	radii: readonly [number, number, number, number],
): Contour {
	const limit = Math.min(w, h) / 2;
	const [tl, tr, br, bl] = radii.map((r) => Math.min(Math.max(r, 0), limit)) as [
		number,
		number,
		number,
		number,
	];
	const contour = new Contour(x + tl, y);
	if (tr > 0) contour.arc(x + w - tr, y + tr, tr, -90, 0);
	else contour.lineTo(x + w, y);
	if (br > 0) contour.arc(x + w - br, y + h - br, br, 0, 90);
	else contour.lineTo(x + w, y + h);
	if (bl > 0) contour.arc(x + bl, y + h - bl, bl, 90, 180);
	else contour.lineTo(x, y + h);
	if (tl > 0) contour.arc(x + tl, y + tl, tl, 180, 270);
	else contour.lineTo(x, y);
	return contour;
}

/** A circle as four quarter arcs, starting at the top. */
export function circleContour(cx: number, cy: number, r: number): Contour {
	return new Contour(cx, cy - r).arc(cx, cy, r, -90, 270);
}

/**
 * A superellipse of exponent about four, as four cubics.
 *
 * The control factor 0.909 puts each quarter's midpoint where |x|^4 + |y|^4
 * = 1 has it (at 2^-1/4 of the half size on both axes), which is the
 * squircle's defining point; the rest stays within half a percent of the true
 * curve.
 */
export function squircleContour(cx: number, cy: number, rx: number, ry: number): Contour {
	const k = 0.909;
	return new Contour(cx + rx, cy)
		.cubicTo(cx + rx, cy + k * ry, cx + k * rx, cy + ry, cx, cy + ry)
		.cubicTo(cx - k * rx, cy + ry, cx - rx, cy + k * ry, cx - rx, cy)
		.cubicTo(cx - rx, cy - k * ry, cx - k * rx, cy - ry, cx, cy - ry)
		.cubicTo(cx + k * rx, cy - ry, cx + rx, cy - k * ry, cx + rx, cy);
}

/** A closed polygon through x, y pairs, in the order given. */
export function polygonContour(points: readonly number[]): Contour {
	const contour = new Contour(points[0] as number, points[1] as number);
	for (let i = 2; i < points.length; i += 2) {
		contour.lineTo(points[i] as number, points[i + 1] as number);
	}
	return contour;
}

/** A rectangle with each corner cut at 45 degrees by `cut` along both edges. */
export function octagonContour(x: number, y: number, w: number, h: number, cut: number): Contour {
	const c = Math.min(Math.max(cut, 0), Math.min(w, h) / 2);
	return polygonContour([
		x + c,
		y,
		x + w - c,
		y,
		x + w,
		y + c,
		x + w,
		y + h - c,
		x + w - c,
		y + h,
		x + c,
		y + h,
		x,
		y + h - c,
		x,
		y + c,
	]);
}

/**
 * A rectangle with a concave quarter circle of radius `bite` taken out of
 * each corner, centred on the corner. A bite reaching past the box's edges is
 * clamped to half the shorter side.
 */
export function scoopedContour(x: number, y: number, w: number, h: number, bite: number): Contour {
	const r = Math.min(Math.max(bite, 0), Math.min(w, h) / 2);
	const right = x + w;
	const bottom = y + h;
	return new Contour(x + r, y)
		.lineTo(right - r, y)
		.arc(right, y, r, 180, 90)
		.lineTo(right, bottom - r)
		.arc(right, bottom, r, 270, 180)
		.lineTo(x + r, bottom)
		.arc(x, bottom, r, 360, 270)
		.lineTo(x, y + r)
		.arc(x, y, r, 90, 0);
}

/**
 * The hole of a ring whose outer edge is `scoopedContour(x, y, w, h, bite)`,
 * one module in, keeping the ring one module thick round the bites too: the
 * box inset by one with each corner cut by an arc of radius bite + 1 about the
 * outer corner. Wound clockwise; emit it reversed.
 */
export function scoopedHole(x: number, y: number, w: number, h: number, bite: number): Contour {
	const r = bite + 1;
	const reach = Math.sqrt(r * r - 1);
	const left = x + 1;
	const top = y + 1;
	const right = x + w - 1;
	const bottom = y + h - 1;
	if (reach <= 1) {
		return polygonContour([left, top, right, top, right, bottom, left, bottom]);
	}
	// The angle at which the arc about a corner meets the inset edge.
	const near = (atan2(1, reach) * 180) / PI;
	return new Contour(x + reach, top)
		.lineTo(x + w - reach, top)
		.arc(x + w, y, r, 180 - near, 90 + near)
		.lineTo(right, y + h - reach)
		.arc(x + w, y + h, r, 270 - near, 180 + near)
		.lineTo(x + reach, bottom)
		.arc(x, y + h, r, 360 - near, 270 + near)
		.lineTo(left, y + reach)
		.arc(x, y, r, 90 - near, near);
}

/** A regular star polygon: `points` tips at radius `outer`, notches at `inner`, the first tip at `start` degrees. */
export function starContour(
	cx: number,
	cy: number,
	points: number,
	outer: number,
	inner: number,
	start: number,
): Contour {
	const list: number[] = [];
	for (let i = 0; i < points * 2; i += 1) {
		const [dx, dy] = direction(start + (i * 180) / points);
		const r = i % 2 === 0 ? outer : inner;
		list.push(cx + r * dx, cy + r * dy);
	}
	return polygonContour(list);
}

/** A regular polygon with `sides` corners at radius `r`, the first at `start` degrees. */
export function regularContour(
	cx: number,
	cy: number,
	sides: number,
	r: number,
	start: number,
): Contour {
	const list: number[] = [];
	for (let i = 0; i < sides; i += 1) {
		const [dx, dy] = direction(start + (i * 360) / sides);
		list.push(cx + r * dx, cy + r * dy);
	}
	return polygonContour(list);
}

/**
 * A line from (x1, y1) to (x2, y2) drawn as a filled stadium `width` wide
 * with round ends, which is how an icon's strokes are made without strokes.
 */
export function capsule(x1: number, y1: number, x2: number, y2: number, width: number): Contour {
	const r = width / 2;
	const angle = (atan2(y2 - y1, x2 - x1) * 180) / PI;
	const [nx, ny] = direction(angle + 90);
	return new Contour(x1 - nx * r, y1 - ny * r)
		.lineTo(x2 - nx * r, y2 - ny * r)
		.arc(x2, y2, r, angle - 90, angle + 90)
		.lineTo(x1 + nx * r, y1 + ny * r)
		.arc(x1, y1, r, angle + 90, angle + 270);
}

/** A ring: `outer` clockwise and `hole` written reversed. */
export function ring(out: PathBuilder, outer: Contour, hole: Contour): void {
	outer.emit(out);
	hole.emit(out, true);
}
