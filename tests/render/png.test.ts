import { inflateSync } from 'node:zlib';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { encodePng } from '../../src/render/png.js';
import type { RgbaImage } from '../../src/render/types.js';
import { crc } from './png-writer.js';
import { seeded } from './scenes.js';

interface Chunk {
	readonly type: string;
	readonly data: Uint8Array;
}

/** Split a file into chunks, checking each CRC with the test writer's own table. */
function chunks(bytes: Uint8Array): Chunk[] {
	expect(Array.from(bytes.subarray(0, 8))).toEqual([
		0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
	]);
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const out: Chunk[] = [];
	for (let at = 8; at < bytes.length;) {
		const length = view.getUint32(at);
		const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
		expect(view.getUint32(at + 8 + length), `${type} CRC`).toBe(
			crc(bytes.subarray(at + 4, at + 8 + length)),
		);
		out.push({ type, data: bytes.subarray(at + 8, at + 8 + length) });
		at += 12 + length;
	}
	return out;
}

function header(bytes: Uint8Array): { width: number; height: number; depth: number; type: number } {
	const ihdr = chunks(bytes)[0] as Chunk;
	const view = new DataView(ihdr.data.buffer, ihdr.data.byteOffset);
	return {
		width: view.getUint32(0),
		height: view.getUint32(4),
		depth: ihdr.data[8] as number,
		type: ihdr.data[9] as number,
	};
}

function make(
	width: number,
	height: number,
	pixel: (x: number, y: number) => readonly number[],
): RgbaImage {
	const data = new Uint8ClampedArray(width * height * 4);
	for (let y = 0; y < height; y += 1)
		for (let x = 0; x < width; x += 1) data.set(pixel(x, y), (y * width + x) * 4);
	return { width, height, data };
}

/** pngjs decodes our file to exactly the pixels we encoded. */
function expectReadBack(image: RgbaImage, bytes: Uint8Array): void {
	const decoded = PNG.sync.read(Buffer.from(bytes));
	expect(decoded.width).toBe(image.width);
	expect(decoded.height).toBe(image.height);
	expect(new Uint8ClampedArray(decoded.data)).toEqual(image.data);
}

const random = seeded(3);
const noise = (): number => Math.floor(random() * 256);

describe('encodePng', () => {
	const cases: { name: string; image: RgbaImage; type: number; depth: number }[] = [
		{
			name: 'black and white',
			image: make(37, 9, (x, y) => ((x * y) % 3 ? [0, 0, 0, 255] : [255, 255, 255, 255])),
			type: 0,
			depth: 1,
		},
		{
			name: 'four greys',
			image: make(9, 5, (x) => [85 * (x % 4), 85 * (x % 4), 85 * (x % 4), 255]),
			type: 0,
			depth: 2,
		},
		{
			name: 'sixteen greys',
			image: make(17, 3, (x) => [17 * (x % 16), 17 * (x % 16), 17 * (x % 16), 255]),
			type: 0,
			depth: 4,
		},
		{
			name: 'any greys',
			image: make(31, 4, (x, y) => [x * 8 + y, x * 8 + y, x * 8 + y, 255]),
			type: 0,
			depth: 8,
		},
		{
			name: 'two colours',
			image: make(10, 10, (x) => (x % 2 ? [11, 118, 217, 255] : [159, 159, 159, 255])),
			type: 3,
			depth: 1,
		},
		{
			name: 'three colours',
			image: make(
				10,
				10,
				(x) =>
					[
						[255, 0, 0, 255],
						[0, 255, 0, 255],
						[0, 0, 255, 255],
					][x % 3]!,
			),
			type: 3,
			depth: 2,
		},
		{
			name: 'a dozen colours with translucency',
			image: make(12, 12, (x, y) => [x * 20, 0, 0, y % 2 ? 255 : 100]),
			type: 3,
			depth: 8,
		},
		{ name: 'ten colours', image: make(10, 4, (x) => [x * 25, 10, 10, 255]), type: 3, depth: 4 },
		{
			name: 'grey and alpha',
			image: make(20, 20, (x, y) => [x * 12, x * 12, x * 12, y * 12 + 3]),
			type: 4,
			depth: 8,
		},
		{
			name: 'many opaque colours',
			image: make(20, 20, () => [noise(), noise(), noise(), 255]),
			type: 2,
			depth: 8,
		},
		{
			name: 'many translucent colours',
			image: make(20, 20, () => [noise(), noise(), noise(), noise()]),
			type: 6,
			depth: 8,
		},
		{ name: 'one pixel', image: make(1, 1, () => [1, 2, 3, 4]), type: 3, depth: 1 },
	];

	for (const { name, image, type, depth } of cases) {
		it(`writes ${name} as colour type ${type} at ${depth} bits, read back exactly by pngjs`, () => {
			const bytes = encodePng(image);
			expect(header(bytes)).toEqual({ width: image.width, height: image.height, depth, type });
			expectReadBack(image, bytes);
		});
	}

	it('puts translucent palette entries first, so tRNS is as short as it can be', () => {
		const image = make(
			4,
			1,
			(x) =>
				[
					[1, 1, 1, 255],
					[2, 2, 2, 255],
					[3, 3, 3, 9],
					[4, 4, 4, 255],
				][x]!,
		);
		const found = chunks(encodePng(image));
		const plte = found.find((c) => c.type === 'PLTE') as Chunk;
		const trns = found.find((c) => c.type === 'tRNS') as Chunk;
		expect(Array.from(plte.data)).toEqual([3, 3, 3, 1, 1, 1, 2, 2, 2, 4, 4, 4]);
		expect(Array.from(trns.data)).toEqual([9]);
		expect(found.some((c) => c.type === 'tRNS' && c.data.length > 1)).toBe(false);
		const opaque = chunks(encodePng(make(2, 1, (x) => [x, x, 0, 255])));
		expect(opaque.map((c) => c.type)).toEqual(['IHDR', 'PLTE', 'IDAT', 'IEND']);
	});

	it('writes pHYs in pixels per metre, rounded, when given a dpi', () => {
		const image = make(2, 2, () => [0, 0, 0, 255]);
		for (const [dpi, perMetre] of [
			[300, 11811],
			[72, 2835],
			[96, 3780],
			[1200, 47244],
			[0.0254, 1],
		] as const) {
			const found = chunks(encodePng(image, { dpi }));
			expect(found.map((c) => c.type)).toEqual(['IHDR', 'pHYs', 'IDAT', 'IEND']);
			const phys = found[1] as Chunk;
			const view = new DataView(phys.data.buffer, phys.data.byteOffset);
			expect([view.getUint32(0), view.getUint32(4), phys.data[8]]).toEqual([perMetre, perMetre, 1]);
		}
		expect(chunks(encodePng(image)).some((c) => c.type === 'pHYs')).toBe(false);
	});

	it('compresses with each level, all reading back the same, and the same bytes every time', () => {
		const image = make(64, 64, (x, y) => [x * 4, y * 4, (x ^ y) * 4, 255]);
		const sizes: number[] = [];
		for (const level of [0, 1, 6, 9] as const) {
			const bytes = encodePng(image, { level });
			expectReadBack(image, bytes);
			expect(encodePng(image, { level })).toEqual(bytes);
			sizes.push(bytes.length);
		}
		expect(sizes[0]).toBeGreaterThan(sizes[3] as number);
		expect(encodePng(image)).toEqual(encodePng(image, { level: 6 }));
	});

	it('filters adaptively, using every filter where it pays', () => {
		const image = make(48, 48, (x, y) => [
			(x * 5 + y * 3) & 255,
			(x * y) & 255,
			(x + y * 7) & 255,
			255,
		]);
		const found = chunks(encodePng(image));
		const data = new Uint8Array(
			inflateSync(Buffer.concat(found.filter((c) => c.type === 'IDAT').map((c) => c.data))),
		);
		const filters = new Set<number>();
		for (let y = 0; y < 48; y += 1) filters.add(data[y * (48 * 3 + 1)] as number);
		expect(filters.size).toBeGreaterThan(1);
	});

	it('splits a large stream across IDAT chunks of at most a mebibyte', () => {
		const image = make(700, 500, () => [noise(), noise(), noise(), noise()]);
		const found = chunks(encodePng(image, { level: 0 }));
		const idat = found.filter((c) => c.type === 'IDAT');
		expect(idat.length).toBeGreaterThan(1);
		for (const piece of idat.slice(0, -1)) expect(piece.data.length).toBe(1 << 20);
		expectReadBack(image, encodePng(image, { level: 0 }));
	});

	it('accepts a plain Uint8Array of pixels too', () => {
		const image = {
			width: 1,
			height: 1,
			data: new Uint8Array([9, 8, 7, 255]) as unknown as Uint8ClampedArray,
		};
		expect(PNG.sync.read(Buffer.from(encodePng(image))).data[0]).toBe(9);
	});

	it('refuses a malformed image or options with a TypeError', () => {
		const image = make(1, 1, () => [0, 0, 0, 255]);
		const images: unknown[] = [
			null,
			{ width: 0, height: 1, data: new Uint8ClampedArray(0) },
			{ width: 1, height: 1, data: [0, 0, 0, 0] },
			{ width: 1, height: 1, data: new Uint8ClampedArray(3) },
		];
		for (const bad of images) expect(() => encodePng(bad as RgbaImage)).toThrow(TypeError);
		for (const options of [
			null,
			{ level: 3 },
			{ dpi: 0 },
			{ dpi: -5 },
			{ dpi: Number.NaN },
			{ dpi: 1e12 },
			{ dpi: '300' },
		]) {
			expect(() => encodePng(image, options as never)).toThrow(TypeError);
		}
	});
});
