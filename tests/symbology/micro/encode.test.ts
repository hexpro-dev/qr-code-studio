/**
 * Micro QR end to end: text in through src/encode, a symbol out, and back to
 * the same text, against BWIPP and zxing-cpp.
 *
 * With mixed content the two encoders may segment differently. This package
 * segments by exact dynamic programming and BWIPP by lookahead tables, so
 * where the symbols differ the test holds three things instead: BWIPP's
 * symbol reads here to the same text, this package's bitstream is no longer
 * than BWIPP's, and BWIPP's own segments, written by this package's segment
 * writer and built here, give BWIPP's symbol module for module. The last is
 * what makes the comparison exact whichever segmentation won.
 */

import { describe, expect, it } from 'vitest';
import { TooMuchDataError, isQrStudioError } from '../../../src/core/index.js';
import { dataCodewords } from '../../../src/encode/bitstream.js';
import { encode, encodeStructuredAppend } from '../../../src/encode/index.js';
import { createMicroQrSymbology } from '../../../src/symbology/micro/entry.js';
import { MICRO_VERSIONS, microSpec } from '../../../src/symbology/micro/tables.js';
import {
	bwipMatrix,
	decodedBits,
	mixedText,
	seeded,
	segmentsOf,
	zxingRead,
	zxingWrite,
} from './helpers.js';

const MICRO = createMicroQrSymbology();

const LEVELS = MICRO_VERSIONS.flatMap((version) =>
	microSpec(version).levels.map((level) => ({ version, ec: level.ecLevel })),
);

/** M1 carries digits only, M2 digits and alphanumerics; mixed text above that. */
function textFor(random: ReturnType<typeof seeded>, version: string, length: number): string {
	if (version === 'M1') return mixedText(random, length).replace(/[^0-9]/g, '') || '7';
	if (version === 'M2') return mixedText(random, length).replace(/[a-z!?@#]/g, '') || 'A1';
	return mixedText(random, length);
}

describe('encode with symbology micro, against bwip-js', () => {
	it("makes BWIPP's symbol, or one at least as short that reads the same", () => {
		const random = seeded(0xe2e);
		let exact = 0;
		let compared = 0;
		const problems: string[] = [];
		for (const { version, ec } of LEVELS) {
			for (let sample = 0; sample < 25; sample += 1) {
				const text = textFor(random, version, 1 + random.int(14));
				let ours;
				try {
					ours = encode(text, {
						symbology: 'micro',
						ecLevel: ec,
						minVersion: version,
						maxVersion: version,
					});
				} catch (error) {
					if (!(error instanceof TooMuchDataError)) throw error;
					// Nothing fits here, so BWIPP's longer or equal stream cannot fit either.
					expect(() => bwipMatrix({ bcid: 'microqrcode', text, version, eclevel: ec })).toThrow();
					continue;
				}
				const read = MICRO.read(ours.matrix, { strict: true });
				if (read.bitstream.text !== text)
					problems.push(`${version}-${ec} ours read back differently`);
				let theirs;
				try {
					theirs = bwipMatrix({ bcid: 'microqrcode', text, version, eclevel: ec });
				} catch {
					continue;
				}
				compared += 1;
				if (ours.matrix.equals(theirs)) {
					exact += 1;
					continue;
				}
				const profile = MICRO.profile(version);
				const theirRead = MICRO.read(theirs, { strict: true });
				if (theirRead.bitstream.text !== text)
					problems.push(`${version}-${ec} theirs read differently`);
				if (decodedBits(read.bitstream, profile) > decodedBits(theirRead.bitstream, profile)) {
					problems.push(`${version}-${ec} ours is longer than BWIPP's`);
				}
				const rebuilt = MICRO.build(
					dataCodewords(segmentsOf(theirRead.bitstream), {}, profile, MICRO.blocks(version, ec)),
					version,
					ec,
					'auto',
				);
				if (!rebuilt.matrix.equals(theirs))
					problems.push(`${version}-${ec} BWIPP's segments built differently`);
			}
		}
		expect(problems).toEqual([]);
		expect(compared).toBeGreaterThan(150);
		// Most mixed strings segment the same way in both; the rest differ only in
		// equally short or longer choices on BWIPP's side.
		expect(exact / compared).toBeGreaterThan(0.6);
	});
});

describe('encode with symbology micro, against zxing-cpp', () => {
	it('is read to the same text by zxing-cpp', async () => {
		const random = seeded(0xe2f);
		const failures: string[] = [];
		for (const { version, ec } of LEVELS) {
			for (let sample = 0; sample < 4; sample += 1) {
				const text = textFor(random, version, 1 + random.int(12));
				let built;
				try {
					built = encode(text, {
						symbology: 'micro',
						ecLevel: ec,
						minVersion: version,
						maxVersion: version,
					});
				} catch {
					continue;
				}
				const result = await zxingRead(built.matrix, 'MicroQRCode');
				if (result?.text !== text)
					failures.push(`${version}-${ec}: ${result === undefined ? 'not read' : 'misread'}`);
			}
		}
		expect(failures).toEqual([]);
	});

	it('reads what zxing-wasm writes to its text, at every version and level', async () => {
		const random = seeded(0xe30);
		const failures: string[] = [];
		for (const { version, ec } of LEVELS) {
			const number = microSpec(version).number;
			for (let sample = 0; sample < 3; sample += 1) {
				// Shrink until zint fits it at this version.
				let text = textFor(random, version, 14);
				let zint;
				while (zint === undefined && text.length > 0) {
					try {
						zint = await zxingWrite(text, 'MicroQRCode', `version=${number},ecLevel=${ec}`);
					} catch {
						text = text.slice(0, -1);
					}
				}
				if (zint === undefined) {
					failures.push(`${version}-${ec}: zint wrote nothing`);
					continue;
				}
				const read = MICRO.read(zint, { strict: true });
				if (read.bitstream.text !== text || read.version !== version || read.ecLevel !== ec) {
					failures.push(`${version}-${ec}`);
				}
			}
		}
		expect(failures).toEqual([]);
	});
});

describe('encode with symbology micro, its options', () => {
	it('defaults to level M, so M1 only when asked for L', () => {
		expect(encode('123', { symbology: 'micro' }).version).toBe('M2');
		expect(encode('123', { symbology: 'micro', ecLevel: 'L' }).version).toBe('M1');
		expect(encode('HELLO', { symbology: 'micro', ecLevel: 'L' }).version).toBe('M2');
		expect(encode('hello', { symbology: 'micro', ecLevel: 'L' }).version).toBe('M3');
	});

	it('boosts the level as far as the chosen size allows', () => {
		const built = encode('12345', {
			symbology: 'micro',
			ecLevel: 'L',
			boostEc: true,
			minVersion: 'M4',
		});
		expect([built.version, built.ecLevel]).toEqual(['M4', 'Q']);
	});

	it('takes a forced mask', () => {
		expect(encode('MICRO', { symbology: 'micro', mask: 3 }).mask).toBe(3);
		expect(() => encode('MICRO', { symbology: 'micro', mask: 4 })).toThrow(TypeError);
	});

	it('refuses what Micro QR cannot carry, by name', () => {
		const code = (run: () => unknown): string | undefined => {
			try {
				run();
			} catch (error) {
				if (isQrStudioError(error))
					return `${error.code} ${String(error.params.feature ?? error.params.reason)}`;
				throw error;
			}
			return undefined;
		};
		expect(code(() => encode('0101234567890128', { symbology: 'micro', fnc1: 'gs1' }))).toBe(
			'encode/unsupported-feature fnc1',
		);
		expect(code(() => encodeStructuredAppend('x'.repeat(30), { symbology: 'micro' }))).toBe(
			'encode/unsupported-feature structured-append',
		);
		expect(code(() => encode('café', { symbology: 'micro', segmentation: { eci: 'utf-8' } }))).toBe(
			'encode/unsupported-feature eci',
		);
		expect(code(() => encode('ABC', { symbology: 'micro', ecLevel: 'L', maxVersion: 'M1' }))).toBe(
			'encode/unsupported-content mode',
		);
		expect(() => encode('x'.repeat(40), { symbology: 'micro' })).toThrow(TooMuchDataError);
	});
});
