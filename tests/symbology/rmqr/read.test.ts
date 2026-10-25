/**
 * Reading rMQR back to its data codewords: round trips through interleaved
 * blocks, other encoders' symbols, damage within and past the bounds,
 * reflections, erasures and the refusals.
 */

import { describe, expect, it } from 'vitest';
import { BitMatrix, QrStudioError } from '../../../src/core/index.js';
import { dataCodewordCount } from '../../../src/symbology/micro/blocks.js';
import type { EcLevel } from '../../../src/segment/types.js';
import { buildRmqr, readRmqrCodewords } from '../../../src/symbology/rmqr/entry.js';
import { writeRmqrFormat } from '../../../src/symbology/rmqr/format.js';
import {
	rmqrFormatModulesNearFinder,
	rmqrFormatModulesNearSubFinder,
} from '../../../src/symbology/rmqr/layout.js';
import { rmqrBlocks, rmqrSpecs } from '../../../src/symbology/rmqr/tables.js';
import {
	bwipMatrix,
	corrupt,
	dataCodewords,
	maxChars,
	randomPayload,
	seeded,
} from '../micro/helpers.js';
import type { Seeded } from '../micro/helpers.js';
import { rmqrFields } from './fields.js';

function randomData(random: Seeded, version: string, ec: EcLevel): Uint8Array {
	return random.bytes(dataCodewordCount(rmqrBlocks(version, ec)));
}

function stage(call: () => unknown): string | undefined {
	try {
		call();
	} catch (error) {
		if (error instanceof QrStudioError) return `${error.code} ${String(error.params.stage)}`;
		throw error;
	}
	return undefined;
}

/** Stream positions of each block's codewords, for damaging a chosen block. */
function blockPositions(version: string, ec: EcLevel): number[][] {
	const { blocks } = rmqrBlocks(version, ec);
	const positions: number[][] = blocks.map(() => []);
	let next = 0;
	const longest = Math.max(...blocks.map((block) => block.dataCount));
	for (let i = 0; i < longest; i += 1) {
		blocks.forEach((block, b) => {
			if (i < block.dataCount) positions[b]!.push(next++);
		});
	}
	for (let i = 0; i < blocks[0]!.ecCount; i += 1) for (const at of positions) at.push(next++);
	return positions;
}

describe('reading rMQR', () => {
	it('round trips every size and level, strictly', () => {
		const random = seeded(0x40);
		for (const spec of rmqrSpecs()) {
			for (const level of spec.levels) {
				const data = randomData(random, spec.version, level.ecLevel);
				const built = buildRmqr(data, spec.version, level.ecLevel, 0);
				const read = readRmqrCodewords(built.matrix, { strict: true });
				expect([...read.data]).toEqual([...data]);
				expect([read.version, read.ecLevel, read.mask, read.formatErrors]).toEqual([
					spec.version,
					level.ecLevel,
					0,
					0,
				]);
				expect(read.errorsPerBlock).toEqual(level.blocks.blocks.map(() => 0));
				expect(read.capacityPerBlock).toEqual(
					level.blocks.blocks.map((block) => Math.floor(block.ecCount / 2)),
				);
			}
		}
	});

	it('reads what bwip-js writes', () => {
		const random = seeded(0x41);
		for (const spec of rmqrSpecs()) {
			const fields = rmqrFields(spec.indicator);
			for (const level of spec.levels) {
				const mode = (['numeric', 'alphanumeric', 'byte', 'kanji'] as const)[random.int(4)]!;
				const most = maxChars(mode, fields, level.blocks.dataBits);
				const payload = randomPayload(random, mode, 1 + random.int(most));
				const theirs = bwipMatrix({
					bcid: 'rectangularmicroqrcode',
					text: payload.text,
					version: spec.version,
					eclevel: level.ecLevel,
				});
				const read = readRmqrCodewords(theirs, { strict: true });
				expect([...read.data]).toEqual([
					...dataCodewords(payload, fields, dataCodewordCount(level.blocks), 8),
				]);
			}
		}
	});

	it('corrects up to capacity in every block at once, and refuses one more in any', () => {
		const random = seeded(0x42);
		for (const spec of rmqrSpecs()) {
			for (const level of spec.levels) {
				const data = randomData(random, spec.version, level.ecLevel);
				const built = buildRmqr(data, spec.version, level.ecLevel, 0);
				const positions = blockPositions(spec.version, level.ecLevel);
				const t = Math.floor(level.blocks.blocks[0]!.ecCount / 2);
				const delta = new Map<number, number>();
				for (const at of positions) {
					const shuffled = [...at];
					for (let i = shuffled.length - 1; i > 0; i -= 1) {
						const j = random.int(i + 1);
						[shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
					}
					for (const position of shuffled.slice(0, t)) delta.set(position, 1 + random.int(255));
				}
				const read = readRmqrCodewords(corrupt(built, delta), { strict: false });
				expect([...read.data]).toEqual([...data]);
				expect(read.errorsPerBlock).toEqual(positions.map(() => t));
				// One more error in a single block is past its reach.
				const victim = random.int(positions.length);
				const spare = positions[victim]!.find((position) => !delta.has(position))!;
				delta.set(spare, 0x5a);
				expect(stage(() => readRmqrCodewords(corrupt(built, delta), { strict: false }))).toBe(
					'decode/unreadable reed-solomon',
				);
			}
		}
	});

	it('repairs a block with erasures where errors alone would not do', () => {
		const random = seeded(0x43);
		const built = buildRmqr(randomData(random, 'R11x43', 'H'), 'R11x43', 'H', 0);
		const delta = new Map<number, number>();
		for (let position = 0; position < 20; position += 1) delta.set(position, 0xff);
		const damaged = corrupt(built, delta);
		const flags = new Uint8Array(43 * 11);
		built.layout.dataBits.forEach((bit, module) => {
			if (bit >= 0 && bit >>> 3 < 20) flags[module] = 1;
		});
		expect(stage(() => readRmqrCodewords(damaged, { strict: false }))).toBe(
			'decode/unreadable reed-solomon',
		);
		const read = readRmqrCodewords(damaged, { strict: false, erasures: flags });
		expect(read.erasuresUsed).toBe(20);
		expect([...read.data]).toEqual([...readRmqrCodewords(built.matrix, { strict: true }).data]);
		// More flagged than check symbols: the flags are dropped, not trusted.
		const everything = new Uint8Array(43 * 11).fill(1);
		expect(
			readRmqrCodewords(built.matrix, { strict: false, erasures: everything }).erasuresUsed,
		).toBe(0);
	});

	it('reads through damage to one format copy, leniently', () => {
		const random = seeded(0x44);
		const built = buildRmqr(randomData(random, 'R9x77', 'M'), 'R9x77', 'M', 0);
		const damaged = built.matrix.clone();
		for (const [x, y] of rmqrFormatModulesNearFinder().slice(0, 6)) damaged.xor(x, y);
		expect(stage(() => readRmqrCodewords(damaged, { strict: true }))).toBe(
			'decode/unreadable format',
		);
		const read = readRmqrCodewords(damaged, { strict: false });
		expect([read.version, read.ecLevel, read.formatErrors]).toEqual(['R9x77', 'M', 0]);
	});

	it('refuses a format that names another size', () => {
		const random = seeded(0x45);
		const built = buildRmqr(randomData(random, 'R9x77', 'M'), 'R9x77', 'M', 0);
		const lying = built.matrix.clone();
		writeRmqrFormat(
			lying,
			[rmqrFormatModulesNearFinder(), rmqrFormatModulesNearSubFinder(77, 9)],
			3,
		);
		expect(stage(() => readRmqrCodewords(lying, { strict: false }))).toBe(
			'decode/unreadable version',
		);
	});

	it('reads a symbol flipped left to right leniently, and says so', () => {
		const random = seeded(0x46);
		for (const spec of rmqrSpecs().filter((_, i) => i % 5 === 0)) {
			const data = randomData(random, spec.version, 'H');
			const flipped = buildRmqr(data, spec.version, 'H', 'auto').matrix.mirrored();
			const read = readRmqrCodewords(flipped, { strict: false });
			expect([...read.data]).toEqual([...data]);
			expect(read.mirrored).toBe(true);
			expect(stage(() => readRmqrCodewords(flipped, { strict: true }))).toMatch(
				/^decode\/unreadable/,
			);
			const flags = new Uint8Array(spec.width * spec.height);
			expect(readRmqrCodewords(flipped, { strict: false, erasures: flags }).mirrored).toBe(true);
		}
	});

	it('refuses a grid that is not one of the 32 sizes', () => {
		for (const [width, height] of [
			[43, 8],
			[7, 43],
			[44, 7],
			[11, 11],
		] as const) {
			expect(stage(() => readRmqrCodewords(new BitMatrix(width, height), { strict: false }))).toBe(
				'decode/unreadable version',
			);
		}
	});

	it('throws TypeError for a caller mistake', () => {
		const matrix = buildRmqr(new Uint8Array(6), 'R7x43', 'M', 0).matrix;
		expect(() => readRmqrCodewords('grid' as unknown as BitMatrix, { strict: true })).toThrow(
			TypeError,
		);
		expect(() => readRmqrCodewords(matrix, { strict: true, erasures: new Uint8Array(1) })).toThrow(
			TypeError,
		);
	});
});

describe('building rMQR', () => {
	it('refuses codewords that do not fit, levels it lacks and masks it lacks', () => {
		expect(() => buildRmqr(new Uint8Array(5), 'R7x43', 'M', 0)).toThrow(TypeError);
		expect(() => buildRmqr([] as unknown as Uint8Array, 'R7x43', 'M', 0)).toThrow(TypeError);
		expect(() => buildRmqr(new Uint8Array(6), 'R7x43', 'L', 0)).toThrow(TypeError);
		expect(() => buildRmqr(new Uint8Array(6), 'R7x43', 'M', 1)).toThrow(TypeError);
		expect(() => buildRmqr(new Uint8Array(6), 'R6x43', 'M', 0)).toThrow(TypeError);
	});

	it('interleaves the blocks of a multi-block level', () => {
		// R17x139-H: two blocks of 12 data codewords and four of 13.
		const data = Uint8Array.from({ length: 76 }, (_, i) => i);
		const built = buildRmqr(data, 'R17x139', 'H', 0);
		expect([...built.codewords.subarray(0, 8)]).toEqual([0, 12, 24, 37, 50, 63, 1, 13]);
		// The longer blocks' last data codewords come after every block's 12th.
		expect([...built.codewords.subarray(72, 76)]).toEqual([36, 49, 62, 75]);
		expect(built.codewords).toHaveLength(232);
		expect([built.symbology, built.mask]).toEqual(['rmqr', 0]);
	});
});
