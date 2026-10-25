/**
 * Seeded damage to a built symbol, by codeword or by module, for the reader
 * tests. Nothing here decides what a reader should do; it only breaks things
 * in known places.
 */

import { BitMatrix } from '../../../src/core/bit-matrix.js';
import type { BuiltSymbol } from '../../../src/symbology/types.js';
import { interleaveOrder } from '../../../src/symbology/qr/blocks.js';
import { qrGeometry } from '../../../src/symbology/qr/layout.js';
import type { Seeded } from '../../core/helpers.js';
import { distinctPositions } from '../../core/helpers.js';

/** The modules of each placed codeword, most significant bit first. */
export function codewordModules(version: number): number[][] {
	const { layout } = qrGeometry(version);
	const out: number[][] = [];
	for (let i = 0; i < layout.dataBits.length; i += 1) {
		const bit = layout.dataBits[i]!;
		if (bit < 0) continue;
		(out[bit >>> 3] ??= [])[7 - (bit & 7)] = i;
	}
	return out;
}

/** Interleaved positions of each block's codewords. */
export function blockPositions(symbol: BuiltSymbol): number[][] {
	const order = interleaveOrder(symbol.blocks);
	const out: number[][] = symbol.blocks.blocks.map(() => []);
	for (let i = 0; i < order.block.length; i += 1) out[order.block[i]!]!.push(i);
	return out;
}

/** XOR a nonzero value into each listed interleaved codeword. */
export function corrupt(
	symbol: BuiltSymbol,
	positions: readonly number[],
	random: Seeded,
): BitMatrix {
	const modules = codewordModules(Number(symbol.version));
	const data = Uint8Array.from(symbol.matrix.data);
	for (const position of positions) {
		const value = 1 + random.int(255);
		const cells = modules[position]!;
		for (let bit = 0; bit < 8; bit += 1) {
			if ((value >>> (7 - bit)) & 1) data[cells[bit]!] = data[cells[bit]!]! ^ 1;
		}
	}
	return new BitMatrix(symbol.matrix.width, symbol.matrix.height, data);
}

/** `count` codewords chosen in every block. */
export function perBlock(
	symbol: BuiltSymbol,
	count: (block: number) => number,
	random: Seeded,
): number[] {
	const out: number[] = [];
	blockPositions(symbol).forEach((positions, block) => {
		for (const k of distinctPositions(random, positions.length, count(block)))
			out.push(positions[k]!);
	});
	return out;
}

/** A module flag map marking every module of the listed codewords. */
export function erasureMap(symbol: BuiltSymbol, positions: readonly number[]): Uint8Array {
	const modules = codewordModules(Number(symbol.version));
	const flags = new Uint8Array(symbol.matrix.data.length);
	for (const position of positions) for (const cell of modules[position]!) flags[cell] = 1;
	return flags;
}

/** Flip modules at the given indexes. */
export function flip(matrix: BitMatrix, indexes: readonly number[]): BitMatrix {
	const data = Uint8Array.from(matrix.data);
	for (const index of indexes) data[index] = data[index]! ^ 1;
	return new BitMatrix(matrix.width, matrix.height, data);
}
