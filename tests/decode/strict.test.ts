/**
 * The strict profile, rule by rule: each thing it gives up, shown by a
 * picture the scanner reads and the strict reader refuses.
 *
 * The property that holds the whole profile to account, that every capture it
 * reads two independent readers read too, is in conservative.test.ts.
 */

import { describe, expect, it } from 'vitest';
import type { BitMatrix } from '../../src/core/bit-matrix.js';
import type { RgbaImage } from '../../src/core/image.js';
import { decodeImage } from '../../src/decode/decoder.js';
import type { DecodeOptions, DecodeFrame } from '../../src/decode/types.js';
import { encode } from '../../src/encode/encode.js';
import { capture } from '../helpers/corpus.js';
import { blur, dim, invert, mirror, noise, pad } from '../helpers/damage.js';
import { blankImage, drawGrid, fillRect, paste } from '../helpers/draw.js';

const TEXT = 'https://example.com/menu/table-12?visit=1';
const STRICT: DecodeOptions = { profile: 'strict-v1' };

function symbol(text = TEXT, ecLevel: 'L' | 'M' | 'Q' | 'H' = 'M'): BitMatrix {
	return encode(text, { ecLevel }).matrix;
}

function outcome(image: RgbaImage, options: DecodeOptions = STRICT): string {
	const result = decodeImage(image, options);
	if (result.ok) return result.value.map((found) => found.read.bitstream.text).join('|');
	return `${result.error.code} ${result.error.params.stage}`;
}

describe('the strict profile', () => {
	it('reads a clean symbol, with the same corners and confidence as the scanner', () => {
		const image = drawGrid(symbol(), { scale: 6 });
		const strict = decodeImage(image, STRICT);
		const lenient = decodeImage(image);
		expect(strict.ok && lenient.ok).toBe(true);
		if (!strict.ok || !lenient.ok) return;
		expect(strict.value[0]?.read.bitstream.text).toBe(TEXT);
		expect(strict.value[0]?.corners).toEqual(lenient.value[0]?.corners);
		expect(strict.value[0]?.read.formatErrors).toBe(0);
	});

	it('refuses a mirrored symbol the scanner reads', () => {
		const image = mirror(drawGrid(symbol(), { scale: 6 }));
		expect(outcome(image, {})).toBe(TEXT);
		expect(outcome(image)).toMatch(/^decode\/unreadable /);
	});

	it('refuses an inverted symbol unless told the design is light-on-dark', () => {
		const image = invert(drawGrid(symbol(), { scale: 6 }));
		expect(outcome(image)).toBe('decode/not-found finders');
		expect(outcome(image, { ...STRICT, polarity: 'light-on-dark' })).toBe(TEXT);
		const result = decodeImage(image, { ...STRICT, polarity: 'light-on-dark' });
		expect(result.ok && result.value[0]?.inverted).toBe(true);
		// And told light-on-dark, it refuses the design's opposite.
		expect(
			outcome(drawGrid(symbol(), { scale: 6 }), { ...STRICT, polarity: 'light-on-dark' }),
		).toMatch(/^decode\/not-found/);
	});

	it('uses one rung: a capture only half scale rescues is refused', () => {
		const image = noise(dim(drawGrid(symbol(), { scale: 8 }), 0.3, 14), 30, 3);
		expect(outcome(image, {})).toBe(TEXT);
		expect(outcome(image)).not.toBe(TEXT);
		const frames: DecodeFrame[] = [];
		decodeImage(image, { ...STRICT, onTelemetry: (frame) => frames.push(frame) });
		const failed = frames.find((frame) => frame.stage === 'failed');
		expect(failed?.stage === 'failed' && failed.attempts).toBe(1);
	});

	it('ignores erasures, which a phone does not have', () => {
		const image = drawGrid(symbol(TEXT, 'H'), { scale: 6 });
		fillRect(
			image,
			image.width * 0.4,
			image.height * 0.4,
			image.width * 0.2,
			image.height * 0.2,
			128,
		);
		const result = decodeImage(image, { ...STRICT, erasures: true });
		if (result.ok) expect(result.value[0]?.read.erasuresUsed).toBe(0);
		const lenient = decodeImage(image);
		expect(lenient.ok && lenient.value[0]?.read.erasuresUsed).toBeGreaterThan(0);
	});

	it('holds finder ratios to a third of a module, where the scanner allows half', () => {
		// Finder cores drawn 2.2 modules wide instead of 3, so the light ring
		// reads 1.4 modules: 0.4 out, inside the scanner's slack and outside the
		// strict reader's.
		const matrix = symbol(TEXT, 'H');
		const scale = 10;
		const image = drawGrid(matrix, { scale });
		const quiet = 4 * scale;
		for (const [mx, my] of [
			[0, 0],
			[matrix.width - 7, 0],
			[0, matrix.height - 7],
		] as const) {
			const x = quiet + mx * scale;
			const y = quiet + my * scale;
			fillRect(image, x + 2 * scale, y + 2 * scale, 3 * scale, 3 * scale, 255);
			fillRect(image, x + 2.4 * scale, y + 2.4 * scale, 2.2 * scale, 2.2 * scale, 0);
		}
		expect(outcome(image, {})).toBe(TEXT);
		expect(outcome(image)).toBe('decode/not-found finders');
	});

	it('requires the alignment pattern where the finders put it', () => {
		const matrix = symbol();
		const scale = 6;
		const image = drawGrid(matrix, { scale });
		// Paint the bottom right alignment pattern out entirely.
		const centre = matrix.width - 7;
		fillRect(image, (4 + centre - 2) * scale, (4 + centre - 2) * scale, 5 * scale, 5 * scale, 255);
		expect(outcome(image, {})).toBe(TEXT);
		expect(outcome(image)).toBe('decode/not-found geometry');
	});

	it('reads only a grid whose timing pattern lands', () => {
		const matrix = symbol();
		const broken = matrix.clone();
		for (let i = 8; i < matrix.width - 8; i += 1) {
			broken.set(i, 6, true);
			broken.set(6, i, true);
		}
		expect(outcome(drawGrid(broken, { scale: 6 }))).toBe('decode/not-found geometry');
	});

	it('refuses a symbol whose fixed patterns threshold differently under glare', () => {
		// Two captures from the nightly corpus: version 1, glare across a finder
		// and the timing pattern. jsQR reads them and zxing-cpp does not, because
		// the two threshold the washed-out modules differently.
		for (const seed of [12551, 17891]) {
			const shot = capture(seed);
			expect(outcome(shot.image, {}), `seed ${seed}`).toBe(shot.text);
			expect(outcome(shot.image), `seed ${seed}`).toBe('decode/unreadable margin');
		}
	});

	it('refuses a picture whose background breaks up into speckle', () => {
		// Noise strong enough to speckle a flat background, on a symbol large and
		// sharp enough to read straight through it.
		const image = noise(pad(drawGrid(symbol(TEXT, 'H'), { scale: 9 }), 40), 34, 21);
		expect(outcome(image, {})).toBe(TEXT);
		expect(outcome(image)).toBe('decode/unreadable margin');
	});

	it("refuses a symbol whose finders a plain reader would not pick over a crisper decoy's", () => {
		// The symbol slightly soft, and three small, sharp bullseyes beside it: a
		// reader that commits to the best-scoring group takes the decoys.
		const code = blur(drawGrid(symbol(), { scale: 7 }), 2);
		const image = blankImage(code.width + 120, code.height);
		paste(image, code, 0, 0);
		const bullseye = drawGrid(
			{
				width: 7,
				height: 7,
				get: (x, y) => Math.max(Math.abs(x - 3), Math.abs(y - 3)) !== 2,
			},
			{ scale: 3, quiet: 2 },
		);
		for (const [x, y] of [
			[code.width + 10, 20],
			[code.width + 70, 20],
			[code.width + 10, 80],
		] as const) {
			paste(image, bullseye, x, y);
		}
		expect(outcome(image, {})).toBe(TEXT);
		expect(outcome(image)).toBe('decode/unreadable margin');
		// Without the decoys the same symbol passes.
		expect(outcome(code)).toBe(TEXT);
	});
});
