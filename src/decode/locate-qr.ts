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
 * The strict profile offers one grid at most, chosen by the symbol's own
 * timing patterns from the same candidates (see `strictHypothesis`).
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
import { apply, fitHomography, quadToQuad } from './transform.js';
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

/** How near its prediction, in modules, the strict reader looks for the alignment pattern first. */
const NEAR_ALIGNMENT = 2;
/** How far from each prediction, in modules, the walk down the diagonal looks. */
const WALK_RADIUS = 4;
/** The worst bullseye score the walk takes for a pattern: a real one scores under 0.1, a patch of data over 0.29. */
const WALK_MAX_SCORE = 0.25;
/** Alignment candidates the strict reader weighs from each window. */
const STRICT_CANDIDATES = 3;

/** The timing patterns' agreement with their alternation, read through a transform from the thresholded picture. */
function timingThrough(image: Binarised, transform: Homography, size: number): number {
	let matched = 0;
	let total = 0;
	for (let i = 8; i < size - 8; i += 1) {
		const dark = i % 2 === 0;
		for (const [u, v] of [
			[i, 6],
			[6, i],
		] as const) {
			const p = apply(transform, u + 0.5, v + 0.5);
			const x = Math.floor(p.x);
			const y = Math.floor(p.y);
			const bit =
				x >= 0 &&
				y >= 0 &&
				x < image.width &&
				y < image.height &&
				image.bits[y * image.width + x] === 1;
			if (bit === dark) matched += 1;
			total += 1;
		}
	}
	return matched / total;
}

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
function estimateSize(image: Binarised, triple: FinderTriple): number {
	const { topLeft, topRight, bottomLeft } = triple;
	// Each axis by its own module size, measured along it at both ends: under
	// perspective the two axes are foreshortened differently.
	const fallback = tripleModuleSize(image, triple);
	const across =
		hypot(topRight.x - topLeft.x, topRight.y - topLeft.y) /
		(moduleSizeAcross(image, topLeft, topRight) ?? fallback);
	const down =
		hypot(bottomLeft.x - topLeft.x, bottomLeft.y - topLeft.y) /
		(moduleSizeAcross(image, topLeft, bottomLeft) ?? fallback);
	return (across + down) / 2 + 7;
}

/** Sizes worth trying, best first: the nearest legal size and its neighbours four and eight away. */
export function candidateSizes(estimate: number, legal: ReadonlySet<number>): number[] {
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
 * The centres of the alignment patterns on the diagonal of a QR symbol of
 * `size` modules, smallest first, past the top left finder: ISO/IEC 18004's
 * table, as the usual formula derives it (version 32 is the one irregular
 * step).
 */
export function diagonalAlignments(size: number): number[] {
	const version = (size - 17) / 4;
	if (version < 2) return [];
	const count = Math.floor(version / 7) + 2;
	const step = version === 32 ? 26 : Math.ceil((version * 4 + 4) / (count * 2 - 2)) * 2;
	const out: number[] = [];
	for (let at = size - 7; out.length < count - 1; at -= step) out.unshift(at);
	return out;
}

/**
 * The grid fitted by walking the alignment patterns down the diagonal: each
 * one predicted from the fit through the last, found close to the
 * prediction, and fitted through in turn. Under perspective the three
 * finders alone put the far corner of a large symbol tens of modules out,
 * but the next pattern along from a good fit is never more than a module or
 * two away. Null when not one pattern is found.
 */
function walkedTransform(image: Binarised, triple: FinderTriple, size: number): Homography | null {
	const { topLeft, topRight, bottomLeft } = triple;
	const source: Point[] = [
		{ x: 3.5, y: 3.5 },
		{ x: size - 3.5, y: 3.5 },
		{ x: 3.5, y: size - 3.5 },
	];
	const destination: Point[] = [topLeft, topRight, bottomLeft];
	let transform = samplingTransform(size, triple, null);
	let found = false;
	for (const centre of diagonalAlignments(size)) {
		const at = centre + 0.5;
		const expected = apply(transform, at, at);
		const module = moduleAt(transform, at);
		// A grid collapsed to a line or a point measures no module, or NaN.
		if (!(module > 0)) break;
		const [best] = searchBullseye(
			image,
			expected,
			Math.max(2, Math.round(WALK_RADIUS * module)),
			module,
			1,
		);
		// A pattern that looks like one: a patch of data that happens to ring would
		// throw every later prediction off. The first is up to three modules from
		// where the finders put it on a large symbol tilted 20 degrees; from then
		// on each prediction is through every pattern already found.
		if (best === undefined || best.score > WALK_MAX_SCORE) continue;
		source.push({ x: at, y: at });
		destination.push(best.point);
		// Least squares through all of them: a pattern in the middle of the symbol
		// is on the line between the top right and bottom left finders, and four
		// points with three on a line fix no projective map.
		const fitted = fitHomography(source, destination);
		if (fitted === null) continue;
		transform = fitted;
		found = true;
	}
	return found ? transform : null;
}

/**
 * The strict reader's one grid for a triple, or null.
 *
 * Of the legal sizes nearest the estimate and a step either side, and for
 * each (from version 2) the alignment pattern candidates near the
 * prediction and the best of the scanner's wide window, each refitted once,
 * the grid that lays the timing patterns down straightest. The symbol's own
 * ruler decides, where rounding an estimate or nearness to an affine guess
 * would not: a version 30 symbol tilted 20 degrees measures two modules
 * short, and under perspective the patch of data nearest the guess is often
 * not the pattern. Whether a plain reader would get the same grid is asked
 * later, of the grid it would lay (see plain.ts); the symbology's strict
 * read then requires the version information to agree with the size.
 */
export function strictHypothesis(
	image: Binarised,
	triple: FinderTriple,
	legal: ReadonlySet<number>,
): GridHypothesis | null {
	let chosen: GridHypothesis | null = null;
	let straightest = -1;
	for (const size of candidateSizes(estimateSize(image, triple), legal).slice(0, 3)) {
		const initial = samplingTransform(size, triple, null);
		const transforms: Homography[] = [];
		// Version 1 has no alignment pattern and reads from the three finders.
		if (size < 25) transforms.push(initial);
		for (const found of size < 25
			? []
			: [
					...alignmentCandidates(image, initial, size, NEAR_ALIGNMENT, STRICT_CANDIDATES),
					...alignmentCandidates(image, initial, size, null, STRICT_CANDIDATES),
				]) {
			const fitted = samplingTransform(size, triple, found);
			const [refined] = alignmentCandidates(image, fitted, size, 2, 1);
			transforms.push(
				refined !== undefined && hypot(refined.x - found.x, refined.y - found.y) > REFIT_MIN_SHIFT
					? samplingTransform(size, triple, refined)
					: fitted,
			);
		}
		const walked = size < 25 ? null : walkedTransform(image, triple, size);
		if (walked !== null) transforms.push(walked);
		for (const transform of transforms) {
			const agreement = timingThrough(image, transform, size);
			if (agreement > straightest) {
				straightest = agreement;
				chosen = { width: size, height: size, transform };
			}
		}
	}
	return chosen;
}

/**
 * Every grid hypothesis for a triple, lazily, best first: the scanner's.
 *
 * The plain three-point fit comes first: it is right for a flat scan and the
 * only answer for version 1. Then each scored alignment candidate, refitted
 * where a tight second search moves it: once a pattern is found the
 * four-point fit through it is projective, so its prediction is sub-module
 * accurate and the re-search either confirms the centre or lands it properly.
 * Both are kept, because the read downstream is exact and can refuse the
 * wrong one.
 */
export function* qrHypotheses(
	image: Binarised,
	triple: FinderTriple,
	legal: ReadonlySet<number>,
): Generator<GridHypothesis> {
	for (const size of candidateSizes(estimateSize(image, triple), legal)) {
		const initial = samplingTransform(size, triple, null);
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
