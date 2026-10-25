/**
 * Captions drawn by this package against resvg setting the same text from the
 * source TrueType files.
 *
 * resvg shapes text with rustybuzz, a port of HarfBuzz, so this checks the
 * whole chain at once against an independent one: the compiled outlines, the
 * advances, the kerning (summed over every lookup of the feature, as HarfBuzz
 * does), and the placement of each line. Each line is handed to resvg as an
 * SVG text element at the start and baseline our layout chose; everything
 * after that point is resvg's own.
 *
 * Some captions include pairs where opentype.js's `getKerningValue` gives 0
 * and shaping gives a large adjustment ("//" is -190 units in Bold, "T/" is
 * -100). At these sizes a wrong answer there moves the rest of the line by
 * several pixels, which fails the flat-interior check by a wide margin.
 *
 * resvg's own anti-aliasing comes in coarse steps, so as in
 * `tests/render/resvg.test.ts` it draws at eight times the size and is box
 * filtered down; our caption is drawn at the real size, six pixels to the
 * unit. The limits are set just above what was measured when they were
 * written, which is noted beside them.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { rasterise } from '../../src/render/raster.js';
import type { RgbaImage, Scene } from '../../src/render/types.js';
import { layoutText } from '../../src/text/layout.js';
import type { LayoutOptions } from '../../src/text/types.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const FONT_FILES = ['fonts/IBMPlexSans-Regular.ttf', 'fonts/IBMPlexSans-Bold.ttf'].map((file) =>
	resolve(root, file),
);
const OVERSAMPLE = 8;

function shrink(big: RgbaImage, k: number): RgbaImage {
	const width = big.width / k;
	const height = big.height / k;
	const data = new Uint8ClampedArray(width * height * 4);
	for (let y = 0; y < height; y += 1) {
		for (let x = 0; x < width; x += 1) {
			let r = 0;
			let g = 0;
			let b = 0;
			let a = 0;
			for (let dy = 0; dy < k; dy += 1) {
				for (let dx = 0; dx < k; dx += 1) {
					const at = ((y * k + dy) * big.width + x * k + dx) * 4;
					const alpha = (big.data[at + 3] as number) / 255;
					r += (big.data[at] as number) * alpha;
					g += (big.data[at + 1] as number) * alpha;
					b += (big.data[at + 2] as number) * alpha;
					a += alpha;
				}
			}
			const out = (y * width + x) * 4;
			if (a > 0) {
				data[out] = Math.round(r / a);
				data[out + 1] = Math.round(g / a);
				data[out + 2] = Math.round(b / a);
			}
			data[out + 3] = Math.round((a / (k * k)) * 255);
		}
	}
	return { width, height, data };
}

function escape(text: string): string {
	return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

interface Caption {
	readonly text: string;
	readonly weight: 400 | 700;
	readonly width: number;
	readonly height: number;
	readonly size: number;
	readonly maxLines: number;
	readonly align: 'start' | 'centre' | 'end';
}

const captions: Caption[] = [
	{ text: 'SCAN ME', weight: 700, width: 60, height: 14, size: 10, maxLines: 1, align: 'centre' },
	{
		text: 'AVATAR Tower WAVY To. Yo, P.',
		weight: 700,
		width: 150,
		height: 14,
		size: 9,
		maxLines: 1,
		align: 'start',
	},
	{
		text: 'http://example.com // T/ (x) ?.',
		weight: 700,
		width: 160,
		height: 14,
		size: 9,
		maxLines: 1,
		align: 'end',
	},
	{
		text: 'Ωμέγα ΑΥΤΟ Жук ДОМ Ѐ',
		weight: 700,
		width: 120,
		height: 14,
		size: 9,
		maxLines: 1,
		align: 'centre',
	},
	{
		text: 'Scan for the menu and today\u2019s specials \u2013 \u20ac5',
		weight: 400,
		width: 120,
		height: 30,
		size: 9,
		maxLines: 2,
		align: 'centre',
	},
	{
		text: 'Łódź Šibenik Ærøskøbing Œuvre',
		weight: 400,
		width: 150,
		height: 14,
		size: 9,
		maxLines: 1,
		align: 'start',
	},
];

function render(caption: Caption, scale: number): { ours: RgbaImage; theirs: RgbaImage } {
	const options: LayoutOptions = {
		fontId: caption.weight === 700 ? 'plex-sans-bold' : 'plex-sans-regular',
		size: caption.size,
		box: { x: 0, y: 0, width: caption.width, height: caption.height },
		maxLines: caption.maxLines,
		align: caption.align,
	};
	const layout = layoutText(caption.text, options);
	expect(layout.missing).toEqual([]);
	expect(layout.overflow).toBe(false);
	const scene: Scene = {
		width: caption.width,
		height: caption.height,
		background: { kind: 'solid', colour: { r: 255, g: 255, b: 255, a: 1 } },
		layers: layout.paths.map((path) => ({
			kind: 'path' as const,
			path,
			paint: { kind: 'solid' as const, colour: { r: 0, g: 0, b: 0, a: 1 } },
		})),
	};
	const width = caption.width * scale;
	const ours = rasterise(scene, { width });
	const lines = layout.lines
		.map(
			(line) =>
				`<text x="${line.x}" y="${line.baseline}" font-family="IBM Plex Sans" font-weight="${caption.weight}" font-size="${caption.size}" xml:space="preserve">${escape(line.text)}</text>`,
		)
		.join('');
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${caption.width} ${caption.height}"><rect width="${caption.width}" height="${caption.height}" fill="#fff"/>${lines}</svg>`;
	const png = new Resvg(svg, {
		fitTo: { mode: 'width', value: width * OVERSAMPLE },
		font: { fontFiles: FONT_FILES, loadSystemFonts: false, defaultFontFamily: 'IBM Plex Sans' },
	})
		.render()
		.asPng();
	const decoded = PNG.sync.read(png);
	const theirs = shrink(
		{ width: decoded.width, height: decoded.height, data: new Uint8ClampedArray(decoded.data) },
		OVERSAMPLE,
	);
	return { ours, theirs };
}

interface Difference {
	readonly mean: number;
	readonly max: number;
	readonly overEight: number;
	readonly interiorOverFour: number;
}

function compare(ours: RgbaImage, theirs: RgbaImage): Difference {
	expect(theirs.width).toBe(ours.width);
	expect(theirs.height).toBe(ours.height);
	const { width, height } = ours;
	let sum = 0;
	let max = 0;
	let overEight = 0;
	let interior = 0;
	for (let y = 1; y < height - 1; y += 1) {
		for (let x = 1; x < width - 1; x += 1) {
			const at = (y * width + x) * 4;
			const d = Math.abs((ours.data[at] as number) - (theirs.data[at] as number));
			sum += d;
			max = Math.max(max, d);
			if (d > 8) overEight += 1;
			if (d <= 4) continue;
			let flat = true;
			for (let dy = -1; dy <= 1 && flat; dy += 1) {
				for (let dx = -1; dx <= 1; dx += 1) {
					const near = ((y + dy) * width + x + dx) * 4;
					if (Math.abs((ours.data[near] as number) - (ours.data[at] as number)) > 3) flat = false;
				}
			}
			if (flat) interior += 1;
		}
	}
	const pixels = (width - 2) * (height - 2);
	return {
		mean: sum / pixels,
		max,
		overEight: overEight / pixels,
		interiorOverFour: interior / pixels,
	};
}

describe('captions against resvg setting the same text', () => {
	for (const caption of captions) {
		it(`draws "${caption.text}" as rustybuzz sets it`, () => {
			const { ours, theirs } = render(caption, 6);
			const difference = compare(ours, theirs);
			const report = JSON.stringify(difference);
			// Measured when written: the worst pixel 6 levels out, the worst
			// mean 0.064 of a level, no pixel over 8 and none flat in our render
			// over 4. The two agree to within anti-aliasing.
			expect(difference.max, report).toBeLessThanOrEqual(10);
			expect(difference.mean, report).toBeLessThan(0.15);
			expect(difference.overEight, report).toBe(0);
			expect(difference.interiorOverFour, report).toBe(0);
		});
	}

	it('would notice the line moved by a fifth of a pixel', () => {
		// The check above is only worth something if it fails for a small
		// error. Shift our caption by 0.2 px and it must.
		const caption = captions[2] as Caption;
		const { ours, theirs } = render(caption, 6);
		expect(compare(ours, theirs).max).toBeLessThanOrEqual(10);
		const moved = new Uint8ClampedArray(ours.data.length).fill(255);
		const { width, height } = ours;
		for (let y = 0; y < height; y += 1) {
			for (let x = 1; x < width; x += 1) {
				const at = (y * width + x) * 4;
				const from = (y * width + x - 1) * 4;
				for (let c = 0; c < 4; c += 1) {
					moved[at + c] = Math.round(
						0.8 * (ours.data[at + c] as number) + 0.2 * (ours.data[from + c] as number),
					);
				}
			}
		}
		const shifted = compare({ width, height, data: moved }, theirs);
		// Measured: a mean of 1.6 levels against 0.05, and edges well past
		// the limit above.
		expect(shifted.mean).toBeGreaterThan(0.15);
		expect(shifted.max).toBeGreaterThan(10);
	});
});

describe('the font files resvg was given', () => {
	it('are the committed sources', () => {
		for (const file of FONT_FILES) expect(readFileSync(file).length).toBeGreaterThan(100_000);
	});
});
