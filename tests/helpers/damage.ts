/**
 * Seeded, deterministic damage, so the reader is tested against something
 * closer to what people photograph than a clean render.
 *
 * Lifted from the authenticator package's test helpers
 * (google-auth-secret-retriever, `tests/helpers/image.ts`) and made fit for
 * the determinism zone, because the verify layer will promote these into
 * `src/verify/degrade.ts`: angles go through core's sin and cos, randomness
 * through core's seeded generator, no `**`, no unspecified Math, and every
 * function is pure, returning a new image and leaving its input alone.
 *
 * Every function reads the red channel and writes grey. The tests draw grey
 * and the reader converts to grey first, so nothing is lost.
 */

import type { RgbaImage } from '../../src/core/image.js';
import { cos, hypot, PI, sin } from '../../src/core/math.js';
import { createPrng } from '../../src/core/prng.js';
import type { Quad } from '../../src/decode/transform.js';
import { apply, quadToQuad } from '../../src/decode/transform.js';
import { blankImage } from './draw.js';

function level(image: RgbaImage, x: number, y: number): number {
	const cx = Math.min(image.width - 1, Math.max(0, x));
	const cy = Math.min(image.height - 1, Math.max(0, y));
	return image.data[(cy * image.width + cx) * 4] as number;
}

function setLevel(image: RgbaImage, x: number, y: number, value: number): void {
	const at = (y * image.width + x) * 4;
	const v = Math.min(255, Math.max(0, Math.round(value)));
	image.data[at] = v;
	image.data[at + 1] = v;
	image.data[at + 2] = v;
	image.data[at + 3] = 255;
}

/** Bilinear, so a warp does not alias the module grid away. Pixel centres sit at half-integers. */
function smooth(image: RgbaImage, x: number, y: number): number {
	const fx0 = x - 0.5;
	const fy0 = y - 0.5;
	const x0 = Math.floor(fx0);
	const y0 = Math.floor(fy0);
	const fx = fx0 - x0;
	const fy = fy0 - y0;
	return (
		level(image, x0, y0) * (1 - fx) * (1 - fy) +
		level(image, x0 + 1, y0) * fx * (1 - fy) +
		level(image, x0, y0 + 1) * (1 - fx) * fy +
		level(image, x0 + 1, y0 + 1) * fx * fy
	);
}

function map(image: RgbaImage, f: (value: number, x: number, y: number) => number): RgbaImage {
	const out = blankImage(image.width, image.height);
	for (let y = 0; y < image.height; y += 1) {
		for (let x = 0; x < image.width; x += 1) setLevel(out, x, y, f(level(image, x, y), x, y));
	}
	return out;
}

/** Rotate by a multiple of 90 degrees, clockwise. */
export function rotateQuarter(image: RgbaImage, turns: number): RgbaImage {
	let current = image;
	for (let i = 0; i < ((turns % 4) + 4) % 4; i += 1) {
		const out = blankImage(current.height, current.width);
		for (let y = 0; y < current.height; y += 1) {
			for (let x = 0; x < current.width; x += 1) {
				setLevel(out, current.height - 1 - y, x, level(current, x, y));
			}
		}
		current = out;
	}
	return current;
}

/** Rotate by any angle about the centre, onto a canvas that holds the whole result. */
export function rotate(image: RgbaImage, degrees: number, background = 255): RgbaImage {
	const radians = (degrees * PI) / 180;
	const c = cos(radians);
	const s = sin(radians);
	const size = Math.ceil(hypot(image.width, image.height));
	const out = blankImage(size, size, background);
	const cx = image.width / 2;
	const cy = image.height / 2;
	for (let y = 0; y < size; y += 1) {
		for (let x = 0; x < size; x += 1) {
			// Inverse map from pixel centres, so every destination pixel has a source.
			const dx = x + 0.5 - size / 2;
			const dy = y + 0.5 - size / 2;
			const sx = c * dx + s * dy + cx;
			const sy = -s * dx + c * dy + cy;
			if (sx < 0 || sy < 0 || sx >= image.width || sy >= image.height) continue;
			setLevel(out, x, y, smooth(image, sx, sy));
		}
	}
	return out;
}

/** Mirror left to right, as a photograph of a reflection or a front camera does. */
export function mirror(image: RgbaImage): RgbaImage {
	return map(image, (_, x, y) => level(image, image.width - 1 - x, y));
}

/** Swap dark and light, as a dark-mode screenshot does. */
export function invert(image: RgbaImage): RgbaImage {
	return map(image, (value) => 255 - value);
}

/**
 * A camera moving during the exposure: every pixel the mean of a straight
 * smear `length` pixels long at `degrees`, sampled a pixel apart, the edges
 * clamped.
 */
export function motionBlur(image: RgbaImage, length: number, degrees: number): RgbaImage {
	const out = blankImage(image.width, image.height);
	const dx = cos((degrees * PI) / 180);
	const dy = sin((degrees * PI) / 180);
	const taps = Math.max(1, Math.round(length));
	for (let y = 0; y < image.height; y += 1) {
		for (let x = 0; x < image.width; x += 1) {
			let total = 0;
			for (let k = 0; k < taps; k += 1) {
				const t = taps === 1 ? 0 : (k / (taps - 1) - 0.5) * length;
				total += level(image, Math.round(x + dx * t), Math.round(y + dy * t));
			}
			setLevel(out, x, y, total / taps);
		}
	}
	return out;
}

/** A separable box blur of `radius` pixels, standing in for slightly out of focus. */
export function blur(image: RgbaImage, radius: number): RgbaImage {
	if (radius <= 0) return map(image, (value) => value);
	const pass = (source: RgbaImage, horizontal: boolean): RgbaImage => {
		const out = blankImage(source.width, source.height);
		for (let y = 0; y < source.height; y += 1) {
			for (let x = 0; x < source.width; x += 1) {
				let total = 0;
				for (let d = -radius; d <= radius; d += 1) {
					total += horizontal ? level(source, x + d, y) : level(source, x, y + d);
				}
				setLevel(out, x, y, total / (radius * 2 + 1));
			}
		}
		return out;
	};
	return pass(pass(image, true), false);
}

/** Additive uniform noise of up to `amount` grey levels, seeded. */
export function noise(image: RgbaImage, amount: number, seed: number): RgbaImage {
	const random = createPrng(seed);
	return map(image, (value) => value + (random.next() * 2 - 1) * amount);
}

/** A soft bright ellipse, standing in for a reflection on a screen or gloss. */
export function glare(
	image: RgbaImage,
	strength: number,
	centre: { x: number; y: number } = { x: 0.35, y: 0.3 },
): RgbaImage {
	const cx = image.width * centre.x;
	const cy = image.height * centre.y;
	const rx = image.width * 0.3;
	const ry = image.height * 0.22;
	return map(image, (value, x, y) => {
		const u = (x - cx) / rx;
		const v = (y - cy) / ry;
		const d = u * u + v * v;
		const fall = 1 - d;
		return d < 1 ? value + strength * fall * fall : value;
	});
}

/** A linear brightness ramp corner to corner, which no single global threshold survives. */
export function gradient(image: RgbaImage, amount: number): RgbaImage {
	return map(
		image,
		(value, x, y) => value + ((x / image.width + y / image.height) / 2 - 0.5) * amount,
	);
}

/** Scale every level, as a photograph in poor light does. */
export function dim(image: RgbaImage, gain: number, lift = 0): RgbaImage {
	return map(image, (value) => value * gain + lift);
}

/** Squeeze the levels towards `centre` by `factor` (1 leaves them, 0 makes the picture flat). */
export function contrast(image: RgbaImage, factor: number, centre = 128): RgbaImage {
	return map(image, (value) => centre + (value - centre) * factor);
}

/**
 * Reduce by a fractional factor, averaging the whole footprint: a symbol at a
 * non-integer number of pixels a module, which is what a scaled screenshot or
 * a photograph at arm's length gives, and where the sampling floor sits.
 */
export function shrink(image: RgbaImage, factor: number): RgbaImage {
	const width = Math.max(1, Math.floor(image.width / factor));
	const height = Math.max(1, Math.floor(image.height / factor));
	const out = blankImage(width, height);
	for (let y = 0; y < height; y += 1) {
		for (let x = 0; x < width; x += 1) {
			let total = 0;
			let weight = 0;
			const top = y * factor;
			const bottom = Math.min(image.height, (y + 1) * factor);
			const left = x * factor;
			const right = Math.min(image.width, (x + 1) * factor);
			for (let sy = Math.floor(top); sy < bottom; sy += 1) {
				const wy = Math.min(sy + 1, bottom) - Math.max(sy, top);
				for (let sx = Math.floor(left); sx < right; sx += 1) {
					const w = (Math.min(sx + 1, right) - Math.max(sx, left)) * wy;
					total += level(image, sx, sy) * w;
					weight += w;
				}
			}
			setLevel(out, x, y, total / weight);
		}
	}
	return out;
}

/** Paste onto a larger canvas, as a screenshot of a whole screen would hold it. */
export function pad(image: RgbaImage, margin: number, background = 255): RgbaImage {
	const out = blankImage(image.width + margin * 2, image.height + margin * 2, background);
	for (let y = 0; y < image.height; y += 1) {
		for (let x = 0; x < image.width; x += 1)
			setLevel(out, x + margin, y + margin, level(image, x, y));
	}
	return out;
}

/** Paint a rectangle one grey level, in fractions of the picture: a logo, a sticker, a smudge. */
export function paint(
	image: RgbaImage,
	rect: { x: number; y: number; width: number; height: number },
	value: number,
): RgbaImage {
	const x0 = Math.round(rect.x * image.width);
	const y0 = Math.round(rect.y * image.height);
	const x1 = Math.round((rect.x + rect.width) * image.width);
	const y1 = Math.round((rect.y + rect.height) * image.height);
	return map(image, (current, x, y) => (x >= x0 && x < x1 && y >= y0 && y < y1 ? value : current));
}

/** Paint an image into an arbitrary quadrilateral on a flat canvas, sampling smoothly. */
export function warpInto(
	image: RgbaImage,
	quad: Quad,
	width: number,
	height: number,
	background = 255,
): RgbaImage {
	const out = blankImage(width, height, background);
	const toSource = quadToQuad(quad, [
		{ x: 0, y: 0 },
		{ x: image.width, y: 0 },
		{ x: image.width, y: image.height },
		{ x: 0, y: image.height },
	]);
	const xs = quad.map((p) => p.x);
	const ys = quad.map((p) => p.y);
	const minX = Math.max(0, Math.floor(Math.min(...xs)));
	const maxX = Math.min(width - 1, Math.ceil(Math.max(...xs)));
	const minY = Math.max(0, Math.floor(Math.min(...ys)));
	const maxY = Math.min(height - 1, Math.ceil(Math.max(...ys)));
	for (let y = minY; y <= maxY; y += 1) {
		for (let x = minX; x <= maxX; x += 1) {
			const source = apply(toSource, x + 0.5, y + 0.5);
			if (source.x < 0 || source.y < 0 || source.x > image.width || source.y > image.height) {
				continue;
			}
			setLevel(out, x, y, smooth(image, source.x, source.y));
		}
	}
	return out;
}

/**
 * A keystone: the bottom edge narrowed by `strength` of the width, as a real
 * homography rather than a per-row taper. The taper looks like perspective and
 * is not a projective map of a plane at all, so no eight-coefficient transform
 * inverts it and a reader that handles real photographs fails on it.
 */
export function perspective(image: RgbaImage, strength: number): RgbaImage {
	const inset = (image.width * strength) / 2;
	return warpInto(
		image,
		[
			{ x: 0, y: 0 },
			{ x: image.width, y: 0 },
			{ x: image.width - inset, y: image.height },
			{ x: inset, y: image.height },
		],
		image.width,
		image.height,
	);
}

export interface PlaceOptions {
	/** Rotation about the vertical axis, degrees. */
	readonly yaw?: number;
	/** Rotation about the horizontal axis, degrees. */
	readonly pitch?: number;
	/** Rotation in the picture plane, degrees. */
	readonly roll?: number;
	/** Fraction of the shorter canvas edge the subject spans. Default 0.7. */
	readonly fill?: number;
	readonly width?: number;
	readonly height?: number;
	readonly background?: number;
	/**
	 * Camera distance in half-widths of the subject. Default 8: a 7 cm screen
	 * from 30 cm. Lower is a wider lens held closer.
	 */
	readonly distance?: number;
}

export interface Placement {
	readonly image: RgbaImage;
	/** Where the source's own corners landed: top left, top right, bottom right, bottom left. */
	readonly quad: Quad;
}

/** Photograph a flat picture from an angle: a real pinhole projection of a plane. */
export function place(image: RgbaImage, options: PlaceOptions = {}): Placement {
	const width = options.width ?? Math.round(Math.max(image.width, image.height) * 1.6);
	const height = options.height ?? width;
	const fill = options.fill ?? 0.7;
	const radians = (degrees: number | undefined): number => ((degrees ?? 0) * PI) / 180;
	const yaw = radians(options.yaw);
	const pitch = radians(options.pitch);
	const roll = radians(options.roll);
	const longest = Math.max(image.width, image.height);
	const halfX = image.width / longest;
	const halfY = image.height / longest;
	const distance = options.distance ?? 8;
	const projected = (
		[
			[-halfX, -halfY],
			[halfX, -halfY],
			[halfX, halfY],
			[-halfX, halfY],
		] as const
	).map(([x0, y0]) => {
		const rx = x0 * cos(roll) - y0 * sin(roll);
		const ry = x0 * sin(roll) + y0 * cos(roll);
		const x1 = rx * cos(yaw);
		const z1 = -rx * sin(yaw);
		const y2 = ry * cos(pitch) - z1 * sin(pitch);
		const z2 = ry * sin(pitch) + z1 * cos(pitch);
		const depth = distance + z2;
		return { x: x1 / depth, y: y2 / depth };
	});
	const minX = Math.min(...projected.map((p) => p.x));
	const maxX = Math.max(...projected.map((p) => p.x));
	const minY = Math.min(...projected.map((p) => p.y));
	const maxY = Math.max(...projected.map((p) => p.y));
	const scale = (Math.min(width, height) * fill) / Math.max(maxX - minX, maxY - minY);
	const onCanvas = (p: { x: number; y: number }) => ({
		x: width / 2 + (p.x - (minX + maxX) / 2) * scale,
		y: height / 2 + (p.y - (minY + maxY) / 2) * scale,
	});
	const quad = projected.map(onCanvas) as unknown as Quad;
	return { image: warpInto(image, quad, width, height, options.background ?? 255), quad };
}
