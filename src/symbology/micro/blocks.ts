/**
 * Reed-Solomon blocks for the QR family: splitting data codewords into
 * blocks, adding check symbols, interleaving, and the reverse with
 * correction.
 *
 * Micro QR always has one block; rMQR has up to six, in two groups whose data
 * counts differ by one, interleaved the same way QR Model 2 interleaves: the
 * first data codeword of every block, then the second of every block, and so
 * on, short blocks dropping out of the last round, then the check symbols in
 * the same order. One implementation for both, in the module rMQR already
 * imports, so that the order cannot drift between them.
 *
 * The 4 bit codeword. M1 and M3 end their data on half a codeword. Inside the
 * algebra it is a whole symbol whose low four bits are zero (BWIPP and
 * zxing-cpp both treat it that way, and the symbols they make agree with these
 * to the module), and only its high four bits are placed in the symbol. So the
 * bytes handed in and out here carry it in the high nibble, which is also
 * where a BitBuffer padded to a whole byte puts it.
 */

import { QR_FIELD, RsDecodeError, rsDecode, rsEncode } from '../../core/index.js';
import type { RsCode } from '../../core/index.js';
import type { BlockLayout } from './contract-types.js';

/** Block sizes in the order the specification lists them, shorter blocks first. */
export function makeBlockLayout(
	groups: readonly { readonly count: number; readonly dataCount: number }[],
	ecCount: number,
	p: number,
	lastDataCodewordBits: 8 | 4,
): BlockLayout {
	const blocks: { readonly dataCount: number; readonly ecCount: number }[] = [];
	for (const group of groups) {
		for (let i = 0; i < group.count; i += 1) {
			blocks.push(Object.freeze({ dataCount: group.dataCount, ecCount }));
		}
	}
	let total = 0;
	let data = 0;
	for (const block of blocks) {
		total += block.dataCount + block.ecCount;
		data += block.dataCount;
	}
	return Object.freeze({
		blocks: Object.freeze(blocks),
		totalCodewords: total,
		p,
		lastDataCodewordBits,
		dataBits: data * 8 - (lastDataCodewordBits === 4 ? 4 : 0),
	});
}

export function dataCodewordCount(layout: BlockLayout): number {
	let count = 0;
	for (const block of layout.blocks) count += block.dataCount;
	return count;
}

/** Errors a block may have corrected: floor((ec - p) / 2), the contract's capacity. */
export function blockCapacity(layout: BlockLayout, ecCount: number): number {
	return Math.max(0, Math.floor((ecCount - layout.p) / 2));
}

function rsCode(ecCount: number): RsCode {
	return { field: QR_FIELD, ecCount, firstRoot: 0 };
}

/**
 * Where each block's codewords sit in the interleaved stream: `positions[b][i]`
 * is the stream index of codeword i of block b, data first, then check
 * symbols.
 */
function interleavedPositions(layout: BlockLayout): number[][] {
	const { blocks } = layout;
	const positions: number[][] = blocks.map(() => []);
	let next = 0;
	let longest = 0;
	for (const block of blocks) longest = Math.max(longest, block.dataCount);
	for (let i = 0; i < longest; i += 1) {
		blocks.forEach((block, b) => {
			if (i >= block.dataCount) return;
			(positions[b] as number[]).push(next);
			next += 1;
		});
	}
	// Every block in a symbol has the same number of check symbols.
	const ecCount = (blocks[0] as { ecCount: number }).ecCount;
	for (let i = 0; i < ecCount; i += 1) {
		for (const at of positions) {
			at.push(next);
			next += 1;
		}
	}
	return positions;
}

/**
 * The full interleaved codeword stream for some data codewords: data, check
 * symbols, interleaved. `data` is in block order (block 0's codewords, then
 * block 1's), which is the order a bitstream fills them.
 */
export function encodeCodewords(layout: BlockLayout, data: Uint8Array): Uint8Array {
	const positions = interleavedPositions(layout);
	const out = new Uint8Array(layout.totalCodewords);
	let offset = 0;
	layout.blocks.forEach((block, b) => {
		const slice = data.subarray(offset, offset + block.dataCount);
		offset += block.dataCount;
		const check = rsEncode(rsCode(block.ecCount), slice);
		const at = positions[b] as number[];
		for (let i = 0; i < block.dataCount; i += 1) out[at[i] as number] = slice[i] as number;
		for (let i = 0; i < block.ecCount; i += 1) {
			out[at[block.dataCount + i] as number] = check[i] as number;
		}
	});
	return out;
}

export interface CorrectedCodewords {
	/** Data codewords in block order, corrected. */
	readonly data: Uint8Array;
	readonly errorsPerBlock: readonly number[];
	readonly capacityPerBlock: readonly number[];
	readonly erasuresUsed: number;
}

/**
 * De-interleave and correct. `erased[i]` nonzero marks stream codeword i as
 * unreliable (a module of it sampled with low confidence).
 *
 * Erasures are honoured only while they leave the misdecode margin intact:
 * a block uses them when it has at most ec - p, and then corrects at most
 * floor((ec - p - f) / 2) errors besides, so 2e + f never passes ec - p. A
 * block flagged past that is decoded as if nothing were flagged, because the
 * flags are a hint from the sampler, and a hint that would spend the margin
 * is worth less than the margin.
 */
export function correctCodewords(
	layout: BlockLayout,
	received: Uint8Array,
	erased?: Uint8Array,
): CorrectedCodewords {
	const positions = interleavedPositions(layout);
	const data = new Uint8Array(dataCodewordCount(layout));
	const errorsPerBlock: number[] = [];
	const capacityPerBlock: number[] = [];
	let erasuresUsed = 0;
	let offset = 0;
	layout.blocks.forEach((block, b) => {
		const at = positions[b] as number[];
		const values = at.map((position) => received[position] as number);
		const budget = block.ecCount - layout.p;
		let flagged: number[] = [];
		if (erased !== undefined) {
			at.forEach((position, i) => {
				if (erased[position] !== 0) flagged.push(i);
			});
			if (flagged.length > budget) flagged = [];
		}
		const capacity = blockCapacity(layout, block.ecCount);
		const corrected = rsDecode(rsCode(block.ecCount), values, {
			erasures: flagged,
			maxErrors: Math.floor((budget - flagged.length) / 2),
		});
		errorsPerBlock.push(corrected.errors);
		capacityPerBlock.push(capacity);
		erasuresUsed += corrected.erasures;
		for (let i = 0; i < block.dataCount; i += 1)
			data[offset + i] = corrected.codewords[i] as number;
		offset += block.dataCount;
	});
	// A repair that put bits into the half of the 4 bit codeword the symbol has
	// no modules for cannot be the codeword that was written: whatever was
	// corrected, it was not this block.
	if (layout.lastDataCodewordBits === 4 && ((data[data.length - 1] as number) & 0x0f) !== 0) {
		throw new RsDecodeError('no-solution');
	}
	return {
		data,
		errorsPerBlock: Object.freeze(errorsPerBlock),
		capacityPerBlock: Object.freeze(capacityPerBlock),
		erasuresUsed,
	};
}
