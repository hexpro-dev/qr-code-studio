import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { area } from '../../src/geometry/measure.js';
import { PATH_CLOSE, PATH_LINE, PATH_MOVE } from '../../src/geometry/path.js';
import type { Path } from '../../src/geometry/path.js';
import { traceGrid } from '../../src/geometry/trace.js';
import { rasterise } from '../../src/render/raster.js';

interface Grid {
	readonly width: number;
	readonly height: number;
	readonly cells: readonly boolean[];
}

const grids = fc
	.record({ width: fc.integer({ min: 1, max: 12 }), height: fc.integer({ min: 1, max: 12 }) })
	.chain(({ width, height }) =>
		fc
			.array(fc.boolean(), { minLength: width * height, maxLength: width * height })
			.map((cells) => ({ width, height, cells })),
	);

function trace(grid: Grid): Path {
	return traceGrid(grid.width, grid.height, (x, y) => grid.cells[y * grid.width + x] === true);
}

/** Each subpath's corners, as the commands give them. */
function loops(path: Path): number[][] {
	const out: number[][] = [];
	let at = 0;
	for (const command of path.commands) {
		if (command === PATH_MOVE) out.push([]);
		if (command === PATH_MOVE || command === PATH_LINE) {
			out[out.length - 1]?.push(path.points[at] as number, path.points[at + 1] as number);
			at += 2;
		}
	}
	return out;
}

/** The winding number at a point, counted from the edges directly. */
function winding(path: Path, px: number, py: number): number {
	let total = 0;
	for (const loop of loops(path)) {
		const n = loop.length / 2;
		for (let i = 0; i < n; i += 1) {
			const x0 = loop[i * 2] as number;
			const y0 = loop[i * 2 + 1] as number;
			const x1 = loop[((i + 1) % n) * 2] as number;
			const y1 = loop[((i + 1) % n) * 2 + 1] as number;
			if ((y0 <= py && py < y1) || (y1 <= py && py < y0)) {
				const x = x0 + ((py - y0) * (x1 - x0)) / (y1 - y0);
				if (x < px) total += y1 > y0 ? 1 : -1;
			}
		}
	}
	return total;
}

/**
 * How many outlines the grid needs at least: the connected pieces of its cell
 * boundary, found here by a flood over boundary edges with no reference to
 * how the tracer works. Each piece is one closed walk at best, because every
 * vertex on it has as many edges in as out.
 */
function boundaryPieces(grid: Grid): number {
	const { width, height } = grid;
	const dark = (x: number, y: number): boolean =>
		x >= 0 && y >= 0 && x < width && y < height && grid.cells[y * width + x] === true;
	const stride = width + 1;
	const neighbours = new Map<number, number[]>();
	const link = (a: number, b: number): void => {
		neighbours.set(a, [...(neighbours.get(a) ?? []), b]);
		neighbours.set(b, [...(neighbours.get(b) ?? []), a]);
	};
	for (let y = 0; y <= height; y += 1) {
		for (let x = 0; x <= width; x += 1) {
			if (x < width && dark(x, y - 1) !== dark(x, y)) link(y * stride + x, y * stride + x + 1);
			if (y < height && dark(x - 1, y) !== dark(x, y)) link(y * stride + x, (y + 1) * stride + x);
		}
	}
	const seen = new Set<number>();
	let pieces = 0;
	for (const start of neighbours.keys()) {
		if (seen.has(start)) continue;
		pieces += 1;
		const stack = [start];
		seen.add(start);
		while (stack.length > 0) {
			const at = stack.pop() as number;
			for (const next of neighbours.get(at) ?? []) {
				if (!seen.has(next)) {
					seen.add(next);
					stack.push(next);
				}
			}
		}
	}
	return pieces;
}

describe('traceGrid', () => {
	it('outlines a single cell and an empty grid', () => {
		const one = traceGrid(1, 1, () => true);
		expect(Array.from(one.commands)).toEqual([
			PATH_MOVE,
			PATH_LINE,
			PATH_LINE,
			PATH_LINE,
			PATH_CLOSE,
		]);
		expect(Array.from(one.points)).toEqual([0, 0, 1, 0, 1, 1, 0, 1]);
		expect(traceGrid(0, 0, () => true).commands.length).toBe(0);
		expect(traceGrid(3, 3, () => false).commands.length).toBe(0);
	});

	it('merges a run of cells into one rectangle with only its corners', () => {
		const run = traceGrid(5, 1, () => true);
		expect(Array.from(run.points)).toEqual([0, 0, 5, 0, 5, 1, 0, 1]);
	});

	it('winds a hole the other way', () => {
		const ring = traceGrid(3, 3, (x, y) => !(x === 1 && y === 1));
		const [outer, inner] = loops(ring);
		expect(outer).toEqual([0, 0, 3, 0, 3, 3, 0, 3]);
		expect(inner).toEqual([1, 1, 1, 2, 2, 2, 2, 1]);
		expect(area(ring)).toBe(8);
		expect(winding(ring, 1.5, 1.5)).toBe(0);
	});

	it('joins two cells that touch only at a corner into one outline', () => {
		const pair = traceGrid(2, 2, (x, y) => x === y);
		expect(loops(pair)).toHaveLength(1);
		expect(area(pair)).toBe(2);
	});

	it('keeps an outline whole where joining would split it', () => {
		// A ring broken only by a diagonal: one boundary already runs through
		// the corner, and crossing over there would cut it in two.
		const cells = [
			[1, 1, 1, 0],
			[1, 0, 1, 0],
			[1, 1, 0, 1],
			[0, 0, 1, 1],
		];
		const grid: Grid = { width: 4, height: 4, cells: cells.flat().map((cell) => cell === 1) };
		expect(loops(trace(grid))).toHaveLength(boundaryPieces(grid));
	});

	it('asks for each cell exactly once', () => {
		const asked: string[] = [];
		traceGrid(3, 2, (x, y) => {
			asked.push(`${x},${y}`);
			return (x + y) % 2 === 0;
		});
		expect(asked.sort()).toEqual(['0,0', '0,1', '1,0', '1,1', '2,0', '2,1']);
	});

	it('refuses a size that is not a whole number, or no function', () => {
		expect(() => traceGrid(-1, 2, () => true)).toThrow(TypeError);
		expect(() => traceGrid(2, 1.5, () => true)).toThrow(TypeError);
		expect(() => traceGrid(Number.NaN, 1, () => true)).toThrow(TypeError);
		expect(() => traceGrid(2, 2, 'dark' as never)).toThrow(TypeError);
	});

	it('fills exactly the dark cells, with integer corners and opposite holes, for any grid', () => {
		fc.assert(
			fc.property(grids, (grid) => {
				const path = trace(grid);
				const dark = grid.cells.filter(Boolean).length;
				expect(area(path)).toBe(dark);
				for (const value of path.points) expect(Number.isInteger(value)).toBe(true);
				for (let y = 0; y < grid.height; y += 1) {
					for (let x = 0; x < grid.width; x += 1) {
						// Dark cells wind once, all the same way (their left edge
						// runs up the page); light cells, holes included, wind zero.
						const expected = grid.cells[y * grid.width + x] ? -1 : 0;
						expect(winding(path, x + 0.5, y + 0.5) + 0).toBe(expected);
					}
				}
			}),
			{ numRuns: 300, seed: 20261025 },
		);
	});

	it('uses the fewest outlines the grid allows', () => {
		fc.assert(
			fc.property(grids, (grid) => {
				expect(loops(trace(grid))).toHaveLength(boundaryPieces(grid));
			}),
			{ numRuns: 300, seed: 20261026 },
		);
	});

	it('rasterises at an integer scale to exactly the cell grid', () => {
		fc.assert(
			fc.property(grids, fc.integer({ min: 1, max: 5 }), (grid, scale) => {
				const path = trace(grid);
				const image = rasterise(
					{
						width: grid.width,
						height: grid.height,
						background: null,
						layers: [
							{ kind: 'path', path, paint: { kind: 'solid', colour: { r: 0, g: 0, b: 0, a: 1 } } },
						],
					},
					{ width: grid.width * scale, height: grid.height * scale },
				);
				for (let y = 0; y < image.height; y += 1) {
					for (let x = 0; x < image.width; x += 1) {
						const cell = grid.cells[Math.floor(y / scale) * grid.width + Math.floor(x / scale)];
						expect(image.data[(y * image.width + x) * 4 + 3]).toBe(cell ? 255 : 0);
					}
				}
			}),
			{ numRuns: 150, seed: 20261027 },
		);
	});
});
