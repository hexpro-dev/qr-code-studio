/**
 * Exact pixel coverage of a filled outline, one row at a time.
 *
 * The scan check rasterises a design and then decodes it, and its verdict has
 * to be the same in Node, Chromium, WebKit and Firefox. A canvas cannot
 * promise that: each engine anti-aliases its own way. So coverage is computed
 * here, analytically, in float64 arithmetic that IEEE 754 fixes bit for bit.
 *
 * What is computed is the area of each pixel where the winding number is not
 * zero, which is what the nonzero fill rule means, to within rounding. The
 * usual signed-area accumulator (sum each edge's trapezoid, take the absolute
 * value, clamp to one) is exact only while the winding inside a pixel stays at
 * 0 or 1. It over-inks a pixel where two shapes overlap at their edges and
 * under-inks one where opposite windings meet, which is exactly where a module
 * shape that reaches into its neighbour's cell sits. So instead, within each
 * pixel row:
 *
 * 1. The edges crossing the row are grouped into clusters whose horizontal
 *    extents overlap. Between clusters no edge passes, so the winding there is
 *    the same from the top of the row to the bottom.
 * 2. Each cluster is cut into horizontal sub-bands at every edge end point
 *    and every crossing of two edges. Within a sub-band no two edges cross, so
 *    they keep one left to right order.
 * 3. Walking that order from the winding on the cluster's left, the edges
 *    where the winding changes between zero and not zero are the boundary of
 *    the filled region. Only those are accumulated, entering as +1 and leaving
 *    as -1, so the running sum along the row is the filled area of each pixel
 *    directly, between 0 and 1.
 *
 * Horizontal edges take no part in the winding, but they do separate regions,
 * so they count when clusters are formed.
 *
 * Geometry is clipped as it is added: everything outside the rows is dropped,
 * everything right of the image is dropped, and everything left of it is
 * pressed onto x = 0, where it still contributes its winding to every pixel to
 * its right. The winding at a point is decided only by the edges to its left,
 * so neither change moves a pixel.
 */

import { flattenPath } from '../geometry/flatten.js';
import type { Path } from '../geometry/path.js';

/**
 * The furthest a chord may stray from its curve, in device pixels.
 *
 * The sliver a chord cuts off is then under 1/64 of any pixel it crosses:
 * four levels of coverage at the very most, on a long gentle curve, and under
 * one on a curve the size of a module. The four arc circle that the curve
 * itself approximates is further than that from a true circle once its radius
 * passes 60 pixels, so a finer tolerance would buy nothing anyone could see.
 */
export const FLATTEN_TOLERANCE = 1 / 64;

/** A crossing closer than this (in pixels) to a sub-band's top or bottom is treated as on it. */
const CROSSING_MARGIN = 1e-9;

/**
 * How many times one cluster may be split at crossings before the rest of it
 * is sampled instead.
 *
 * Each crossing splits once, so this is only reached by a tangle of more than
 * about ninety edges crossing one another within one pixel row, which no
 * design draws. It is here so that such a tangle costs a bounded amount of
 * time rather than time growing with the cube of its size. Past the budget,
 * what is left of the cluster is cut into `FALLBACK_STRIPS` strips a pixel
 * high and each strip is walked in the order its edges have at its middle,
 * which is out only where edges cross inside a strip.
 */
const MAX_SPLITS = 4096;
const FALLBACK_STRIPS = 64;

/** Coverage within this of 0 or 1 is snapped there, so rounding noise touches no pixel. */
const SNAP = 1e-12;

/**
 * Add one straight boundary piece to an accumulation row.
 *
 * The piece runs from x0 at the top of a strip to x1 at the bottom, `dy` high
 * (at most one pixel), and `sign` says whether the filled region lies to its
 * right (+1) or ends there (-1). After a prefix sum each column holds the area
 * to the right of the pieces within it, which is the pixel's coverage.
 *
 * Exact for a straight line. The line is linear in y, so the share of the
 * strip it leaves to the right within each column is a rectangle (the height
 * where the line is still to the column's left) plus a trapezoid (the height
 * where it crosses the column, at its mean distance from the column's right
 * side). Each column gets the difference from the one before.
 */
export function accumulate(
	acc: Float64Array,
	x0: number,
	x1: number,
	dy: number,
	sign: number,
): void {
	const lo = x0 < x1 ? x0 : x1;
	const hi = x0 < x1 ? x1 : x0;
	const d = sign * dy;
	const first = Math.floor(lo);
	if (hi <= first + 1) {
		const mean = (x0 + x1) * 0.5 - first;
		acc[first] = (acc[first] as number) + d * (1 - mean);
		acc[first + 1] = (acc[first + 1] as number) + d * mean;
		return;
	}
	const span = hi - lo;
	const last = Math.ceil(hi) - 1;
	let previous = 0;
	for (let column = first; column <= last; column += 1) {
		const u0 = column > lo ? column : lo;
		const u1 = column + 1 < hi ? column + 1 : hi;
		const covered = (u0 - lo) / span + ((u1 - u0) / span) * (column + 1 - (u0 + u1) * 0.5);
		acc[column] = (acc[column] as number) + d * (covered - previous);
		previous = covered;
	}
	acc[last + 1] = (acc[last + 1] as number) + d * (1 - previous);
}

/** A growable list of float64 values. */
class Floats {
	data = new Float64Array(256);
	length = 0;

	push(value: number): void {
		if (this.length === this.data.length) {
			const grown = new Float64Array(this.data.length * 2);
			grown.set(this.data);
			this.data = grown;
		}
		this.data[this.length] = value;
		this.length += 1;
	}
}

/** The x at height y on the line through (x0, y0) and (x1, y1), y0 < y1, exact at both ends. */
function lineX(x0: number, y0: number, x1: number, y1: number, y: number): number {
	if (y === y0) return x0;
	if (y === y1) return x1;
	// Through the fraction rather than a slope: the fraction is between 0 and
	// 1, so this cannot overflow however steep or shallow the edge is.
	return x0 + ((y - y0) / (y1 - y0)) * (x1 - x0);
}

/** Insertion sort of `order` by `key`, stable. The lists are short or nearly sorted. */
function sortBy(order: number[], key: (i: number) => number): void {
	for (let i = 1; i < order.length; i += 1) {
		const item = order[i] as number;
		const value = key(item);
		let j = i - 1;
		while (j >= 0 && key(order[j] as number) > value) {
			order[j + 1] = order[j] as number;
			j -= 1;
		}
		order[j + 1] = item;
	}
}

/**
 * Buffers one row's work needs, shared by every outline in a picture.
 *
 * Outlines are covered one at a time and each leaves the accumulation row
 * zeroed behind it, so one set serves a scene of any number of layers: the
 * memory stays a row, not a row per layer.
 */
export class CoverageScratch {
	readonly acc: Float64Array;
	bandTop = new Float64Array(64);
	bandBottom = new Float64Array(64);
	bandXTop = new Float64Array(64);
	bandXBottom = new Float64Array(64);
	bandMin = new Float64Array(64);
	bandMax = new Float64Array(64);

	constructor(readonly width: number) {
		this.acc = new Float64Array(width + 2);
	}

	/** Room for the band data of `size` edges. */
	grow(size: number): void {
		if (size <= this.bandTop.length) return;
		let capacity = this.bandTop.length;
		while (capacity < size) capacity *= 2;
		const resize = (from: Float64Array): Float64Array<ArrayBuffer> => {
			const to = new Float64Array(capacity);
			to.set(from);
			return to;
		};
		this.bandTop = resize(this.bandTop);
		this.bandBottom = resize(this.bandBottom);
		this.bandXTop = resize(this.bandXTop);
		this.bandXBottom = resize(this.bandXBottom);
		this.bandMin = resize(this.bandMin);
		this.bandMax = resize(this.bandMax);
	}
}

/**
 * The edges of one filled outline, in device pixels, and the coverage of each
 * row of pixels they enclose.
 *
 * Rows must be asked for in increasing order, though any may be skipped. An
 * edge becomes active when its first row arrives and is dropped after its
 * last, so the work for a row is proportional to what crosses it and the
 * memory is the edges plus one row.
 */
export class EdgeSet {
	/** x0, y0, x1, y1 for each sloped edge, with y0 < y1. */
	private readonly lines = new Floats();
	/** +1 for an edge that ran down the page, -1 for one that ran up. */
	private readonly directions: number[] = [];
	/** y, x from, x to, for each horizontal edge strictly inside a row. */
	private readonly flats = new Floats();

	private ready = false;
	/** Sloped edges ordered by first row, and where each row's run starts. */
	private byRow = new Int32Array(0);
	private rowStart = new Int32Array(0);
	private flatByRow = new Int32Array(0);
	private flatRowStart = new Int32Array(0);

	private active: number[] = [];
	private nextRow = 0;
	private touchedLo = 0;
	private touchedHi = 0;
	private splitsLeft = 0;

	/** The last row's coverage is zero outside [start, end). */
	start = 0;
	end = 0;

	readonly width: number;

	constructor(
		private readonly scratch: CoverageScratch,
		readonly height: number,
	) {
		this.width = scratch.width;
	}

	/** Every edge of `path`, scaled by (sx, sy) into device pixels. */
	static fromPath(
		path: Path,
		scratch: CoverageScratch,
		height: number,
		sx: number,
		sy: number,
	): EdgeSet {
		const edges = new EdgeSet(scratch, height);
		const width = scratch.width;
		flattenPath(
			path,
			{
				matrix: [sx, 0, 0, sy, 0, 0],
				tolerance: FLATTEN_TOLERANCE,
				cull: { x: 0, y: 0, width, height },
			},
			(x0, y0, x1, y1) => edges.addLine(x0, y0, x1, y1),
		);
		return edges;
	}

	/** Add an edge in device coordinates, clipped as described at the top of the file. */
	addLine(x0: number, y0: number, x1: number, y1: number): void {
		const { width, height } = this;
		if (y0 === y1) {
			// On a row boundary it separates nothing inside any row.
			if (y0 <= 0 || y0 >= height || Math.floor(y0) === y0) return;
			const from = Math.min(Math.max(Math.min(x0, x1), 0), width);
			const to = Math.min(Math.max(Math.max(x0, x1), 0), width);
			if (from === to) return;
			this.flats.push(y0);
			this.flats.push(from);
			this.flats.push(to);
			return;
		}
		const down = y0 < y1;
		const ax = down ? x0 : x1;
		const ay = down ? y0 : y1;
		const bx = down ? x1 : x0;
		const by = down ? y1 : y0;
		if (by <= 0 || ay >= height) return;
		const topY = ay < 0 ? 0 : ay;
		const bottomY = by > height ? height : by;
		const topX = lineX(ax, ay, bx, by, topY);
		const bottomX = lineX(ax, ay, bx, by, bottomY);
		this.splitAtSides(topX, topY, bottomX, bottomY, down ? 1 : -1);
	}

	/** Cut a sloped edge where it crosses x = 0 and x = width, and keep or press each piece. */
	private splitAtSides(ax: number, ay: number, bx: number, by: number, direction: number): void {
		let px = ax;
		let py = ay;
		const sides = ax <= bx ? [0, this.width] : [this.width, 0];
		for (const side of sides) {
			if ((px < side && bx > side) || (px > side && bx < side)) {
				const y = py + ((side - px) / (bx - px)) * (by - py);
				if (y > py && y < by) {
					this.keepPiece(px, py, side, y, direction);
					px = side;
					py = y;
				}
			}
		}
		this.keepPiece(px, py, bx, by, direction);
	}

	/**
	 * Store one piece. Every piece has height: the edge was clipped to rows it
	 * crosses, and it is only cut strictly between its ends.
	 */
	private keepPiece(ax: number, ay: number, bx: number, by: number, direction: number): void {
		const mid = (ax + bx) * 0.5;
		if (mid > this.width) return;
		const left = mid < 0;
		this.lines.push(left ? 0 : ax);
		this.lines.push(ay);
		this.lines.push(left ? 0 : bx);
		this.lines.push(by);
		this.directions.push(direction);
	}

	/** Order the edges by their first row, once, with a counting sort. */
	private prepare(): void {
		this.ready = true;
		const { height } = this;
		const count = this.directions.length;
		const lines = this.lines.data;
		this.rowStart = new Int32Array(height + 1);
		for (let e = 0; e < count; e += 1) {
			const row = Math.floor(lines[e * 4 + 1] as number);
			this.rowStart[row + 1] = (this.rowStart[row + 1] as number) + 1;
		}
		for (let r = 0; r < height; r += 1) {
			this.rowStart[r + 1] = (this.rowStart[r + 1] as number) + (this.rowStart[r] as number);
		}
		this.byRow = new Int32Array(count);
		const fill = this.rowStart.slice(0, height);
		for (let e = 0; e < count; e += 1) {
			const row = Math.floor(lines[e * 4 + 1] as number);
			this.byRow[fill[row] as number] = e;
			fill[row] = (fill[row] as number) + 1;
		}

		const flatCount = this.flats.length / 3;
		const flats = this.flats.data;
		this.flatRowStart = new Int32Array(height + 1);
		for (let f = 0; f < flatCount; f += 1) {
			const row = Math.floor(flats[f * 3] as number);
			this.flatRowStart[row + 1] = (this.flatRowStart[row + 1] as number) + 1;
		}
		for (let r = 0; r < height; r += 1) {
			this.flatRowStart[r + 1] =
				(this.flatRowStart[r + 1] as number) + (this.flatRowStart[r] as number);
		}
		this.flatByRow = new Int32Array(flatCount);
		const flatFill = this.flatRowStart.slice(0, height);
		for (let f = 0; f < flatCount; f += 1) {
			const row = Math.floor(flats[f * 3] as number);
			this.flatByRow[flatFill[row] as number] = f;
			flatFill[row] = (flatFill[row] as number) + 1;
		}
	}

	private emit(x0: number, x1: number, dy: number, sign: number): void {
		accumulate(this.scratch.acc, x0, x1, dy, sign);
		const lo = Math.floor(x0 < x1 ? x0 : x1);
		// One past the last index `accumulate` can have written.
		const hi = Math.ceil(x0 < x1 ? x1 : x0) + 2;
		if (lo < this.touchedLo) this.touchedLo = lo;
		if (hi > this.touchedHi) this.touchedHi = hi;
	}

	/**
	 * Fill `out` with the coverage of row `row`, and say whether any pixel has
	 * any. When it does, `start` and `end` bound the pixels that do.
	 */
	coverage(row: number, out: Float64Array): boolean {
		if (!this.ready) this.prepare();
		const { width } = this;
		const lines = this.lines.data;
		while (this.nextRow <= row && this.nextRow < this.height) {
			const from = this.rowStart[this.nextRow] as number;
			const to = this.rowStart[this.nextRow + 1] as number;
			for (let i = from; i < to; i += 1) this.active.push(this.byRow[i] as number);
			this.nextRow += 1;
		}
		const top = row;
		const bottom = row + 1;
		let n = 0;
		for (let k = 0; k < this.active.length; k += 1) {
			const e = this.active[k] as number;
			if ((lines[e * 4 + 3] as number) > top) {
				this.active[n] = e;
				n += 1;
			}
		}
		this.active.length = n;
		const flatFrom = this.flatRowStart[row] as number;
		const flatTo = this.flatRowStart[row + 1] as number;
		if (n === 0 && flatFrom === flatTo) return false;

		const band = this.scratch;
		band.grow(n);
		for (let k = 0; k < n; k += 1) {
			const e = this.active[k] as number;
			const x0 = lines[e * 4] as number;
			const y0 = lines[e * 4 + 1] as number;
			const x1 = lines[e * 4 + 2] as number;
			const y1 = lines[e * 4 + 3] as number;
			const ta = y0 > top ? y0 : top;
			const tb = y1 < bottom ? y1 : bottom;
			const xa = lineX(x0, y0, x1, y1, ta);
			const xb = lineX(x0, y0, x1, y1, tb);
			band.bandTop[k] = ta;
			band.bandBottom[k] = tb;
			band.bandXTop[k] = xa;
			band.bandXBottom[k] = xb;
			band.bandMin[k] = xa < xb ? xa : xb;
			band.bandMax[k] = xa < xb ? xb : xa;
		}
		this.sortActive(n);

		const flats = this.flats.data;
		const flatOrder: number[] = [];
		for (let i = flatFrom; i < flatTo; i += 1) flatOrder.push(this.flatByRow[i] as number);
		sortBy(flatOrder, (f) => flats[f * 3 + 1] as number);

		this.touchedLo = width + 2;
		this.touchedHi = -1;
		let winding = 0;
		let i = 0;
		let j = 0;
		const members: number[] = [];
		while (i < n || j < flatOrder.length) {
			members.length = 0;
			let reach = -Infinity;
			let taken = false;
			// Take items in order of their left end while they overlap the cluster.
			for (;;) {
				const nextSloped = i < n ? (band.bandMin[i] as number) : Infinity;
				const flat = j < flatOrder.length ? (flatOrder[j] as number) : -1;
				const nextFlat = flat >= 0 ? (flats[flat * 3 + 1] as number) : Infinity;
				const nextLeft = nextSloped <= nextFlat ? nextSloped : nextFlat;
				if (nextLeft === Infinity || (taken && nextLeft > reach)) break;
				taken = true;
				if (nextSloped <= nextFlat) {
					members.push(i);
					const right = band.bandMax[i] as number;
					if (right > reach) reach = right;
					i += 1;
				} else {
					const right = flats[flat * 3 + 2] as number;
					if (right > reach) reach = right;
					j += 1;
				}
			}
			winding = this.cluster(members, winding);
		}

		if (this.touchedHi < 0) return false;
		const lo = this.touchedLo;
		const acc = band.acc;
		this.start = lo < width ? lo : width;
		this.end = this.start;
		let sum = 0;
		for (let x = lo; x < width; x += 1) {
			if (x >= this.touchedHi && sum === 0) {
				this.end = x;
				break;
			}
			sum += acc[x] as number;
			acc[x] = 0;
			// Exact coverage lies in [0, 1], so anything outside it, and anything
			// within rounding of either end, is rounding: snap it there, running
			// total included, so the noise never spreads along the row.
			if (sum < SNAP) sum = 0;
			else if (sum > 1 - SNAP) sum = 1;
			out[x] = sum;
			this.end = x + 1;
		}
		for (let x = width; x < this.touchedHi && x < acc.length; x += 1) acc[x] = 0;
		return this.end > this.start;
	}

	/** Insertion sort of the active edges by their left end in this row, carrying the band data. */
	private sortActive(n: number): void {
		const { active } = this;
		const { bandTop, bandBottom, bandXTop, bandXBottom, bandMin, bandMax } = this.scratch;
		for (let k = 1; k < n; k += 1) {
			const key = bandMin[k] as number;
			if ((bandMin[k - 1] as number) <= key) continue;
			const e = active[k] as number;
			const ta = bandTop[k] as number;
			const tb = bandBottom[k] as number;
			const xa = bandXTop[k] as number;
			const xb = bandXBottom[k] as number;
			const max = bandMax[k] as number;
			let j = k - 1;
			while (j >= 0 && (bandMin[j] as number) > key) {
				active[j + 1] = active[j] as number;
				bandTop[j + 1] = bandTop[j] as number;
				bandBottom[j + 1] = bandBottom[j] as number;
				bandXTop[j + 1] = bandXTop[j] as number;
				bandXBottom[j + 1] = bandXBottom[j] as number;
				bandMin[j + 1] = bandMin[j] as number;
				bandMax[j + 1] = bandMax[j] as number;
				j -= 1;
			}
			active[j + 1] = e;
			bandTop[j + 1] = ta;
			bandBottom[j + 1] = tb;
			bandXTop[j + 1] = xa;
			bandXBottom[j + 1] = xb;
			bandMin[j + 1] = key;
			bandMax[j + 1] = max;
		}
	}

	/**
	 * Accumulate one cluster's boundary, given the winding to its left, and
	 * return the winding to its right.
	 */
	private cluster(members: readonly number[], left: number): number {
		const band = this.scratch;
		if (members.length === 0) return left;
		if (members.length === 1) {
			// The common case by far: one edge on its own, such as the side of a
			// module, with nothing to order.
			const k = members[0] as number;
			const right = left + (this.directions[this.active[k] as number] as number);
			if ((left === 0) !== (right === 0)) {
				this.emit(
					band.bandXTop[k] as number,
					band.bandXBottom[k] as number,
					(band.bandBottom[k] as number) - (band.bandTop[k] as number),
					left === 0 ? 1 : -1,
				);
			}
			return right;
		}

		const events: number[] = [];
		for (const k of members) events.push(band.bandTop[k] as number, band.bandBottom[k] as number);
		sortBy(events, (y) => y);
		let right = left;
		let first = true;
		let previous = events[0] as number;
		this.splitsLeft = MAX_SPLITS;
		for (let i = 1; i < events.length; i += 1) {
			const next = events[i] as number;
			if (next === previous) continue;
			const spanning: number[] = [];
			for (const k of members) {
				if ((band.bandTop[k] as number) <= previous && (band.bandBottom[k] as number) >= next) {
					spanning.push(this.active[k] as number);
				}
			}
			if (spanning.length > 0) {
				const after = this.subBand(spanning, previous, next, left);
				if (first) {
					right = after;
					first = false;
				}
			}
			previous = next;
		}
		return right;
	}

	/**
	 * Accumulate the boundary within one sub-band of a cluster, splitting it
	 * at the first crossing if two edges cross inside it. Returns the winding
	 * to the cluster's right.
	 */
	private subBand(
		edges: readonly number[],
		top: number,
		bottom: number,
		left: number,
		sampled = false,
	): number {
		const lines = this.lines.data;
		const count = edges.length;
		const xTop: number[] = [];
		const xBottom: number[] = [];
		for (const e of edges) {
			const x0 = lines[e * 4] as number;
			const y0 = lines[e * 4 + 1] as number;
			const x1 = lines[e * 4 + 2] as number;
			const y1 = lines[e * 4 + 3] as number;
			xTop.push(lineX(x0, y0, x1, y1, top));
			xBottom.push(lineX(x0, y0, x1, y1, bottom));
		}
		const order: number[] = [];
		for (let i = 0; i < count; i += 1) order.push(i);
		// By the middle of the sub-band: two edges that do not cross inside it
		// are in the same order there as everywhere else in it.
		sortBy(order, (i) => (xTop[i] as number) + (xBottom[i] as number));

		// Two neighbours out of order at the top or the bottom cross inside.
		// If no neighbours are, no pair is: straight edges in order at both
		// ends are in order throughout.
		let cut = Infinity;
		for (let i = 0; i + 1 < count && !sampled; i += 1) {
			const a = order[i] as number;
			const b = order[i + 1] as number;
			const dTop = (xTop[a] as number) - (xTop[b] as number);
			const dBottom = (xBottom[a] as number) - (xBottom[b] as number);
			if (dTop <= 0 && dBottom <= 0) continue;
			const y = top + (bottom - top) * (dTop / (dTop - dBottom));
			if (y > top + CROSSING_MARGIN && y < bottom - CROSSING_MARGIN && y < cut) cut = y;
		}
		if (cut !== Infinity) {
			if (this.splitsLeft === 0) return this.strips(edges, top, bottom, left);
			this.splitsLeft -= 1;
			const right = this.subBand(edges, top, cut, left);
			this.subBand(edges, cut, bottom, left);
			return right;
		}

		let winding = left;
		for (const i of order) {
			const next = winding + (this.directions[edges[i] as number] as number);
			if ((winding === 0) !== (next === 0)) {
				this.emit(xTop[i] as number, xBottom[i] as number, bottom - top, winding === 0 ? 1 : -1);
			}
			winding = next;
		}
		return winding;
	}

	/** The fallback past the split budget: thin strips, each walked as if nothing crossed in it. */
	private strips(edges: readonly number[], top: number, bottom: number, left: number): number {
		const count = Math.max(1, Math.ceil((bottom - top) * FALLBACK_STRIPS));
		let right = left;
		for (let s = 0; s < count; s += 1) {
			const from = s === 0 ? top : top + ((bottom - top) * s) / count;
			const to = s + 1 === count ? bottom : top + ((bottom - top) * (s + 1)) / count;
			const after = this.subBand(edges, from, to, left, true);
			if (s === 0) right = after;
		}
		return right;
	}
}
