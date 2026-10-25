/**
 * The matrix reader: round trips at every version and level, both profiles,
 * damage of every kind it is meant to survive or refuse, and matrices made by
 * `qrcode`, which segments, masks and pads in its own way.
 */

import fc from 'fast-check';
import QRCode from 'qrcode';
import { describe, expect, it } from 'vitest';
import { BitMatrix } from '../../../src/core/bit-matrix.js';
import { BitBuffer } from '../../../src/core/bits.js';
import { QrStudioError, isQrStudioError } from '../../../src/core/errors.js';
import type { EcLevel, Mode } from '../../../src/segment/types.js';
import { buildQr } from '../../../src/symbology/qr/build.js';
import { blockCapacity, qrBlocks } from '../../../src/symbology/qr/blocks.js';
import { formatBits, versionBits } from '../../../src/symbology/qr/info.js';
import { qrGeometry } from '../../../src/symbology/qr/layout.js';
import { readQr } from '../../../src/symbology/qr/read.js';
import { EC_LEVELS } from '../../../src/symbology/qr/tables.js';
import { seeded } from '../../core/helpers.js';
import { blockPositions, corrupt, erasureMap, flip, perBlock } from './damage.js';
import { capacity, iconv, ourData, payload } from './oracles.js';

const MODES: readonly Mode[] = ['numeric', 'alphanumeric', 'byte', 'kanji'];

function stage(run: () => unknown): string | undefined {
	try {
		run();
	} catch (error) {
		if (isQrStudioError(error)) return String(error.params.stage);
		throw error;
	}
	return undefined;
}

function sample(version: number, level: EcLevel, seed: number, mask: number | 'auto' = 0) {
	const random = seeded(seed);
	const mode = MODES[random.int(4)]!;
	const p = payload(random, mode, 1 + random.int(capacity(mode, version, level)));
	return { p, symbol: buildQr(ourData(p, version, level), version, level, mask), random };
}

/** Overwrite one copy of format information with another level and mask's. */
function writeFormat(
	matrix: BitMatrix,
	which: 'formatFirst' | 'formatSecond',
	bits: number,
): BitMatrix {
	const geometry = qrGeometry((matrix.width - 17) / 4);
	const data = Uint8Array.from(matrix.data);
	geometry[which].forEach((index, i) => {
		data[index] = (bits >>> (14 - i)) & 1;
	});
	return new BitMatrix(matrix.width, matrix.height, data);
}

function writeVersion(
	matrix: BitMatrix,
	which: 'versionFirst' | 'versionSecond',
	bits: number,
): BitMatrix {
	const geometry = qrGeometry((matrix.width - 17) / 4);
	const data = Uint8Array.from(matrix.data);
	geometry[which].forEach((index, i) => {
		data[index] = (bits >>> i) & 1;
	});
	return new BitMatrix(matrix.width, matrix.height, data);
}

describe('reading what build makes', () => {
	it('round-trips every version and level, in every mode, in both profiles', () => {
		const random = seeded(0x1eaf);
		for (let version = 1; version <= 40; version += 1) {
			for (const level of EC_LEVELS) {
				const mode = MODES[(version + level.charCodeAt(0)) % 4]!;
				const p = payload(random, mode, 1 + random.int(capacity(mode, version, level)));
				const mask = random.int(8);
				const symbol = buildQr(ourData(p, version, level), version, level, mask);
				for (const strict of [true, false]) {
					const read = readQr(symbol.matrix, { strict });
					expect(read.bitstream.text, `${version}-${level} ${mode}`).toBe(p.text);
					expect([
						read.version,
						read.ecLevel,
						read.mask,
						read.formatErrors,
						read.mirrored,
						read.erasuresUsed,
					]).toEqual([String(version), level, mask, 0, false, 0]);
					expect(read.errorsPerBlock.every((e) => e === 0)).toBe(true);
					const layout = qrBlocks(version, level);
					expect(read.capacityPerBlock).toEqual(
						layout.blocks.map((b) => blockCapacity(b.ecCount, layout.p)),
					);
				}
			}
		}
	});

	it('reads a mirrored symbol leniently, says so, and refuses it strictly', () => {
		for (const version of [1, 5, 7, 20]) {
			const { p, symbol } = sample(version, 'M', version, 'auto');
			const mirrored = symbol.matrix.mirrored();
			const read = readQr(mirrored, { strict: false });
			expect(read.bitstream.text).toBe(p.text);
			expect(read.mirrored).toBe(true);
			expect(stage(() => readQr(mirrored, { strict: true }))).toBeDefined();
		}
	});
});

describe('format information', () => {
	const { p, symbol } = sample(3, 'Q', 77, 5);
	const first = qrGeometry(3).formatFirst;
	const second = qrGeometry(3).formatSecond;

	it('takes one corrected bit strictly, provided both copies agree', () => {
		const read = readQr(flip(symbol.matrix, [first[4]!]), { strict: true });
		expect(read.formatErrors).toBe(1);
		expect(read.bitstream.text).toBe(p.text);
		expect(stage(() => readQr(flip(symbol.matrix, [first[4]!, first[9]!]), { strict: true }))).toBe(
			'format',
		);
		const other = writeFormat(symbol.matrix, 'formatFirst', formatBits('L', 2));
		expect(stage(() => readQr(other, { strict: true }))).toBe('format');
	});

	it('takes up to three bits leniently, from the better copy, trying each plausible format', () => {
		expect(
			readQr(flip(symbol.matrix, [first[0]!, first[5]!]), { strict: false }).formatErrors,
		).toBe(0);
		const both = flip(symbol.matrix, [first[0]!, first[5]!, second[1]!, second[2]!]);
		expect(readQr(both, { strict: false })).toMatchObject({
			formatErrors: 2,
			mask: 5,
			ecLevel: 'Q',
		});
		// A copy that states another format outright is tried first (a tie goes
		// to the top-left copy), refused by Reed-Solomon, and the other copy wins.
		const other = writeFormat(symbol.matrix, 'formatFirst', formatBits('L', 2));
		expect(readQr(other, { strict: false }).bitstream.text).toBe(p.text);
		const gone = flip(symbol.matrix, [...first.subarray(0, 4), ...second.subarray(0, 4)]);
		expect(stage(() => readQr(gone, { strict: false }))).toBe('format');
	});
});

describe('version information', () => {
	const { p, symbol } = sample(9, 'L', 99, 3);
	const geometry = qrGeometry(9);

	it('is required strictly from version 7, and stands in for nothing', () => {
		expect(
			readQr(
				flip(symbol.matrix, [
					geometry.versionFirst[0]!,
					geometry.versionFirst[5]!,
					geometry.versionFirst[11]!,
				]),
				{ strict: true },
			).bitstream.text,
		).toBe(p.text);
		const unreadable = flip(symbol.matrix, [
			...geometry.versionFirst.subarray(0, 5),
			...geometry.versionSecond.subarray(0, 5),
		]);
		expect(stage(() => readQr(unreadable, { strict: true }))).toBe('version');
		// Leniently, the size stands in for two unreadable copies.
		expect(readQr(unreadable, { strict: false }).bitstream.text).toBe(p.text);
	});

	it('refuses a symbol whose version information names another version', () => {
		const oneWrong = writeVersion(symbol.matrix, 'versionFirst', versionBits(12));
		expect(stage(() => readQr(oneWrong, { strict: true }))).toBe('version');
		expect(readQr(oneWrong, { strict: false }).bitstream.text).toBe(p.text);
		const bothWrong = writeVersion(oneWrong, 'versionSecond', versionBits(12));
		expect(stage(() => readQr(bothWrong, { strict: false }))).toBe('version');
	});

	it('refuses a size QR does not come in', () => {
		expect(stage(() => readQr(new BitMatrix(22, 22), { strict: false }))).toBe('version');
		expect(stage(() => readQr(new BitMatrix(21, 25), { strict: false }))).toBe('version');
		expect(stage(() => readQr(new BitMatrix(181, 181), { strict: true }))).toBe('version');
	});
});

describe('Reed-Solomon in the reader', () => {
	it('corrects up to floor((ec - p) / 2) codewords in every block, and reports each count', () => {
		fc.assert(
			fc.property(
				fc.integer({ min: 1, max: 40 }),
				fc.constantFrom(...EC_LEVELS),
				fc.integer({ min: 0, max: 2 ** 31 - 1 }),
				(version, level, seed) => {
					const { p, symbol, random } = sample(version, level, seed, seed % 8);
					const layout = symbol.blocks;
					const counts = layout.blocks.map((b) =>
						random.int(blockCapacity(b.ecCount, layout.p) + 1),
					);
					const damaged = corrupt(
						symbol,
						perBlock(symbol, (block) => counts[block]!, random),
						random,
					);
					for (const strict of [false, true]) {
						const read = readQr(damaged, { strict });
						expect(read.bitstream.text).toBe(p.text);
						expect(read.errorsPerBlock).toEqual(counts);
					}
				},
			),
			{ numRuns: 120, seed: 0x12e },
		);
	});

	it('exposes what the strict scan check needs to keep a quarter of t in reserve', () => {
		// read itself applies no margin: with t corrected, it reads, and the
		// numbers show the reserve is gone.
		const { p, symbol, random } = sample(10, 'M', 4242, 1);
		const layout = symbol.blocks;
		const t = layout.blocks.map((b) => blockCapacity(b.ecCount, layout.p));
		const read = readQr(
			corrupt(
				symbol,
				perBlock(symbol, (block) => t[block]!, random),
				random,
			),
			{ strict: true },
		);
		expect(read.bitstream.text).toBe(p.text);
		read.errorsPerBlock.forEach((errors, i) => {
			const reserve = Math.ceil(0.25 * read.capacityPerBlock[i]!);
			expect(read.capacityPerBlock[i]! - errors).toBeLessThan(reserve);
		});
	});

	it('refuses a block past its capacity rather than miscorrecting it, at the smallest symbols', () => {
		// 1-L keeps 3 of 7 check codewords back, so 3 errors are refused even
		// though the code could reach them.
		let refused = 0;
		for (let seed = 0; seed < 60; seed += 1) {
			const { symbol, random } = sample(1, 'L', seed, 0);
			const damaged = corrupt(
				symbol,
				perBlock(symbol, () => 3, random),
				random,
			);
			const result = stage(() => readQr(damaged, { strict: false }));
			if (result === 'reed-solomon') refused += 1;
		}
		expect(refused).toBe(60);
	});

	it('uses erasures leniently to correct past t, and not strictly', () => {
		const { p, symbol, random } = sample(5, 'H', 555, 2);
		const layout = symbol.blocks;
		// ec - p erasures per block, double what errors alone could correct.
		const positions = perBlock(symbol, (block) => layout.blocks[block]!.ecCount - layout.p, random);
		const damaged = corrupt(symbol, positions, random);
		const erasures = erasureMap(symbol, positions);
		const read = readQr(damaged, { strict: false, erasures });
		expect(read.bitstream.text).toBe(p.text);
		expect(read.erasuresUsed).toBe(positions.length);
		expect(read.errorsPerBlock.every((e) => e === 0)).toBe(true);
		expect(stage(() => readQr(damaged, { strict: true, erasures }))).toBe('reed-solomon');
	});

	it('drops erasures it cannot use: too many, or wrong ones', () => {
		const { p, symbol, random } = sample(4, 'M', 404, 6);
		const blocks = blockPositions(symbol);
		// Every codeword flagged: more than ec - p, so errors alone decide.
		const all = erasureMap(symbol, blocks.flat());
		expect(readQr(symbol.matrix, { strict: false, erasures: all }).erasuresUsed).toBe(0);
		// Flags in the wrong place, with real errors elsewhere: decoding with the
		// flags fails, without them succeeds.
		const layout = symbol.blocks;
		const flagged = perBlock(
			symbol,
			(block) => layout.blocks[block]!.ecCount - layout.p - 1,
			random,
		);
		const elsewhere = blocks.map((positions) =>
			positions.find((position) => !flagged.includes(position))!,
		);
		const damaged = corrupt(symbol, elsewhere, random);
		const read = readQr(damaged, { strict: false, erasures: erasureMap(symbol, flagged) });
		expect(read.bitstream.text).toBe(p.text);
		expect(read.erasuresUsed).toBe(0);
		// Erasures of a mirrored matrix follow it.
		const mirrored = readQr(symbol.matrix.mirrored(), {
			strict: false,
			erasures: new BitMatrix(33, 33, erasureMap(symbol, flagged)).mirrored().data,
		});
		expect(mirrored.mirrored).toBe(true);
	});
});

describe('the bitstream stage', () => {
	it('is final once Reed-Solomon accepts: no mirrored retry', () => {
		const out = new BitBuffer();
		// 0110 is no mode at all.
		out.append(0b0110_0000, 8);
		while (out.length < qrBlocks(1, 'M').dataBits) out.append(0xec, 8);
		const symbol = buildQr(out.toBytes(), 1, 'M', 3);
		expect(stage(() => readQr(symbol.matrix, { strict: false }))).toBe('segments');
	});

	it('refuses options a caller should not pass', () => {
		const { symbol } = sample(1, 'M', 1);
		expect(() => readQr(symbol.matrix, {} as { strict: boolean })).toThrow(TypeError);
		expect(() => readQr(symbol.matrix, { strict: false, erasures: new Uint8Array(3) })).toThrow(
			TypeError,
		);
		expect(() => buildQr(new Uint8Array(16), 1, 'M', 8)).toThrow(TypeError);
		expect(isQrStudioError(new QrStudioError('decode/unreadable', 'x'))).toBe(true);
	});
});

describe('reading what qrcode makes', () => {
	it('reads its own segmentation, masks and kanji', () => {
		const random = seeded(0xface);
		const toSJISFunc = (char: string): number => iconv.encode(char, 'shift_jis').readUInt16BE(0);
		for (let round = 0; round < 60; round += 1) {
			const pieces = [
				'0123456789',
				'HELLO WORLD',
				'mixed Case text',
				'日本語',
				'https://example.com/',
			];
			let text = '';
			for (let i = 0; i < 1 + random.int(6); i += 1) text += pieces[random.int(pieces.length)]!;
			const level = EC_LEVELS[random.int(4)]!;
			const symbol = QRCode.create(text, { errorCorrectionLevel: level, toSJISFunc });
			const size = symbol.modules.size;
			const matrix = new BitMatrix(size, size, Uint8Array.from(symbol.modules.data));
			const read = readQr(matrix, { strict: true });
			expect(read.bitstream.text, `round ${round}`).toBe(text);
			expect([read.version, read.mask]).toEqual([String(symbol.version), symbol.maskPattern]);
		}
	});
});
