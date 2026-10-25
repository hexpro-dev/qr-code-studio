/**
 * Reducing a picture by area averaging, in plain arithmetic.
 *
 * A logo is stored at no more than 1024 pixels a side, and the reduction has
 * to be the same in every browser so the same file gives the same design, so
 * it is done here rather than by a canvas, whose smoothing differs between
 * engines and is a single bilinear tap in some of them. Every output pixel is
 * the average of the source area it covers, each source pixel weighted by how
 * much of it falls inside, which is the reduction a box filter of exactly the
 * right width gives.
 *
 * Colour is averaged premultiplied by alpha, so a transparent pixel's colour,
 * which nobody sees, does not bleed a dark fringe into the edge of a logo.
 */

import type { RgbaImage } from '../core/image.js';

/** The size `width` by `height` comes to with neither side over `maxSide`, never enlarged. */
export function fitWithin(width: number, height: number, maxSide: number): [number, number] {
	const longest = Math.max(width, height);
	if (longest <= maxSide) return [width, height];
	const scale = maxSide / longest;
	return [Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale))];
}

/** For each output index, the source indices it covers and how much of each. */
function spans(
	source: number,
	target: number,
): { readonly start: number; readonly weights: Float64Array }[] {
	const ratio = source / target;
	const out: { start: number; weights: Float64Array }[] = [];
	for (let i = 0; i < target; i += 1) {
		const from = i * ratio;
		const to = (i + 1) * ratio;
		const start = Math.floor(from);
		const end = Math.min(source, Math.ceil(to));
		const weights = new Float64Array(end - start);
		for (let s = start; s < end; s += 1) {
			weights[s - start] = (Math.min(to, s + 1) - Math.max(from, s)) / ratio;
		}
		out.push({ start, weights });
	}
	return out;
}

/** `image` reduced to `width` by `height` by area averaging. Neither may be larger than the source. */
export function areaAverage(image: RgbaImage, width: number, height: number): RgbaImage {
	if (
		!Number.isInteger(width) ||
		!Number.isInteger(height) ||
		width < 1 ||
		height < 1 ||
		width > image.width ||
		height > image.height
	) {
		throw new TypeError(
			'areaAverage: the target is a whole number of pixels, 1 to the source size.',
		);
	}
	if (width === image.width && height === image.height) return image;
	const { data } = image;
	// Premultiplied, horizontal pass first: source rows, target columns.
	const across = spans(image.width, width);
	const middle = new Float64Array(width * image.height * 4);
	for (let y = 0; y < image.height; y += 1) {
		for (let x = 0; x < width; x += 1) {
			const { start, weights } = across[x] as (typeof across)[number];
			let r = 0;
			let g = 0;
			let b = 0;
			let a = 0;
			for (let k = 0; k < weights.length; k += 1) {
				const at = (y * image.width + start + k) * 4;
				const w = weights[k] as number;
				const alpha = (data[at + 3] as number) * w;
				r += (data[at] as number) * alpha;
				g += (data[at + 1] as number) * alpha;
				b += (data[at + 2] as number) * alpha;
				a += alpha;
			}
			const to = (y * width + x) * 4;
			middle[to] = r;
			middle[to + 1] = g;
			middle[to + 2] = b;
			middle[to + 3] = a;
		}
	}
	const down = spans(image.height, height);
	const out = new Uint8ClampedArray(width * height * 4);
	for (let y = 0; y < height; y += 1) {
		const { start, weights } = down[y] as (typeof down)[number];
		for (let x = 0; x < width; x += 1) {
			let r = 0;
			let g = 0;
			let b = 0;
			let a = 0;
			for (let k = 0; k < weights.length; k += 1) {
				const at = ((start + k) * width + x) * 4;
				const w = weights[k] as number;
				r += (middle[at] as number) * w;
				g += (middle[at + 1] as number) * w;
				b += (middle[at + 2] as number) * w;
				a += (middle[at + 3] as number) * w;
			}
			const to = (y * width + x) * 4;
			if (a > 0) {
				out[to] = Math.round(r / a);
				out[to + 1] = Math.round(g / a);
				out[to + 2] = Math.round(b / a);
			}
			out[to + 3] = Math.round(a);
		}
	}
	return { width, height, data: out };
}
