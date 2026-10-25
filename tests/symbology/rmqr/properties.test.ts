/**
 * Properties of rMQR reading, by fast-check: up to t damaged codewords in
 * every block at once read back exactly, and so does format damage within
 * the bound in either copy.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { dataCodewordCount } from '../../../src/symbology/micro/blocks.js';
import { buildRmqr, readRmqrCodewords } from '../../../src/symbology/rmqr/entry.js';
import {
	rmqrFormatModulesNearFinder,
	rmqrFormatModulesNearSubFinder,
} from '../../../src/symbology/rmqr/layout.js';
import { rmqrSpecs } from '../../../src/symbology/rmqr/tables.js';
import { corrupt } from '../micro/helpers.js';

const LEVELS = rmqrSpecs().flatMap((spec) =>
	spec.levels.map((level) => ({ version: spec.version, ec: level.ecLevel, blocks: level.blocks })),
);

const symbolArbitrary = fc
	.record({
		level: fc.constantFrom(...LEVELS),
		seed: fc.uint8Array({ minLength: 200, maxLength: 200 }),
	})
	.map(({ level, seed }) => {
		const data = seed.slice(0, dataCodewordCount(level.blocks));
		return { data, built: buildRmqr(data, level.version, level.ec, 0) };
	});

/** Stream positions of each block's codewords, in the interleaved order. */
function streamPositions(dataCounts: readonly number[], ecCount: number): number[][] {
	const positions: number[][] = dataCounts.map(() => []);
	let next = 0;
	for (let i = 0; i < Math.max(...dataCounts); i += 1) {
		dataCounts.forEach((count, b) => {
			if (i < count) positions[b]!.push(next++);
		});
	}
	for (let i = 0; i < ecCount; i += 1) for (const at of positions) at.push(next++);
	return positions;
}

describe('rMQR reading, as properties', () => {
	it('reads through up to t damaged codewords in every block', () => {
		fc.assert(
			fc.property(
				symbolArbitrary,
				fc.array(fc.tuple(fc.nat(), fc.integer({ min: 1, max: 255 })), { maxLength: 400 }),
				({ data, built }, picks) => {
					const { blocks } = built.blocks;
					const t = Math.floor(blocks[0]!.ecCount / 2);
					const positions = streamPositions(
						blocks.map((block) => block.dataCount),
						blocks[0]!.ecCount,
					);
					const delta = new Map<number, number>();
					const perBlock = positions.map(() => 0);
					for (const [pick, value] of picks) {
						const b = pick % positions.length;
						const at = positions[b]!;
						const position = at[Math.floor(pick / positions.length) % at.length]!;
						if (delta.has(position) || perBlock[b]! >= t) continue;
						delta.set(position, value);
						perBlock[b]! += 1;
					}
					const read = readRmqrCodewords(corrupt(built, delta), { strict: false });
					expect([...read.data]).toEqual([...data]);
					expect(read.errorsPerBlock).toEqual(perBlock);
				},
			),
			{ numRuns: 200, seed: 0x7a11 },
		);
	});

	it('reads through format damage within the bound in either copy', () => {
		fc.assert(
			fc.property(
				symbolArbitrary,
				fc.uniqueArray(fc.integer({ min: 0, max: 17 }), { maxLength: 3 }),
				fc.uniqueArray(fc.integer({ min: 0, max: 17 }), { maxLength: 3 }),
				({ built }, first, second) => {
					const damaged = built.matrix.clone();
					const { width, height } = damaged;
					const near = rmqrFormatModulesNearFinder();
					const far = rmqrFormatModulesNearSubFinder(width, height);
					for (const bit of first) damaged.xor(...near[bit]!);
					for (const bit of second) damaged.xor(...far[bit]!);
					const lenient = readRmqrCodewords(damaged, { strict: false });
					expect([lenient.version, lenient.ecLevel]).toEqual([built.version, built.ecLevel]);
					expect(lenient.formatErrors).toBe(Math.min(first.length, second.length));
					if (first.length <= 1 && second.length <= 1) {
						const strict = readRmqrCodewords(damaged, { strict: true });
						expect(strict.formatErrors).toBe(Math.max(first.length, second.length));
					}
				},
			),
			{ numRuns: 300, seed: 0xf0a8 },
		);
	});
});
