/**
 * Paints as the rasteriser applies them: a colour for every pixel centre,
 * composited over what is there in proportion to the shape's coverage.
 *
 * Gradients are sampled at the centre of each pixel, in user space, so a
 * scene stretched to a different aspect ratio keeps its gradients the shape
 * they were drawn. Colours between stops are interpolated unpremultiplied and
 * then premultiplied, which is what resvg and the browsers do for SVG
 * gradients, and they pad beyond the ends.
 *
 * A conic gradient's position is the angle round its centre, from core's
 * `atan2`, which gives the same bits in every engine. `Math.atan2` does not,
 * and a conic gradient is exactly where a last-place difference would land a
 * pixel on the other side of a hard stop.
 *
 * Everything is float64 from here to the output row. Rounding to bytes
 * happens once, in `raster.ts`.
 */

import { PI, TAU, atan2 } from '../core/math.js';
import type { NormalPaint, NormalStop } from './scene.js';

/** Stops as parallel arrays of offsets and straight colour from 0 to 1. */
export interface Ramp {
	readonly offsets: Float64Array;
	readonly r: Float64Array;
	readonly g: Float64Array;
	readonly b: Float64Array;
	readonly a: Float64Array;
}

export function ramp(stops: readonly NormalStop[]): Ramp {
	const n = stops.length;
	const out: Ramp = {
		offsets: new Float64Array(n),
		r: new Float64Array(n),
		g: new Float64Array(n),
		b: new Float64Array(n),
		a: new Float64Array(n),
	};
	for (let i = 0; i < n; i += 1) {
		const stop = stops[i] as NormalStop;
		out.offsets[i] = stop.offset;
		out.r[i] = stop.colour.r / 255;
		out.g[i] = stop.colour.g / 255;
		out.b[i] = stop.colour.b / 255;
		out.a[i] = stop.colour.a;
	}
	return out;
}

/**
 * The straight colour at `t` along a ramp, each channel 0 to 1, written to
 * `out`. The SVG writer uses this for the wedges of a conic gradient, so the
 * two writers read a ramp the same way.
 */
export function rampStraight(ramp: Ramp, t: number, out: Float64Array): void {
	const { offsets } = ramp;
	const last = offsets.length - 1;
	// Not-greater rather than less-or-equal, so a NaN from a degenerate
	// gradient takes the first stop instead of spreading through the row.
	if (!(t > (offsets[0] as number))) {
		out[0] = ramp.r[0] as number;
		out[1] = ramp.g[0] as number;
		out[2] = ramp.b[0] as number;
		out[3] = ramp.a[0] as number;
		return;
	}
	if (t >= (offsets[last] as number)) {
		out[0] = ramp.r[last] as number;
		out[1] = ramp.g[last] as number;
		out[2] = ramp.b[last] as number;
		out[3] = ramp.a[last] as number;
		return;
	}
	// The last stop at or before t. Its successor is past t, so the interval
	// has width and the division is safe, even where two stops share an
	// offset to make a hard edge.
	let i = 0;
	while (i < last - 1 && (offsets[i + 1] as number) <= t) i += 1;
	const from = offsets[i] as number;
	const f = (t - from) / ((offsets[i + 1] as number) - from);
	out[0] = (ramp.r[i] as number) + ((ramp.r[i + 1] as number) - (ramp.r[i] as number)) * f;
	out[1] = (ramp.g[i] as number) + ((ramp.g[i + 1] as number) - (ramp.g[i] as number)) * f;
	out[2] = (ramp.b[i] as number) + ((ramp.b[i + 1] as number) - (ramp.b[i] as number)) * f;
	out[3] = (ramp.a[i] as number) + ((ramp.a[i + 1] as number) - (ramp.a[i] as number)) * f;
}

/**
 * Where a point lies round a conic gradient, from 0 to just under 1.
 *
 * `start` is the angle of offset 0 in radians, clockwise from +x with y down,
 * which is the sense `atan2` already has in that space.
 */
export function conicOffset(dx: number, dy: number, start: number): number {
	const t = (atan2(dy, dx) - start) / TAU;
	return t - Math.floor(t);
}

/** A conic gradient's start angle, reduced within a turn first so large angles keep their precision. */
export function conicStart(degrees: number): number {
	return (degrees % 360) * (PI / 180);
}

/** Lay a premultiplied colour over pixel `i` of `row`, source over. */
export function over(
	row: Float64Array,
	i: number,
	r: number,
	g: number,
	b: number,
	a: number,
): void {
	const keep = 1 - a;
	row[i] = r + (row[i] as number) * keep;
	row[i + 1] = g + (row[i + 1] as number) * keep;
	row[i + 2] = b + (row[i + 2] as number) * keep;
	row[i + 3] = a + (row[i + 3] as number) * keep;
}

/** A paint ready to be laid over a row of pixels. */
export class PreparedPaint {
	private readonly colour = new Float64Array(4);
	private readonly ramp: Ramp | null;
	/** The gradient position of a point in user space, or null for a solid. */
	private readonly offsetAt: ((ux: number, uy: number) => number) | null;

	constructor(paint: Exclude<NormalPaint, { kind: 'none' }>) {
		if (paint.kind === 'solid') {
			const { r, g, b, a } = paint.colour;
			this.colour[0] = (r / 255) * a;
			this.colour[1] = (g / 255) * a;
			this.colour[2] = (b / 255) * a;
			this.colour[3] = a;
			this.ramp = null;
			this.offsetAt = null;
			return;
		}
		this.ramp = ramp(paint.stops);
		if (paint.kind === 'linear') {
			const { x1, y1 } = paint;
			const dx = paint.x2 - x1;
			const dy = paint.y2 - y1;
			const length2 = dx * dx + dy * dy;
			this.offsetAt = (ux, uy) => ((ux - x1) * dx + (uy - y1) * dy) / length2;
		} else if (paint.kind === 'radial') {
			const { cx, cy, r } = paint;
			this.offsetAt = (ux, uy) => {
				const ddx = ux - cx;
				const ddy = uy - cy;
				return Math.sqrt(ddx * ddx + ddy * ddy) / r;
			};
		} else {
			const { cx, cy } = paint;
			const start = conicStart(paint.angle);
			this.offsetAt = (ux, uy) => conicOffset(ux - cx, uy - cy, start);
		}
	}

	/**
	 * Lay the paint over pixels `start` to `end` of `row`, each weighted by its
	 * coverage in `cover`. `uy` is the row's pixel centre in user space and
	 * `unitsPerPixel` the width of a pixel in user units.
	 */
	composite(
		row: Float64Array,
		cover: Float64Array,
		start: number,
		end: number,
		uy: number,
		unitsPerPixel: number,
	): void {
		const colour = this.colour;
		const offsetAt = this.offsetAt;
		if (offsetAt === null) {
			const r = colour[0] as number;
			const g = colour[1] as number;
			const b = colour[2] as number;
			const a = colour[3] as number;
			for (let x = start; x < end; x += 1) {
				const c = cover[x] as number;
				if (c === 0) continue;
				over(row, x * 4, r * c, g * c, b * c, a * c);
			}
			return;
		}
		const ramp = this.ramp as Ramp;
		for (let x = start; x < end; x += 1) {
			const c = cover[x] as number;
			if (c === 0) continue;
			rampStraight(ramp, offsetAt((x + 0.5) * unitsPerPixel, uy), colour);
			const a = colour[3] as number;
			over(
				row,
				x * 4,
				(colour[0] as number) * a * c,
				(colour[1] as number) * a * c,
				(colour[2] as number) * a * c,
				a * c,
			);
		}
	}
}
