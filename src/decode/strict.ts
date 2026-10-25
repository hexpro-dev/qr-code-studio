/**
 * The strict profile, strict-v1: what the scan check reads with.
 *
 * The scan check's promise is that a design it passes scans on the phones
 * people use, so this reader has to be at least as hard to satisfy as any of
 * them. Whatever it reads, zxing-cpp and jsQR must read too, which
 * tests/decode/conservative.test.ts holds it to over a seeded corpus of
 * damaged captures. Against the scanner, it gives up:
 *
 * - every threshold but one: the hybrid binariser the common readers use
 *   (`binariseHybridMean`), at the picture's own scale;
 * - every sample but one: the pixel under each module's centre;
 * - the other polarity: only the design's own, dark-on-light unless told;
 * - mirror images, erasures, and any format information more than one bit
 *   out or with its copies disagreeing (the symbology's strict read);
 * - slack in the finders: their runs within 0.35 of a module of 1:1:3:1:1,
 *   on both diagonals as well as the axes;
 * - guessing: one finder triple, one size computed as a phone computes it,
 *   and from version 2 the alignment pattern found within two modules of
 *   where the finders put it, or no grid at all; a grid whose timing pattern
 *   does not read is not read;
 *
 * and then asks three things of a symbol that did read, all about the picture
 * rather than the symbol:
 *
 * - The thresholded picture must not break up into speckle. Noise that leaves
 *   the symbol itself readable turns a flat background into isolated dark
 *   pixels, and a reader that finds finder patterns by their run ratios finds
 *   them everywhere in it and picks the wrong three: measured against jsQR
 *   over the corpus, that is where it fails, from about one pixel in sixteen.
 *   More than one in fifty is refused.
 * - The grid a plain reader would lay must read to the same bytes (see
 *   `plain.ts`).
 * - The fixed patterns (finders, separators, timing and alignment patterns)
 *   must read the same under both of the thresholds the common readers use,
 *   the block mean jsQR and ZXing take and the middle of the block's range
 *   zxing-cpp and this package's scanner take. Where they differ the picture
 *   has lost the contrast that tells dark from light, nearly always to
 *   glare, and a reader that finds its way by those patterns is lost too.
 *
 * The reserve of ceil(0.25 t) unused corrections per block is the last part
 * of the profile and is not here: the verify layer applies it, from
 * `MatrixRead.errorsPerBlock` and `capacityPerBlock`.
 */

import type { SymbolLayout } from '../symbology/types.js';
import { ROLE_CODES } from '../symbology/roles.js';
import type { Binarised } from './binarise.js';
import type { Homography } from './transform.js';

/** The most speckle, as a fraction of all pixels, the strict profile accepts. */
export const STRICT_MAX_SPECKLE = 0.02;

/**
 * The fraction of pixels that are dark with at most one dark neighbour of
 * four: isolated specks. A symbol's own modules are at least two pixels
 * across at any size the strict reader samples, so none of its pixels is one.
 */
export function speckle(image: Binarised): number {
	const { width, height, bits } = image;
	if (width < 3 || height < 3) return 0;
	let isolated = 0;
	for (let y = 1; y < height - 1; y += 1) {
		for (let x = 1; x < width - 1; x += 1) {
			const at = y * width + x;
			if (bits[at] === 0) continue;
			const neighbours =
				(bits[at - 1] as number) +
				(bits[at + 1] as number) +
				(bits[at - width] as number) +
				(bits[at + width] as number);
			if (neighbours <= 1) isolated += 1;
		}
	}
	return isolated / (width * height);
}

const FIXED_ROLES: ReadonlySet<number> = new Set([
	ROLE_CODES.finder,
	ROLE_CODES.separator,
	ROLE_CODES.timing,
	ROLE_CODES.alignment,
	ROLE_CODES['sub-finder'],
	ROLE_CODES['corner-finder'],
]);

/**
 * Whether every fixed-pattern module reads the same in two thresholded
 * versions of one picture, at the pixel under its centre.
 */
export function fixedPatternsAgree(
	a: Binarised,
	b: Binarised,
	transform: Homography,
	layout: SymbolLayout,
): boolean {
	const [a11, a21, a31, a12, a22, a32, a13, a23, a33] = transform;
	for (let y = 0; y < layout.height; y += 1) {
		for (let x = 0; x < layout.width; x += 1) {
			if (!FIXED_ROLES.has(layout.roles[y * layout.width + x] as number)) continue;
			const u = x + 0.5;
			const v = y + 0.5;
			const d = a13 * u + a23 * v + a33;
			const px = Math.floor((a11 * u + a21 * v + a31) / d);
			const py = Math.floor((a12 * u + a22 * v + a32) / d);
			// The strict grid has every module on the picture, so these are too.
			const at = py * a.width + px;
			if (a.bits[at] !== b.bits[at]) return false;
		}
	}
	return true;
}
