/**
 * Every message key the reader's failures map to has an English sentence,
 * every sentence is reached, and the sentences keep the house register.
 *
 * Failures are provoked rather than listed: each way `decodeImage` can fail
 * is made to happen on a drawn picture, and its key looked up. The two that a
 * picture cannot reach in this runtime (kanji with no Shift_JIS decoder, and
 * an error with no stage) are mapped from errors built by hand.
 */

import { describe, expect, it } from 'vitest';
import { BitBuffer } from '../../src/core/bits.js';
import { QrStudioError } from '../../src/core/errors.js';
import type { RgbaImage } from '../../src/core/image.js';
import { createPrng } from '../../src/core/prng.js';
import { decodeImage } from '../../src/decode/decoder.js';
import { decodeFailureKey } from '../../src/decode/failure.js';
import type { DecodeOptions } from '../../src/decode/types.js';
import { encode } from '../../src/encode/encode.js';
import { DECODE_MESSAGES } from '../../src/messages/en/decode.js';
import { qrBlocks } from '../../src/symbology/qr/blocks.js';
import { buildQr } from '../../src/symbology/qr/build.js';
import { checkRegister } from '../encode/register.js';
import { noise, pad } from '../helpers/damage.js';
import { blankImage, drawGrid, fillRect } from '../helpers/draw.js';

function keyFor(image: RgbaImage, options: DecodeOptions = {}): string {
	const result = decodeImage(image, options);
	if (result.ok) throw new Error('expected the read to fail');
	return decodeFailureKey(result.error);
}

/** A version 1-M symbol whose bitstream is these fields, then the terminator and padding. */
function symbolWith(fields: [number, number][]): RgbaImage {
	const out = new BitBuffer();
	for (const [value, bits] of fields) out.append(value, bits);
	out.append(0, 4);
	out.append(0, (8 - (out.length % 8)) % 8);
	while (out.length < qrBlocks(1, 'M').dataBits) out.append(0xec, 8);
	return drawGrid(buildQr(out.toBytes(), 1, 'M', 0).matrix, { scale: 6 });
}

describe('the decode messages', () => {
	it('cover every way a read fails, and nothing else', () => {
		const used = new Set<string>();
		const scale = 6;

		used.add(keyFor(blankImage(120, 120)));

		const matrix = encode('https://example.com/messages', { ecLevel: 'M' }).matrix;
		const scrambled = matrix.clone();
		const random = createPrng(31);
		for (let y = 0; y < matrix.height; y += 1) {
			for (let x = 0; x < matrix.width; x += 1) {
				const finder =
					(x < 8 && y < 8) || (x >= matrix.width - 8 && y < 8) || (x < 8 && y >= matrix.height - 8);
				if (!finder) scrambled.set(x, y, random.int(2) === 1);
			}
		}
		used.add(keyFor(drawGrid(scrambled, { scale })));

		// One copy of the format information two bits out: the strict reader
		// needs both copies within one.
		const formatFlipped = matrix.clone();
		formatFlipped.xor(0, 8);
		formatFlipped.xor(1, 8);
		used.add(keyFor(drawGrid(formatFlipped, { scale }), { profile: 'strict-v1' }));

		// Version 7 with both copies of the version information wiped: the strict
		// reader does not trust the size alone.
		const large = encode('V'.repeat(120), { ecLevel: 'L', minVersion: '7' }).matrix;
		const versionless = large.clone();
		const size = large.width;
		for (let i = 0; i < 6; i += 1) {
			for (let j = size - 11; j < size - 8; j += 1) {
				versionless.set(i, j, false);
				versionless.set(j, i, false);
			}
		}
		used.add(keyFor(drawGrid(versionless, { scale: 4 }), { profile: 'strict-v1' }));

		const damaged = drawGrid(
			encode('https://example.com/menu/table-12?visit=1', { ecLevel: 'L' }).matrix,
			{ scale },
		);
		fillRect(
			damaged,
			damaged.width * 0.3,
			damaged.height * 0.3,
			damaged.width * 0.45,
			damaged.height * 0.45,
			0,
		);
		used.add(keyFor(damaged, { erasures: false }));

		// A bitstream that announces a mode no QR symbol has.
		used.add(keyFor(symbolWith([[0b0110, 4]])));

		used.add(
			keyFor(
				symbolWith([
					[0b0111, 4],
					[99, 8],
					[0b0100, 4],
					[1, 8],
					[0x41, 8],
				]),
			),
		);

		used.add(
			keyFor(
				noise(
					pad(
						drawGrid(encode('https://example.com/menu', { ecLevel: 'H' }).matrix, { scale: 9 }),
						40,
					),
					34,
					21,
				),
				{
					profile: 'strict-v1',
				},
			),
		);

		for (const error of [
			new QrStudioError('decode/unsupported', 'x', { stage: 'segments', feature: 'kanji' }),
			new QrStudioError('decode/unsupported', 'x', { stage: 'segments' }),
			new QrStudioError('decode/unreadable', 'x'),
		]) {
			used.add(decodeFailureKey(error));
		}

		for (const key of used) expect(DECODE_MESSAGES[key], key).toBeDefined();
		expect([...used].sort()).toEqual(Object.keys(DECODE_MESSAGES).sort());
		checkRegister(DECODE_MESSAGES);
		expect(Object.isFrozen(DECODE_MESSAGES)).toBe(true);
	});
});
