import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { QrStudioError } from '../../src/core/errors.js';
import { DEFAULT_MAX_PIXELS, decodePng } from '../../src/render/png-decode.js';
import { encodePng } from '../../src/render/png.js';
import type { RgbaImage } from '../../src/render/types.js';
import { chunk, crc, writePng } from './png-writer.js';
import type { PngSpec } from './png-writer.js';
import { seeded } from './scenes.js';

/** The byte after each chunk of a file, in order. */
function chunkEnds(bytes: Uint8Array): number[] {
	const ends: number[] = [];
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	for (let at = 8; at < bytes.length; at += 12 + view.getUint32(at))
		ends.push(at + 12 + view.getUint32(at));
	return ends;
}

/** pngjs's reading of a file, the oracle. */
function oracle(bytes: Uint8Array): Uint8Array {
	return new Uint8Array(PNG.sync.read(Buffer.from(bytes)).data);
}

function failure(bytes: Uint8Array, options?: { maxPixels?: number }): QrStudioError {
	try {
		decodePng(bytes, options);
	} catch (error) {
		expect(error).toBeInstanceOf(QrStudioError);
		return error as QrStudioError;
	}
	throw new Error('decoded a file that should have been refused');
}

const DEPTHS: Record<number, number[]> = {
	0: [1, 2, 4, 8, 16],
	2: [8, 16],
	3: [1, 2, 4, 8],
	4: [8, 16],
	6: [8, 16],
};
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

/** A seeded image of the given kind, with tRNS wherever the kind allows one. */
function spec(
	colourType: number,
	depth: number,
	interlaced: boolean,
	width = 13,
	height = 11,
): PngSpec {
	const random = seeded(colourType * 100 + depth + (interlaced ? 7 : 0));
	const max = (1 << depth) - 1;
	const entries =
		colourType === 3 ? Math.min(1 << depth, 1 + Math.floor(random() * (1 << depth))) : 0;
	const pixels: number[][] = [];
	for (let i = 0; i < width * height; i += 1) {
		const values: number[] = [];
		for (let c = 0; c < (CHANNELS[colourType] as number); c += 1) {
			values.push(
				colourType === 3 ? Math.floor(random() * entries) : Math.floor(random() * (max + 1)),
			);
		}
		pixels.push(values);
	}
	// Make sure the transparent key is used by at least one pixel.
	const key = pixels[3] as number[];
	const palette =
		colourType === 3
			? Array.from(
					{ length: entries },
					() =>
						[0, 0, 0].map(() => Math.floor(random() * 256)) as unknown as [number, number, number],
				)
			: undefined;
	let trns: number[] | undefined;
	if (colourType === 3)
		trns = Array.from({ length: Math.ceil(entries / 2) }, () => Math.floor(random() * 256));
	if (colourType === 0) trns = [key[0]! >> 8, key[0]! & 0xff];
	if (colourType === 2) trns = key.flatMap((v) => [v >> 8, v & 0xff]);
	return {
		width,
		height,
		depth,
		colourType,
		interlaced,
		samples: (x, y) => pixels[y * width + x] as number[],
		...(palette ? { palette } : {}),
		...(trns ? { trns } : {}),
	};
}

describe('decodePng', () => {
	it('reads every colour type and bit depth, interlaced or not, as pngjs does', () => {
		for (const [type, depths] of Object.entries(DEPTHS)) {
			for (const depth of depths) {
				for (const interlaced of [false, true]) {
					const bytes = writePng(spec(Number(type), depth, interlaced));
					const ours = decodePng(bytes);
					expect(ours.width).toBe(13);
					expect(ours.height).toBe(11);
					expect(ours.data, `type ${type} depth ${depth} interlaced ${interlaced}`).toEqual(
						new Uint8ClampedArray(oracle(bytes)),
					);
				}
			}
		}
	});

	it('reads the smallest interlaced images, where most passes are empty', () => {
		for (const [width, height] of [
			[1, 1],
			[1, 9],
			[9, 1],
			[2, 3],
			[5, 5],
		] as const) {
			const bytes = writePng(spec(6, 8, true, width, height));
			expect(decodePng(bytes).data).toEqual(new Uint8ClampedArray(oracle(bytes)));
		}
	});

	it('reads files pngjs wrote, at 8 and 16 bits', () => {
		const random = seeded(5);
		const width = 17;
		const height = 9;
		const image = new PNG({ width, height });
		for (let i = 0; i < image.data.length; i += 1) image.data[i] = Math.floor(random() * 256);
		for (let i = 0; i < width * height; i += 1) {
			// Grey for the grey types, so the conversion pngjs makes is exact.
			if (i % 3 === 0) image.data[i * 4 + 1] = image.data[i * 4 + 2] = image.data[i * 4] as number;
		}
		for (const colorType of [0, 2, 4, 6] as const) {
			const file = PNG.sync.write(image, { colorType, inputHasAlpha: true });
			expect(decodePng(new Uint8Array(file)).data).toEqual(new Uint8ClampedArray(oracle(file)));
		}
		const wide = new Uint16Array(width * height * 4).map(() => Math.floor(random() * 65536));
		const deep = new PNG({ width, height, bitDepth: 16, inputHasAlpha: true });
		deep.data = Buffer.from(wide.buffer);
		for (const colorType of [2, 6] as const) {
			const file = PNG.sync.write(deep, {
				colorType,
				bitDepth: 16,
				inputHasAlpha: true,
				inputColorType: 6,
			});
			expect(decodePng(new Uint8Array(file)).data).toEqual(new Uint8ClampedArray(oracle(file)));
		}
	});

	it('gives back exactly what encodePng wrote, for every colour type it chooses', () => {
		const random = seeded(11);
		const make = (
			width: number,
			height: number,
			pixel: (x: number, y: number) => number[],
		): RgbaImage => {
			const data = new Uint8ClampedArray(width * height * 4);
			for (let y = 0; y < height; y += 1)
				for (let x = 0; x < width; x += 1) data.set(pixel(x, y), (y * width + x) * 4);
			return { width, height, data };
		};
		const images = [
			make(37, 5, (x, y) => ((x + y) % 3 ? [0, 0, 0, 255] : [255, 255, 255, 255])),
			make(9, 9, (x) => [85 * (x % 4), 85 * (x % 4), 85 * (x % 4), 255]),
			make(9, 9, (x) => [17 * x, 17 * x, 17 * x, 255]),
			make(30, 7, (x, y) => [x * 7 + y, x * 7 + y, x * 7 + y, 255]),
			make(20, 20, (x, y) => [(x % 5) * 50, (y % 4) * 60, 9, (x + y) % 3 ? 255 : 0]),
			make(20, 20, (x, y) => [x * 12, x * 12, x * 12, y * 12]),
			make(20, 20, () => [
				Math.floor(random() * 256),
				Math.floor(random() * 256),
				Math.floor(random() * 256),
				255,
			]),
			make(20, 20, () => [0, 0, 0, 0].map(() => Math.floor(random() * 256))),
		];
		for (const image of images) {
			for (const level of [0, 1, 6, 9] as const) {
				expect(decodePng(encodePng(image, { level })).data).toEqual(image.data);
			}
		}
	});

	it('skips ancillary chunks unread, wherever they are, and follows IDAT split anywhere', () => {
		const base = spec(2, 8, false);
		const text = new TextEncoder().encode('Comment\0anything at all');
		const bytes = writePng({
			...base,
			extra: [
				['tEXt', text],
				['gAMA', Uint8Array.from([0, 0, 0xb1, 0x8f])],
				['abCd', Uint8Array.from([1, 2, 3])],
				// A suggested palette for a truecolour image, which may be ignored.
				['PLTE', Uint8Array.from([1, 2, 3])],
			],
			split: 7,
		});
		expect(decodePng(bytes).data).toEqual(new Uint8ClampedArray(oracle(bytes)));
		// Anything after IEND is not part of the file.
		const trailing = Uint8Array.from([...bytes, 1, 2, 3]);
		expect(decodePng(trailing).data).toEqual(decodePng(bytes).data);
	});

	it('ignores a tRNS that does not fit its colour type, as libpng does', () => {
		for (const [type, trns] of [
			[0, [0]],
			[2, [0, 0]],
			[6, [0, 0]],
		] as const) {
			const bytes = writePng({ ...spec(type, 8, false), trns: [...trns] });
			const decoded = decodePng(bytes).data;
			for (let i = 3; i < decoded.length; i += 4) if (type !== 6) expect(decoded[i]).toBe(255);
		}
		// A palette tRNS longer than the palette is ignored too.
		const palette = spec(3, 8, false);
		const long = writePng({ ...palette, trns: Array.from({ length: 300 }, () => 0) });
		expect(
			Array.from(decodePng(long).data.filter((_, i) => i % 4 === 3)).every((a) => a === 255),
		).toBe(true);
	});

	describe('refuses', () => {
		const good = writePng(spec(2, 8, false));

		/** A copy of `good` with the chunk at byte `at` rewritten and its CRC made right again. */
		function withChunk(bytes: Uint8Array, at: number, type: string, data: Uint8Array): Uint8Array {
			const length = new DataView(bytes.buffer, bytes.byteOffset).getUint32(at);
			return Uint8Array.from([
				...bytes.subarray(0, at),
				...chunk(type, data),
				...bytes.subarray(at + 12 + length),
			]);
		}
		const header = (changes: Record<number, number>): Uint8Array => {
			const data = good.slice(16, 29);
			for (const [index, value] of Object.entries(changes)) data[Number(index)] = value;
			return withChunk(good, 8, 'IHDR', data);
		};
		const reason = (bytes: Uint8Array): string | number | undefined => {
			const error = failure(bytes);
			expect(error.code).toBe('image/unreadable');
			expect(error.message).not.toMatch(/[0-9]/);
			return error.params.reason;
		};

		it('what is not a PNG', () => {
			expect(reason(new Uint8Array(0))).toBe('signature');
			expect(reason(Uint8Array.from([0x89, 0x50, 0x4e]))).toBe('signature');
			expect(reason(Uint8Array.from([...good.subarray(0, 7), 0, ...good.subarray(8)]))).toBe(
				'signature',
			);
		});

		it('a chunk whose CRC is wrong', () => {
			const bytes = good.slice();
			bytes[20] = (bytes[20] as number) ^ 1;
			expect(reason(bytes)).toBe('crc');
		});

		it('a header that is missing, malformed or contradicts itself', () => {
			expect(
				reason(Uint8Array.from([...good.subarray(0, 8), ...chunk('IDAT', new Uint8Array(1))])),
			).toBe('header');
			expect(reason(withChunk(good, 8, 'IHDR', new Uint8Array(12)))).toBe('header');
			expect(reason(header({ 0: 0, 1: 0, 2: 0, 3: 0 }))).toBe('header');
			expect(reason(header({ 4: 0x80 }))).toBe('header');
			expect(reason(header({ 8: 4 }))).toBe('header');
			expect(reason(header({ 9: 5 }))).toBe('header');
			expect(reason(header({ 10: 1 }))).toBe('header');
			expect(reason(header({ 11: 1 }))).toBe('header');
			expect(reason(header({ 12: 2 }))).toBe('header');
			const twice = Uint8Array.from([
				...good.subarray(0, 33),
				...good.subarray(8, 33),
				...good.subarray(33),
			]);
			expect(reason(twice)).toBe('header');
		});

		it('a file cut short, or with no end', () => {
			expect(reason(good.subarray(0, 40))).toBe('truncated');
			expect(reason(good.subarray(0, good.length - 12))).toBe('truncated');
			expect(reason(good.subarray(0, 30))).toBe('truncated');
		});

		it('a chunk with an impossible length, a bad type or an unknown critical type', () => {
			const huge = good.slice();
			huge.set([0x80, 0, 0, 0], 33);
			expect(reason(huge)).toBe('chunk');
			const badType = Uint8Array.from([
				...good.subarray(0, 33),
				...chunk('a1b2', new Uint8Array(0)),
				...good.subarray(33),
			]);
			expect(reason(badType)).toBe('chunk');
			const critical = Uint8Array.from([
				...good.subarray(0, 33),
				...chunk('ABCD', new Uint8Array(0)),
				...good.subarray(33),
			]);
			expect(reason(critical)).toBe('chunk');
		});

		it('a palette image with no palette, a malformed one, or an index past its end', () => {
			const palette = spec(3, 4, false);
			const { palette: _entries, ...noPalette } = palette;
			expect(reason(writePng(noPalette))).toBe('palette');
			const bytes = writePng(palette);
			expect(reason(writePng({ ...palette, extra: [['PLTE', Uint8Array.from([1, 2])]] }))).toBe(
				'palette',
			);
			expect(reason(writePng({ ...palette, extra: [['PLTE', new Uint8Array(0)]] }))).toBe(
				'palette',
			);
			// Two palettes.
			expect(reason(writePng({ ...palette, extra: [['PLTE', Uint8Array.from([1, 2, 3])]] }))).toBe(
				'palette',
			);
			// More entries than four bits can index.
			expect(
				reason(
					writePng({
						...palette,
						palette: Array.from({ length: 17 }, () => [0, 0, 0] as [number, number, number]),
					}),
				),
			).toBe('palette');
			const short = writePng({ ...palette, palette: [[0, 0, 0]], samples: () => [3] });
			expect(reason(short)).toBe('palette');
			expect(decodePng(bytes).width).toBe(13);
			// A palette after the image data.
			const late = Uint8Array.from([
				...bytes.subarray(0, bytes.length - 12),
				...chunk('PLTE', Uint8Array.from([1, 2, 3])),
				...bytes.subarray(bytes.length - 12),
			]);
			expect(reason(late)).toBe('palette');
		});

		it('image data that is missing, damaged, the wrong length, split by another chunk or wrongly filtered', () => {
			const end = chunk('IEND', new Uint8Array(0));
			expect(reason(Uint8Array.from([...good.subarray(0, 33), ...end]))).toBe('data');
			const zeroes = Uint8Array.from([
				...good.subarray(0, 33),
				...chunk('IDAT', new Uint8Array(20)),
				...end,
			]);
			expect(reason(zeroes)).toBe('data');
			const tooShort = writePng({ ...spec(2, 8, false), height: 11, samples: () => [1, 2, 3] });
			const cut = Uint8Array.from(tooShort);
			// Claim one more row than the data holds.
			const claimed = Uint8Array.from([
				...cut.subarray(0, 8),
				...chunk('IHDR', Uint8Array.from([0, 0, 0, 13, 0, 0, 0, 12, 8, 2, 0, 0, 0])),
				...cut.subarray(33),
			]);
			expect(reason(claimed)).toBe('data');
			const fewer = Uint8Array.from([
				...cut.subarray(0, 8),
				...chunk('IHDR', Uint8Array.from([0, 0, 0, 13, 0, 0, 0, 10, 8, 2, 0, 0, 0])),
				...cut.subarray(33),
			]);
			expect(reason(fewer)).toBe('data');
			const split = writePng({ ...spec(2, 8, false), split: 10 });
			const firstEnd = chunkEnds(split).find(
				(end) => split[end - 18] === 0x49 && split[end - 17] === 0x44,
			) as number;
			const interrupted = Uint8Array.from([
				...split.subarray(0, firstEnd),
				...chunk('tEXt', Uint8Array.from([65, 0, 66])),
				...split.subarray(firstEnd),
			]);
			expect(reason(interrupted)).toBe('data');
			expect(reason(writePng({ ...spec(2, 8, false), filter: () => 5 }))).toBe('data');
		});

		it('an image with more pixels than allowed, before reading its data', () => {
			const big = withChunk(
				good,
				8,
				'IHDR',
				Uint8Array.from([0, 0x80, 0, 0, 0, 0x80, 0, 0, 8, 6, 0, 0, 0]),
			);
			const error = failure(big);
			expect(error.code).toBe('image/too-large');
			expect(error.params).toEqual({
				width: 8388608,
				height: 8388608,
				maxPixels: DEFAULT_MAX_PIXELS,
			});
			expect(failure(good, { maxPixels: 100 }).code).toBe('image/too-large');
			expect(decodePng(good, { maxPixels: 143 }).width).toBe(13);
		});

		it('arguments of the wrong type, with a TypeError', () => {
			expect(() => decodePng([1, 2, 3] as unknown as Uint8Array)).toThrow(TypeError);
			expect(() => decodePng(good, null as never)).toThrow(TypeError);
			for (const maxPixels of [0, -1, 1.5, Number.NaN]) {
				expect(() => decodePng(good, { maxPixels })).toThrow(TypeError);
			}
		});
	});

	it('checks CRCs the same way the test writer computes them', () => {
		expect(crc(new TextEncoder().encode('IEND'))).toBe(0xae426082);
	});
});
