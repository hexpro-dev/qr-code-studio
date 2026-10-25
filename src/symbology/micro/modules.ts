/**
 * The module grid both small symbologies share: drawing function patterns
 * with a role for every module, walking the data region, and moving codeword
 * bits into and out of a matrix.
 *
 * The encoder and the reader use the same layout object, so they cannot
 * disagree about which module carries which bit. That disagreement is the one
 * geometry bug that looks like damage rather than like a bug: everything up to
 * the first misplaced module decodes, and Reed-Solomon then reports the rest
 * as errors it can or cannot fix.
 */

import { BitMatrix } from '../../core/index.js';
import { dataCodewordCount } from './blocks.js';
import { ROLE_CODES } from '../roles.js';
import type { BlockLayout, ModuleRole, StyleableRegion, SymbolLayout } from '../types.js';

/** Function patterns as they are drawn, before any data or format bits. */
export class FunctionGrid {
	readonly width: number;
	readonly height: number;
	/** ROLE_CODES per module, row major; data until something claims the module. */
	readonly roles: Uint8Array;
	/** 1 where a function module is dark. */
	readonly dark: Uint8Array;

	constructor(width: number, height: number) {
		this.width = width;
		this.height = height;
		this.roles = new Uint8Array(width * height).fill(ROLE_CODES.data);
		this.dark = new Uint8Array(width * height);
	}

	/**
	 * Claim a module for a function pattern. A later claim replaces an earlier
	 * one, which is how the specification's figures overlap (a finder drawn
	 * over the end of a timing pattern), so callers draw in the order the
	 * patterns are laid down.
	 */
	set(x: number, y: number, role: ModuleRole, dark: boolean): void {
		const at = y * this.width + x;
		this.roles[at] = ROLE_CODES[role];
		this.dark[at] = dark ? 1 : 0;
	}

	isData(x: number, y: number): boolean {
		return this.roles[y * this.width + x] === ROLE_CODES.data;
	}
}

/**
 * Everything about a version's modules that does not depend on the error
 * correction level: roles, regions, the drawn function patterns and the order
 * the data region is filled in.
 */
export interface Geometry {
	readonly width: number;
	readonly height: number;
	readonly roles: Uint8Array;
	readonly regions: readonly StyleableRegion[];
	/** Function patterns drawn; format and data modules light. */
	readonly template: BitMatrix;
	/** Every data module, as y * width + x, in the order bits are placed. */
	readonly order: Int32Array;
}

/**
 * The data region in placement order: columns in pairs from `startX`
 * leftwards, right module before left, upwards in the first pair and
 * alternating direction after, skipping every function module.
 *
 * QR Model 2 also steps over its vertical timing column. Micro QR's timing
 * runs down the left edge and rMQR's vertical timing lines sit inside function
 * columns of their own, so neither has a column to step over; rMQR starts one
 * column in, because its right edge is all function patterns.
 */
function zigzag(grid: FunctionGrid, startX: number): Int32Array {
	const { width, height } = grid;
	const out: number[] = [];
	let upwards = true;
	for (let right = startX; right >= 0; right -= 2) {
		for (let step = 0; step < height; step += 1) {
			const y = upwards ? height - 1 - step : step;
			for (const x of [right, right - 1]) {
				if (x >= 0 && grid.isData(x, y)) out.push(y * width + x);
			}
		}
		upwards = !upwards;
	}
	return Int32Array.from(out);
}

export function makeGeometry(
	grid: FunctionGrid,
	regions: readonly StyleableRegion[],
	startX: number,
): Geometry {
	const template = new BitMatrix(grid.width, grid.height, grid.dark);
	return Object.freeze({
		width: grid.width,
		height: grid.height,
		roles: grid.roles,
		regions: Object.freeze(regions.map((region) => Object.freeze({ ...region }))),
		template,
		order: zigzag(grid, startX),
	});
}

/**
 * The bit each data module carries for a block structure: codeword index * 8
 * plus the bit (7 the most significant), or -1 for a remainder module past the
 * last codeword.
 *
 * The one irregularity is the 4 bit codeword of M1 and M3. Only its high four
 * bits are placed, so the stream skips from bit 4 of that codeword straight
 * to bit 7 of the next, and every module after it maps to a different
 * codeword than plain eight bit counting would give. That depends on how many
 * data codewords the level has, which is why M3's mapping differs between L
 * and M while its roles do not.
 */
export function mapDataBits(geometry: Geometry, blocks: BlockLayout): Int32Array {
	const out = new Int32Array(geometry.width * geometry.height).fill(-1);
	const end = blocks.totalCodewords * 8;
	const skipAt = blocks.lastDataCodewordBits === 4 ? (dataCodewordCount(blocks) - 1) * 8 + 4 : -1;
	let k = 0;
	for (const module of geometry.order) {
		if (k === skipAt) k += 4;
		if (k < end) out[module] = (k >>> 3) * 8 + 7 - (k & 7);
		k += 1;
	}
	return out;
}

export function makeLayout(geometry: Geometry, dataBits: Int32Array): SymbolLayout {
	return Object.freeze({
		width: geometry.width,
		height: geometry.height,
		roles: geometry.roles,
		dataBits,
		regions: geometry.regions,
	});
}

/** The function patterns with every codeword bit placed, unmasked, format information still blank. */
export function placeCodewords(
	geometry: Geometry,
	layout: SymbolLayout,
	codewords: Uint8Array,
): BitMatrix {
	const matrix = geometry.template.clone();
	const { dataBits } = layout;
	for (const module of geometry.order) {
		const bit = dataBits[module] as number;
		if (bit >= 0 && (((codewords[bit >>> 3] as number) >>> (bit & 7)) & 1) === 1) {
			matrix.data[module] = 1;
		}
	}
	return matrix;
}

/** Whether a mask flips the module at column x, row y. */
export type MaskPredicate = (x: number, y: number) => boolean;

/** XOR a mask over the data region, remainder modules included, in place. */
export function applyMask(matrix: BitMatrix, geometry: Geometry, flips: MaskPredicate): void {
	const { width } = geometry;
	for (const module of geometry.order) {
		if (flips(module % width, Math.floor(module / width))) {
			matrix.data[module] = (matrix.data[module] as number) ^ 1;
		}
	}
}

export interface ReceivedStream {
	/** The codeword stream as placed, unmasked. */
	readonly codewords: Uint8Array;
	/** 1 for each codeword with at least one module the sampler flagged. */
	readonly erased: Uint8Array;
}

/** Undo the mask and gather the codeword stream, with the codewords any flagged module touches. */
export function readCodewordStream(
	matrix: BitMatrix,
	geometry: Geometry,
	layout: SymbolLayout,
	total: number,
	flips: MaskPredicate,
	erasures?: Uint8Array,
): ReceivedStream {
	const { width } = geometry;
	const codewords = new Uint8Array(total);
	const erased = new Uint8Array(total);
	const { dataBits } = layout;
	for (const module of geometry.order) {
		const bit = dataBits[module] as number;
		if (bit < 0) continue;
		const masked = flips(module % width, Math.floor(module / width)) ? 1 : 0;
		const value = (matrix.data[module] as number) ^ masked;
		const index = bit >>> 3;
		codewords[index] = (codewords[index] as number) | (value << (bit & 7));
		if (erasures !== undefined && erasures[module] !== 0) erased[index] = 1;
	}
	return { codewords, erased };
}
