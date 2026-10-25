/**
 * The strict profile, strict-v1: what the scan check reads with.
 *
 * The scan check's promise is that a design it passes scans on the phones
 * people use, so this reader has to be at least as hard to satisfy as any of
 * them. Whatever it reads, zxing-cpp and jsQR must read too, which
 * tests/decode/conservative.test.ts holds it to over a seeded corpus of
 * damaged captures, styled-conservative.test.ts over every design preset
 * photographed, tilted and damaged, and tilt.test.ts over large symbols at
 * an angle; the verify layer's own captures of every preset, on all nine of
 * its axes, were the survey that set the newer rules below. Against the
 * scanner, it gives up:
 *
 * - every threshold but one: the hybrid binariser the common readers use
 *   (`binariseHybridMean`), at the picture's own scale;
 * - every sample but one: the pixel under each module's centre;
 * - the other polarity: only the design's own, dark-on-light unless told;
 * - mirror images, erasures, and any format information more than one bit
 *   out or with its copies disagreeing (the symbology's strict read);
 * - slack in the finders: their runs within 0.35 of a module of 1:1:3:1:1
 *   along the axes, and within half a module on both diagonals (see
 *   `STRICT_FINDER_TOLERANCE`);
 * - guessing: one finder triple and one grid, the size and (from version 2)
 *   the alignment pattern whose grid lays the timing patterns down
 *   straightest, or no grid at all; a grid whose timing pattern does not
 *   read is not read, and from version 7 its version information has to
 *   agree with its size;
 *
 * and then asks six things of a symbol that did read, all about the picture
 * rather than the symbol:
 *
 * - Its modules must be at least 2.25 pixels across
 *   (`STRICT_MIN_MODULE_PIXELS`), and from version 7 three
 *   (`STRICT_MIN_TILED_MODULE_PIXELS`), and drawn out no more than 1.8 times
 *   one way over the other, a tilt of about 56 degrees
 *   (`STRICT_MAX_FORESHORTENING`).
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
 *   zxing-cpp and this package's scanner take, wherever the picture around
 *   them keeps its contrast. Where they differ on a module whose
 *   neighbourhood has gone pale, the picture has lost the pattern, nearly
 *   always to glare, and a reader that finds its way by it is lost too.
 *   Where they differ on a module whose neighbourhood keeps its contrast,
 *   the centre sits on a drawn edge, which styled designs do on purpose.
 * - The finders' rings must be ones zxing-cpp can trace: no ring of dots,
 *   and at a slant or under a smear no circle (see `finderRingsTraceable`);
 *   and their centres ones it can settle on (see `finderCentresClosed`).
 * - From version 7, the grid zxing-cpp lays in tiles, cornered on the
 *   finders' rings, must read as well (see `tiled.ts`).
 *
 * The reserve of ceil(0.25 t) unused corrections per block is the last part
 * of the profile and is not here: the verify layer applies it, from
 * `MatrixRead.errorsPerBlock` and `capacityPerBlock`.
 */

import { PI, cos, hypot, sin } from '../core/math.js';
import type { SymbolLayout } from '../symbology/types.js';
import { ROLE_CODES } from '../symbology/roles.js';
import type { Binarised } from './binarise.js';
import { binariseHybridMean } from './binarise.js';
import { STRICT_FINDER_TOLERANCE, findFinderPatterns } from './finder.js';
import type { GreyImage } from './grey.js';
import type { Homography } from './transform.js';
import { apply, moduleWidth } from './transform.js';
import { ringPoints } from './tiled.js';
import type { Point } from './types.js';

/**
 * The fewest pixels a module the strict profile reads at. Nyquist is two, and
 * between two and two and a quarter zxing-cpp starts to miss symbols jsQR and
 * this reader still read (2 of 71 in the 20,000-capture corpus); above it, it
 * missed none. The scan check draws at more than this, so the floor costs a
 * design nothing.
 */
export const STRICT_MIN_MODULE_PIXELS = 2.25;

/**
 * The fewest pixels a module from version 7, where zxing-cpp samples in tiles
 * cornered on the finders' rings (see tiled.ts). Below three a ring is two or
 * three pixels thick and the corners zxing-cpp fits to it fall where the
 * pixels happen to: over verify's captures of every preset, at 2.5 pixels a
 * module zxing-cpp missed one version 7 symbol in fifteen that jsQR read, and
 * the tiled grid laid here let some of those through. From three it let none
 * through.
 */
export const STRICT_MIN_TILED_MODULE_PIXELS = 3;

/**
 * The most a module may be drawn out one way over the other at the middle of
 * the symbol: 1.8, a tilt of about 56 degrees. Past it the readers find the
 * far corner by tracing the finders' sides a long way across a steep
 * perspective, and zxing-cpp put it tens of pixels out on a symbol tilted 60
 * degrees that the strict reader read: one of the 127 it read there, and none
 * of the 586 at 50 degrees (1.56).
 */
export const STRICT_MAX_FORESHORTENING = 1.8;

/**
 * How much longer a module is drawn one way than the other at (u, v): the
 * ratio of the largest to the smallest stretch of the transform's derivative
 * there, 1 for a square module and 1 / cos t for a tilt of t.
 */
export function foreshortening(transform: Homography, u: number, v: number): number {
	const [a11, a21, a31, a12, a22, a32, a13, a23, a33] = transform;
	const d = a13 * u + a23 * v + a33;
	const x = (a11 * u + a21 * v + a31) / d;
	const y = (a12 * u + a22 * v + a32) / d;
	// The columns of the derivative: where a step in u, and one in v, goes.
	const ux = (a11 - x * a13) / d;
	const uy = (a12 - y * a13) / d;
	const vx = (a21 - x * a23) / d;
	const vy = (a22 - y * a23) / d;
	const a = ux * ux + uy * uy;
	const b = vx * vx + vy * vy;
	const c = ux * vx + uy * vy;
	const spread = Math.sqrt((a - b) * (a - b) + 4 * c * c);
	return Math.sqrt((a + b + spread) / (a + b - spread));
}

/**
 * Whether the strict profile samples a grid at all: modules wide enough, from
 * version 7 (`tiled`) wider still, and not drawn out past
 * `STRICT_MAX_FORESHORTENING`, all at the middle of the symbol.
 */
export function strictSamples(
	transform: Homography,
	width: number,
	height: number,
	tiled: boolean,
): boolean {
	const u = width / 2;
	const v = height / 2;
	const floor = tiled ? STRICT_MIN_TILED_MODULE_PIXELS : STRICT_MIN_MODULE_PIXELS;
	return (
		moduleWidth(transform, u, v) >= floor &&
		foreshortening(transform, u, v) <= STRICT_MAX_FORESHORTENING
	);
}

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
 * Below this share of the symbol's own contrast, the picture around a
 * fixed-pattern module has lost the contrast that tells dark from light.
 *
 * Measured, not chosen: where the two thresholds split on a fixed-pattern
 * module under glare, the 3 by 3 modules around it span 0.28 to 0.53 of the
 * symbol's range; where they split on a styled design (a round finder centre
 * whose corner module's centre sits on the curve, a dot or a rounded corner
 * in the timing pattern), 0.96 to 1.03. Three quarters sits between them with
 * room either side.
 */
export const WASHED_OUT = 0.75;

/** Samples across each module of the 3 by 3 neighbourhood, a side. */
const NEIGHBOURHOOD_STEPS = 4;

function pixelAt(transform: Homography, u: number, v: number): { x: number; y: number } {
	const [a11, a21, a31, a12, a22, a32, a13, a23, a33] = transform;
	const d = a13 * u + a23 * v + a33;
	return {
		x: Math.floor((a11 * u + a21 * v + a31) / d),
		y: Math.floor((a12 * u + a22 * v + a32) / d),
	};
}

function greyAt(grey: GreyImage, transform: Homography, u: number, v: number): number | undefined {
	const { x, y } = pixelAt(transform, u, v);
	if (x < 0 || y < 0 || x >= grey.width || y >= grey.height) return undefined;
	return grey.data[y * grey.width + x] as number;
}

/**
 * The symbol's own contrast: the spread between the 5th and 95th percentile
 * grey of its module centres.
 */
function symbolRange(grey: GreyImage, transform: Homography, layout: SymbolLayout): number {
	const histogram = new Uint32Array(256);
	let total = 0;
	for (let y = 0; y < layout.height; y += 1) {
		for (let x = 0; x < layout.width; x += 1) {
			const level = greyAt(grey, transform, x + 0.5, y + 0.5);
			if (level === undefined) continue;
			histogram[level] = (histogram[level] as number) + 1;
			total += 1;
		}
	}
	const percentile = (fraction: number): number => {
		let seen = 0;
		let level = 0;
		for (; level < 255; level += 1) {
			seen += histogram[level] as number;
			if (seen >= total * fraction) break;
		}
		return level;
	};
	return percentile(0.95) - percentile(0.05);
}

/** The spread of grey over the 3 by 3 modules centred on module (x, y). */
function neighbourhoodRange(grey: GreyImage, transform: Homography, x: number, y: number): number {
	let low = 255;
	let high = 0;
	const steps = 3 * NEIGHBOURHOOD_STEPS;
	for (let j = 0; j <= steps; j += 1) {
		for (let i = 0; i <= steps; i += 1) {
			const level = greyAt(
				grey,
				transform,
				x - 1 + i / NEIGHBOURHOOD_STEPS,
				y - 1 + j / NEIGHBOURHOOD_STEPS,
			);
			if (level === undefined) continue;
			if (level < low) low = level;
			if (level > high) high = level;
		}
	}
	return high - low;
}

/**
 * Whether the fixed-pattern modules read the same in two thresholded
 * versions of one picture, at the pixel under each centre, wherever the
 * picture there still has its contrast.
 *
 * A module the two split on is forgiven when the 3 by 3 modules around it
 * span at least `WASHED_OUT` of the symbol's range: then the split is a
 * centre that sits on a drawn edge, which a styled design puts there on
 * purpose and every reader resolves by its neighbours. Where the
 * neighbourhood itself has gone pale, the split is the picture losing the
 * pattern, and that refuses.
 */
export function fixedPatternsAgree(
	a: Binarised,
	b: Binarised,
	grey: GreyImage,
	transform: Homography,
	layout: SymbolLayout,
): boolean {
	let range: number | undefined;
	for (let y = 0; y < layout.height; y += 1) {
		for (let x = 0; x < layout.width; x += 1) {
			if (!FIXED_ROLES.has(layout.roles[y * layout.width + x] as number)) continue;
			// The strict grid has every module centre on the picture.
			const { x: px, y: py } = pixelAt(transform, x + 0.5, y + 0.5);
			const at = py * a.width + px;
			if (a.bits[at] === b.bits[at]) continue;
			range ??= symbolRange(grey, transform, layout);
			if (neighbourhoodRange(grey, transform, x, y) < range * WASHED_OUT) return false;
		}
	}
	return true;
}

/**
 * Past this ratio between the largest and smallest finder, the symbol is seen
 * at a slant, and zxing-cpp stops trusting the finders' centres alone: it
 * traces the straight outer sides of the finders' rings and intersects them
 * to find the far corner. Its switch is at a tenth by its own measure; by
 * this one, taken through the fitted grid, it starts failing round rings at
 * about 1.06 (a tilt of 8 to 10 degrees), so the strict reader asks for
 * traceable sides from half that.
 */
export const STRICT_SLANT = 1.03;
/** A finder whose diagonal reach is less than this times its axial reach has no corners to its ring: a circle. */
const MIN_CORNER_RATIO = 1.06;
/** The most a ring's outer side may wander, in modules, over its middle stretch, to count as a straight line. */
const MAX_SIDE_WANDER = 0.12;
/** The middle stretch of a side, in modules either side of its centre. */
const SIDE_STRETCH = 1.2;
const SIDE_STEP = 0.2;
const EDGE_STEP = 0.02;

/** Bilinear grey at a point given in module coordinates, or NaN off the picture. */
function greyAtModule(grey: GreyImage, transform: Homography, u: number, v: number): number {
	const [a11, a21, a31, a12, a22, a32, a13, a23, a33] = transform;
	const d = a13 * u + a23 * v + a33;
	const x = (a11 * u + a21 * v + a31) / d - 0.5;
	const y = (a12 * u + a22 * v + a32) / d - 0.5;
	const x0 = Math.floor(x);
	const y0 = Math.floor(y);
	if (x0 < 0 || y0 < 0 || x0 + 1 >= grey.width || y0 + 1 >= grey.height) return Number.NaN;
	const fx = x - x0;
	const fy = y - y0;
	const at = (px: number, py: number): number => grey.data[py * grey.width + px] as number;
	return (
		at(x0, y0) * (1 - fx) * (1 - fy) +
		at(x0 + 1, y0) * fx * (1 - fy) +
		at(x0, y0 + 1) * (1 - fx) * fy +
		at(x0 + 1, y0 + 1) * fx * fy
	);
}

/**
 * How far out a finder's ring reaches along a ray from (u, v) in direction
 * (du, dv), in module units, to sub-module precision: the last point between
 * `from` and `to` where the grey crosses from dark to light, halfway between
 * the darkest and lightest on the ray.
 */
function ringReach(
	grey: GreyImage,
	transform: Homography,
	u: number,
	v: number,
	du: number,
	dv: number,
	from: number,
	to: number,
): number {
	const levels: number[] = [];
	for (let t = from; t <= to; t += EDGE_STEP) {
		levels.push(greyAtModule(grey, transform, u + du * t, v + dv * t));
	}
	let low = 255;
	let high = 0;
	for (const level of levels) {
		if (Number.isNaN(level)) return Number.NaN;
		if (level < low) low = level;
		if (level > high) high = level;
	}
	const middle = (low + high) / 2;
	for (let i = levels.length - 2; i >= 0; i -= 1) {
		const here = levels[i] as number;
		const next = levels[i + 1] as number;
		if (here < middle && next >= middle) {
			return from + (i + (middle - here) / (next - here)) * EDGE_STEP;
		}
	}
	return Number.NaN;
}

/** One module's width in pixels at a point of the symbol. */
function moduleWidthAt(transform: Homography, u: number, v: number): number {
	const here = apply(transform, u, v);
	const across = apply(transform, u + 1, v);
	const down = apply(transform, u, v + 1);
	return (
		(Math.abs(across.x - here.x) +
			Math.abs(across.y - here.y) +
			Math.abs(down.x - here.x) +
			Math.abs(down.y - here.y)) /
		2
	);
}

/** A finder ring's outer side over its middle stretch: how far it wanders, and how far the ring reaches into its corners. */
export interface RingShape {
	readonly wander: number;
	readonly corner: number;
}

/** The ring of the finder centred on module (u, v), or null where it runs off the picture. */
export function ringShape(
	grey: GreyImage,
	transform: Homography,
	u: number,
	v: number,
): RingShape | null {
	let wander = 0;
	let across = 0;
	for (const [du, dv] of [
		[1, 0],
		[-1, 0],
		[0, 1],
		[0, -1],
	] as const) {
		const side: number[] = [];
		for (let t = -SIDE_STRETCH; t <= SIDE_STRETCH + 1e-9; t += SIDE_STEP) {
			// Offset along the side, perpendicular to the ray.
			side.push(ringReach(grey, transform, u + dv * t, v + du * t, du, dv, 2, 4.4));
		}
		if (side.some((reach) => Number.isNaN(reach))) return null;
		wander = Math.max(wander, Math.max(...side) - Math.min(...side));
		across += (side[Math.floor(side.length / 2)] as number) / 4;
	}
	let diagonal = 0;
	for (const [du, dv] of [
		[1, 1],
		[1, -1],
		[-1, 1],
		[-1, -1],
	] as const) {
		const reach = ringReach(grey, transform, u, v, du / Math.SQRT2, dv / Math.SQRT2, 2, 5.6);
		if (Number.isNaN(reach)) return null;
		diagonal += reach / 4;
	}
	return { wander, corner: diagonal / across };
}

/**
 * Past this difference, in modules, between the widest and narrowest blur of
 * a finder's outer edge across sixteen directions, the camera moved during
 * the exposure. Measured, not chosen: square on and under a defocus the
 * difference is under 0.3 of a module for every preset; a smear of 0.75 of a
 * module puts it at 0.45 and more, and each of the 23 round and dotted
 * finders zxing-cpp missed under a smear that the strict reader read was at
 * 0.52 or more.
 */
export const STRICT_MAX_SMEAR = 0.45;

/** Sixteen directions round a finder's centre, turned a little so none runs along a side. */
const SMEAR_RAYS: readonly (readonly [number, number])[] = Array.from({ length: 16 }, (_, k) => {
	const angle = (k * PI) / 8 + 0.1;
	return [cos(angle), sin(angle)] as const;
});
/** Where the outer edge of a finder's ring is looked for: the dark ring from 2.6 modules out, its separator to 4.4. */
const SMEAR_FROM = 2.6;
const SMEAR_TO = 4.4;
/** The samples of the dark ring's own level, and of the separator's, along each ray. */
const SMEAR_DARK = 30;
const SMEAR_LIGHT = 60;
/** Less contrast than this between the ring and its separator, in grey levels, is no edge to measure. */
const SMEAR_MIN_CONTRAST = 8;

/**
 * How wide, in modules, the outer edge of a finder's ring is blurred along a
 * ray from its centre: from a tenth of the way between the ring's level and
 * the separator's to nine tenths. NaN where the ray leaves the picture or
 * finds too little contrast for an edge.
 */
function edgeBlur(
	grey: GreyImage,
	transform: Homography,
	u: number,
	v: number,
	du: number,
	dv: number,
): number {
	const levels: number[] = [];
	for (let i = 0; SMEAR_FROM + i * EDGE_STEP <= SMEAR_TO + 1e-9; i += 1) {
		const t = SMEAR_FROM + i * EDGE_STEP;
		levels.push(greyAtModule(grey, transform, u + du * t, v + dv * t));
	}
	if (levels.some((level) => Number.isNaN(level))) return Number.NaN;
	const low = Math.min(...levels.slice(0, SMEAR_DARK));
	const high = Math.max(...levels.slice(SMEAR_LIGHT));
	if (high - low < SMEAR_MIN_CONTRAST) return Number.NaN;
	// The last rise through a level between the two: there is always one, from
	// the ring's darkest sample, below it, to the separator's lightest, above.
	const crossing = (share: number): number => {
		const level = low + share * (high - low);
		let i = levels.length - 1;
		while (!((levels[i - 1] as number) < level && (levels[i] as number) >= level)) i -= 1;
		const before = levels[i - 1] as number;
		const after = levels[i] as number;
		return SMEAR_FROM + (i - 1 + (level - before) / (after - before)) * EDGE_STEP;
	};
	return crossing(0.9) - crossing(0.1);
}

/**
 * How unevenly a finder's outer edge is blurred: the widest blur over the
 * sixteen directions less the narrowest, in modules. A lens blurs evenly; a
 * moving camera smears one way. Infinite where no two directions measure.
 */
export function finderSmear(grey: GreyImage, transform: Homography, u: number, v: number): number {
	const widths = SMEAR_RAYS.map(([du, dv]) => edgeBlur(grey, transform, u, v, du, dv)).filter(
		(width) => !Number.isNaN(width),
	);
	if (widths.length < 2) return Number.POSITIVE_INFINITY;
	return Math.max(...widths) - Math.min(...widths);
}

/** Whether a finder's dark ring walks closed, inner and outer edge both, in zxing-cpp's threshold (see tiled.ts). */
function ringClosed(bits: Binarised, transform: Homography, u: number, v: number): boolean {
	const centre = apply(transform, u, v);
	const width = Math.round(7 * moduleWidth(transform, u, v));
	return (
		ringPoints(bits, centre, width, 2, false).length > 0 &&
		ringPoints(bits, centre, width, 3, true).length > 0
	);
}

/**
 * Whether each of a QR symbol's finders has a centre zxing-cpp can settle on,
 * in its own threshold `bits`: one dark patch whose edge, walked from the
 * centre's pixel, goes all the way round it, with the middle of the walk on
 * a dark pixel.
 *
 * zxing-cpp, having found a finder by its runs, settles its centre by walking
 * the edge of the dark centre and taking the middle of the walk, and drops the
 * finder when the walk does not close round the centre or its middle is
 * light. Glare that leaves a light hole in the centre does that: a two-tone design under glare that jsQR and
 * the strict reader read was one zxing-cpp found no symbol in at all, with
 * its bottom left finder's centre holed in this threshold and solid in the
 * strict reader's own. Over verify's captures of every preset the rule
 * refuses 7 in 1,000 symbols the strict reader would otherwise read, every
 * one of them read by zxing-cpp too: this threshold is a model of zxing-cpp's
 * and not its own, and where they differ this errs towards refusing.
 */
export function finderCentresClosed(bits: Binarised, transform: Homography, size: number): boolean {
	return [
		[3.5, 3.5],
		[size - 3.5, 3.5],
		[3.5, size - 3.5],
	].every(([u, v]) => {
		const centre = apply(transform, u as number, v as number);
		const reach = Math.round((7 * moduleWidth(transform, u as number, v as number) * 2) / 3);
		const walk = ringPoints(bits, centre, reach, 1, false);
		if (walk.length === 0) return false;
		// The middle of the walk, where zxing-cpp puts the centre, has to be dark.
		let x = 0;
		let y = 0;
		for (const p of walk) {
			x += p.x / walk.length;
			y += p.y / walk.length;
		}
		return bits.bits[Math.floor(y) * bits.width + Math.floor(x)] === 1;
	});
}

/**
 * Whether a QR symbol's finder rings are ones zxing-cpp can trace.
 *
 * zxing-cpp, once the finders differ in size by a tenth, finds the symbol's
 * far corner by tracing the straight outer sides of the finders' rings and
 * intersecting them. A circular ring has no straight side, and a ring of dots
 * has a scalloped one. Over the styled corpus zxing-cpp read none of the
 * circle-ringed presets tilted 15 degrees and every one of them square on;
 * the dot-ringed one it missed a quarter of the time even square on, and
 * most of the time tilted. jsQR, which never looks at the sides, read them
 * all, and so did the strict reader until it asked this.
 *
 * Measured through the fitted grid, so slant and roll drop out: over the
 * middle 2.4 modules of each side, a straight side wanders 0.03 to 0.06 of a
 * module (squares, rounded and extra-rounded corners, squircles, leaves,
 * octagons, cushions) and a circle or a ring of dots 0.20 to 0.25. A circle
 * reaches no further along its diagonals than its axes; every cornered ring,
 * dots included, at least 1.12 times further.
 *
 * So a ring of dots, cornered and scalloped, is refused outright, and a
 * circle when the symbol is seen at a slant.
 *
 * A camera that moves during the exposure does to a round ring what a slant
 * does: over verify's captures zxing-cpp missed round rings smeared by a
 * module or more one time in four that jsQR and the strict reader read, and
 * square ones next to never. A smear also hides a ring of dots, joining them
 * along it and leaving them apart across it, so that the ring measures
 * straight and zxing-cpp still misses it. Smeared past `STRICT_MAX_SMEAR`,
 * then, every ring has to be straight, cornered and, in zxing-cpp's own
 * threshold `bits`, one closed ring.
 */
export function finderRingsTraceable(
	grey: GreyImage,
	bits: Binarised,
	transform: Homography,
	size: number,
): boolean {
	const centres: [number, number][] = [
		[3.5, 3.5],
		[size - 3.5, 3.5],
		[3.5, size - 3.5],
	];
	const widths = centres.map(([u, v]) => moduleWidthAt(transform, u, v));
	const slanted = Math.max(...widths) > Math.min(...widths) * STRICT_SLANT;
	const smeared = centres.some(([u, v]) => finderSmear(grey, transform, u, v) > STRICT_MAX_SMEAR);
	for (const [u, v] of centres) {
		const kind = ringKind(grey, transform, u, v);
		// A ring that cannot be measured is not one a reader can trace either.
		if (kind === null || kind === 'dotted') return false;
		if ((slanted || smeared) && kind === 'round') return false;
		if (smeared && !ringClosed(bits, transform, u, v)) return false;
	}
	return true;
}

/**
 * What a finder's ring is to a reader that traces its sides, by its shape
 * (see `finderRingsTraceable`): `cornered`, straight-sided with corners, which
 * every reader follows; `round`, without corners, which zxing-cpp loses at a
 * slant or under a smear; `dotted`, cornered but scalloped, which it loses
 * anywhere. Null where the ring cannot be measured on the picture.
 *
 * The design layer can ask this of a ring and centre it draws, through the
 * grid it drew them on, to know before any photograph how the strict profile
 * will take them.
 */
export function ringKind(
	grey: GreyImage,
	transform: Homography,
	u: number,
	v: number,
): RingKind | null {
	const ring = ringShape(grey, transform, u, v);
	if (ring === null) return null;
	if (ring.corner < MIN_CORNER_RATIO) return 'round';
	return ring.wander <= MAX_SIDE_WANDER ? 'cornered' : 'dotted';
}

export type RingKind = 'cornered' | 'round' | 'dotted';

/**
 * Whether the strict profile's finder search, thresholding a picture as the
 * strict reader does, finds a finder centred within a module of `centre`.
 *
 * The design layer's conformance test measures a ring and centre with
 * sub-pixel edges at four pixels a module; the strict reader measures whole
 * pixels from the pixels nearest a centre it knows to a fraction of one. This
 * is the strict reader's own measure, for a caller that wants the verdict of
 * the reader that will judge the finder rather than a model of it.
 */
export function strictFindsFinder(image: GreyImage, centre: Point, modulePixels: number): boolean {
	return findFinderPatterns(binariseHybridMean(image), STRICT_FINDER_TOLERANCE).some(
		(pattern) => hypot(pattern.x - centre.x, pattern.y - centre.y) < modulePixels,
	);
}
