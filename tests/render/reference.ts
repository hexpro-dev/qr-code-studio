/**
 * Independent coverage oracles for the rasteriser's tests.
 *
 * Neither shares code with `src/render/coverage.ts`. Both find, along a
 * horizontal line, where the line crosses each edge, sort the crossings, and
 * walk them with a winding count, which is the nonzero rule straight from its
 * definition. They differ in how many lines they take through each pixel and
 * in what they do along each one.
 */

/** A closed polygon as x, y pairs in device pixels. */
export type Polygon = readonly number[];

interface Crossing {
	readonly x: number;
	readonly direction: number;
}

/** Where the horizontal line at `y` crosses the polygons' edges, sorted by x. */
function crossings(polygons: readonly Polygon[], y: number): Crossing[] {
	const out: Crossing[] = [];
	for (const polygon of polygons) {
		const n = polygon.length / 2;
		for (let i = 0; i < n; i += 1) {
			const x0 = polygon[i * 2] as number;
			const y0 = polygon[i * 2 + 1] as number;
			const x1 = polygon[((i + 1) % n) * 2] as number;
			const y1 = polygon[((i + 1) % n) * 2 + 1] as number;
			// Half open, so a vertex exactly on the line is counted once.
			if ((y0 <= y && y < y1) || (y1 <= y && y < y0)) {
				out.push({ x: x0 + ((y - y0) * (x1 - x0)) / (y1 - y0), direction: y1 > y0 ? 1 : -1 });
			}
		}
	}
	return out.sort((a, b) => a.x - b.x);
}

/** The intervals along one line where the winding is not zero. */
function spans(polygons: readonly Polygon[], y: number): [number, number][] {
	const out: [number, number][] = [];
	let winding = 0;
	let start = 0;
	for (const crossing of crossings(polygons, y)) {
		const next = winding + crossing.direction;
		if (winding === 0 && next !== 0) start = crossing.x;
		if (winding !== 0 && next === 0) out.push([start, crossing.x]);
		winding = next;
	}
	return out;
}

/**
 * Coverage from `lines` horizontal lines through each pixel row, each one
 * adding the exact length of its filled intervals in each pixel.
 *
 * Exact along x, sampled along y. A straight edge that crosses a line's whole
 * strip is linear there, so the line through the strip's middle gives the
 * strip's area exactly; only strips holding a vertex, a crossing or a
 * horizontal edge are approximate, each by at most one strip's height in any
 * pixel. With 2048 lines a pixel that is under a tenth of the 1/255 the tests
 * allow.
 */
export function stripReference(
	polygons: readonly Polygon[],
	width: number,
	height: number,
	lines = 2048,
): Float64Array {
	const out = new Float64Array(width * height);
	for (let row = 0; row < height; row += 1) {
		for (let s = 0; s < lines; s += 1) {
			const y = row + (s + 0.5) / lines;
			for (const [from, to] of spans(polygons, y)) {
				const a = Math.max(from, 0);
				const b = Math.min(to, width);
				for (let x = Math.floor(a); x < b && x < width; x += 1) {
					const overlap = Math.min(b, x + 1) - Math.max(a, x);
					if (overlap > 0)
						out[row * width + x] = (out[row * width + x] as number) + overlap / lines;
				}
			}
		}
	}
	return out;
}

/**
 * Coverage as the share of a grid of `n` by `n` points per pixel that are
 * inside, the textbook supersampled reference.
 *
 * Each sample is in or out, so this is off by up to about 1/(2n) of a pixel
 * per edge crossing it (an edge parallel to the grid moves the count a whole
 * row of samples at a time). At 16 by 16 that is 1/32, eight levels.
 */
export function pointReference(
	polygons: readonly Polygon[],
	width: number,
	height: number,
	n = 16,
): Float64Array {
	const out = new Float64Array(width * height);
	for (let row = 0; row < height; row += 1) {
		for (let s = 0; s < n; s += 1) {
			const y = row + (s + 0.5) / n;
			for (const [from, to] of spans(polygons, y)) {
				for (let x = 0; x < width; x += 1) {
					for (let t = 0; t < n; t += 1) {
						const px = x + (t + 0.5) / n;
						if (px >= from && px < to) {
							out[row * width + x] = (out[row * width + x] as number) + 1 / (n * n);
						}
					}
				}
			}
		}
	}
	return out;
}
