/**
 * The outline of a grid of dark cells, as few closed shapes as possible.
 *
 * A QR symbol drawn one square per module is thousands of subpaths, every
 * shared edge between two neighbours is drawn twice, and an SVG renderer that
 * anti-aliases each square on its own leaves a faint seam along every one of
 * them. Tracing the boundary instead gives one outline per connected shape,
 * with nothing to seam, and a file a fraction of the size.
 *
 * Every edge of the outline runs along a cell boundary with the dark cell on
 * its right as seen with y down, so outer edges go clockwise and the edges of
 * holes go anticlockwise, and the nonzero rule fills exactly the dark cells.
 * Corners are integers, so the outline is exact: at any integer scale it
 * covers whole pixels and nothing else.
 *
 * The one choice in tracing is at a vertex where two dark cells meet only
 * diagonally. The boundary passes through it twice, and the two passes can be
 * joined either way: each cell keeps its own corner, or the boundary crosses
 * over to the other cell. Either fills the same cells. Which one gives fewer
 * outlines depends on the grid, so this traces once keeping corners, then
 * crosses over at each such vertex where that joins two different outlines.
 * Joining two cycles of a permutation by swapping two successors always gives
 * one cycle, so every crossing removes an outline, and an outline is never
 * split. The result is the fewest the grid allows.
 */

import { PATH_CLOSE, PATH_LINE, PATH_MOVE } from './path.js';
import type { Path } from './path.js';

/** Right, down, left, up: the order a turn to the right walks them in. */
const DX = [1, 0, -1, 0] as const;
const DY = [0, 1, 0, -1] as const;

/** Merge a grid of dark cells into the fewest closed outlines (holes wound the other way). */
export function traceGrid(
	width: number,
	height: number,
	dark: (x: number, y: number) => boolean,
): Path {
	if (!Number.isInteger(width) || width < 0 || !Number.isInteger(height) || height < 0) {
		throw new TypeError('traceGrid: width and height are whole numbers, zero or more.');
	}
	if (typeof dark !== 'function') {
		throw new TypeError('traceGrid: dark is a function of x and y.');
	}

	// Asked once per cell, so a caller's function is never asked twice and
	// can be as slow as it likes.
	const cells = new Uint8Array(width * height);
	for (let y = 0; y < height; y += 1) {
		for (let x = 0; x < width; x += 1) {
			if (dark(x, y)) cells[y * width + x] = 1;
		}
	}
	const isDark = (x: number, y: number): boolean =>
		x >= 0 && y >= 0 && x < width && y < height && cells[y * width + x] === 1;

	const stride = width + 1;
	const vertices = stride * (height + 1);
	// Outgoing boundary edges at each vertex, one bit per direction.
	const out = new Uint8Array(vertices);
	for (let y = 0; y <= height; y += 1) {
		for (let x = 0; x < width; x += 1) {
			const above = isDark(x, y - 1);
			const below = isDark(x, y);
			if (below && !above) out[y * stride + x] |= 1 << 0;
			else if (above && !below) out[y * stride + x + 1] |= 1 << 2;
		}
	}
	for (let x = 0; x <= width; x += 1) {
		for (let y = 0; y < height; y += 1) {
			const left = isDark(x - 1, y);
			const right = isDark(x, y);
			if (left && !right) out[y * stride + x] |= 1 << 1;
			else if (right && !left) out[(y + 1) * stride + x] |= 1 << 3;
		}
	}

	// At a vertex with two ways out, whether to turn left (cross to the other
	// diagonal cell) rather than right (keep this cell's corner).
	const cross = new Uint8Array(vertices);
	const next = (vertex: number, direction: number): number => {
		const mask = out[vertex] as number;
		if ((mask & (mask - 1)) === 0) return 31 - Math.clz32(mask);
		return cross[vertex] === 1 ? (direction + 3) % 4 : (direction + 1) % 4;
	};
	const step = (vertex: number, direction: number): number =>
		vertex + (DX[direction] as number) + (DY[direction] as number) * stride;

	// First pass: label every edge with the outline it belongs to when every
	// diagonal vertex keeps its corners.
	const label = new Int32Array(vertices * 4).fill(-1);
	let outlines = 0;
	for (let v = 0; v < vertices; v += 1) {
		const mask = out[v] as number;
		for (let d = 0; d < 4; d += 1) {
			if ((mask & (1 << d)) === 0 || label[v * 4 + d] !== -1) continue;
			let vertex = v;
			let direction = d;
			do {
				label[vertex * 4 + direction] = outlines;
				vertex = step(vertex, direction);
				direction = next(vertex, direction);
			} while (vertex !== v || direction !== d);
			outlines += 1;
		}
	}

	// Second pass: cross over wherever that joins two outlines that are still
	// separate, tracked with a union-find over the first pass's labels.
	const parent = Int32Array.from({ length: outlines }, (_, i) => i);
	const root = (i: number): number => {
		let at = i;
		while (parent[at] !== at) {
			parent[at] = parent[parent[at] as number] as number;
			at = parent[at] as number;
		}
		return at;
	};
	for (let v = 0; v < vertices; v += 1) {
		const mask = out[v] as number;
		if ((mask & (mask - 1)) === 0) continue;
		const first = 31 - Math.clz32(mask & -mask);
		const second = 31 - Math.clz32(mask);
		const a = root(label[v * 4 + first] as number);
		const b = root(label[v * 4 + second] as number);
		if (a === b) continue;
		cross[v] = 1;
		parent[a] = b;
	}

	// Final pass: walk each outline once more and keep only its corners.
	const commands: number[] = [];
	const points: number[] = [];
	const visited = new Uint8Array(vertices * 4);
	const loopVertices: number[] = [];
	const loopDirections: number[] = [];
	for (let v = 0; v < vertices; v += 1) {
		const mask = out[v] as number;
		for (let d = 0; d < 4; d += 1) {
			if ((mask & (1 << d)) === 0 || visited[v * 4 + d] === 1) continue;
			loopVertices.length = 0;
			loopDirections.length = 0;
			let vertex = v;
			let direction = d;
			do {
				visited[vertex * 4 + direction] = 1;
				loopVertices.push(vertex);
				loopDirections.push(direction);
				vertex = step(vertex, direction);
				direction = next(vertex, direction);
			} while (vertex !== v || direction !== d);

			// A corner is where the direction changes. The first vertex found in
			// raster order is always one (nothing of its outline lies above it or
			// to its left), but the walk does not rely on that.
			const n = loopVertices.length;
			let started = false;
			for (let k = 0; k < n; k += 1) {
				const before = loopDirections[(k + n - 1) % n];
				if (loopDirections[k] === before) continue;
				const at = loopVertices[k] as number;
				commands.push(started ? PATH_LINE : PATH_MOVE);
				points.push(at % stride, Math.floor(at / stride));
				started = true;
			}
			commands.push(PATH_CLOSE);
		}
	}
	return { commands: Uint8Array.from(commands), points: Float64Array.from(points) };
}
