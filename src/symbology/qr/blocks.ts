/**
 * Reed-Solomon blocks: splitting data into blocks, adding check codewords,
 * interleaving, and the reverse.
 *
 * Interleaving is what lets a code survive a smudge. Consecutive codewords in
 * the symbol belong to different blocks, so damage that would overwhelm one
 * block is spread thinly over all of them. The writer takes the first data
 * codeword of every block, then the second, skipping blocks that have run out
 * (group 1's blocks are one codeword shorter than group 2's), then the check
 * codewords the same way.
 *
 * Written over `BlockLayout` rather than QR's tables, so the same functions
 * serve rMQR (several blocks, same field, same interleave) and Micro QR (one
 * block). Reed-Solomon itself is core's, over GF(2^8) with polynomial 0x11D
 * and first root 0, which all three symbologies share.
 */

import { QR_FIELD } from '../../core/field.js';
import type { RsCode } from '../../core/reed-solomon.js';
import { rsDecode, rsEncode } from '../../core/reed-solomon.js';
import type { EcLevel } from '../../segment/types.js';
import type { BlockLayout } from '../types.js';
import { TOTAL_CODEWORDS, ecRow, misdecodeProtection } from './tables.js';

function code(ecCount: number): RsCode {
	return { field: QR_FIELD, ecCount, firstRoot: 0 };
}

let qrCache: Map<string, BlockLayout> | undefined;

/** The block structure of a QR version and level. Cached; frozen. */
export function qrBlocks(version: number, level: EcLevel): BlockLayout {
	const key = `${version}${level}`;
	qrCache ??= new Map();
	let found = qrCache.get(key);
	if (found === undefined) {
		const row = ecRow(version, level);
		const blocks = [
			...Array.from({ length: row.group1Blocks }, () => ({
				dataCount: row.group1Data,
				ecCount: row.ecPerBlock,
			})),
			...Array.from({ length: row.group2Blocks }, () => ({
				dataCount: row.group2Data,
				ecCount: row.ecPerBlock,
			})),
		].map((block) => Object.freeze(block));
		const dataCodewords = blocks.reduce((sum, block) => sum + block.dataCount, 0);
		found = Object.freeze({
			blocks: Object.freeze(blocks),
			totalCodewords: TOTAL_CODEWORDS[version - 1] as number,
			p: misdecodeProtection(version, level),
			lastDataCodewordBits: 8,
			dataBits: dataCodewords * 8,
		});
		qrCache.set(key, found);
	}
	return found;
}

/** Errors a block may correct: floor((ec - p) / 2). */
export function blockCapacity(ecCount: number, p: number): number {
	return Math.floor((ecCount - p) / 2);
}

interface Order {
	readonly block: Int32Array;
	readonly offset: Int32Array;
}

let orders: WeakMap<BlockLayout, Order> | undefined;

/**
 * For each position in the interleaved sequence, the block it belongs to and
 * its position within that block (data codewords first, then check codewords).
 * Cached per layout object.
 */
export function interleaveOrder(layout: BlockLayout): Order {
	orders ??= new WeakMap();
	const cached = orders.get(layout);
	if (cached !== undefined) return cached;
	const total = layout.blocks.reduce((sum, b) => sum + b.dataCount + b.ecCount, 0);
	const block = new Int32Array(total);
	const offset = new Int32Array(total);
	let at = 0;
	const sweep = (
		count: (b: { dataCount: number; ecCount: number }) => number,
		base: (b: { dataCount: number }) => number,
	): void => {
		const longest = Math.max(...layout.blocks.map(count));
		for (let i = 0; i < longest; i += 1) {
			layout.blocks.forEach((b, index) => {
				if (i >= count(b)) return;
				block[at] = index;
				offset[at] = base(b) + i;
				at += 1;
			});
		}
	};
	sweep(
		(b) => b.dataCount,
		() => 0,
	);
	sweep(
		(b) => b.ecCount,
		(b) => b.dataCount,
	);
	const order = Object.freeze({ block, offset });
	orders.set(layout, order);
	return order;
}

/** Split data into blocks, add each block's check codewords, and interleave. */
export function interleaveBlocks(data: Uint8Array, layout: BlockLayout): Uint8Array {
	const dataCount = layout.blocks.reduce((sum, b) => sum + b.dataCount, 0);
	if (data.length !== dataCount) {
		throw new RangeError(`this block layout takes ${dataCount} data codewords, not ${data.length}`);
	}
	const blocks: Uint8Array[] = [];
	let start = 0;
	for (const b of layout.blocks) {
		const block = new Uint8Array(b.dataCount + b.ecCount);
		const slice = data.subarray(start, start + b.dataCount);
		block.set(slice);
		block.set(rsEncode(code(b.ecCount), slice), b.dataCount);
		blocks.push(block);
		start += b.dataCount;
	}
	const order = interleaveOrder(layout);
	const out = new Uint8Array(order.block.length);
	for (let i = 0; i < out.length; i += 1) {
		out[i] = (blocks[order.block[i] as number] as Uint8Array)[order.offset[i] as number] as number;
	}
	return out;
}

export interface DecodedBlocks {
	/** The data codewords, corrected, in their original order. */
	readonly data: Uint8Array;
	readonly errorsPerBlock: readonly number[];
	readonly capacityPerBlock: readonly number[];
	readonly erasuresUsed: number;
}

/**
 * De-interleave and correct every block.
 *
 * Each block may correct floor((ec - p) / 2) errors and no more, however many
 * the algebra could reach: past that the protection the smallest symbols keep
 * back is spent, and a block that comes out "corrected" may be a different
 * valid block. Erasures (`erased`, one flag per interleaved position) are
 * used when a block has no more than ec - p of them, and then cap errors at
 * floor((ec - p - f) / 2), the same budget ISO/IEC 18004 7.5.2 sets
 * (e + 2t <= d - p). An erasure is a hint, not a fact: a logo can cover a
 * codeword whose modules happen to be right, and an erasure list can come
 * from a guess. So when a block will not decode with its erasures, it is
 * tried once more without them before it is given up on.
 */
export function decodeBlocks(
	codewords: Uint8Array,
	layout: BlockLayout,
	erased?: Uint8Array,
): DecodedBlocks {
	const order = interleaveOrder(layout);
	if (codewords.length !== order.block.length) {
		throw new RangeError(
			`this block layout has ${order.block.length} codewords, not ${codewords.length}`,
		);
	}
	const blocks = layout.blocks.map((b) => new Uint8Array(b.dataCount + b.ecCount));
	const erasures = layout.blocks.map((): number[] => []);
	for (let i = 0; i < codewords.length; i += 1) {
		const index = order.block[i] as number;
		const offset = order.offset[i] as number;
		(blocks[index] as Uint8Array)[offset] = codewords[i] as number;
		if (erased !== undefined && erased[i] !== 0) (erasures[index] as number[]).push(offset);
	}
	const errorsPerBlock: number[] = [];
	const capacityPerBlock: number[] = [];
	const data: number[] = [];
	let erasuresUsed = 0;
	layout.blocks.forEach((b, index) => {
		const received = blocks[index] as Uint8Array;
		const flagged = (erasures[index] as number[]).sort((x, y) => x - y);
		const budget = b.ecCount - layout.p;
		const rs = code(b.ecCount);
		let decoded;
		if (flagged.length > 0 && flagged.length <= budget) {
			try {
				decoded = rsDecode(rs, received, {
					erasures: flagged,
					maxErrors: Math.floor((budget - flagged.length) / 2),
				});
			} catch {
				// Refused with the erasures: try once more on errors alone, below.
			}
		}
		decoded ??= rsDecode(rs, received, { maxErrors: blockCapacity(b.ecCount, layout.p) });
		errorsPerBlock.push(decoded.errors);
		capacityPerBlock.push(blockCapacity(b.ecCount, layout.p));
		erasuresUsed += decoded.erasures;
		for (let i = 0; i < b.dataCount; i += 1) data.push(decoded.codewords[i] as number);
	});
	return {
		data: Uint8Array.from(data),
		errorsPerBlock: Object.freeze(errorsPerBlock),
		capacityPerBlock: Object.freeze(capacityPerBlock),
		erasuresUsed,
	};
}
