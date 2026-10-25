/**
 * Reading Micro QR back to its data codewords: round trips, other encoders'
 * symbols, damage within and past the bounds, reflections, erasures, and the
 * refusals.
 */

import { describe, expect, it } from 'vitest';
import { BitMatrix, QrStudioError } from '../../../src/core/index.js';
import { decodeCodewords } from '../../../src/symbology/micro/blocks.js';
import { interleaveBlocks } from '../../../src/symbology/qr/blocks.js';
import type { EcLevel } from '../../../src/segment/types.js';
import { buildMicro, readMicroCodewords } from '../../../src/symbology/micro/entry.js';
import { microFormatWord, writeMicroFormat } from '../../../src/symbology/micro/format.js';
import { readEitherWay } from '../../../src/symbology/micro/read-helpers.js';
import { MICRO_VERSIONS, microBlocks, microSpec } from '../../../src/symbology/micro/tables.js';
import { MICRO_FIELDS } from './fields.js';
import { bwipMatrix, dataCodewords, maxChars, randomPayload, seeded } from './helpers.js';
import type { Seeded } from './helpers.js';

function randomData(random: Seeded, version: string, ec: EcLevel): Uint8Array {
	const blocks = microBlocks(version, ec);
	const data = random.bytes(blocks.blocks[0]!.dataCount);
	if (blocks.lastDataCodewordBits === 4) data[data.length - 1]! &= 0xf0;
	return data;
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

/** Flip every module of codeword `index` in a built symbol. */
function damageCodeword(matrix: BitMatrix, dataBits: Int32Array, index: number): void {
	dataBits.forEach((bit, module) => {
		if (bit >= 0 && bit >>> 3 === index) matrix.data[module] = (matrix.data[module] as number) ^ 1;
	});
}

const LEVELS = MICRO_VERSIONS.flatMap((version) =>
	microSpec(version).levels.map((level) => ({ version, ec: level.ecLevel })),
);

describe('reading Micro QR', () => {
	it('round trips every version, level and mask, strictly', () => {
		const random = seeded(0x20);
		for (const { version, ec } of LEVELS) {
			for (const mask of [0, 1, 2, 3]) {
				const data = randomData(random, version, ec);
				const read = readMicroCodewords(buildMicro(data, version, ec, mask).matrix, {
					strict: true,
				});
				expect([...read.data]).toEqual([...data]);
				expect([read.version, read.ecLevel, read.mask]).toEqual([version, ec, mask]);
				expect(read.errorsPerBlock).toEqual([0]);
				expect([read.erasuresUsed, read.formatErrors, read.mirrored]).toEqual([0, 0, false]);
			}
		}
	});

	it('reads what bwip-js writes', () => {
		const random = seeded(0x21);
		for (const { version, ec } of LEVELS) {
			const spec = microSpec(version);
			const fields = MICRO_FIELDS[version];
			const blocks = microBlocks(version, ec);
			for (const mode of spec.modes) {
				const payload = randomPayload(
					random,
					mode,
					1 + random.int(maxChars(mode, fields, blocks.dataBits)),
				);
				const theirs = bwipMatrix({
					bcid: 'microqrcode',
					text: payload.text,
					version,
					eclevel: ec,
				});
				const read = readMicroCodewords(theirs, { strict: true });
				const expected = dataCodewords(
					payload,
					fields,
					blocks.blocks[0]!.dataCount,
					spec.lastDataCodewordBits,
				);
				expect([...read.data]).toEqual([...expected]);
				expect(read.ecLevel).toBe(ec);
			}
		}
	});

	it('reports capacity as floor((ec - p) / 2), with M1 detection only', () => {
		const random = seeded(0x22);
		const capacities = LEVELS.map(
			({ version, ec }) =>
				readMicroCodewords(buildMicro(randomData(random, version, ec), version, ec, 0).matrix, {
					strict: false,
				}).capacityPerBlock[0],
		);
		expect(capacities).toEqual([0, 1, 2, 2, 4, 3, 5, 7]);
	});

	it('corrects up to capacity and refuses one more', () => {
		const random = seeded(0x23);
		for (const { version, ec } of LEVELS) {
			const built = buildMicro(randomData(random, version, ec), version, ec, 'auto');
			const blocks = built.blocks;
			const capacity = Math.floor((blocks.blocks[0]!.ecCount - blocks.p) / 2);
			// Whole codewords from the data and check region, never the 4 bit one.
			const short = blocks.lastDataCodewordBits === 4 ? blocks.blocks[0]!.dataCount - 1 : -1;
			const candidates = Array.from({ length: blocks.totalCodewords }, (_, i) => i).filter(
				(i) => i !== short,
			);
			for (let i = candidates.length - 1; i > 0; i -= 1) {
				const j = random.int(i + 1);
				[candidates[i], candidates[j]] = [candidates[j]!, candidates[i]!];
			}
			const within = built.matrix.clone();
			for (const index of candidates.slice(0, capacity))
				damageCodeword(within, built.layout.dataBits, index);
			const read = readMicroCodewords(within, { strict: false });
			expect([...read.data]).toEqual([...readMicroCodewords(built.matrix, { strict: true }).data]);
			expect(read.errorsPerBlock).toEqual([capacity]);
			const past = within.clone();
			damageCodeword(past, built.layout.dataBits, candidates[capacity]!);
			expect(stage(() => readMicroCodewords(past, { strict: false }))).toBe(
				'decode/unreadable reed-solomon',
			);
		}
	});

	it('uses erasures to repair twice as much, but never past the misdecode margin', () => {
		const random = seeded(0x24);
		const built = buildMicro(randomData(random, 'M4', 'M'), 'M4', 'M', 2);
		const flags = new Uint8Array(17 * 17);
		const damaged = built.matrix.clone();
		// Ten check symbols and p = 0: ten erasures, where only five errors would do.
		for (let index = 0; index < 10; index += 1) {
			damageCodeword(damaged, built.layout.dataBits, index);
			built.layout.dataBits.forEach((bit, module) => {
				if (bit >>> 3 === index && bit >= 0) flags[module] = 1;
			});
		}
		expect(stage(() => readMicroCodewords(damaged, { strict: false }))).toBe(
			'decode/unreadable reed-solomon',
		);
		const read = readMicroCodewords(damaged, { strict: false, erasures: flags });
		expect([...read.data]).toEqual([...readMicroCodewords(built.matrix, { strict: true }).data]);
		expect([read.erasuresUsed, read.errorsPerBlock[0]]).toEqual([10, 0]);
		// A strict read is the scan check's and takes no erasures.
		expect(stage(() => readMicroCodewords(damaged, { strict: true, erasures: flags }))).toBe(
			'decode/unreadable reed-solomon',
		);
		// M1 keeps both check symbols for detection, so erasures are not spent there.
		const m1 = buildMicro(Uint8Array.from([0x12, 0x34, 0x50]), 'M1', 'L', 0);
		const m1Flags = new Uint8Array(121).fill(1);
		expect(readMicroCodewords(m1.matrix, { strict: false, erasures: m1Flags }).erasuresUsed).toBe(
			0,
		);
	});

	it('detects damage to M1 rather than repairing it', () => {
		const built = buildMicro(Uint8Array.from([0x12, 0x34, 0x50]), 'M1', 'L', 1);
		const damaged = built.matrix.clone();
		damageCodeword(damaged, built.layout.dataBits, 0);
		expect(stage(() => readMicroCodewords(damaged, { strict: false }))).toBe(
			'decode/unreadable reed-solomon',
		);
	});

	it('refuses a repair that reaches into the missing half of the 4 bit codeword', () => {
		const blocks = microBlocks('M3', 'L');
		const data = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 0x0b]);
		// A valid block, but only because its last data codeword has low bits
		// no Micro QR symbol can carry.
		expect(() => decodeCodewords(blocks, interleaveBlocks(data, blocks))).toThrow(QrStudioError);
	});

	it('trusts three bits of format damage leniently and one strictly', () => {
		const random = seeded(0x25);
		const built = buildMicro(randomData(random, 'M3', 'M'), 'M3', 'M', 3);
		const once = built.matrix.clone();
		once.xor(1, 8);
		expect(readMicroCodewords(once, { strict: true }).formatErrors).toBe(1);
		const thrice = once.clone();
		thrice.xor(8, 1);
		thrice.xor(8, 4);
		expect(stage(() => readMicroCodewords(thrice, { strict: true }))).toBe(
			'decode/unreadable format',
		);
		expect(readMicroCodewords(thrice, { strict: false }).formatErrors).toBe(3);
	});

	it('refuses a format that names another version', () => {
		const built = buildMicro(Uint8Array.from([1, 2, 3, 4, 5]), 'M2', 'L', 0);
		const lying = built.matrix.clone();
		writeMicroFormat(lying, microFormatWord(5, 0));
		expect(stage(() => readMicroCodewords(lying, { strict: false }))).toBe(
			'decode/unreadable version',
		);
	});

	it('reads a reflection leniently and says so, and never strictly', () => {
		const random = seeded(0x26);
		for (const { version, ec } of LEVELS) {
			const data = randomData(random, version, ec);
			const reflected = buildMicro(data, version, ec, 'auto').matrix.mirrored();
			const read = readMicroCodewords(reflected, { strict: false });
			expect([...read.data]).toEqual([...data]);
			expect(read.mirrored).toBe(true);
			expect(stage(() => readMicroCodewords(reflected, { strict: true }))).toMatch(
				/^decode\/unreadable/,
			);
		}
	});

	it('mirrors the erasure map with the matrix', () => {
		const random = seeded(0x27);
		const built = buildMicro(randomData(random, 'M4', 'Q'), 'M4', 'Q', 0);
		const damaged = built.matrix.clone();
		const flags = new Uint8Array(17 * 17);
		for (let index = 0; index < 14; index += 1) {
			damageCodeword(damaged, built.layout.dataBits, index);
			built.layout.dataBits.forEach((bit, module) => {
				if (bit >= 0 && bit >>> 3 === index) flags[module] = 7;
			});
		}
		const flagged = new BitMatrix(
			17,
			17,
			flags.map((value) => (value ? 1 : 0)),
		).mirrored();
		const read = readMicroCodewords(damaged.mirrored(), { strict: false, erasures: flagged.data });
		expect(read.mirrored).toBe(true);
		expect(read.erasuresUsed).toBe(14);
	});

	it('refuses a grid of any other size', () => {
		for (const [width, height] of [
			[12, 12],
			[11, 13],
			[21, 21],
			[1, 1],
		] as const) {
			expect(stage(() => readMicroCodewords(new BitMatrix(width, height), { strict: false }))).toBe(
				'decode/unreadable version',
			);
		}
	});

	it('refuses an all-light or all-dark grid before its codewords', () => {
		// Either the format is past repair, or the nearest word names another
		// version: both are refusals before Reed-Solomon is reached.
		const dark = new BitMatrix(15, 15);
		dark.setRegion(0, 0, 15, 15, true);
		for (const grid of [dark, new BitMatrix(15, 15)]) {
			for (const strict of [false, true]) {
				expect(stage(() => readMicroCodewords(grid, { strict }))).toMatch(
					/^decode\/unreadable (format|version)$/,
				);
			}
		}
	});

	it('throws TypeError for a caller mistake', () => {
		const matrix = buildMicro(Uint8Array.from([1, 2, 3, 4, 5]), 'M2', 'L', 0).matrix;
		expect(() => readMicroCodewords({} as BitMatrix, { strict: false })).toThrow(TypeError);
		expect(() =>
			readMicroCodewords(matrix, { strict: false, erasures: new Uint8Array(3) }),
		).toThrow(TypeError);
		expect(() =>
			readMicroCodewords(matrix, { strict: false, erasures: [] as unknown as Uint8Array }),
		).toThrow(TypeError);
	});

	it('lets a bug on the second attempt through rather than hiding it', () => {
		const matrix = new BitMatrix(11, 11);
		let calls = 0;
		const once = (): never => {
			calls += 1;
			if (calls === 1) throw new QrStudioError('decode/unreadable', 'first', { stage: 'format' });
			throw new RangeError('a bug');
		};
		expect(() => readEitherWay(matrix, false, undefined, once)).toThrow(RangeError);
		expect(() =>
			readEitherWay(matrix, false, undefined, () => {
				throw new TypeError('also a bug');
			}),
		).toThrow(TypeError);
	});
});

describe('building Micro QR', () => {
	it('refuses codewords that do not fit the version and level', () => {
		expect(() => buildMicro(new Uint8Array(4), 'M2', 'L', 0)).toThrow(TypeError);
		expect(() => buildMicro([1, 2, 3] as unknown as Uint8Array, 'M1', 'L', 0)).toThrow(TypeError);
		expect(() => buildMicro(Uint8Array.from([1, 2, 3]), 'M1', 'L', 0)).toThrow(/high nibble/);
		expect(() => buildMicro(new Uint8Array(5), 'M2', 'Q', 0)).toThrow(TypeError);
		expect(() => buildMicro(new Uint8Array(5), 'M9', 'L', 0)).toThrow(TypeError);
	});

	it('refuses a mask that is not 0 to 3 or auto', () => {
		for (const mask of [4, -1, 1.5, Number.NaN]) {
			expect(() => buildMicro(new Uint8Array(5), 'M2', 'L', mask)).toThrow(TypeError);
		}
	});

	it('returns codewords as placed: data then check symbols', () => {
		const built = buildMicro(Uint8Array.from([0x12, 0x34, 0x50]), 'M1', 'L', 0);
		expect(built.codewords).toHaveLength(5);
		expect([...built.codewords.subarray(0, 3)]).toEqual([0x12, 0x34, 0x50]);
		expect(Object.isFrozen(built)).toBe(true);
		expect(built.symbology).toBe('micro');
	});
});
