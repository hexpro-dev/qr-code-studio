/**
 * Where everything is in a Micro QR symbol.
 *
 * One finder pattern at the top left with its separator below and to the
 * right; timing patterns along the whole top row and left column, starting
 * from the finder's edge, so they double as the symbol's outer edge on two
 * sides; fifteen format modules in the L just inside the separator; and data
 * everywhere else. There is no second format copy, no version information and
 * no alignment pattern, which is what makes the symbol small and also why so
 * few readers bother with it.
 *
 * Layout from ISO/IEC 18004's Micro QR figures as BWIPP draws them
 * (barcode.ps: `qrcode.fpat`, the micro branch of the timing loop, and
 * `qrcode.formatfimmap` for the format modules), proved against bwip-js and
 * zint (through zxing-wasm's writer) module for module.
 */

import type { EcLevel, SymbolLayout } from './contract-types.js';
import { FunctionGrid, makeGeometry, makeLayout, mapDataBits } from './modules.js';
import type { Geometry } from './modules.js';
import { microBlocks, microSpec } from './tables.js';

/**
 * The format modules in bit order, most significant first: bit 14 sits at
 * column 1 of row 8 and the sequence runs along row 8 to the corner, then up
 * column 8 to row 1. The same path QR Model 2's first copy takes around its
 * top left finder, shifted one module in because Micro QR's timing pattern
 * occupies row 0 and column 0.
 */
export const MICRO_FORMAT_MODULES: readonly (readonly [number, number])[] = Object.freeze(
	[
		[1, 8],
		[2, 8],
		[3, 8],
		[4, 8],
		[5, 8],
		[6, 8],
		[7, 8],
		[8, 8],
		[8, 7],
		[8, 6],
		[8, 5],
		[8, 4],
		[8, 3],
		[8, 2],
		[8, 1],
	].map((pair) => Object.freeze(pair) as readonly [number, number]),
);

function drawFinder(grid: FunctionGrid): void {
	for (let y = 0; y < 8; y += 1) {
		for (let x = 0; x < 8; x += 1) {
			if (x === 7 || y === 7) {
				grid.set(x, y, 'separator', false);
				continue;
			}
			const ring = Math.max(Math.abs(x - 3), Math.abs(y - 3));
			// Dark outer ring, light ring, dark 3 by 3 core.
			grid.set(x, y, 'finder', ring !== 2);
		}
	}
}

function buildGeometry(size: number): Geometry {
	const grid = new FunctionGrid(size, size);
	// Timing first, as BWIPP lays it down. The finder covers none of it (timing
	// starts at 8, past the separator), so the order matters only for
	// agreeing with the figures, not for any module's value.
	for (let i = 8; i < size; i += 1) {
		grid.set(i, 0, 'timing', i % 2 === 0);
		grid.set(0, i, 'timing', i % 2 === 0);
	}
	drawFinder(grid);
	for (const [x, y] of MICRO_FORMAT_MODULES) grid.set(x, y, 'format', false);
	return makeGeometry(
		grid,
		[{ role: 'finder', kind: 'concentric-7', x: 0, y: 0, width: 7, height: 7, rotation: 0 }],
		size - 1,
	);
}

let geometries: Map<string, Geometry> | undefined;
let layouts: Map<string, SymbolLayout> | undefined;

export function microGeometry(version: string): Geometry {
	const spec = microSpec(version);
	geometries ??= new Map();
	let found = geometries.get(spec.version);
	if (found === undefined) {
		found = buildGeometry(spec.size);
		geometries.set(spec.version, found);
	}
	return found;
}

/**
 * The layout for a version, or for a version at a level.
 *
 * Roles and regions are the version's. The codeword each data module carries
 * is too, except at M3, where the 4 bit codeword sits after 11 data codewords
 * at L and after 9 at M, so every module from there on belongs to a different
 * codeword. `layout('M3')` is therefore M3 at L, the first level, and a
 * symbol built or read at M3-M carries `layout('M3', 'M')`. Each is cached, and
 * levels whose mapping is the same share one object.
 */
export function microLayout(version: string, ec?: EcLevel): SymbolLayout {
	const spec = microSpec(version);
	const level = ec ?? (spec.levels[0] as { ecLevel: EcLevel }).ecLevel;
	const blocks = microBlocks(spec.version, level);
	const key =
		blocks.lastDataCodewordBits === 4 ? `${spec.version}:${blocks.dataBits}` : spec.version;
	layouts ??= new Map();
	let found = layouts.get(key);
	if (found === undefined) {
		const geometry = microGeometry(spec.version);
		found = makeLayout(geometry, mapDataBits(geometry, blocks));
		layouts.set(key, found);
	}
	return found;
}
