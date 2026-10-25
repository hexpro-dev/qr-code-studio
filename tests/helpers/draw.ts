/**
 * Drawing a module grid onto pixels, for the reader to read back.
 *
 * Axis-aligned squares on RGBA, the way the authenticator's
 * `renderQrImageData` does it, so a test controls every pixel and a wrong
 * expectation is arithmetic rather than a renderer's opinion. The render layer
 * draws the real thing; these tests are about the reader.
 */

import type { RgbaImage } from '../../src/core/image.js';

/** Anything with a width, a height and a dark-or-light per module. */
export interface ModuleGrid {
	readonly width: number;
	readonly height: number;
	get(x: number, y: number): 0 | 1 | boolean;
}

export interface DrawOptions {
	/** Pixels per module, a whole number. Default 6. */
	readonly scale?: number;
	/** Quiet zone, in modules. Default 4. */
	readonly quiet?: number;
	/** Grey level of a dark module. Default 0. */
	readonly dark?: number;
	/** Grey level of a light module and the quiet zone. Default 255. */
	readonly light?: number;
}

export function blankImage(width: number, height: number, level = 255): RgbaImage {
	const data = new Uint8ClampedArray(width * height * 4).fill(level);
	for (let i = 3; i < data.length; i += 4) data[i] = 255;
	return { width, height, data };
}

export function drawGrid(grid: ModuleGrid, options: DrawOptions = {}): RgbaImage {
	const scale = options.scale ?? 6;
	const quiet = options.quiet ?? 4;
	const dark = options.dark ?? 0;
	const light = options.light ?? 255;
	const width = (grid.width + quiet * 2) * scale;
	const height = (grid.height + quiet * 2) * scale;
	const image = blankImage(width, height, light);
	for (let y = 0; y < grid.height; y += 1) {
		for (let x = 0; x < grid.width; x += 1) {
			if (!grid.get(x, y)) continue;
			fillRect(image, (x + quiet) * scale, (y + quiet) * scale, scale, scale, dark);
		}
	}
	return image;
}

export function fillRect(
	image: RgbaImage,
	x: number,
	y: number,
	w: number,
	h: number,
	level: number,
): void {
	// Whole pixels: a fractional index into a typed array writes nothing at all.
	const x0 = Math.max(0, Math.round(x));
	const y0 = Math.max(0, Math.round(y));
	const x1 = Math.min(image.width, Math.round(x + w));
	const y1 = Math.min(image.height, Math.round(y + h));
	for (let row = y0; row < y1; row += 1) {
		for (let column = x0; column < x1; column += 1) {
			const at = (row * image.width + column) * 4;
			image.data[at] = level;
			image.data[at + 1] = level;
			image.data[at + 2] = level;
			image.data[at + 3] = 255;
		}
	}
}

/** Paste `source` into `target` with its top left at (x, y). */
export function paste(target: RgbaImage, source: RgbaImage, x: number, y: number): void {
	for (let row = 0; row < source.height; row += 1) {
		const ty = y + row;
		if (ty < 0 || ty >= target.height) continue;
		for (let column = 0; column < source.width; column += 1) {
			const tx = x + column;
			if (tx < 0 || tx >= target.width) continue;
			const from = (row * source.width + column) * 4;
			const to = (ty * target.width + tx) * 4;
			for (let c = 0; c < 4; c += 1) target.data[to + c] = source.data[from + c] as number;
		}
	}
}
