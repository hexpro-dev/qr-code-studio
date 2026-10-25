/**
 * Seeded, deterministic damage: what a phone camera, a printer and a room do
 * to a code between the screen it was designed on and the reader that sees
 * it.
 *
 * Promoted from the authenticator package's test helpers
 * (google-auth-secret-retriever, `tests/helpers/image.ts`) and made fit for
 * the determinism zone: angles go through core's sine and cosine, the
 * Gaussian through core's exp, randomness through core's seeded generator,
 * and nothing else but + - * /, square roots, floor, round, min and max,
 * which IEEE 754 fixes exactly. So a seed gives the same capture, and the
 * same verdict, in every engine.
 *
 * Everything works on a `GreyPlane`, one float a pixel of BT.601 luma from 0
 * (dark) to 255 (light), because that is what the reader sees: it converts a
 * picture to the same luma before it does anything else. Floats rather than
 * bytes so a chain of steps rounds once, at the end, as a camera's pipeline
 * does. Every function is pure: it returns a new plane and leaves its input
 * alone.
 *
 * Pixel centres sit at half-integers: pixel (0, 0) covers [0, 1) on both
 * axes, so a sample at (0.5, 0.5) is exactly its value.
 */

import type { RgbaImage } from '../core/image.js';
import { cos, exp, sin } from '../core/math.js';
import type { Prng } from '../core/prng.js';
import type { Homography, Point, Quad } from './homography.js';
import { quadToQuad } from './homography.js';

export interface GreyPlane {
	readonly width: number;
	readonly height: number;
	/** Row major, 0 dark to 255 light. */
	readonly data: Float32Array;
}

/** White paper, the level everything outside a design is. */
export const PAPER = 255;

export function greyPlane(width: number, height: number, fill = PAPER): GreyPlane {
	const data = new Float32Array(width * height);
	data.fill(fill);
	return { width, height, data };
}

/** BT.601 luma, alpha laid over white paper, as the reader converts a picture. */
export function fromRgba(image: RgbaImage): GreyPlane {
	const { width, height, data } = image;
	const out = new Float32Array(width * height);
	for (let i = 0, p = 0; i < out.length; i += 1, p += 4) {
		const luma =
			0.299 * (data[p] as number) +
			0.587 * (data[p + 1] as number) +
			0.114 * (data[p + 2] as number);
		const a = (data[p + 3] as number) / 255;
		out[i] = luma * a + PAPER * (1 - a);
	}
	return { width, height, data: out };
}

/** Rounded once to bytes, as grey RGBA. */
export function toRgba(plane: GreyPlane): RgbaImage {
	const data = new Uint8ClampedArray(plane.width * plane.height * 4);
	for (let i = 0, p = 0; i < plane.data.length; i += 1, p += 4) {
		const v = Math.min(255, Math.max(0, Math.round(plane.data[i] as number)));
		data[p] = v;
		data[p + 1] = v;
		data[p + 2] = v;
		data[p + 3] = 255;
	}
	return { width: plane.width, height: plane.height, data };
}

function clampIndex(value: number, size: number): number {
	return value < 0 ? 0 : value >= size ? size - 1 : value;
}

/** Bilinear, edges extended. */
export function sampleBilinear(plane: GreyPlane, x: number, y: number): number {
	const fx0 = x - 0.5;
	const fy0 = y - 0.5;
	const x0 = Math.floor(fx0);
	const y0 = Math.floor(fy0);
	const fx = fx0 - x0;
	const fy = fy0 - y0;
	const { width, height, data } = plane;
	const xa = clampIndex(x0, width);
	const xb = clampIndex(x0 + 1, width);
	const ya = clampIndex(y0, height) * width;
	const yb = clampIndex(y0 + 1, height) * width;
	const top = (data[ya + xa] as number) * (1 - fx) + (data[ya + xb] as number) * fx;
	const bottom = (data[yb + xa] as number) * (1 - fx) + (data[yb + xb] as number) * fx;
	return top * (1 - fy) + bottom * fy;
}

/**
 * Photograph `source`: each output pixel is the mean of `supersample` by
 * `supersample` points across its own area, each mapped through `toSource`
 * (output pixel coordinates to source pixel coordinates) and read bilinearly.
 * That is a sensor integrating light over its pixel, which is what keeps a
 * reduction from aliasing the module grid away. Points that land outside the
 * source read as `background`.
 */
export function warp(
	source: GreyPlane,
	toSource: Homography,
	width: number,
	height: number,
	supersample: number,
	background = PAPER,
): GreyPlane {
	const out = new Float32Array(width * height);
	const s = Math.max(1, Math.floor(supersample));
	const share = 1 / (s * s);
	const [a, b, c, d, e, f, g, h, i] = toSource;
	for (let y = 0; y < height; y += 1) {
		for (let x = 0; x < width; x += 1) {
			let sum = 0;
			for (let j = 0; j < s; j += 1) {
				const v = y + (j + 0.5) / s;
				for (let k = 0; k < s; k += 1) {
					const u = x + (k + 0.5) / s;
					const w = g * u + h * v + i;
					const sx = (a * u + b * v + c) / w;
					const sy = (d * u + e * v + f) / w;
					sum +=
						sx < 0 || sy < 0 || sx > source.width || sy > source.height
							? background
							: sampleBilinear(source, sx, sy);
				}
			}
			out[y * width + x] = sum * share;
		}
	}
	return { width, height, data: out };
}

/** Paint `source` into `quad` on a `width` by `height` canvas of `background`. */
export function warpInto(
	source: GreyPlane,
	quad: Quad,
	width: number,
	height: number,
	supersample = 2,
	background = PAPER,
): GreyPlane {
	const toSource = quadToQuad(quad, [
		{ x: 0, y: 0 },
		{ x: source.width, y: 0 },
		{ x: source.width, y: source.height },
		{ x: 0, y: source.height },
	]);
	return warp(source, toSource, width, height, supersample, background);
}

/**
 * One pass of a separable filter with edge extension. The interior of each
 * row is summed without any clamping; only the `radius` pixels at each end
 * look past the edge. Vertical passes run along rows, tap by tap, so memory
 * is read in order.
 */
function convolve(plane: GreyPlane, kernel: Float64Array, horizontal: boolean): GreyPlane {
	const { width, height, data } = plane;
	const out = new Float32Array(width * height);
	const radius = (kernel.length - 1) / 2;
	if (horizontal) {
		for (let y = 0; y < height; y += 1) {
			const row = y * width;
			for (let x = 0; x < width; x += 1) {
				let sum = 0;
				if (x >= radius && x < width - radius) {
					const base = row + x - radius;
					for (let k = 0; k < kernel.length; k += 1) {
						sum += (data[base + k] as number) * (kernel[k] as number);
					}
				} else {
					for (let k = -radius; k <= radius; k += 1) {
						sum +=
							(data[row + clampIndex(x + k, width)] as number) * (kernel[k + radius] as number);
					}
				}
				out[row + x] = sum;
			}
		}
		return { width, height, data: out };
	}
	for (let y = 0; y < height; y += 1) {
		const row = y * width;
		for (let k = -radius; k <= radius; k += 1) {
			const from = clampIndex(y + k, height) * width;
			const weight = kernel[k + radius] as number;
			for (let x = 0; x < width; x += 1) {
				out[row + x] = (out[row + x] as number) + (data[from + x] as number) * weight;
			}
		}
	}
	return { width, height, data: out };
}

/** The normalised Gaussian for `sigma` pixels, out to three sigma. */
export function gaussianKernel(sigma: number): Float64Array {
	const radius = Math.max(1, Math.ceil(3 * sigma));
	const kernel = new Float64Array(2 * radius + 1);
	let total = 0;
	for (let k = -radius; k <= radius; k += 1) {
		const w = exp(-(k * k) / (2 * sigma * sigma));
		kernel[k + radius] = w;
		total += w;
	}
	for (let k = 0; k < kernel.length; k += 1) kernel[k] = (kernel[k] as number) / total;
	return kernel;
}

/** Out of focus, or a lens's own softness: a Gaussian of `sigma` pixels. */
export function gaussianBlur(plane: GreyPlane, sigma: number): GreyPlane {
	if (!(sigma > 0.05)) return copy(plane);
	const kernel = gaussianKernel(sigma);
	return convolve(convolve(plane, kernel, true), kernel, false);
}

/** The authenticator's separable box blur, `radius` pixels each way. */
export function boxBlur(plane: GreyPlane, radius: number): GreyPlane {
	const r = Math.max(0, Math.floor(radius));
	if (r === 0) return copy(plane);
	const kernel = new Float64Array(2 * r + 1).fill(1 / (2 * r + 1));
	return convolve(convolve(plane, kernel, true), kernel, false);
}

/**
 * A hand moving during the exposure: the mean along a straight path
 * `length` pixels long at `radians`, centred on each pixel.
 */
export function motionBlur(plane: GreyPlane, length: number, radians: number): GreyPlane {
	if (!(length > 0.25)) return copy(plane);
	const steps = Math.max(2, Math.ceil(length) + 1);
	const dx = cos(radians) * length;
	const dy = sin(radians) * length;
	const { width, height } = plane;
	const out = new Float32Array(width * height);
	for (let y = 0; y < height; y += 1) {
		for (let x = 0; x < width; x += 1) {
			let sum = 0;
			for (let k = 0; k < steps; k += 1) {
				const t = k / (steps - 1) - 0.5;
				sum += sampleBilinear(plane, x + 0.5 + t * dx, y + 0.5 + t * dy);
			}
			out[y * width + x] = sum / steps;
		}
	}
	return { width, height, data: out };
}

/**
 * Sensor noise of standard deviation `sd` levels.
 *
 * Each value is the sum of three uniforms, centred and scaled to unit
 * variance (Irwin and Hall): bell shaped, bounded at three sigma, and made of
 * nothing but additions, where Box and Muller would need a logarithm and a
 * cosine per pixel.
 */
export function addNoise(plane: GreyPlane, sd: number, prng: Prng): GreyPlane {
	const out = new Float32Array(plane.data);
	if (!(sd > 0)) return { width: plane.width, height: plane.height, data: out };
	for (let i = 0; i < out.length; i += 1) {
		const unit = (prng.next() + prng.next() + prng.next() - 1.5) * 2;
		out[i] = (out[i] as number) + unit * sd;
	}
	return { width: plane.width, height: plane.height, data: out };
}

/** Scale every level, as a photograph taken in poor light does. */
export function dim(plane: GreyPlane, gain: number, lift = 0): GreyPlane {
	const out = new Float32Array(plane.data.length);
	for (let i = 0; i < out.length; i += 1) out[i] = (plane.data[i] as number) * gain + lift;
	return { width: plane.width, height: plane.height, data: out };
}

/**
 * Light that falls off across the picture: a gain of `near` on one side and
 * `far` on the other, along `radians`.
 */
export function lightFalloff(
	plane: GreyPlane,
	near: number,
	far: number,
	radians: number,
): GreyPlane {
	const { width, height } = plane;
	const ux = cos(radians);
	const uy = sin(radians);
	// The extent of the picture along the direction, so the ramp spans it exactly.
	const corners = [0, ux * width, uy * height, ux * width + uy * height];
	const lo = Math.min(...corners);
	const span = Math.max(...corners) - lo || 1;
	const out = new Float32Array(width * height);
	for (let y = 0; y < height; y += 1) {
		for (let x = 0; x < width; x += 1) {
			const t = (ux * (x + 0.5) + uy * (y + 0.5) - lo) / span;
			out[y * width + x] = (plane.data[y * width + x] as number) * (near + (far - near) * t);
		}
	}
	return { width, height, data: out };
}

/** The authenticator's additive ramp, which one global threshold cannot handle. */
export function gradient(plane: GreyPlane, amount: number): GreyPlane {
	const { width, height } = plane;
	const out = new Float32Array(width * height);
	for (let y = 0; y < height; y += 1) {
		for (let x = 0; x < width; x += 1) {
			const shift = ((x / width + y / height) / 2 - 0.5) * amount;
			out[y * width + x] = (plane.data[y * width + x] as number) + shift;
		}
	}
	return { width, height, data: out };
}

export interface GlareSpot {
	readonly cx: number;
	readonly cy: number;
	readonly rx: number;
	readonly ry: number;
}

/**
 * A specular reflection: inside an ellipse every level is pulled towards
 * white, by `strength` times (1 - d squared) where d is the distance from the
 * centre as a share of the radius, clipped at all the way. So at strength 1
 * only the very middle is white, and at 2 the inner seven tenths of the
 * radius are, whatever was printed there, which is what a lamp reflected in
 * a glossy menu does to a sensor.
 */
export function glare(plane: GreyPlane, strength: number, spot: GlareSpot): GreyPlane {
	const { width, height } = plane;
	const out = new Float32Array(plane.data);
	const x0 = Math.max(0, Math.floor(spot.cx - spot.rx));
	const x1 = Math.min(width, Math.ceil(spot.cx + spot.rx));
	const y0 = Math.max(0, Math.floor(spot.cy - spot.ry));
	const y1 = Math.min(height, Math.ceil(spot.cy + spot.ry));
	for (let y = y0; y < y1; y += 1) {
		for (let x = x0; x < x1; x += 1) {
			const nx = (x + 0.5 - spot.cx) / spot.rx;
			const ny = (y + 0.5 - spot.cy) / spot.ry;
			const d = nx * nx + ny * ny;
			if (d >= 1) continue;
			const pull = Math.min(1, strength * (1 - d));
			const at = y * width + x;
			const v = out[at] as number;
			out[at] = v + (PAPER - v) * pull;
		}
	}
	return { width, height, data: out };
}

/** Rounded to whole levels and clipped, as a sensor's converter does, without leaving floats. */
export function quantise(plane: GreyPlane): GreyPlane {
	const out = new Float32Array(plane.data.length);
	for (let i = 0; i < out.length; i += 1) {
		out[i] = Math.min(255, Math.max(0, Math.round(plane.data[i] as number)));
	}
	return { width: plane.width, height: plane.height, data: out };
}

/** One pass of a running minimum or maximum over 2r + 1 pixels. */
function extremum(plane: GreyPlane, r: number, horizontal: boolean, takeMin: boolean): GreyPlane {
	const { width, height, data } = plane;
	const out = new Float32Array(width * height);
	for (let y = 0; y < height; y += 1) {
		for (let x = 0; x < width; x += 1) {
			let best = data[y * width + x] as number;
			for (let k = -r; k <= r; k += 1) {
				const at = horizontal
					? y * width + clampIndex(x + k, width)
					: clampIndex(y + k, height) * width + x;
				const v = data[at] as number;
				if (takeMin ? v < best : v > best) best = v;
			}
			out[y * width + x] = best;
		}
	}
	return { width, height, data: out };
}

function morphology(plane: GreyPlane, radius: number, takeMin: boolean): GreyPlane {
	const whole = Math.floor(radius);
	const part = radius - whole;
	const at = (r: number): GreyPlane =>
		r === 0 ? plane : extremum(extremum(plane, r, true, takeMin), r, false, takeMin);
	const inner = at(whole);
	// Callers pass a radius above zero, so a whole radius is at least 1 and
	// `inner` is already a new plane.
	if (part === 0) return inner;
	const outer = at(whole + 1);
	// A fraction of a pixel is the edge pixel part covered, as anti-aliasing draws it.
	const out = new Float32Array(plane.data.length);
	for (let i = 0; i < out.length; i += 1) {
		out[i] = (inner.data[i] as number) * (1 - part) + (outer.data[i] as number) * part;
	}
	return { width: plane.width, height: plane.height, data: out };
}

/**
 * Ink spread (dot gain): every dark edge moves out by `radius` pixels.
 *
 * A square structuring element, so a corner spreads by radius times the
 * square root of two along its diagonal where real ink rounds it off. That is
 * harsher than paper, which is the side to err on.
 */
export function spreadInk(plane: GreyPlane, radius: number): GreyPlane {
	return radius > 0 ? morphology(plane, radius, true) : copy(plane);
}

/** Ink starved (a worn ribbon, a thin laser toner): every dark edge moves in by `radius` pixels. */
export function starveInk(plane: GreyPlane, radius: number): GreyPlane {
	return radius > 0 ? morphology(plane, radius, false) : copy(plane);
}

/**
 * Faded print: every level moves towards the paper by `amount`, so the ink
 * keeps 1 - amount of its contrast and the ground keeps the same share of
 * whatever it had below white.
 */
export function fade(plane: GreyPlane, amount: number): GreyPlane {
	const out = new Float32Array(plane.data.length);
	for (let i = 0; i < out.length; i += 1) {
		const v = plane.data[i] as number;
		out[i] = PAPER - (PAPER - v) * (1 - amount);
	}
	return { width: plane.width, height: plane.height, data: out };
}

export function copy(plane: GreyPlane): GreyPlane {
	return { width: plane.width, height: plane.height, data: new Float32Array(plane.data) };
}

/** Swap dark and light, as a dark mode screenshot does. */
export function invert(plane: GreyPlane): GreyPlane {
	const out = new Float32Array(plane.data.length);
	for (let i = 0; i < out.length; i += 1) out[i] = PAPER - (plane.data[i] as number);
	return { width: plane.width, height: plane.height, data: out };
}

/** Mirror left to right, as a front camera or a reflection does. */
export function mirror(plane: GreyPlane): GreyPlane {
	const { width, height, data } = plane;
	const out = new Float32Array(width * height);
	for (let y = 0; y < height; y += 1) {
		for (let x = 0; x < width; x += 1)
			out[y * width + width - 1 - x] = data[y * width + x] as number;
	}
	return { width, height, data: out };
}

/** Rotate by quarter turns, clockwise. */
export function rotateQuarter(plane: GreyPlane, turns: number): GreyPlane {
	let current = plane;
	for (let t = 0; t < ((turns % 4) + 4) % 4; t += 1) {
		const { width, height, data } = current;
		const out = new Float32Array(width * height);
		// (x, y) goes to (height - 1 - y, x) on a height by width canvas.
		for (let y = 0; y < height; y += 1) {
			for (let x = 0; x < width; x += 1)
				out[x * height + height - 1 - y] = data[y * width + x] as number;
		}
		current = { width: height, height: width, data: out };
	}
	return current === plane ? copy(plane) : current;
}

/** The corners of a `width` by `height` picture turned by `radians` about its centre and moved by (dx, dy). */
export function turnedQuad(width: number, height: number, radians: number, dx = 0, dy = 0): Quad {
	const c = cos(radians);
	const s = sin(radians);
	const cx = width / 2;
	const cy = height / 2;
	const turn = (x: number, y: number): Point => ({
		x: cx + (x - cx) * c - (y - cy) * s + dx,
		y: cy + (x - cx) * s + (y - cy) * c + dy,
	});
	return [turn(0, 0), turn(width, 0), turn(width, height), turn(0, height)];
}

/** Rotate by any angle about the centre, onto a canvas that holds all of it, on `background`. */
export function rotate(plane: GreyPlane, radians: number, background = PAPER): GreyPlane {
	const quad = turnedQuad(plane.width, plane.height, radians);
	const xs = quad.map((p) => p.x);
	const ys = quad.map((p) => p.y);
	const minX = Math.min(...xs);
	const minY = Math.min(...ys);
	const width = Math.ceil(Math.max(...xs) - minX);
	const height = Math.ceil(Math.max(...ys) - minY);
	const moved = quad.map((p) => ({ x: p.x - minX, y: p.y - minY })) as unknown as Quad;
	return warpInto(plane, moved, width, height, 2, background);
}

/** Paste onto a larger canvas of `background`, `margin` pixels each side. */
export function pad(plane: GreyPlane, margin: number, background = PAPER): GreyPlane {
	const out = greyPlane(plane.width + 2 * margin, plane.height + 2 * margin, background);
	for (let y = 0; y < plane.height; y += 1) {
		out.data.set(
			plane.data.subarray(y * plane.width, (y + 1) * plane.width),
			(y + margin) * out.width + margin,
		);
	}
	return out;
}

/**
 * Reduce by a whole factor, averaging each block: a picture at a fraction of
 * its resolution, as a browser's downscale or a photograph at arm's length
 * gives.
 */
export function shrink(plane: GreyPlane, factor: number): GreyPlane {
	const f = Math.max(1, Math.floor(factor));
	const width = Math.max(1, Math.floor(plane.width / f));
	const height = Math.max(1, Math.floor(plane.height / f));
	const out = new Float32Array(width * height);
	for (let y = 0; y < height; y += 1) {
		for (let x = 0; x < width; x += 1) {
			let sum = 0;
			for (let j = 0; j < f; j += 1) {
				for (let i = 0; i < f; i += 1)
					sum += plane.data[(y * f + j) * plane.width + x * f + i] as number;
			}
			out[y * width + x] = sum / (f * f);
		}
	}
	return { width, height, data: out };
}

/**
 * Where the corners of a flat `width` by `height` picture land when it is
 * tilted by `tiltRadians` about an axis in its own plane at `axisRadians`, and
 * seen by a pinhole camera `distance` half-widths away. A real projection of
 * a plane, so both axes foreshorten. The quad is in the picture's own units,
 * centred on the origin, with the axis perpendicular to the tilt keeping its
 * scale.
 */
export function tiltedQuad(
	width: number,
	height: number,
	tiltRadians: number,
	axisRadians: number,
	distance: number,
): Quad {
	const half = Math.max(width, height) / 2;
	const ca = cos(axisRadians);
	const sa = sin(axisRadians);
	const ct = cos(tiltRadians);
	const st = sin(tiltRadians);
	const corners: readonly (readonly [number, number])[] = [
		[-width / 2, -height / 2],
		[width / 2, -height / 2],
		[width / 2, height / 2],
		[-width / 2, height / 2],
	];
	const project = ([x, y]: readonly [number, number]): Point => {
		// Into axis coordinates: u along the tilt axis, v across it.
		const u = x * ca + y * sa;
		const v = -x * sa + y * ca;
		// Tilting turns v out of the plane.
		const vt = v * ct;
		const z = v * st;
		const depth = distance * half + z;
		const scale = (distance * half) / depth;
		const pu = u * scale;
		const pv = vt * scale;
		return { x: pu * ca - pv * sa, y: pu * sa + pv * ca };
	};
	return corners.map(project) as unknown as Quad;
}
