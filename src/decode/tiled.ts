/**
 * A third opinion for the strict profile, from version 7: the grid zxing-cpp
 * lays in tiles, through the alignment patterns and the finders' inner
 * corners.
 *
 * From version 7 zxing-cpp does not sample a symbol through one projective
 * map. It finds every alignment pattern and samples each square of four of
 * them through a map of its own. Three of those squares have a finder at one
 * corner, where no alignment pattern is, and there zxing-cpp takes the
 * finder's ring instead: it traces the ring's inner and outer edges, fits four
 * straight sides to each, blends the two, and takes the corner of the blend
 * that faces the middle of the symbol, wherever that lands within half a
 * finder of where the alignment grid predicts it.
 *
 * On a square ring that corner is the centre of the ring's corner module, as
 * the grid expects. On a ring with its corners cut or rounded, the sides are
 * fitted from whatever the edge walk counts as each side, and the corners they
 * meet in move: by a third of a module on an octagon at any density, and by
 * as much on a rounded ring a few pixels a module across. The whole tile moves
 * with its corner, a third of a module off at the finder and less towards the
 * other three, and at a few pixels a module that is the difference between a
 * module read and a module missed. Measured over verify's captures of every
 * design preset, those were all of the version 7 symbols the strict reader
 * passed and zxing-cpp failed: octagonal finders at 3 to 6 pixels a module,
 * rounded and round ones at 2.5. So the strict profile lays zxing-cpp's grid
 * here, on zxing-cpp's threshold, and requires it to read to the same bytes
 * with at most one more error in any block than the strict reader's own, and
 * below six pixels a module none.
 *
 * Which corner the fit lands on depends on the pixel the walk starts from,
 * and zxing-cpp starts from under its own estimate of the finder's centre,
 * which is not the strict grid's to the pixel. A grid that reads from the
 * strict reader's centre and not from the pixel beside it is one zxing-cpp
 * may or may not read, so the grid is laid from each of the nine pixels
 * round the centre (`TILED_NUDGES`) and every one of them has to read.
 *
 * Written from the algorithm's description, after zxing-cpp's
 * `ConcentricFinder` and QR `SampleQR` (Apache 2.0), including the details
 * that look arbitrary and decide where the corner lands: the walk starts on
 * the ray to the right of the centre's pixel, the first corner is the point
 * of the walk furthest from the centre, and the others are searched for by
 * their place in the walk rather than by angle.
 *
 * The alignment patterns are put where the strict grid has them rather than
 * searched for: on a symbol the strict reader read they are where it says,
 * and it is the finders' corners that this is about.
 */

import { BitMatrix } from '../core/bit-matrix.js';
import { hypot } from '../core/math.js';
import type { Binarised } from './binarise.js';
import { diagonalAlignments } from './locate-qr.js';
import type { Homography } from './transform.js';
import { apply, moduleWidth, quadToQuad } from './transform.js';
import type { Point } from './types.js';

/** The smallest symbol zxing-cpp samples in tiles: version 7, 45 modules. */
export const TILED_SIZE = 45;

/**
 * The most errors a block of zxing-cpp's tiled grid may have beyond the strict
 * reader's own, at `TILED_SHARP_PIXELS` a module and more. Measured, not
 * chosen: over the first survey of verify's captures of every preset, every
 * version 7 symbol the strict reader passed and zxing-cpp failed had a block
 * two or more errors worse in the tiled grid, or no read at all, and of those
 * zxing-cpp read, 98 in 100 were within one. The two later surveys found
 * misses that came out within one from the strict grid's centres, both
 * octagonal finders, one at 4 pixels a module and one at 6: the first is why
 * `TILED_SHARP_PIXELS` is six, the second why the grid is laid from every
 * pixel round the centres (`TILED_NUDGES`).
 */
export const TILED_EXTRA_ERRORS = 1;

/**
 * Below this many pixels a module the tiled grid may have no more errors than
 * the strict reader's own. There a corner a fifth of a module out is a pixel
 * out, and zxing-cpp's own finder centres and alignment patterns, which this
 * takes from the strict grid rather than finding as it does, move it as much
 * again: an octagonal finder at 4 pixels a module that zxing-cpp missed came
 * out one error worse in two blocks here, and no better than that would have
 * told it from those zxing-cpp read.
 */
export const TILED_SHARP_PIXELS = 6;

/** A pixel of a thresholded picture: 1 dark, 0 light, -1 off the picture. */
function pixel(image: Binarised, x: number, y: number): number {
	if (x < 0 || y < 0 || x >= image.width || y >= image.height) return -1;
	return image.bits[y * image.width + x] as number;
}

/** A position and a heading on the pixel grid, as zxing-cpp's integer cursor walks it. */
interface Cursor {
	x: number;
	y: number;
	dx: number;
	dy: number;
}

/** The heading a quarter turn to the right (`side` 1) or left (-1), y pointing down. */
function turned(cursor: Cursor, side: number): { dx: number; dy: number } {
	return { dx: -cursor.dy * side, dy: cursor.dx * side };
}

/** Whether the pixel one step away in (dx, dy) differs from the cursor's own: an edge, or the picture's border. */
function edgeAt(image: Binarised, cursor: Cursor, dx: number, dy: number): boolean {
	return pixel(image, cursor.x + dx, cursor.y + dy) !== pixel(image, cursor.x, cursor.y);
}

/**
 * Walk forward past `nth` changes of colour, at most `range` steps, and stop
 * on the first pixel past the last one, or with `backup` the last pixel before
 * it. False when the edges run out first.
 */
function stepToEdge(
	image: Binarised,
	cursor: Cursor,
	nth: number,
	range: number,
	backup: boolean,
): boolean {
	let steps = 0;
	let last = pixel(image, cursor.x, cursor.y);
	let left = nth;
	while (left > 0 && steps < range && last !== -1) {
		steps += 1;
		const here = pixel(image, cursor.x + steps * cursor.dx, cursor.y + steps * cursor.dy);
		if (here !== last) {
			last = here;
			left -= 1;
		}
	}
	if (backup) steps -= 1;
	cursor.x += steps * cursor.dx;
	cursor.y += steps * cursor.dy;
	return left === 0;
}

/**
 * One step along an edge kept on `side`: turn towards that side when the edge
 * leaves it, away from it when the edge blocks the way, and give up when it
 * blocks every way. False when the step leaves the picture.
 */
function stepAlongEdge(image: Binarised, cursor: Cursor, side: number): boolean {
	const towards = turned(cursor, side);
	if (!edgeAt(image, cursor, towards.dx, towards.dy)) {
		cursor.dx = towards.dx;
		cursor.dy = towards.dy;
	} else {
		for (let turns = 0; edgeAt(image, cursor, cursor.dx, cursor.dy); turns += 1) {
			if (turns === 2) return false;
			const away = turned(cursor, -side);
			cursor.dx = away.dx;
			cursor.dy = away.dy;
		}
	}
	cursor.x += cursor.dx;
	cursor.y += cursor.dy;
	return pixel(image, cursor.x, cursor.y) !== -1;
}

/**
 * The pixels along the `edge`th edge out from a finder's centre, walked all
 * the way round: on the dark side of it, the first pixel past it or with
 * `backup` the last before it. Empty unless the walk closes on itself having
 * gone round the centre in all eight directions, inside twice `width`.
 */
export function ringPoints(
	image: Binarised,
	centre: Point,
	width: number,
	edge: number,
	backup: boolean,
): Point[] {
	const cx = Math.trunc(centre.x);
	const cy = Math.trunc(centre.y);
	const most = Math.trunc((4 * (width + 1) * 3) / 2);
	const reach = width * 2;
	const cursor: Cursor = { x: cx, y: cy, dx: 1, dy: 0 };
	if (!stepToEdge(image, cursor, edge, reach, backup)) return [];
	const right = turned(cursor, 1);
	cursor.dx = right.dx;
	cursor.dy = right.dy;
	const side = backup ? -1 : 1;
	const startX = cursor.x;
	const startY = cursor.y;
	let directions = 0;
	const points: Point[] = [];
	do {
		points.push({ x: cursor.x + 0.5, y: cursor.y + 0.5 });
		// Which of the eight directions round the centre this pixel is in, by
		// integer division as zxing-cpp takes it: a diagonal only where the walk
		// crosses it exactly, which a closed walk round the centre always does.
		const ox = cursor.x - cx;
		const oy = cursor.y - cy;
		const longest = Math.max(Math.abs(ox), Math.abs(oy));
		directions |= 1 << (4 + Math.trunc(ox / longest) + 3 * Math.trunc(oy / longest));
		if (!stepAlongEdge(image, cursor, side)) return [];
		const out = hypot(cursor.x - cx, cursor.y - cy);
		if (out > reach || out === 0 || points.length > most) return [];
	} while (cursor.x !== startX || cursor.y !== startY);
	return directions === 0b111101111 ? points : [];
}

/** A line a x + b y = c, (a, b) of unit length. */
interface Line {
	readonly a: number;
	readonly b: number;
	readonly c: number;
}

/** The orthogonal least squares line through some points, or null for fewer than two distinct ones. */
function fitLine(points: readonly Point[]): Line | null {
	let mx = 0;
	let my = 0;
	for (const p of points) {
		mx += p.x / points.length;
		my += p.y / points.length;
	}
	let xx = 0;
	let yy = 0;
	let xy = 0;
	for (const p of points) {
		xx += (p.x - mx) * (p.x - mx);
		yy += (p.y - my) * (p.y - my);
		xy += (p.x - mx) * (p.y - my);
	}
	// The normal, from whichever row of the scatter matrix is the larger.
	const [a, b] = yy >= xx ? [yy, -xy] : [xy, -xx];
	const length = hypot(a, b);
	if (!(length > 0)) return null;
	return { a: a / length, b: b / length, c: (a * mx + b * my) / length };
}

function distanceToLine(line: Line, p: Point): number {
	return Math.abs(line.a * p.x + line.b * p.y - line.c);
}

function intersect(first: Line, second: Line): Point {
	const d = first.a * second.b - first.b * second.a;
	return {
		x: (first.c * second.b - first.b * second.c) / d,
		y: (first.a * second.c - first.c * second.a) / d,
	};
}

/** Index of the point in [from, to) that scores highest: the first of equals, or with `lastOfEquals` the last. */
function highest(
	points: readonly Point[],
	from: number,
	to: number,
	score: (p: Point) => number,
	lastOfEquals = false,
): number {
	let best = from;
	for (let i = from + 1; i < to; i += 1) {
		const here = score(points[i] as Point);
		const top = score(points[best] as Point);
		if (here > top || (lastOfEquals && here === top)) best = i;
	}
	return best;
}

/**
 * Four corners fitted to a ring's walk, as zxing-cpp fits them, or null where
 * it would refuse the ring: too round (its nearest point more than 0.85 of
 * the way out to its furthest), or a side whose points stray from their line
 * by more than an eighth of the side's length, clamped to between one and
 * eight pixels.
 */
export function fitQuadrilateral(centre: Point, walk: readonly Point[]): Point[] | null {
	const out = (p: Point): number => hypot(p.x - centre.x, p.y - centre.y);
	const nearest = walk[highest(walk, 0, walk.length, (p) => -out(p))] as Point;
	// The last of the furthest, as std::minmax_element gives it.
	const furthest = highest(walk, 0, walk.length, out, true);
	if (out(nearest) > 0.85 * out(walk[furthest] as Point)) return null;
	const points = [...walk.slice(furthest), ...walk.slice(0, furthest)];
	const n = points.length;
	const third = highest(points, Math.trunc((n * 3) / 8), Math.trunc((n * 5) / 8), out);
	const first = points[0] as Point;
	const across = points[third] as Point;
	const span = hypot(across.x - first.x, across.y - first.y);
	const offDiagonal = (p: Point): number =>
		Math.abs((across.x - first.x) * (p.y - first.y) - (across.y - first.y) * (p.x - first.x)) /
		span;
	const second = highest(points, Math.trunc(n / 8), Math.trunc((n * 3) / 8), offDiagonal);
	const fourth = highest(points, Math.trunc((n * 5) / 8), Math.trunc((n * 7) / 8), offDiagonal);
	const corners = [0, second, third, fourth, n];
	const lines: Line[] = [];
	for (let side = 0; side < 4; side += 1) {
		const stretch = points.slice((corners[side] as number) + 1, corners[side + 1] as number);
		const line = fitLine(stretch);
		if (line === null) return null;
		const slack = Math.max(1, Math.min(8, stretch.length / 8));
		if (stretch.length > 3 && stretch.some((p) => distanceToLine(line, p) > slack)) return null;
		lines.push(line);
	}
	return lines.map((line, i) => intersect(line, lines[(i + 1) % 4] as Line));
}

/** A fitted ring's corners, unless its shortest side is under `floor` pixels or a third of its longest. */
function plausibleSquare(corners: readonly Point[], floor: number): boolean {
	let shortest = Number.POSITIVE_INFINITY;
	let longest = 0;
	for (let i = 0; i < 4; i += 1) {
		const a = corners[i] as Point;
		const b = corners[(i + 1) % 4] as Point;
		const side = hypot(b.x - a.x, b.y - a.y);
		shortest = Math.min(shortest, side);
		longest = Math.max(longest, side);
	}
	return shortest >= floor && shortest > longest / 3;
}

function fittedEdge(
	image: Binarised,
	centre: Point,
	width: number,
	edge: number,
	backup: boolean,
): Point[] | null {
	const walk = ringPoints(image, centre, width, edge, backup);
	if (walk.length === 0) return null;
	const corners = fitQuadrilateral(centre, walk);
	return corners !== null && plausibleSquare(corners, 2 * (edge - (backup ? 1 : 0)))
		? corners
		: null;
}

/**
 * The corners of a finder's dark ring as zxing-cpp fits them: the inner edge's
 * and the outer edge's fits blended, corner by nearest corner, which puts
 * them at the middle of the ring. Null where either fit is refused.
 */
export function finderCorners(image: Binarised, centre: Point, width: number): Point[] | null {
	const inner = fittedEdge(image, centre, width, 2, false);
	if (inner === null) return null;
	const outer = fittedEdge(image, centre, width, 3, true);
	if (outer === null) return null;
	const start = inner[0] as Point;
	const offset = highest(outer, 0, 4, (p) => -hypot(p.x - start.x, p.y - start.y));
	return inner.map((p, i) => {
		const q = outer[(i + offset) % 4] as Point;
		return { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
	});
}

/**
 * The pixel positions zxing-cpp would take for the corners of its tiles, on
 * a QR symbol of `size` modules, at least `TILED_SIZE`, that the strict grid
 * `transform` lies over: row by row, the centres of the alignment patterns
 * where the grid has them, and at the three finders the fitted corner of the
 * ring facing the middle of the symbol, where the fit lands one within half
 * a finder of the grid's own. `nudge` moves the centres the rings are walked
 * from, in pixels.
 */
export function tileCorners(
	image: Binarised,
	transform: Homography,
	size: number,
	nudge: Point = { x: 0, y: 0 },
): Point[][] {
	const at = [6, ...diagonalAlignments(size)];
	const last = at.length - 1;
	const corners = at.map((v) => at.map((u) => apply(transform, u + 0.5, v + 0.5)));
	for (const [column, row, u, v] of [
		[0, 0, 3.5, 3.5],
		[last, 0, size - 3.5, 3.5],
		[0, last, 3.5, size - 3.5],
	] as const) {
		const finder = 7 * moduleWidth(transform, u, v);
		const line = corners[row] as Point[];
		const predicted = line[column] as Point;
		// The last of the fitted corners within half a finder of the prediction,
		// as zxing-cpp takes it. A ring that does not fit keeps the prediction,
		// and one that does not fit from its own centre is taken not to fit from
		// a pixel off it either: a round ring zxing-cpp refuses to fit, from
		// wherever it starts, can sometimes be fitted from a start a pixel off.
		const centre = apply(transform, u, v);
		const width = Math.round(finder);
		const fitted =
			nudge.x === 0 && nudge.y === 0
				? finderCorners(image, centre, width)
				: finderCorners(image, centre, width) &&
					finderCorners(image, { x: centre.x + nudge.x, y: centre.y + nudge.y }, width);
		for (const candidate of fitted ?? []) {
			if (hypot(candidate.x - predicted.x, candidate.y - predicted.y) < finder / 2) {
				line[column] = candidate;
			}
		}
	}
	return corners;
}

/**
 * The matrix zxing-cpp would sample from a QR symbol of `size` modules, at
 * least `TILED_SIZE`, that the strict grid `transform` lies over: in tiles
 * between the corners `tileCorners` gives, each mapped through its own four,
 * one pixel a module.
 */
export function tiledGrid(
	image: Binarised,
	transform: Homography,
	size: number,
	nudge: Point = { x: 0, y: 0 },
): BitMatrix {
	const at = [6, ...diagonalAlignments(size)];
	const last = at.length - 1;
	const corners = tileCorners(image, transform, size, nudge);
	const corner = (row: number, column: number): Point => (corners[row] as Point[])[column] as Point;
	const matrix = new BitMatrix(size, size);
	for (let row = 0; row < last; row += 1) {
		for (let column = 0; column < last; column += 1) {
			const u0 = at[column] as number;
			const u1 = at[column + 1] as number;
			const v0 = at[row] as number;
			const v1 = at[row + 1] as number;
			const tile = quadToQuad(
				[
					{ x: u0 + 0.5, y: v0 + 0.5 },
					{ x: u1 + 0.5, y: v0 + 0.5 },
					{ x: u1 + 0.5, y: v1 + 0.5 },
					{ x: u0 + 0.5, y: v1 + 0.5 },
				],
				[
					corner(row, column),
					corner(row, column + 1),
					corner(row + 1, column + 1),
					corner(row + 1, column),
				],
			);
			// The tiles along the symbol's edges reach out over the finders and
			// the last row and column of modules.
			const top = row === 0 ? 0 : v0;
			const bottom = row === last - 1 ? size : v1;
			const left = column === 0 ? 0 : u0;
			const right = column === last - 1 ? size : u1;
			for (let y = top; y < bottom; y += 1) {
				for (let x = left; x < right; x += 1) {
					const p = apply(tile, x + 0.5, y + 0.5);
					if (pixel(image, Math.floor(p.x), Math.floor(p.y)) === 1) matrix.set(x, y, true);
				}
			}
		}
	}
	return matrix;
}

/**
 * Where zxing-cpp's own finder centres may be, against the strict grid's, in
 * pixels: the nine whole-pixel steps round it. zxing-cpp walks each ring from
 * the pixel under its own centre, and the corner it fits on a ring with cut
 * or rounded corners depends on where the walk starts, so the tiled grid is
 * laid from each of these.
 */
export const TILED_NUDGES: readonly Point[] = Object.freeze(
	[-1, 0, 1].flatMap((y) => [-1, 0, 1].map((x) => Object.freeze({ x, y }))),
);

/**
 * Every distinct matrix zxing-cpp might sample in tiles (see `tiledGrid`),
 * one for each of `TILED_NUDGES` whose fitted corners differ from the rest.
 */
export function tiledGrids(image: Binarised, transform: Homography, size: number): BitMatrix[] {
	const seen = new Set<string>();
	const out: BitMatrix[] = [];
	for (const nudge of TILED_NUDGES) {
		const key = tileCorners(image, transform, size, nudge)
			.flat()
			.map((p) => `${p.x},${p.y}`)
			.join(' ');
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(tiledGrid(image, transform, size, nudge));
	}
	return out;
}
