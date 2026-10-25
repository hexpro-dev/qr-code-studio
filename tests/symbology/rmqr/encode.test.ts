/**
 * rMQR end to end: text in through src/encode, a symbol out, and back to the
 * same text, against BWIPP and zxing-cpp. Where the two encoders segment
 * mixed content differently, the test holds the same three things as the
 * Micro QR one (see tests/symbology/micro/encode.test.ts).
 */

import { describe, expect, it } from 'vitest';
import { BitMatrix, TooMuchDataError, isQrStudioError } from '../../../src/core/index.js';
import { dataCodewords } from '../../../src/encode/bitstream.js';
import { encode, encodeStructuredAppend } from '../../../src/encode/index.js';
import { createRmqrSymbology } from '../../../src/symbology/rmqr/entry.js';
import { rmqrSpecs } from '../../../src/symbology/rmqr/tables.js';
import bwipjs from 'bwip-js';
import {
	bwipMatrix,
	decodedBits,
	mixedText,
	seeded,
	segmentsOf,
	zxingRead,
	zxingWrite,
} from '../micro/helpers.js';

const RMQR = createRmqrSymbology();

const LEVELS = rmqrSpecs().flatMap((spec) =>
	spec.levels.map((level) => ({
		version: spec.version,
		indicator: spec.indicator,
		ec: level.ecLevel,
	})),
);

describe('encode with symbology rmqr, against bwip-js', () => {
	it("makes BWIPP's symbol, or one at least as short that reads the same", () => {
		const random = seeded(0xe31);
		let exact = 0;
		let compared = 0;
		const problems: string[] = [];
		for (const { version, ec } of LEVELS) {
			for (let sample = 0; sample < 8; sample += 1) {
				const text = mixedText(random, 1 + random.int(40));
				let ours;
				try {
					ours = encode(text, {
						symbology: 'rmqr',
						ecLevel: ec,
						minVersion: version,
						maxVersion: version,
					});
				} catch (error) {
					if (!(error instanceof TooMuchDataError)) throw error;
					expect(() =>
						bwipMatrix({ bcid: 'rectangularmicroqrcode', text, version, eclevel: ec }),
					).toThrow();
					continue;
				}
				const read = RMQR.read(ours.matrix, { strict: true });
				if (read.bitstream.text !== text)
					problems.push(`${version}-${ec} ours read back differently`);
				let theirs;
				try {
					theirs = bwipMatrix({ bcid: 'rectangularmicroqrcode', text, version, eclevel: ec });
				} catch {
					continue;
				}
				compared += 1;
				if (ours.matrix.equals(theirs)) {
					exact += 1;
					continue;
				}
				const profile = RMQR.profile(version);
				const theirRead = RMQR.read(theirs, { strict: true });
				if (theirRead.bitstream.text !== text)
					problems.push(`${version}-${ec} theirs read differently`);
				if (decodedBits(read.bitstream, profile) > decodedBits(theirRead.bitstream, profile)) {
					problems.push(`${version}-${ec} ours is longer than BWIPP's`);
				}
				const rebuilt = RMQR.build(
					dataCodewords(segmentsOf(theirRead.bitstream), {}, profile, RMQR.blocks(version, ec)),
					version,
					ec,
					0,
				);
				if (!rebuilt.matrix.equals(theirs))
					problems.push(`${version}-${ec} BWIPP's segments built differently`);
			}
		}
		expect(problems).toEqual([]);
		expect(compared).toBeGreaterThan(300);
		expect(exact / compared).toBeGreaterThan(0.6);
	});

	it('writes GS1 data with FNC1 in first position as BWIPP does', () => {
		const built = encode('0101234567890128', { symbology: 'rmqr', fnc1: 'gs1' });
		const raw = bwipjs.raw({
			bcid: 'rectangularmicroqrcode',
			text: '^FNC10101234567890128',
			parsefnc: true,
			version: built.version,
			eclevel: 'M',
			fixedeclevel: true,
		} as unknown as Parameters<typeof bwipjs.raw>[0]) as unknown as {
			pixs: number[];
			pixx: number;
			pixy: number;
		}[];
		const theirs = new BitMatrix(raw[0]!.pixx, raw[0]!.pixy, Uint8Array.from(raw[0]!.pixs));
		expect(built.matrix.equals(theirs)).toBe(true);
		const read = RMQR.read(built.matrix, { strict: true });
		expect([read.bitstream.fnc1, read.bitstream.text]).toEqual(['gs1', '0101234567890128']);
	});
});

describe('encode with symbology rmqr, against zxing-cpp', () => {
	it('is read to the same text by zxing-cpp, at every size and level', async () => {
		const random = seeded(0xe32);
		const failures: string[] = [];
		for (const { version, ec } of LEVELS) {
			for (let sample = 0; sample < 2; sample += 1) {
				const text = mixedText(random, 1 + random.int(20));
				let built;
				try {
					built = encode(text, {
						symbology: 'rmqr',
						ecLevel: ec,
						minVersion: version,
						maxVersion: version,
					});
				} catch {
					continue;
				}
				const result = await zxingRead(built.matrix, 'RMQRCode');
				if (result?.text !== text) failures.push(`${version}-${ec}`);
			}
		}
		expect(failures).toEqual([]);
	});

	it('reads what zxing-wasm writes to its text, at every size and level', async () => {
		const random = seeded(0xe33);
		const failures: string[] = [];
		for (const { version, indicator, ec } of LEVELS) {
			let text = mixedText(random, 30);
			let zint;
			while (zint === undefined && text.length > 0) {
				try {
					zint = await zxingWrite(text, 'RMQRCode', `version=${indicator + 1},ecLevel=${ec}`);
				} catch {
					text = text.slice(0, -1);
				}
			}
			if (zint === undefined) {
				failures.push(`${version}-${ec}: zint wrote nothing`);
				continue;
			}
			const read = RMQR.read(zint, { strict: true });
			if (read.bitstream.text !== text || read.version !== version || read.ecLevel !== ec) {
				failures.push(`${version}-${ec}`);
			}
		}
		expect(failures).toEqual([]);
	});

	it('round trips an ECI and zxing-cpp reads it', async () => {
		const built = encode('café über', { symbology: 'rmqr', segmentation: { eci: 'utf-8' } });
		const read = RMQR.read(built.matrix, { strict: true });
		expect([read.bitstream.text, read.bitstream.textSource]).toEqual(['café über', 'eci-26']);
		expect((await zxingRead(built.matrix, 'RMQRCode'))?.text).toBe('café über');
	});
});

describe('encode with symbology rmqr, its options', () => {
	const text = 'Example 0123456789 ABC';

	it('picks the smallest area by default, and the shortest height or width when asked', () => {
		const area = encode(text, { symbology: 'rmqr' });
		const height = encode(text, { symbology: 'rmqr', rmqrPreference: 'height' });
		const width = encode(text, { symbology: 'rmqr', rmqrPreference: 'width' });
		expect([area.version, height.version, width.version]).toEqual(['R11x43', 'R7x77', 'R11x43']);
		for (const built of [area, height, width]) {
			expect(RMQR.read(built.matrix, { strict: true }).bitstream.text).toBe(text);
		}
		// Every size smaller by area than the default's is too small for this text.
		const smaller = RMQR.versions.slice(0, RMQR.versions.indexOf('R11x43'));
		for (const version of smaller) {
			expect(() =>
				encode(text, { symbology: 'rmqr', minVersion: version, maxVersion: version }),
			).toThrow(TooMuchDataError);
		}
	});

	it('boosts M to H when the chosen size, the smallest by area, has room', () => {
		const built = encode('2468', { symbology: 'rmqr', boostEc: true });
		expect([built.version, built.ecLevel]).toEqual(['R11x27', 'H']);
	});

	it('refuses what rMQR cannot do, by name', () => {
		const code = (run: () => unknown): string | undefined => {
			try {
				run();
			} catch (error) {
				if (isQrStudioError(error)) return `${error.code} ${String(error.params.feature)}`;
				throw error;
			}
			return undefined;
		};
		expect(code(() => encodeStructuredAppend('x'.repeat(300), { symbology: 'rmqr' }))).toBe(
			'encode/unsupported-feature structured-append',
		);
		expect(() => encode('abc', { symbology: 'rmqr', ecLevel: 'Q' })).toThrow(TypeError);
		expect(() => encode('abc', { symbology: 'rmqr', mask: 1 })).toThrow(TypeError);
		expect(encode('abc', { symbology: 'rmqr', mask: 0 }).mask).toBe(0);
		expect(() => encode('x'.repeat(400), { symbology: 'rmqr' })).toThrow(TooMuchDataError);
	});
});
