/**
 * The malformed-input contract for the reader (tests/fuzz): whatever picture
 * or matrix it is handed, `decodeImage` returns a Result whose failure is a
 * QrStudioError, `decodeMatrix` throws nothing else, and every call finishes,
 * watched from another thread.
 *
 * The pictures are the ones a reader's loops are most likely to choke on:
 * flat fields, one pixel, a thousand pixels by one, checkerboards at every
 * pitch, finder patterns tiled or scattered by the hundred, stripes that hold
 * the finder ratio on every row, and seeded noise, plus real codes with
 * blocks of them overwritten.
 */

import fc from 'fast-check';
import { afterAll, describe, expect, it } from 'vitest';
import { BitMatrix } from '../../src/core/bit-matrix.js';
import { QrStudioError } from '../../src/core/errors.js';
import type { RgbaImage } from '../../src/core/image.js';
import { decodeImage, decodeMatrix } from '../../src/decode/decoder.js';
import { encode } from '../../src/encode/encode.js';
import { guardUnhandledRejections } from '../fuzz/setup.js';
import { startWatchdog } from '../fuzz/watchdog.js';
import { blankImage, drawGrid, fillRect, paste } from '../helpers/draw.js';

guardUnhandledRejections();
const watchdog = startWatchdog();
afterAll(() => watchdog.stop());

const CODES = new Set(['decode/not-found', 'decode/unreadable', 'decode/unsupported']);

function expectContract(label: string, image: RgbaImage): void {
	for (const profile of ['lenient', 'strict-v1'] as const) {
		watchdog.beat(`${profile} ${label}`);
		const result = decodeImage(image, { profile });
		if (!result.ok) {
			expect(result.error, label).toBeInstanceOf(QrStudioError);
			expect(CODES.has(result.error.code), `${label}: ${result.error.code}`).toBe(true);
		}
	}
}

function pattern(
	width: number,
	height: number,
	dark: (x: number, y: number) => boolean,
): RgbaImage {
	const image = blankImage(width, height);
	for (let y = 0; y < height; y += 1) {
		for (let x = 0; x < width; x += 1) {
			if (!dark(x, y)) continue;
			const at = (y * width + x) * 4;
			image.data[at] = 0;
			image.data[at + 1] = 0;
			image.data[at + 2] = 0;
		}
	}
	return image;
}

const bullseye = (x: number, y: number): boolean =>
	Math.max(Math.abs((x % 7) - 3), Math.abs((y % 7) - 3)) !== 2;

describe('adversarial pictures', () => {
	const cases: [string, RgbaImage][] = [
		['1x1 white', blankImage(1, 1)],
		['1x1 black', blankImage(1, 1, 0)],
		['white', blankImage(64, 64)],
		['black', blankImage(64, 64, 0)],
		['transparent', { width: 32, height: 32, data: new Uint8ClampedArray(32 * 32 * 4) }],
		['long thin row', pattern(4000, 1, (x) => x % 5 < 2)],
		['long thin column', pattern(1, 4000, (_, y) => y % 3 === 0)],
		['three rows', pattern(3000, 3, (x) => x % 7 === 3)],
		['huge, flat', blankImage(2400, 1600, 200)],
		...[1, 2, 3, 7].map((pitch): [string, RgbaImage] => [
			`checkerboard ${pitch}`,
			pattern(150, 150, (x, y) => (Math.floor(x / pitch) + Math.floor(y / pitch)) % 2 === 0),
		]),
		...[1, 2, 4].map((scale): [string, RgbaImage] => [
			`finders tiled at ${scale}`,
			pattern(210, 210, (x, y) => bullseye(Math.floor(x / scale), Math.floor(y / scale))),
		]),
		['finder-ratio stripes', pattern(200, 200, (x) => [1, 0, 1, 1, 1, 0, 1, 0][x % 8] === 1)],
		[
			'concentric squares',
			pattern(201, 201, (x, y) => Math.max(Math.abs(x - 100), Math.abs(y - 100)) % 4 < 2),
		],
	];

	for (const [label, image] of cases) {
		it(`returns a Result for ${label}`, () => expectContract(label, image));
	}

	it('returns a Result for scattered finder patterns by the hundred', () => {
		const image = blankImage(400, 400);
		const finder = drawGrid({ width: 7, height: 7, get: bullseye }, { scale: 2, quiet: 1 });
		let state = 7;
		for (let i = 0; i < 200; i += 1) {
			state = (state * 1103515245 + 12345) % 2147483648;
			paste(image, finder, state % 384, Math.floor(state / 384) % 384);
		}
		expectContract('scattered finders', image);
	});
});

describe('random pictures and damaged codes', () => {
	it('returns a Result for seeded noise of every shape', () => {
		fc.assert(
			fc.property(
				fc.integer({ min: 1, max: 96 }),
				fc.integer({ min: 1, max: 96 }),
				fc.integer({ min: 0, max: 0xffffffff }),
				(width, height, seed) => {
					const data = new Uint8ClampedArray(width * height * 4);
					let state = seed;
					for (let i = 0; i < data.length; i += 1) {
						state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
						data[i] = i % 4 === 3 ? 255 : state >>> 24;
					}
					expectContract(`noise ${width}x${height} ${seed}`, { width, height, data });
				},
			),
			{ numRuns: 60, seed: 4242 },
		);
	});

	it('returns a Result for codes with blocks overwritten', () => {
		const clean = drawGrid(encode('https://example.com/fuzz', { ecLevel: 'L' }).matrix, {
			scale: 4,
		});
		fc.assert(
			fc.property(
				fc.array(
					fc.tuple(
						fc.integer({ min: 0, max: clean.width }),
						fc.integer({ min: 0, max: clean.height }),
						fc.integer({ min: 1, max: 40 }),
						fc.integer({ min: 0, max: 255 }),
					),
					{ minLength: 1, maxLength: 12 },
				),
				(blocks) => {
					const image = { ...clean, data: new Uint8ClampedArray(clean.data) };
					for (const [x, y, side, level] of blocks) fillRect(image, x, y, side, side, level);
					expectContract(`blocks ${JSON.stringify(blocks)}`, image);
				},
			),
			{ numRuns: 60, seed: 77 },
		);
	});
});

describe('decodeMatrix on any matrix', () => {
	it('throws only QrStudioError, for legal sizes and others', () => {
		fc.assert(
			fc.property(
				fc.constantFrom(11, 20, 21, 25, 57, 101),
				fc.integer({ min: 0, max: 0xffffffff }),
				fc.boolean(),
				(size, seed, strict) => {
					const data = new Uint8Array(size * size);
					let state = seed;
					for (let i = 0; i < data.length; i += 1) {
						state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
						data[i] = state >>> 31;
					}
					watchdog.beat(`matrix ${size} ${seed}`);
					try {
						decodeMatrix(new BitMatrix(size, size, data), { strict });
					} catch (error) {
						expect(error).toBeInstanceOf(QrStudioError);
					}
				},
			),
			{ numRuns: 200, seed: 9 },
		);
	});
});
