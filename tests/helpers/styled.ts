/**
 * Styled captures: every design preset, built over seeded content by this
 * package's own design and render layers, then photographed by a simple
 * camera model.
 *
 * The camera is the verify layer's clean capture: the design turned by up to
 * 4 degrees, placed at a random sub-pixel phase, integrated over each pixel's
 * footprint the way a sensor does, softened by a lens blur of 0.5 pixels and
 * given sensor noise of 2 grey levels. Nothing else; damage is applied on top
 * by the corpus's own ladders.
 *
 * The scene is drawn once at three times the pixel density (twice for a
 * tilt, whose pictures are larger) and resampled, because the rasteriser has
 * no rotation of its own and a picture drawn at the target density and then
 * rotated would be blurred twice.
 *
 * The tilt is the verify layer's angle model: a true pinhole projection of
 * the design tilted about a seeded axis in its own plane, the camera 5
 * half-widths away.
 */

import type { RgbaImage } from '../../src/core/image.js';
import { cos, PI, sin } from '../../src/core/math.js';
import { createPrng } from '../../src/core/prng.js';
import type { Prng } from '../../src/core/prng.js';
import { createDesignRegistries } from '../../src/design/registries.js';
import { buildScene } from '../../src/design/scene.js';
import type { Preset } from '../../src/design/types.js';
import type { Quad } from '../../src/decode/transform.js';
import { apply, quadToQuad } from '../../src/decode/transform.js';
import type { EcLevel } from '../../src/segment/types.js';
import { encode } from '../../src/encode/encode.js';
import { rasterise } from '../../src/render/raster.js';
import type { DamageKind } from './corpus.js';
import { damage } from './corpus.js';
import { blankImage } from './draw.js';

const SUPERSAMPLE = 3;
/** Gaussian of standard deviation 0.5 pixels, taps at -1, 0 and 1, normalised. */
const BLUR_SIDE = 0.10650697891920077;
const BLUR_CENTRE = 1 - 2 * BLUR_SIDE;

let registries: ReturnType<typeof createDesignRegistries> | undefined;

/** The design registries, made once. */
export function designRegistries(): ReturnType<typeof createDesignRegistries> {
	registries ??= createDesignRegistries();
	return registries;
}

export function presets(): readonly Preset[] {
	return designRegistries().presets.list();
}

/** A seeded link of about `length` characters. */
export function styledContent(seed: number, length: number): string {
	const prng = createPrng(seed);
	const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789-';
	let path = '';
	while (path.length < length) path += alphabet[prng.int(alphabet.length)];
	return `https://example.com/${path}`;
}

function composite(image: RgbaImage): RgbaImage {
	// Over white, as paper: a transparent background is the page it is printed on.
	const out = new Uint8ClampedArray(image.data.length);
	for (let i = 0; i < out.length; i += 4) {
		const a = (image.data[i + 3] as number) / 255;
		for (let c = 0; c < 3; c += 1) out[i + c] = (image.data[i + c] as number) * a + 255 * (1 - a);
		out[i + 3] = 255;
	}
	return { width: image.width, height: image.height, data: out };
}

/** Bilinear sample of one channel at a point, pixel centres at half-integers, white past the edge. */
function sampleChannel(image: RgbaImage, x: number, y: number, channel: number): number {
	const fx = x - 0.5;
	const fy = y - 0.5;
	const x0 = Math.floor(fx);
	const y0 = Math.floor(fy);
	const tx = fx - x0;
	const ty = fy - y0;
	const at = (px: number, py: number): number =>
		px < 0 || py < 0 || px >= image.width || py >= image.height
			? 255
			: (image.data[(py * image.width + px) * 4 + channel] as number);
	return (
		at(x0, y0) * (1 - tx) * (1 - ty) +
		at(x0 + 1, y0) * tx * (1 - ty) +
		at(x0, y0 + 1) * (1 - tx) * ty +
		at(x0 + 1, y0 + 1) * tx * ty
	);
}

/**
 * Where the camera puts the design: a projective map from the design's
 * untilted output pixels (origin at its centre) to the picture's pixels.
 * In-plane roll, then a true pinhole tilt of `tilt` degrees about an axis in
 * the plane at `axis` degrees, seen from `distance` half-widths away, then the
 * sub-pixel phase. At zero tilt this is a rotation and a shift.
 */
function cameraQuad(
	width: number,
	height: number,
	canvas: { width: number; height: number },
	roll: number,
	tilt: number,
	axis: number,
	distance: number,
	phase: { x: number; y: number },
): Quad {
	const r = (roll * PI) / 180;
	const t = (tilt * PI) / 180;
	const a = (axis * PI) / 180;
	const [ax, ay] = [cos(a), sin(a)];
	const half = Math.max(width, height) / 2;
	const focal = distance * half;
	const project = (x0: number, y0: number): { x: number; y: number } => {
		const x = x0 * cos(r) - y0 * sin(r);
		const y = x0 * sin(r) + y0 * cos(r);
		// Rodrigues about (ax, ay, 0): v cos t + (k x v) sin t + k (k . v)(1 - cos t).
		const dot = ax * x + ay * y;
		const px = x * cos(t) + ax * dot * (1 - cos(t));
		const py = y * cos(t) + ay * dot * (1 - cos(t));
		const pz = (ax * y - ay * x) * sin(t);
		const scale = focal / (focal + pz);
		return {
			x: canvas.width / 2 + px * scale + phase.x,
			y: canvas.height / 2 + py * scale + phase.y,
		};
	};
	return [
		project(-width / 2, -height / 2),
		project(width / 2, -height / 2),
		project(width / 2, height / 2),
		project(-width / 2, height / 2),
	];
}

/**
 * The camera: a picture drawn at SUPERSAMPLE times the density, placed by
 * `quad` (where its corners land), integrated over each output pixel on a 3
 * by 3 grid, then blurred and given noise.
 */
function photograph(
	fine: RgbaImage,
	quad: Quad,
	canvas: { width: number; height: number },
	random: Prng,
): RgbaImage {
	const toFine = quadToQuad(quad, [
		{ x: 0, y: 0 },
		{ x: fine.width, y: 0 },
		{ x: fine.width, y: fine.height },
		{ x: 0, y: fine.height },
	]);
	const { width, height } = canvas;
	const out = blankImage(width, height);
	const taps = [1 / 6, 1 / 2, 5 / 6];
	for (let y = 0; y < height; y += 1) {
		for (let x = 0; x < width; x += 1) {
			const sum = [0, 0, 0];
			for (const ty of taps) {
				for (const tx of taps) {
					const p = apply(toFine, x + tx, y + ty);
					for (let channel = 0; channel < 3; channel += 1) {
						sum[channel] = (sum[channel] as number) + sampleChannel(fine, p.x, p.y, channel);
					}
				}
			}
			const at = (y * width + x) * 4;
			for (let channel = 0; channel < 3; channel += 1)
				out.data[at + channel] = (sum[channel] as number) / 9;
		}
	}
	const blurred = blur3(out);
	// Sensor noise, standard deviation 2: four uniforms summed are near enough normal.
	for (let i = 0; i < blurred.data.length; i += 4) {
		let n = 0;
		for (let k = 0; k < 4; k += 1) n += random.next() * 2 - 1;
		const delta = n * 1.7320508075688772;
		for (let channel = 0; channel < 3; channel += 1) {
			blurred.data[i + channel] = Math.round((blurred.data[i + channel] as number) + delta);
		}
	}
	return blurred;
}

/** A separable three-tap Gaussian blur, edges clamped. */
function blur3(image: RgbaImage): RgbaImage {
	const pass = (source: RgbaImage, horizontal: boolean): RgbaImage => {
		const out = blankImage(source.width, source.height);
		for (let y = 0; y < source.height; y += 1) {
			for (let x = 0; x < source.width; x += 1) {
				const before = horizontal ? Math.max(0, x - 1) : x;
				const after = horizontal ? Math.min(source.width - 1, x + 1) : x;
				const above = horizontal ? y : Math.max(0, y - 1);
				const below = horizontal ? y : Math.min(source.height - 1, y + 1);
				for (let channel = 0; channel < 3; channel += 1) {
					out.data[(y * source.width + x) * 4 + channel] =
						BLUR_SIDE * (source.data[(above * source.width + before) * 4 + channel] as number) +
						BLUR_CENTRE * (source.data[(y * source.width + x) * 4 + channel] as number) +
						BLUR_SIDE * (source.data[(below * source.width + after) * 4 + channel] as number);
				}
			}
		}
		return out;
	};
	return pass(pass(image, true), false);
}

export interface StyledCapture {
	readonly preset: string;
	readonly text: string;
	readonly version: string;
	readonly modulePixels: number;
	readonly kind: DamageKind | 'clean';
	readonly severity: number;
	/** Degrees of pinhole tilt, 0 for none. */
	readonly tilt: number;
	readonly image: RgbaImage;
}

export interface StyledOptions {
	readonly preset: Preset;
	/** Pixels a module, before the roll. */
	readonly modulePixels: number;
	/** The QR version, filled nearly to capacity at the preset's level. */
	readonly version: number;
	readonly seed: number;
	/** Damage on top of the capture; default none. */
	readonly kind?: DamageKind;
	readonly severity?: number;
	/** Pinhole tilt in degrees about a seeded axis in the plane; default none. */
	readonly tilt?: number;
	/** Camera distance in half-widths of the design, for a tilt. Default 5. */
	readonly distance?: number;
}

/**
 * The longest seeded content that fits `version` at `ecLevel`, found by
 * halving: a link, or digits when not even the shortest link fits (version 2
 * at level H holds 20 bytes).
 */
function fullContent(seed: number, version: number, ecLevel: EcLevel): string {
	const bounds = { minVersion: String(version), maxVersion: String(version) };
	const digits = (length: number): string => {
		const prng = createPrng(seed);
		let out = '';
		while (out.length < length) out += String(prng.int(10));
		return out;
	};
	for (const make of [(length: number) => styledContent(seed, length), digits]) {
		const fits = (length: number): boolean => {
			try {
				encode(make(length), { ecLevel, ...bounds });
				return true;
			} catch {
				return false;
			}
		};
		if (!fits(1)) continue;
		let low = 1;
		let high = version * version * 12;
		while (low < high) {
			const middle = Math.ceil((low + high) / 2);
			if (fits(middle)) low = middle;
			else high = middle - 1;
		}
		return make(low);
	}
	throw new Error(`nothing fits version ${version} at level ${ecLevel}`);
}

/** One styled capture, a function of its options alone. */
export function styledCapture(options: StyledOptions): StyledCapture {
	const { preset, modulePixels, version, seed } = options;
	const random = createPrng(seed);
	const ecLevel = preset.design.symbol.ecLevel ?? 'M';
	// The longest link that fits: a full symbol, as a real one usually is.
	const text = fullContent(seed, version, ecLevel);
	const symbol = encode(text, {
		ecLevel,
		minVersion: String(version),
		maxVersion: String(version),
	});
	const { scene } = buildScene(symbol, preset.design, { registries: designRegistries(), seed: 11 });
	const width = Math.round(scene.width * modulePixels);
	const height = Math.round(scene.height * modulePixels);
	const supersample = options.tilt === undefined ? SUPERSAMPLE : 2;
	const fine = composite(
		rasterise(scene, { width: width * supersample, height: height * supersample }),
	);
	const roll = (random.next() * 2 - 1) * 4;
	const phase = { x: random.next() - 0.5, y: random.next() - 0.5 };
	const axis = random.next() * 360;
	const tilt = options.tilt ?? 0;
	// A tilted design's near edge grows, so the picture leaves it room.
	const canvas =
		tilt === 0
			? { width, height }
			: { width: Math.ceil(width * 1.25), height: Math.ceil(height * 1.25) };
	const quad = cameraQuad(width, height, canvas, roll, tilt, axis, options.distance ?? 5, phase);
	let image = photograph(fine, quad, canvas, random.fork(1));
	const kind = options.kind ?? 'clean';
	const severity = options.severity ?? 0;
	if (options.kind !== undefined)
		image = damage(image, options.kind, severity, random.fork(2), modulePixels);
	return {
		preset: preset.id,
		text,
		version: symbol.version,
		modulePixels,
		kind,
		severity,
		tilt,
		image,
	};
}
