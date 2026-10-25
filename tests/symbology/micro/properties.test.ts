/**
 * Properties of Micro QR reading, by fast-check: any damage within the
 * bounds reads back exactly.
 *
 * - Up to t = floor((ec - p) / 2) codewords per block changed to any other
 *   value, the 4 bit codeword included, still read leniently to the data
 *   that was built.
 * - Up to three format bits flipped still read leniently, and one strictly,
 *   with the count reported.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { buildMicro, readMicroCodewords } from '../../../src/symbology/micro/entry.js';
import { MICRO_FORMAT_MODULES } from '../../../src/symbology/micro/layout.js';
import { MICRO_VERSIONS, microBlocks, microSpec } from '../../../src/symbology/micro/tables.js';
import { corrupt } from './helpers.js';

const LEVELS = MICRO_VERSIONS.flatMap((version) =>
	microSpec(version).levels.map((level) => ({ version, ec: level.ecLevel })),
);

const symbolArbitrary = fc
	.record({
		level: fc.constantFrom(...LEVELS),
		seedBytes: fc.uint8Array({ minLength: 16, maxLength: 16 }),
		mask: fc.constantFrom<number | 'auto'>(0, 1, 2, 3, 'auto'),
	})
	.map(({ level, seedBytes, mask }) => {
		const blocks = microBlocks(level.version, level.ec);
		const data = seedBytes.slice(0, blocks.blocks[0]!.dataCount);
		if (blocks.lastDataCodewordBits === 4) data[data.length - 1]! &= 0xf0;
		return buildMicro(data, level.version, level.ec, mask);
	});

describe('Micro QR reading, as properties', () => {
	it('reads through up to t damaged codewords', () => {
		fc.assert(
			fc.property(
				symbolArbitrary.chain((built) => {
					const block = built.blocks.blocks[0]!;
					const t = Math.floor((block.ecCount - built.blocks.p) / 2);
					const short = built.blocks.lastDataCodewordBits === 4 ? block.dataCount - 1 : -1;
					return fc.tuple(
						fc.constant(built),
						fc.uniqueArray(fc.integer({ min: 0, max: built.blocks.totalCodewords - 1 }), {
							maxLength: t,
						}),
						fc.array(fc.integer({ min: 1, max: 255 }), { minLength: t, maxLength: t }),
						fc.constant(short),
					);
				}),
				([built, positions, values, short]) => {
					const delta = new Map<number, number>();
					positions.forEach((position, i) => {
						// The 4 bit codeword has only its high nibble in the symbol.
						let value = values[i] as number;
						if (position === short) value = value & 0xf0 || 0x10;
						delta.set(position, value);
					});
					const read = readMicroCodewords(corrupt(built, delta), { strict: false });
					expect([...read.data]).toEqual([...built.codewords.subarray(0, read.data.length)]);
					expect(read.errorsPerBlock).toEqual([positions.length]);
				},
			),
			{ numRuns: 300, seed: 0x5eed },
		);
	});

	it('reads through format damage within the bound', () => {
		fc.assert(
			fc.property(
				symbolArbitrary,
				fc.uniqueArray(fc.integer({ min: 0, max: 14 }), { maxLength: 3 }),
				(built, bits) => {
					const damaged = built.matrix.clone();
					for (const bit of bits) {
						const [x, y] = MICRO_FORMAT_MODULES[bit]!;
						damaged.xor(x, y);
					}
					const lenient = readMicroCodewords(damaged, { strict: false });
					expect([lenient.version, lenient.ecLevel, lenient.mask]).toEqual([
						built.version,
						built.ecLevel,
						built.mask,
					]);
					expect(lenient.formatErrors).toBe(bits.length);
					if (bits.length <= 1) {
						expect(readMicroCodewords(damaged, { strict: true }).formatErrors).toBe(bits.length);
					}
				},
			),
			{ numRuns: 300, seed: 0xf0a7 },
		);
	});
});
