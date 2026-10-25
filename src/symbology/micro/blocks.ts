/**
 * Reed-Solomon blocks for the two small symbologies: their block layouts,
 * and the one check QR's block helpers have no reason to make.
 *
 * Splitting, check symbols, interleaving and correction are the QR layer's
 * `interleaveBlocks` and `decodeBlocks`, written over `BlockLayout` so that
 * all three symbologies share one implementation and one interleave order.
 * Micro QR always has one block; rMQR has up to six, in two groups whose
 * data counts differ by one, interleaved exactly as QR Model 2 interleaves.
 *
 * The 4 bit codeword. M1 and M3 end their data on half a codeword. Inside the
 * algebra it is a whole symbol whose low four bits are zero (BWIPP and
 * zxing-cpp both treat it that way, and the symbols they make agree with these
 * to the module), and only its high four bits are placed in the symbol. So it
 * travels in the high nibble, which is where the encoder's padded bitstream
 * puts it, and the 8 bit helpers serve it unchanged on the way in. On the way
 * out it needs `decodeCodewords`: a repair that sets the low nibble cannot be
 * what was written.
 */

import { RsDecodeError } from '../../core/index.js';
import { decodeBlocks } from '../qr/blocks.js';
import type { DecodedBlocks } from '../qr/blocks.js';
import type { BlockLayout } from '../types.js';

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

/**
 * De-interleave and correct, through `decodeBlocks`, then refuse a repair
 * that put bits into the half of a 4 bit codeword the symbol has no modules
 * for. Whatever Reed-Solomon corrected there, it was not this block.
 */
export function decodeCodewords(
	layout: BlockLayout,
	received: Uint8Array,
	erased?: Uint8Array,
): DecodedBlocks {
	const decoded = decodeBlocks(received, layout, erased);
	const { data } = decoded;
	if (layout.lastDataCodewordBits === 4 && ((data[data.length - 1] as number) & 0x0f) !== 0) {
		throw new RsDecodeError('no-solution');
	}
	return decoded;
}
