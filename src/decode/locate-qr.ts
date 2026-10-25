/**
 * From three finder patterns to sampling grids for QR Model 2.
 *
 * Every grid a triple could stand for, best guess first. The size is
 * measured, so it carries error, and the far corner of the symbol is
 * extrapolated, so it carries more; rather than commit to one answer the
 * scanner offers the nearest legal size and its neighbours, and the plain
 * three-point fit beside each alignment pattern candidate. Trying a wrong one
 * is cheap and safe, because format information and then Reed-Solomon refuse
 * it almost at once, and they are exact where everything here is estimated.
 *
 * The strict profile offers one grid at most: the size a phone reader would
 * compute, through the alignment pattern found close to where the finders put
 * it, or no grid when it is not there.
 *
 * Lifted from the authenticator package's reader
 * (google-auth-secret-retriever, `src/qr/decode/decoder.ts`).
 */

import { hypot } from '../core/math.js';
import { searchBullseye } from './alignment.js';
import type { Binarised } from './binarise.js';
import type { FinderTriple } from './finder.js';
import { moduleSizeAcross } from './finder.js';
import type { Homography } from './transform.js';
import { apply, quadToQuad } from './transform.js';
import type { Point } from './types.js';

export interface GridHypothesis {
	/** Modules across and down. */
	readonly width: number;
	readonly height: number;
	/** Module coordinates to work-image pixels. */
	readonly transform: Homography;
}

/** Below this, in pixels, a re-search has landed on the same centre. */
const REFIT_MIN_SHIFT = 0.5;

/**
 * How far the strict search looks for the alignment pattern, in modules,
 * around where the three finders put it. A reader that takes the nearest
 * plausible pattern to that prediction, as jsQR does, picks a data module
 * once the real pattern is further off than this, and the grid it lays then
 * misses the symbol: so the strict reader requires it this close, found.
 */
const STRICT_ALIGNMENT_RADIUS = 2;

/**
 * Module size for a triple, measured along the two axes joining the finders
 * rather than taken from the row scan, which inflates with rotation (see
 * `moduleSizeAcross`).
 */
export function tripleModuleSize(image: Binarised, triple: FinderTriple): number {
	const { topLeft, topRight, bottomLeft } = triple;
	const across = moduleSizeAcross(image, topLeft, topRight);
	const down = moduleSizeAcross(image, topLeft, bottomLeft);
	if (across !== null && down !== null) return (across + down) / 2;
	return across ?? down ?? (topLeft.moduleSize + topRight.moduleSize + bottomLeft.moduleSize) / 3;
}

/** The size the finders imply, before it is made legal: finder centres sit 3.5 modules in from each edge. */
function estimateSize(triple: FinderTriple, moduleSize: number): number {
	const { topLeft, topRight, bottomLeft } = triple;
	const across = hypot(topRight.x - topLeft.x, topRight.y - topLeft.y) / moduleSize;
	const down = hypot(bottomLeft.x - topLeft.x, bottomLeft.y - topLeft.y) / moduleSize;
	return (across + down) / 2 + 7;
}

/**
 * Sizes worth trying, best first. Lenient: the nearest legal size and its
 * neighbours four and eight away. Strict: the one size a phone reader
 * computes, rounding the estimate and moving one module to a legal size, or
 * none when the estimate lands on 3 mod 4, which zxing and jsQR both refuse.
 */
export function candidateSizes(
	estimate: number,
	legal: ReadonlySet<number>,
	strict: boolean,
): number[] {
	if (strict) {
		let size = Math.round(estimate);
		const remainder = size % 4;
		if (remainder === 0) size += 1;
		else if (remainder === 2) size -= 1;
		else if (remainder === 3) return [];
		return legal.has(size) ? [size] : [];
	}
	const nearest = Math.round((estimate - 17) / 4) * 4 + 17;
	return [nearest, nearest - 4, nearest + 4, nearest - 8, nearest + 8].filter((size) =>
		legal.has(size),
	);
}

/**
 * The transform from module coordinates to pixels, from the three finder
 * centres and a fourth correspondence: the alignment pattern when one was
 * found, at module (size - 7, size - 7) whose centre is size - 6.5, or else
 * the corner the finders imply, treating the view as a parallelogram, which is
 * exact for an affine view and good enough for mild perspective.
 */
function samplingTransform(
	size: number,
	triple: FinderTriple,
	alignment: Point | null,
): Homography {
	const { topLeft, topRight, bottomLeft } = triple;
	const edge = size - 3.5;
	const fourth = alignment ?? {
		x: topRight.x + bottomLeft.x - topLeft.x,
		y: topRight.y + bottomLeft.y - topLeft.y,
	};
	const fourthSource = alignment === null ? edge : size - 6.5;
	return quadToQuad(
		[
			{ x: 3.5, y: 3.5 },
			{ x: edge, y: 3.5 },
			{ x: fourthSource, y: fourthSource },
			{ x: 3.5, y: edge },
		],
		[topLeft, topRight, fourth, bottomLeft],
	);
}

/** One module's width in pixels near a point of the symbol, through a transform. */
function moduleAt(transform: Homography, at: number): number {
	const here = apply(transform, at, at);
	const next = apply(transform, at + 1, at);
	return hypot(next.x - here.x, next.y - here.y);
}

/**
 * Candidates for the bottom right alignment pattern, best first, or none for
 * version 1, which has no alignment pattern.
 *
 * The lenient window has to cover how wrong the prediction can be, not how
 * big the pattern is: from three finders the far corner is extrapolated as if
 * the view were affine, and on a real perspective view that is off by a good
 * fraction of the symbol at the far corner.
 */
function alignmentCandidates(
	image: Binarised,
	transform: Homography,
	size: number,
	radiusModules: number | null,
	limit: number,
): Point[] {
	if (size < 25) return [];
	const centre = size - 6.5;
	const expected = apply(transform, centre, centre);
	const module = moduleAt(transform, centre);
	if (!Number.isFinite(module) || !Number.isFinite(expected.x) || module <= 0) return [];
	const radius =
		radiusModules === null
			? Math.max(4, Math.round(Math.min(module * 6 + size * module * 0.12, 160)))
			: Math.max(2, Math.round(radiusModules * module));
	return searchBullseye(image, expected, radius, module, limit).map((match) => match.point);
}

/**
 * Every grid hypothesis for a triple, lazily, best first.
 *
 * The plain three-point fit comes first in the scanner: it is right for a
 * flat scan and the only answer for version 1. Then each scored alignment
 * candidate, refitted where a tight second search moves it: once a pattern
 * is found the four-point fit through it is projective, so its prediction is
 * sub-module accurate and the re-search either confirms the centre or lands
 * it properly. Both are kept, because the read downstream is exact and can
 * refuse the wrong one.
 */
export function* qrHypotheses(
	image: Binarised,
	triple: FinderTriple,
	legal: ReadonlySet<number>,
	strict: boolean,
): Generator<GridHypothesis> {
	const moduleSize = tripleModuleSize(image, triple);
	for (const size of candidateSizes(estimateSize(triple, moduleSize), legal, strict)) {
		const initial = samplingTransform(size, triple, null);
		if (strict) {
			// Version 1 has no alignment pattern and reads from the three finders; from
			// version 2 the pattern has to be there, where it belongs.
			if (size < 25) {
				yield { width: size, height: size, transform: initial };
				continue;
			}
			const [best] = alignmentCandidates(image, initial, size, STRICT_ALIGNMENT_RADIUS, 1);
			if (best !== undefined) {
				yield { width: size, height: size, transform: samplingTransform(size, triple, best) };
			}
			continue;
		}
		yield { width: size, height: size, transform: initial };
		for (const found of alignmentCandidates(image, initial, size, null, 3)) {
			const transform = samplingTransform(size, triple, found);
			const [refined] = alignmentCandidates(image, transform, size, 2, 1);
			if (
				refined !== undefined &&
				hypot(refined.x - found.x, refined.y - found.y) > REFIT_MIN_SHIFT
			) {
				yield { width: size, height: size, transform: samplingTransform(size, triple, refined) };
			}
			yield { width: size, height: size, transform };
		}
	}
}

/**
 * Whether a sampled QR grid landed on the symbol.
 *
 * Row and column six alternate dark and light across every QR symbol, so they
 * are the cheapest test there is of whether the grid is in the right place,
 * and unlike Reed-Solomon they answer that question specifically: a misplaced
 * grid scores about a half and a damaged symbol on the right grid scores
 * nearly one. Symmetric under transposition, so a mirrored symbol passes too.
 */
export function qrTimingAgreement(modules: Uint8Array, size: number): number {
	let matched = 0;
	let total = 0;
	for (let i = 8; i < size - 8; i += 1) {
		const dark = i % 2 === 0 ? 1 : 0;
		if (modules[6 * size + i] === dark) matched += 1;
		if (modules[i * size + 6] === dark) matched += 1;
		total += 2;
	}
	return matched / total;
}
