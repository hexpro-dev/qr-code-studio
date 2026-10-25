/**
 * Greyscale, and the resolution policy.
 *
 * Lifted from the authenticator package's reader
 * (google-auth-secret-retriever, `src/qr/decode/grey.ts`), where every
 * function here was a bug that shipped before it was right, and adapted to
 * this package: alpha is composited over white, nothing reads a clock, and the
 * only cap is by area.
 */

import type { RgbaImage } from '../core/image.js';

/** A single-channel image. One byte per pixel, 0 dark to 255 light. */
export interface GreyImage {
	readonly data: Uint8Array;
	readonly width: number;
	readonly height: number;
}

/**
 * RGBA to luma, ITU-R BT.601 weights in fixed point, over white.
 *
 * Integer arithmetic because this runs over every pixel of a camera frame
 * thirty times a second, and the difference is invisible after thresholding.
 *
 * A transparent pixel is read as the paper it will be printed on. A PNG with a
 * transparent background stores its light modules as alpha 0 with whatever
 * colour the writer left there, very often black, and reading the colour alone
 * would turn every light module dark.
 */
export function toGrey(image: RgbaImage): GreyImage {
	const { data, width, height } = image;
	const out = new Uint8Array(width * height);
	for (let i = 0, p = 0; i < out.length; i += 1, p += 4) {
		const r = data[p] as number;
		const g = data[p + 1] as number;
		const b = data[p + 2] as number;
		const a = data[p + 3] as number;
		// 0.299, 0.587, 0.114 scaled by 1024.
		const luma = (r * 306 + g * 601 + b * 117) >> 10;
		out[i] = a === 255 ? luma : Math.round((luma * a) / 255 + (255 - a));
	}
	return { data: out, width, height };
}

/**
 * Halve the resolution with a 2x2 box filter.
 *
 * Two jobs at once: it brings a large photograph into the range the finder
 * scan is tuned for, and the averaging takes sensor noise out from under the
 * binariser, which is usually what defeats a dim capture.
 */
export function downscaleHalf(image: GreyImage): GreyImage {
	const width = Math.max(1, image.width >> 1);
	const height = Math.max(1, image.height >> 1);
	const out = new Uint8Array(width * height);
	const lastX = image.width - 1;
	const lastY = image.height - 1;
	for (let y = 0; y < height; y += 1) {
		const top = y * 2 * image.width;
		const bottom = Math.min(y * 2 + 1, lastY) * image.width;
		for (let x = 0; x < width; x += 1) {
			const left = x * 2;
			const right = Math.min(left + 1, lastX);
			const sum =
				(image.data[top + left] as number) +
				(image.data[top + right] as number) +
				(image.data[bottom + left] as number) +
				(image.data[bottom + right] as number);
			out[y * width + x] = sum >> 2;
		}
	}
	return { data: out, width, height };
}

/**
 * Reduce to an arbitrary size by averaging each destination pixel's exact
 * source footprint.
 *
 * The alternative, a bilinear tap, reads two source pixels per axis however
 * far the reduction goes: reducing 4032 pixels to 1600 that way samples 4 of
 * every 25 and throws the rest away, so module edges alias at whatever phase
 * the grid happens to catch them and the binariser inherits stripes that were
 * never in the symbol.
 */
export function downscaleArea(image: GreyImage, width: number, height: number): GreyImage {
	const out = new Uint8Array(width * height);
	const stepX = image.width / width;
	const stepY = image.height / height;
	for (let y = 0; y < height; y += 1) {
		const top = y * stepY;
		const bottom = Math.min(image.height, (y + 1) * stepY);
		const lastRow = Math.ceil(bottom);
		for (let x = 0; x < width; x += 1) {
			const left = x * stepX;
			const right = Math.min(image.width, (x + 1) * stepX);
			const lastColumn = Math.ceil(right);
			let total = 0;
			let weight = 0;
			for (let sy = Math.floor(top); sy < lastRow; sy += 1) {
				// Partial rows and columns carry their overlap as a weight, which keeps
				// the result free of the periodic bias a rounded footprint leaves at a
				// non-integer ratio.
				const wy = Math.min(sy + 1, bottom) - Math.max(sy, top);
				const row = sy * image.width;
				for (let sx = Math.floor(left); sx < lastColumn; sx += 1) {
					const w = (Math.min(sx + 1, right) - Math.max(sx, left)) * wy;
					total += (image.data[row + sx] as number) * w;
					weight += w;
				}
			}
			out[y * width + x] = Math.round(total / weight);
		}
	}
	return { data: out, width, height };
}

/**
 * Enlarge by an integer factor, interpolating.
 *
 * Nearest neighbour is the tempting choice, on the grounds that interpolation
 * invents greys along every module edge. At the resolution this rung exists
 * for, three pixels a module or fewer, those greys are not invented: they are
 * the only record of where the edge sits. Measured in the authenticator at 2.5
 * pixels a module, nearest scored the same as no upscale and this scored 100%.
 */
export function upscaleSmooth(image: GreyImage, factor: number): GreyImage {
	const width = image.width * factor;
	const height = image.height * factor;
	const out = new Uint8Array(width * height);
	for (let y = 0; y < height; y += 1) {
		// Pixel centres, so the interpolation is not half a pixel out.
		const sourceY = Math.min(image.height - 1, Math.max(0, (y + 0.5) / factor - 0.5));
		const y0 = Math.floor(sourceY);
		const y1 = Math.min(image.height - 1, y0 + 1);
		const fy = sourceY - y0;
		for (let x = 0; x < width; x += 1) {
			const sourceX = Math.min(image.width - 1, Math.max(0, (x + 0.5) / factor - 0.5));
			const x0 = Math.floor(sourceX);
			const x1 = Math.min(image.width - 1, x0 + 1);
			const fx = sourceX - x0;
			const a = image.data[y0 * image.width + x0] as number;
			const b = image.data[y0 * image.width + x1] as number;
			const c = image.data[y1 * image.width + x0] as number;
			const d = image.data[y1 * image.width + x1] as number;
			out[y * width + x] = Math.round(
				a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy,
			);
		}
	}
	return { data: out, width, height };
}

/**
 * Reduce to at most `maxPixels`, keeping the aspect ratio.
 *
 * By area rather than by long edge, because every stage of the reader is
 * linear in area and none is linear in long edge: a cap on the long edge
 * prices a 4032 by 3024 photograph and a 4032 by 1000 panorama the same when
 * one is four times the work.
 *
 * Whole halvings first, while the next one would still clear the target, then
 * one area pass for the remainder. Halving repeatedly to fit undershoots any
 * cap by up to a factor of two, and one pixel of input more could halve the
 * working resolution: that discontinuity was the largest resolution loss the
 * authenticator ever had.
 */
export function fitPixels(image: GreyImage, maxPixels: number): GreyImage {
	const pixels = image.width * image.height;
	if (pixels <= maxPixels) return image;
	// Floored rather than rounded, so the result is never a pixel over the cap.
	// A side that would round to nothing keeps one pixel, and the other side
	// gives up what that costs, so a 4000 by 1 strip still lands under the cap.
	const scale = Math.sqrt(maxPixels / pixels);
	let width = Math.max(1, Math.floor(image.width * scale));
	let height = Math.max(1, Math.floor(image.height * scale));
	if (width * height > maxPixels) {
		if (height === 1) width = Math.max(1, Math.floor(maxPixels));
		else height = Math.max(1, Math.floor(maxPixels / width));
	}
	let current = image;
	while (current.width >> 1 >= width && current.height >> 1 >= height) {
		current = downscaleHalf(current);
	}
	return current.width === width && current.height === height
		? current
		: downscaleArea(current, width, height);
}

/**
 * Whether the picture looks like light-on-dark.
 *
 * Sampled from the corners, because a code is supposed to sit inside a light
 * quiet zone and the corners are the part of a picture least likely to be the
 * code. It decides only which polarity the lenient ladder tries first; both
 * are tried either way, so a wrong guess costs one rung.
 *
 * The comparison is against the picture's own dark and light levels rather
 * than a fixed brightness: a photograph in poor light has every level scaled
 * down, and a light surround at 63 used to read as dark and flip the guess for
 * the whole ladder.
 */
export function looksInverted(image: GreyImage): boolean {
	const { data, width, height } = image;
	const patch = Math.max(1, Math.min(width, height) >> 4);
	const samples: number[] = [];
	for (const [ox, oy] of [
		[0, 0],
		[width - patch, 0],
		[0, height - patch],
		[width - patch, height - patch],
	] as const) {
		let total = 0;
		for (let y = oy; y < oy + patch; y += 1) {
			for (let x = ox; x < ox + patch; x += 1) total += data[y * width + x] as number;
		}
		samples.push(total / (patch * patch));
	}
	samples.sort((a, b) => a - b);
	const median = ((samples[1] as number) + (samples[2] as number)) / 2;

	const histogram = new Uint32Array(256);
	for (let i = 0; i < data.length; i += 1) histogram[data[i] as number] += 1;
	const dark = percentile(histogram, data.length, 0.05);
	const light = percentile(histogram, data.length, 0.95);
	// A third of the way up from dark rather than halfway, because a mid-grey
	// surround is common and is not an inverted symbol.
	return median < dark + (light - dark) * 0.35;
}

function percentile(histogram: Uint32Array, total: number, fraction: number): number {
	const target = total * fraction;
	let seen = 0;
	for (let value = 0; value < 255; value += 1) {
		seen += histogram[value] as number;
		if (seen >= target) return value;
	}
	return 255;
}
