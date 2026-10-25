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
 * Everything is float64 from here to the output row. Rounding to bytes
 * happens once, in `raster.ts`.
 */

import type { NormalPaint, NormalStop } from './scene.js';

/** Stops as parallel arrays of offsets and straight colour from 0 to 1. */
interface Ramp {
	readonly offsets: Float64Array;
	readonly r: Float64Array;
	readonly g: Float64Array;
	readonly b: Float64Array;
	readonly a: Float64Array;
}

function ramp(stops: readonly NormalStop[]): Ramp {
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

/** The premultiplied colour at `t` along a ramp, written to `out`. */
function rampAt(ramp: Ramp, t: number, out: Float64Array): void {
	const { offsets } = ramp;
	const last = offsets.length - 1;
	let r: number;
	let g: number;
	let b: number;
	let a: number;
	// Not-greater rather than less-or-equal, so a NaN from a degenerate
	// gradient takes the first stop instead of spreading through the row.
	if (!(t > (offsets[0] as number))) {
		r = ramp.r[0] as number;
		g = ramp.g[0] as number;
		b = ramp.b[0] as number;
		a = ramp.a[0] as number;
	} else if (t >= (offsets[last] as number)) {
		r = ramp.r[last] as number;
		g = ramp.g[last] as number;
		b = ramp.b[last] as number;
		a = ramp.a[last] as number;
	} else {
		// The last stop at or before t. Its successor is past t, so the
		// interval has width and the division below is safe, even where two
		// stops share an offset to make a hard edge.
		let i = 0;
		while (i < last - 1 && (offsets[i + 1] as number) <= t) i += 1;
		const from = offsets[i] as number;
		const f = (t - from) / ((offsets[i + 1] as number) - from);
		r = (ramp.r[i] as number) + ((ramp.r[i + 1] as number) - (ramp.r[i] as number)) * f;
		g = (ramp.g[i] as number) + ((ramp.g[i + 1] as number) - (ramp.g[i] as number)) * f;
		b = (ramp.b[i] as number) + ((ramp.b[i + 1] as number) - (ramp.b[i] as number)) * f;
		a = (ramp.a[i] as number) + ((ramp.a[i + 1] as number) - (ramp.a[i] as number)) * f;
	}
	out[0] = r * a;
	out[1] = g * a;
	out[2] = b * a;
	out[3] = a;
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

	constructor(private readonly paint: NormalPaint) {
		if (paint.kind === 'solid') {
			const { r, g, b, a } = paint.colour;
			this.colour[0] = (r / 255) * a;
			this.colour[1] = (g / 255) * a;
			this.colour[2] = (b / 255) * a;
			this.colour[3] = a;
		}
		if (paint.kind === 'conic') {
			throw new Error('rasterise: conic paints are drawn once the deterministic maths has landed.');
		}
		this.ramp = paint.kind === 'linear' || paint.kind === 'radial' ? ramp(paint.stops) : null;
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
		const paint = this.paint;
		if (paint.kind === 'solid') {
			const [r, g, b, a] = this.colour as unknown as [number, number, number, number];
			for (let x = start; x < end; x += 1) {
				const c = cover[x] as number;
				if (c === 0) continue;
				over(row, x * 4, r * c, g * c, b * c, a * c);
			}
			return;
		}
		const sample = this.colour;
		const ramp = this.ramp as Ramp;
		if (paint.kind === 'linear') {
			const dx = paint.x2 - paint.x1;
			const dy = paint.y2 - paint.y1;
			const length2 = dx * dx + dy * dy;
			const along = (uy - paint.y1) * dy;
			for (let x = start; x < end; x += 1) {
				const c = cover[x] as number;
				if (c === 0) continue;
				const ux = (x + 0.5) * unitsPerPixel;
				rampAt(ramp, ((ux - paint.x1) * dx + along) / length2, sample);
				over(
					row,
					x * 4,
					(sample[0] as number) * c,
					(sample[1] as number) * c,
					(sample[2] as number) * c,
					(sample[3] as number) * c,
				);
			}
			return;
		}
		{
			const radial = paint as Extract<NormalPaint, { kind: 'radial' }>;
			const ddy = uy - radial.cy;
			for (let x = start; x < end; x += 1) {
				const c = cover[x] as number;
				if (c === 0) continue;
				const ddx = (x + 0.5) * unitsPerPixel - radial.cx;
				rampAt(ramp, Math.sqrt(ddx * ddx + ddy * ddy) / radial.r, sample);
				over(
					row,
					x * 4,
					(sample[0] as number) * c,
					(sample[1] as number) * c,
					(sample[2] as number) * c,
					(sample[3] as number) * c,
				);
			}
		}
	}
}
