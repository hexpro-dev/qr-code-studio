/**
 * Where everything is in an rMQR symbol.
 *
 * Drawn in the order BWIPP draws it (barcode.ps: the rmqr branches of the
 * timing, finder and alignment steps, `qrcode.fcorpat`, `qrcode.fsubpat`,
 * `qrcode.algnpatrmqr` and `qrcode.formatfimmap`), because in the shortest
 * symbols the patterns overlap and the later one wins:
 *
 * - Timing along the top and bottom edges from column 3, down both side edges
 *   from row 3, and down every alignment column between its two patterns.
 * - The 7 by 7 finder at the left with its separator, the 5 by 5 finder
 *   sub-pattern at the bottom right, and a corner pattern (an L of five dark
 *   modules around one light one) at the top right and bottom left. In R7 the
 *   finder covers the whole left end and the bottom left corner pattern is
 *   lost under it, and the top right one shares its last module with the
 *   sub-pattern. In R9 the finder's separator crosses the bottom left one,
 *   leaving its bottom three modules.
 * - 3 by 3 alignment patterns on the top and bottom edges at each alignment
 *   column.
 * - Two copies of the format information: beside the finder, and beside the
 *   sub-pattern.
 *
 * zint, through zxing-wasm's writer, draws the same symbols to the module, so
 * the overlaps above are not one implementation's reading.
 */

import type { BlockLayout, StyleableRegion, SymbolLayout } from '../micro/contract-types.js';
import { FunctionGrid, makeGeometry, makeLayout, mapDataBits } from '../micro/modules.js';
import type { Geometry } from '../micro/modules.js';
import { rmqrSpec } from './tables.js';
import type { RmqrVersionSpec } from './tables.js';

/** The finder sub-pattern, 5 by 5: dark ring, light ring, dark centre. */
function subFinderDark(x: number, y: number): boolean {
	return Math.max(Math.abs(x - 2), Math.abs(y - 2)) !== 1;
}

/**
 * The corner pattern in its own frame, corner module at (0, 0) and arms along
 * x and y, as it sits at the top left before being reflected into place:
 * undefined off the pattern.
 */
function cornerDark(x: number, y: number): boolean | undefined {
	if (y === 0 && x <= 2) return true;
	if (x === 0 && y <= 2) return true;
	if (x === 1 && y === 1) return false;
	return undefined;
}

/**
 * The format modules of the copy beside the finder, most significant bit
 * first: three down column 11 from row 3, then columns 10, 9 and 8 each from
 * row 5 up to row 1.
 */
export function rmqrFormatModulesNearFinder(): readonly (readonly [number, number])[] {
	const out: [number, number][] = [
		[11, 3],
		[11, 2],
		[11, 1],
	];
	for (const x of [10, 9, 8]) {
		for (let y = 5; y >= 1; y -= 1) out.push([x, y]);
	}
	return out;
}

/**
 * The copy beside the sub-pattern, most significant bit first: three along
 * row H - 6 from column W - 3 leftwards, then columns W - 6, W - 7 and W - 8
 * each from row H - 2 up to row H - 6.
 */
export function rmqrFormatModulesNearSubFinder(
	width: number,
	height: number,
): readonly (readonly [number, number])[] {
	const out: [number, number][] = [
		[width - 3, height - 6],
		[width - 4, height - 6],
		[width - 5, height - 6],
	];
	for (const x of [width - 6, width - 7, width - 8]) {
		for (let y = height - 2; y >= height - 6; y -= 1) out.push([x, y]);
	}
	return out;
}

function buildGeometry(spec: RmqrVersionSpec): Geometry {
	const { width, height, alignmentColumns } = spec;
	const grid = new FunctionGrid(width, height);

	for (let x = 3; x <= width - 4; x += 1) {
		grid.set(x, 0, 'timing', x % 2 === 0);
		grid.set(x, height - 1, 'timing', x % 2 === 0);
	}
	for (let y = 3; y <= height - 4; y += 1) {
		grid.set(0, y, 'timing', y % 2 === 0);
		grid.set(width - 1, y, 'timing', y % 2 === 0);
		for (const column of alignmentColumns) grid.set(column, y, 'timing', y % 2 === 0);
	}

	// One pass over an 8 by 8 window at each corner, all four patterns per
	// step, so overlaps resolve the way BWIPP's loop resolves them.
	for (let y = 0; y < 8; y += 1) {
		for (let x = 0; x < 8; x += 1) {
			if (y < height) {
				if (x < 7 && y < 7) {
					grid.set(x, y, 'finder', Math.max(Math.abs(x - 3), Math.abs(y - 3)) !== 2);
				} else {
					grid.set(x, y, 'separator', false);
				}
			}
			const corner = cornerDark(x, y);
			if (corner !== undefined) {
				grid.set(width - 1 - x, y, 'corner-finder', corner);
				grid.set(x, height - 1 - y, 'corner-finder', corner);
			}
			if (x < 5 && y < 5) {
				grid.set(width - 1 - x, height - 1 - y, 'sub-finder', subFinderDark(x, y));
			}
		}
	}

	for (const column of alignmentColumns) {
		for (let dy = 0; dy < 3; dy += 1) {
			for (let dx = -1; dx <= 1; dx += 1) {
				const dark = !(dx === 0 && dy === 1);
				grid.set(column + dx, dy, 'alignment', dark);
				grid.set(column + dx, height - 3 + dy, 'alignment', dark);
			}
		}
	}

	for (const [x, y] of rmqrFormatModulesNearFinder()) grid.set(x, y, 'format', false);
	for (const [x, y] of rmqrFormatModulesNearSubFinder(width, height)) {
		grid.set(x, y, 'format', false);
	}

	const regions: StyleableRegion[] = [
		{ role: 'finder', kind: 'concentric-7', x: 0, y: 0, width: 7, height: 7, rotation: 0 },
		{
			role: 'sub-finder',
			kind: 'concentric-5',
			x: width - 5,
			y: height - 5,
			width: 5,
			height: 5,
			rotation: 0,
		},
		// The corner L's rotation is measured clockwise from its own frame, the
		// corner module at the top left with arms going right and down. At the
		// top right the corner is top right and the arms go left and down: 90.
		{
			role: 'corner-finder',
			kind: 'corner-l',
			x: width - 3,
			y: 0,
			width: 3,
			height: 3,
			rotation: 90,
		},
	];
	// The bottom left L is whole only from R11 up: see the comment at the top.
	if (height >= 11) {
		regions.push({
			role: 'corner-finder',
			kind: 'corner-l',
			x: 0,
			y: height - 3,
			width: 3,
			height: 3,
			rotation: 270,
		});
	}
	// The right edge is all function patterns, so placement starts one in.
	return makeGeometry(grid, regions, width - 2);
}

let geometries: Map<string, Geometry> | undefined;
let layouts: Map<string, SymbolLayout> | undefined;

export function rmqrGeometry(version: string): Geometry {
	const spec = rmqrSpec(version);
	geometries ??= new Map();
	let found = geometries.get(spec.version);
	if (found === undefined) {
		found = buildGeometry(spec);
		geometries.set(spec.version, found);
	}
	return found;
}

/**
 * The layout for a version. rMQR's codewords are all eight bits, so both
 * levels map modules to codeword bits identically and share this one object.
 */
export function rmqrLayout(version: string): SymbolLayout {
	const spec = rmqrSpec(version);
	layouts ??= new Map();
	let found = layouts.get(spec.version);
	if (found === undefined) {
		const geometry = rmqrGeometry(spec.version);
		const blocks = (spec.levels[0] as { readonly blocks: BlockLayout }).blocks;
		found = makeLayout(geometry, mapDataBits(geometry, blocks));
		layouts.set(spec.version, found);
	}
	return found;
}
