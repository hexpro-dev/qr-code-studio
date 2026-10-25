/**
 * Reading modules out of a picture through a fitted transform.
 *
 * The estimating half of reading ends here; everything downstream is exact.
 *
 * Sampling is soft. Each module gets a hard decision, dark or light, and a
 * confidence: how far its grey sat from the threshold that made the decision,
 * relative to the symbol's own contrast. A clean render samples at 1 every
 * where. A module under a mid-grey logo, or smeared across an edge by blur,
 * samples near 0, and the lenient reader hands Reed-Solomon those positions
 * as erasures, which cost half what an error does.
 *
 * Lifted from the authenticator package's reader
 * (google-auth-secret-retriever, `src/qr/decode/sample.ts`), which sampled
 * hard bits only.
 */

import { BitMatrix } from '../core/bit-matrix.js';
import type { Binarised } from './binarise.js';
import type { GreyImage } from './grey.js';
import type { Homography } from './transform.js';

/** Below this confidence a module is uncertain: an erasure candidate, and drawn as such. */
export const UNCERTAIN = 0.2;

/**
 * The floor under the contrast a confidence is measured against, in grey
 * levels, so a picture with no contrast at all gives confidences near zero
 * rather than dividing by it.
 */
const MIN_CONTRAST = 8;

/**
 * Where within a module the majority vote looks: the centre and four points a
 * quarter of a module from it. One blown out pixel in the middle of a module
 * no longer flips it.
 */
const VOTE_OFFSETS: readonly (readonly [number, number])[] = [
	[0.5, 0.5],
	[0.25, 0.5],
	[0.75, 0.5],
	[0.5, 0.25],
	[0.5, 0.75],
];
const CENTRE_ONLY: readonly (readonly [number, number])[] = [[0.5, 0.5]];

/**
 * A thresholded picture with the grey it was thresholded from. For a
 * light-on-dark reading both are of the inverted grey, so dark is always dark.
 */
export interface SampleSource {
	readonly grey: GreyImage;
	readonly binarised: Binarised;
}

export interface SampledGrid {
	/** The hard decisions. */
	readonly matrix: BitMatrix;
	/** 0 to 1 per module, row major. */
	readonly confidence: Float32Array;
	/** 1 per module whose confidence is below `UNCERTAIN`, or which fell outside the picture. */
	readonly uncertain: Uint8Array;
	readonly minConfidence: number;
}

export interface SampleOptions {
	/** A five-point vote per module rather than one centre sample. */
	readonly majorityVote: boolean;
	/**
	 * Modules that fall outside the picture, as a fraction of the symbol, that
	 * the grid tolerates; they sample light and uncertain. Zero refuses any.
	 */
	readonly outside: number;
}

/**
 * Sample a `width` by `height` module grid, module (x, y) spanning [x, x + 1)
 * by [y, y + 1) in the transform's source coordinates. Null when the grid
 * falls further outside the picture than `options.outside` allows, which means
 * the fit is wrong rather than the code is damaged.
 */
export function sampleGrid(
	source: SampleSource,
	transform: Homography,
	width: number,
	height: number,
	options: SampleOptions,
): SampledGrid | null {
	const { grey, binarised } = source;
	const offsets = options.majorityVote ? VOTE_OFFSETS : CENTRE_ONLY;
	const points = offsets.length;
	const modules = width * height;
	// Signed distance from the threshold per sample point, positive towards
	// dark, and the hard bit per point. NaN marks a point off the picture.
	const distances = new Float32Array(modules * points);
	const bits = new Uint8Array(modules * points);
	const [a11, a21, a31, a12, a22, a32, a13, a23, a33] = transform;
	let outside = 0;
	const allowed = Math.floor(modules * options.outside);

	for (let y = 0; y < height; y += 1) {
		for (let x = 0; x < width; x += 1) {
			const module = y * width + x;
			for (let k = 0; k < points; k += 1) {
				const offset = offsets[k] as readonly [number, number];
				const sx = x + offset[0];
				const sy = y + offset[1];
				const d = a13 * sx + a23 * sy + a33;
				const px = Math.floor((a11 * sx + a21 * sy + a31) / d);
				const py = Math.floor((a12 * sx + a22 * sy + a32) / d);
				const at = module * points + k;
				// Written as a negated range test so NaN, from a degenerate fit, lands
				// outside too.
				if (!(px >= 0 && py >= 0 && px < grey.width && py < grey.height)) {
					distances[at] = Number.NaN;
					if (k === 0) {
						outside += 1;
						if (outside > allowed) return null;
					}
					continue;
				}
				const pixel = py * grey.width + px;
				const level = grey.data[pixel] as number;
				const threshold = binarised.threshold(px, py);
				distances[at] = threshold - level;
				bits[at] = binarised.bits[pixel] as number;
			}
		}
	}

	const contrast = symbolContrast(distances, points);
	const matrix = new BitMatrix(width, height);
	const confidence = new Float32Array(modules);
	const uncertain = new Uint8Array(modules);
	let minConfidence = 1;

	for (let module = 0; module < modules; module += 1) {
		const base = module * points;
		if (Number.isNaN(distances[base] as number)) {
			// Off the picture: light, and as uncertain as a module can be.
			uncertain[module] = 1;
			minConfidence = 0;
			continue;
		}
		let votes = 0;
		let sum = 0;
		let counted = 0;
		for (let k = 0; k < points; k += 1) {
			const distance = distances[base + k] as number;
			// A vote point off the picture is light, as the authenticator's
			// bounds-checked read made it; it carries no distance.
			if (Number.isNaN(distance)) continue;
			votes += bits[base + k] as number;
			sum += Math.max(-contrast, Math.min(contrast, distance));
			counted += 1;
		}
		const dark = votes * 2 > points;
		if (dark) matrix.data[module] = 1;
		// How far the evidence leans the way the vote went. When the mean of the
		// distances disagrees with the vote, the module is a coin toss.
		const lean = (dark ? sum : -sum) / counted / contrast;
		const value = Math.max(0, Math.min(1, lean));
		confidence[module] = value;
		if (value < UNCERTAIN) uncertain[module] = 1;
		if (value < minConfidence) minConfidence = value;
	}
	return { matrix, confidence, uncertain, minConfidence };
}

/**
 * The symbol's own contrast: the 90th percentile of how far the centre samples
 * sit from their thresholds. Most modules of any readable symbol sit well
 * clear, so this is the distance a confident module has; a logo or a smear
 * covering a fifth of the symbol does not move it.
 */
function symbolContrast(distances: Float32Array, points: number): number {
	const histogram = new Uint32Array(256);
	let total = 0;
	for (let i = 0; i < distances.length; i += points) {
		const distance = distances[i] as number;
		if (Number.isNaN(distance)) continue;
		histogram[Math.min(255, Math.floor(Math.abs(distance)))] += 1;
		total += 1;
	}
	const target = total * 0.9;
	let seen = 0;
	let level = 0;
	for (; level < 255; level += 1) {
		seen += histogram[level] as number;
		if (seen >= target) break;
	}
	return Math.max(MIN_CONTRAST, level);
}
