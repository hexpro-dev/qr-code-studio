/**
 * Large symbols tilted 20 degrees, the angle axis's everyday level: a menu on
 * a table read from the chair in front of it.
 *
 * Under perspective the three finders put the far corner of a large symbol
 * tens of modules from where it is, and the strict reader used to look for
 * the alignment pattern within two modules of that guess: it refused most
 * version 7 symbols at 20 degrees and every version 10, which every reader
 * read. It now walks the alignment patterns down the diagonal and lets the
 * timing patterns choose (see strictHypothesis), and this holds it to reading
 * at least 95 per cent of what both oracles read, at every version to 40,
 * without reading anything either cannot.
 *
 * The default run covers versions 2 to 10; QR_DECODE_NIGHTLY=1 adds 15 to 40,
 * whose pictures take a few seconds each to draw.
 */

import { describe, expect, it } from 'vitest';
import { decodeImage } from '../../src/decode/decoder.js';
import { jsqrText, zxingTexts } from '../helpers/oracles.js';
import { presets, styledCapture } from '../helpers/styled.js';
import { keepsReserve } from './conservative.js';

const NIGHTLY = process.env.QR_DECODE_NIGHTLY === '1';
const VERSIONS = NIGHTLY ? [2, 4, 7, 10, 15, 20, 25, 30, 35, 40] : [2, 4, 7, 10];
const SEEDS = NIGHTLY ? 8 : 3;

describe('classic-black tilted 20 degrees', () => {
	const preset = presets().find((candidate) => candidate.id === 'classic-black');
	for (const version of VERSIONS) {
		it(`version ${version}: reads at least 95 per cent of what both oracles read, and nothing more`, async () => {
			let both = 0;
			let strictOfBoth = 0;
			const violations: string[] = [];
			for (let seed = 1; seed <= SEEDS; seed += 1) {
				const shot = styledCapture({
					preset: preset!,
					modulePixels: 10,
					version,
					seed: seed * 1000 + version,
					tilt: 20,
				});
				const result = decodeImage(shot.image, { profile: 'strict-v1' });
				const read =
					result.ok &&
					result.value.some(
						(found) => found.read.bitstream.text === shot.text && keepsReserve(found.read),
					);
				const zxing = (await zxingTexts(shot.image)).includes(shot.text);
				const jsqr = jsqrText(shot.image) === shot.text;
				if (read && !(zxing && jsqr)) violations.push(`seed ${seed}: zxing ${zxing}, jsQR ${jsqr}`);
				if (zxing && jsqr) {
					both += 1;
					if (read) strictOfBoth += 1;
				}
			}
			expect(violations).toEqual([]);
			expect(strictOfBoth).toBeGreaterThanOrEqual(Math.ceil(both * 0.95));
		}, 900_000);
	}
});
