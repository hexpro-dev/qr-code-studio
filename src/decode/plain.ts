/**
 * A second opinion for the strict profile: the grid a plain reader would
 * sample.
 *
 * The scan check promises that a design it passes scans on the phones people
 * use, and the readers in use are not all careful ones. The plainest is the
 * classic ZXing pipeline, which jsQR ports and older Android readers still
 * run: it scans rows for the finder ratio with a whole module of slack, keeps
 * any shape that holds it for two rows, scores each by how well its runs fit
 * in four directions, and commits to the best group of three; it computes the
 * size from those centres, takes the alignment pattern candidate that best
 * combines shape and nearness to an affine guess, lays one projective grid
 * through the four points, and reads one pixel a module. It tries that grid
 * and one through re-centred finders, and no other.
 *
 * Every step can go wrong where this package's reader does not: a crisp patch
 * of data or of thresholded noise outscores a finder worn by blur or glare, a
 * data module nearer the guess wins over the real alignment pattern under
 * perspective, a centre taken from two rows of a shape is a pixel out at two
 * pixels a module. Measured over the seeded corpus, those were nearly all of
 * the captures this package's strict reading passed and jsQR failed. So the
 * strict profile builds the plain reader's grids here, from the same
 * thresholded picture, and passes a symbol only when one of them reads to the
 * same text.
 *
 * Written from the algorithm's description, after jsQR's locator and
 * extractor (Apache 2.0), including the details that look like slips and are
 * the point: run errors in pixels rather than modules, which favours small
 * crisp shapes over large worn ones, and "diagonals" that are not at 45
 * degrees.
 */

import { BitMatrix } from '../core/bit-matrix.js';
import type { RgbaImage } from '../core/image.js';
import { hypot } from '../core/math.js';
import type { Binarised } from './binarise.js';
import type { GreyImage } from './grey.js';
import { apply, quadToQuad } from './transform.js';
import type { Point } from './types.js';

const BLOCK = 8;
const MIN_DYNAMIC_RANGE = 24;

/**
 * The picture's luminance as jsQR takes it: BT.709 weights on red, green and
 * blue, rounded into a byte, and the alpha ignored. This package's scanner
 * uses BT.601 and reads alpha as paper, and on a coloured design the two
 * disagree by enough to move a threshold: a plain reader picking finders from
 * its own luminance picked a printed ornament on one ticket design that the
 * scanner's luminance never showed it.
 */
export function plainLuminance(image: RgbaImage): GreyImage {
	const { width, height, data } = image;
	// Bytes, so each level rounds as jsQR's does when it stores it.
	const out = new Uint8ClampedArray(width * height);
	for (let i = 0, p = 0; i < out.length; i += 1, p += 4) {
		out[i] =
			0.2126 * (data[p] as number) +
			0.7152 * (data[p + 1] as number) +
			0.0722 * (data[p + 2] as number);
	}
	return { width, height, data: new Uint8Array(out.buffer) };
}

/**
 * The picture thresholded as the plain reader thresholds it: the block-mean
 * hybrid (`binariseHybridMean`), with jsQR's handling of the edges. Its 8 by
 * 8 blocks read past the right edge into the start of the next row, and past
 * the bottom edge into nothing, so a bottom row of blocks cut short by a
 * height that is not a multiple of 8 gets a level of 0, and every block whose
 * 5 by 5 neighbourhood reaches it a threshold dragged down towards dark: on a
 * picture with a narrow quiet zone, that can be the bottom left finder lost.
 * `image` is the picture's grey as it is, and `inverted` reads it
 * light-on-dark: thresholded as it is and the decisions flipped, as jsQR's
 * inverted attempt does.
 */
export function plainThreshold(image: GreyImage, inverted: boolean): Binarised {
	const { width, height, data } = image;
	const size = width * height;
	// Luminance as jsQR sees it at a flat index, past the end being nothing.
	const lum = (index: number): number => (index < size ? (data[index] as number) : Number.NaN);
	const blocksX = Math.ceil(width / BLOCK);
	const blocksY = Math.ceil(height / BLOCK);
	// Bytes, as jsQR keeps them: each block's level is rounded and clamped on
	// the way in, and a missing one is stored as 0, dark, rather than as
	// missing.
	const blackPoints = new Uint8ClampedArray(blocksX * blocksY);
	for (let by = 0; by < blocksY; by += 1) {
		for (let bx = 0; bx < blocksX; bx += 1) {
			let sum = 0;
			let min = Number.POSITIVE_INFINITY;
			let max = 0;
			for (let y = 0; y < BLOCK; y += 1) {
				for (let x = 0; x < BLOCK; x += 1) {
					const value = lum((by * BLOCK + y) * width + bx * BLOCK + x);
					sum += value;
					// Math.min and max, as jsQR has them, so one missing pixel makes the
					// whole block's statistics missing.
					min = Math.min(min, value);
					max = Math.max(max, value);
				}
			}
			let average = sum / (BLOCK * BLOCK);
			if (max - min <= MIN_DYNAMIC_RANGE) {
				average = min / 2;
				if (by > 0 && bx > 0) {
					const neighbours =
						((blackPoints[(by - 1) * blocksX + bx] as number) +
							2 * (blackPoints[by * blocksX + bx - 1] as number) +
							(blackPoints[(by - 1) * blocksX + bx - 1] as number)) /
						4;
					if (min < neighbours) average = neighbours;
				}
			}
			blackPoints[by * blocksX + bx] = average;
		}
	}
	const bits = new Uint8Array(size);
	const thresholds = new Float64Array(blocksX * blocksY);
	for (let by = 0; by < blocksY; by += 1) {
		const top = Math.min(Math.max(by, 2), blocksY - 3);
		for (let bx = 0; bx < blocksX; bx += 1) {
			const left = Math.min(Math.max(bx, 2), blocksX - 3);
			let sum = 0;
			for (let dx = -2; dx <= 2; dx += 1) {
				for (let dy = -2; dy <= 2; dy += 1) {
					sum += blackPoints[(top + dy) * blocksX + left + dx] as number;
				}
			}
			const threshold = sum / 25;
			thresholds[by * blocksX + bx] = threshold;
			for (let x = 0; x < BLOCK; x += 1) {
				for (let y = 0; y < BLOCK; y += 1) {
					// Written at the flat index too, so a block past the right edge
					// overwrites the start of the next row, as jsQR's does.
					const index = (by * BLOCK + y) * width + bx * BLOCK + x;
					if (index >= size) continue;
					const dark = lum(index) <= threshold;
					bits[index] = (inverted ? !dark : dark) ? 1 : 0;
				}
			}
		}
	}
	return {
		width,
		height,
		bits,
		threshold: (x, y) => thresholds[(y >> 3) * blocksX + (x >> 3)] as number,
	};
}

/** How many of the best-scoring shapes each start a group. */
const GROUP_STARTS = 5;
const FINDER_RATIOS = [1, 1, 3, 1, 1] as const;
const ALIGNMENT_RATIOS = [1, 1, 1] as const;

interface Line {
	readonly startX: number;
	readonly endX: number;
	readonly y: number;
}

interface Shape {
	top: Line;
	bottom: Line;
}

interface Scored extends Point {
	readonly size: number;
	readonly score: number;
}

export interface PlainLocation {
	readonly topLeft: Point;
	readonly topRight: Point;
	readonly bottomLeft: Point;
	readonly alignment: Point;
	readonly size: number;
}

function dark(image: Binarised, x: number, y: number): boolean {
	return (
		x >= 0 && y >= 0 && x < image.width && y < image.height && image.bits[y * image.width + x] === 1
	);
}

function distance(a: Point, b: Point): number {
	return hypot(a.x - b.x, a.y - b.y);
}

/**
 * Extend the shape whose last row overlaps this line, or start one. jsQR
 * also lists a line inside the last row, and a line containing it whose
 * width is within half of it either way; both overlap it, so the overlap
 * test alone decides the same.
 */
function extend(active: Shape[], line: Line): void {
	const match = active.find(
		({ bottom }) => line.endX >= bottom.startX && line.startX <= bottom.endX,
	);
	if (match !== undefined) match.bottom = line;
	else active.push({ top: line, bottom: line });
}

/**
 * One pass over the rows: shapes holding the finder ratio for two rows or
 * more, and shapes holding the light, dark, light ratio of an alignment
 * pattern's middle.
 */
function shapes(image: Binarised): { finders: Shape[]; alignments: Shape[] } {
	const finders: Shape[] = [];
	const alignments: Shape[] = [];
	let activeFinders: Shape[] = [];
	let activeAlignments: Shape[] = [];
	for (let y = 0; y <= image.height; y += 1) {
		let length = 0;
		let last = false;
		const scans = [0, 0, 0, 0, 0];
		for (let x = -1; x <= image.width; x += 1) {
			const value = dark(image, x, y);
			if (value === last) {
				length += 1;
				continue;
			}
			scans.shift();
			scans.push(length);
			length = 1;
			last = value;
			const [s0, s1, s2, s3, s4] = scans as [number, number, number, number, number];
			const unit = (s0 + s1 + s2 + s3 + s4) / 7;
			if (
				!value &&
				Math.abs(s0 - unit) < unit &&
				Math.abs(s1 - unit) < unit &&
				Math.abs(s2 - 3 * unit) < 3 * unit &&
				Math.abs(s3 - unit) < unit &&
				Math.abs(s4 - unit) < unit
			) {
				const endX = x - s3 - s4;
				extend(activeFinders, { startX: endX - s2, endX, y });
			}
			const third = (s2 + s3 + s4) / 3;
			if (
				value &&
				Math.abs(s2 - third) < third &&
				Math.abs(s3 - third) < third &&
				Math.abs(s4 - third) < third
			) {
				const endX = x - s4;
				extend(activeAlignments, { startX: endX - s3, endX, y });
			}
		}
		for (const shape of activeFinders) {
			if (shape.bottom.y !== y && shape.bottom.y - shape.top.y >= 2) finders.push(shape);
		}
		activeFinders = activeFinders.filter((shape) => shape.bottom.y === y);
		for (const shape of activeAlignments) if (shape.bottom.y !== y) alignments.push(shape);
		activeAlignments = activeAlignments.filter((shape) => shape.bottom.y === y);
	}
	// The last row scanned is the one past the bottom edge, all light, which
	// closes every shape still open.
	return { finders, alignments };
}

/**
 * Run lengths from `origin` towards `end` on a Bresenham line, as the
 * distances between colour changes, starting dark: the first `count`.
 */
function runsTowards(image: Binarised, origin: Point, end: Point, count: number): number[] {
	const changes: Point[] = [{ x: Math.floor(origin.x), y: Math.floor(origin.y) }];
	const steep = Math.abs(end.y - origin.y) > Math.abs(end.x - origin.x);
	const fromX = Math.floor(steep ? origin.y : origin.x);
	const fromY = Math.floor(steep ? origin.x : origin.y);
	const toX = Math.floor(steep ? end.y : end.x);
	const toY = Math.floor(steep ? end.x : end.y);
	const dx = Math.abs(toX - fromX);
	const dy = Math.abs(toY - fromY);
	let error = Math.floor(-dx / 2);
	const xStep = fromX < toX ? 1 : -1;
	const yStep = fromY < toY ? 1 : -1;
	let current = true;
	for (let x = fromX, y = fromY; x !== toX + xStep; x += xStep) {
		const realX = steep ? y : x;
		const realY = steep ? x : y;
		if (dark(image, realX, realY) !== current) {
			current = !current;
			changes.push({ x: realX, y: realY });
			if (changes.length === count + 1) break;
		}
		error += dy;
		if (error > 0) {
			if (y === toY) break;
			y += yStep;
			error -= dx;
		}
	}
	const out: number[] = [];
	for (let i = 0; i < count; i += 1) {
		const a = changes[i];
		const b = changes[i + 1];
		out.push(a !== undefined && b !== undefined ? distance(a, b) : 0);
	}
	return out;
}

/** The `count` runs through `origin` along the line to `end`, the middle one counted once. */
function runsThrough(image: Binarised, origin: Point, end: Point, count: number): number[] {
	const half = Math.ceil(count / 2);
	const towards = runsTowards(image, origin, end, half);
	const away = runsTowards(
		image,
		origin,
		{ x: 2 * origin.x - end.x, y: 2 * origin.y - end.y },
		half,
	);
	const middle = (towards.shift() as number) + (away.shift() as number) - 1;
	return [...away, middle, ...towards];
}

/** How badly a point's runs fit `ratios` in four directions, in pixels. */
function scoreAt(image: Binarised, point: Point, ratios: readonly number[]): number {
	const { x, y } = point;
	const ends: Point[] = [
		{ x: -1, y },
		{ x, y: -1 },
		{ x: Math.max(0, x - y) - 1, y: Math.max(0, y - x) - 1 },
		{ x: Math.min(image.width, x + y) + 1, y: Math.min(image.height, y + x) + 1 },
	];
	const total = ratios.reduce((sum, ratio) => sum + ratio, 0);
	let squares = 0;
	const sizes: number[] = [];
	for (const end of ends) {
		const runs = runsThrough(image, point, end, ratios.length);
		const size = runs.reduce((sum, run) => sum + run, 0) / total;
		let error = 0;
		ratios.forEach((ratio, i) => {
			const deviation = (runs[i] as number) - ratio * size;
			error += deviation * deviation;
		});
		squares += error * error;
		sizes.push(size);
	}
	const mean = sizes.reduce((sum, size) => sum + size, 0) / sizes.length;
	let sizeError = 0;
	for (const size of sizes) sizeError += ((size - mean) * (size - mean)) / mean;
	return Math.sqrt(squares) + sizeError;
}

function centreOf({ top, bottom }: Shape): Point {
	return {
		x: (top.startX + top.endX + bottom.startX + bottom.endX) / 4,
		y: (top.y + bottom.y + 1) / 2,
	};
}

/** The best-scoring group of three finder shapes, or null. */
function bestGroup(image: Binarised, finders: readonly Shape[]): readonly Scored[] | null {
	const scored: Scored[] = [];
	for (const shape of finders) {
		const centre = centreOf(shape);
		const at = { x: Math.round(centre.x), y: Math.round(centre.y) };
		if (!dark(image, at.x, at.y)) continue;
		const { top, bottom } = shape;
		const size =
			(top.endX - top.startX + (bottom.endX - bottom.startX) + (bottom.y - top.y + 1)) / 3;
		scored.push({ ...centre, size, score: scoreAt(image, at, FINDER_RATIOS) });
	}
	scored.sort((a, b) => a.score - b.score);
	let best: { points: readonly Scored[]; score: number } | null = null;
	for (let i = 0; i < Math.min(GROUP_STARTS, scored.length); i += 1) {
		const first = scored[i] as Scored;
		const others = scored
			.filter((_, j) => j !== i)
			.map((other) => ({
				...other,
				score: other.score + ((other.size - first.size) * (other.size - first.size)) / first.size,
			}))
			.sort((a, b) => a.score - b.score);
		if (others.length < 2) continue;
		const score = first.score + (others[0] as Scored).score + (others[1] as Scored).score;
		if (best === null || score < best.score) {
			best = { points: [first, others[0] as Scored, others[1] as Scored], score };
		}
	}
	return best === null ? null : best.points;
}

/** Top left, top right and bottom left: the corner opposite the longest side, then by the cross product. */
function order(a: Point, b: Point, c: Point): [Point, Point, Point] {
	const ab = distance(a, b);
	const bc = distance(b, c);
	const ac = distance(a, c);
	const [first, topLeft, second] =
		bc >= ab && bc >= ac ? [b, a, c] : ac >= bc && ac >= ab ? [a, b, c] : [a, c, b];
	const cross =
		(second.x - topLeft.x) * (first.y - topLeft.y) - (second.y - topLeft.y) * (first.x - topLeft.x);
	// first is the bottom left guess and second the top right; the sign says
	// whether the guess was the wrong way round.
	return cross < 0 ? [topLeft, first, second] : [topLeft, second, first];
}

/** Size and module from the three centres, or null when the module comes out under a pixel. */
function dimension(
	image: Binarised,
	topLeft: Point,
	topRight: Point,
	bottomLeft: Point,
): { size: number; module: number } | null {
	const run = (from: Point, to: Point): number =>
		runsThrough(image, from, to, 5).reduce((sum, length) => sum + length, 0) / 7;
	const module =
		(run(topLeft, bottomLeft) +
			run(topLeft, topRight) +
			run(bottomLeft, topLeft) +
			run(topRight, topLeft)) /
		4;
	if (module < 1) return null;
	const across = Math.round(distance(topLeft, topRight) / module);
	const down = Math.round(distance(topLeft, bottomLeft) / module);
	let size = Math.floor((across + down) / 2) + 7;
	if (size % 4 === 0) size += 1;
	else if (size % 4 === 2) size -= 1;
	return { size, module };
}

/** A location from three ordered centres: size, and the alignment pattern or its affine guess. */
function locate(
	image: Binarised,
	alignments: readonly Shape[],
	topLeft: Point,
	topRight: Point,
	bottomLeft: Point,
): PlainLocation | null {
	const measured = dimension(image, topLeft, topRight, bottomLeft);
	if (measured === null) return null;
	const corner = {
		x: topRight.x - topLeft.x + bottomLeft.x,
		y: topRight.y - topLeft.y + bottomLeft.y,
	};
	const between =
		(distance(topLeft, bottomLeft) + distance(topLeft, topRight)) / 2 / measured.module;
	const towards = 1 - 3 / between;
	const expected = {
		x: topLeft.x + towards * (corner.x - topLeft.x),
		y: topLeft.y + towards * (corner.y - topLeft.y),
	};
	let alignment: Point = expected;
	if (between >= 15) {
		let bestScore = Number.POSITIVE_INFINITY;
		for (const shape of alignments) {
			const centre = centreOf(shape);
			const at = { x: Math.floor(centre.x), y: Math.floor(centre.y) };
			if (!dark(image, at.x, at.y)) continue;
			const score = scoreAt(image, at, ALIGNMENT_RATIOS) + distance(centre, expected);
			if (score < bestScore) {
				bestScore = score;
				alignment = centre;
			}
		}
	}
	return { topLeft, topRight, bottomLeft, alignment, size: measured.size };
}

/** A centre moved to the middle of its dark run, across and then down, as the second attempt does. */
function recentre(image: Binarised, point: Point): Point {
	const row = Math.round(point.y);
	let left = Math.round(point.x);
	while (dark(image, left, row)) left -= 1;
	let right = Math.round(point.x);
	while (dark(image, right, row)) right += 1;
	const x = (left + right) / 2;
	const column = Math.round(x);
	let top = row;
	while (dark(image, column, top)) top -= 1;
	let bottom = row;
	while (dark(image, column, bottom)) bottom += 1;
	return { x, y: (top + bottom) / 2 };
}

/** The locations a plain reader would try in this picture: none, one or two. */
export function plainReaderLocations(image: Binarised): PlainLocation[] {
	const { finders, alignments } = shapes(image);
	const group = bestGroup(image, finders);
	if (group === null) return [];
	const [topLeft, topRight, bottomLeft] = order(
		group[0] as Point,
		group[1] as Point,
		group[2] as Point,
	);
	const out: PlainLocation[] = [];
	const first = locate(image, alignments, topLeft, topRight, bottomLeft);
	if (first !== null) out.push(first);
	const second = locate(
		image,
		alignments,
		recentre(image, topLeft),
		recentre(image, topRight),
		recentre(image, bottomLeft),
	);
	if (second !== null) out.push(second);
	return out;
}

/** The grid a plain reader samples at a location, one pixel a module, or null for a size no symbol has. */
export function plainReaderGrid(image: Binarised, location: PlainLocation): BitMatrix | null {
	const { size } = location;
	if (size < 21 || size > 177 || size % 4 !== 1) return null;
	const transform = quadToQuad(
		[
			{ x: 3.5, y: 3.5 },
			{ x: size - 3.5, y: 3.5 },
			{ x: size - 6.5, y: size - 6.5 },
			{ x: 3.5, y: size - 3.5 },
		],
		[location.topLeft, location.topRight, location.alignment, location.bottomLeft],
	);
	const grid = new BitMatrix(size, size);
	for (let y = 0; y < size; y += 1) {
		for (let x = 0; x < size; x += 1) {
			const p = apply(transform, x + 0.5, y + 0.5);
			if (dark(image, Math.floor(p.x), Math.floor(p.y))) grid.data[y * size + x] = 1;
		}
	}
	return grid;
}
