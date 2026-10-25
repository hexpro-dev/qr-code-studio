/**
 * Finding and reading codes in a picture.
 *
 * A ladder rather than one clever attempt. Thresholding, scale and polarity
 * are all guesses, and a guess that costs a few milliseconds is not worth
 * agonising over: try the cheap likely one, then the next. The exact half of
 * reading sits behind each symbology's `read` and is never part of the
 * guessing.
 *
 * Lifted from the authenticator package's reader
 * (google-auth-secret-retriever, `src/qr/decode/decoder.ts`) and generalised:
 * any registered symbology with a locator, several codes in one picture, soft
 * samples and erasures, the strict profile beside the lenient one, and no
 * clock unless the caller hands one in, so the same picture gives the same
 * answer every time.
 */

import type { BitMatrix } from '../core/bit-matrix.js';
import { QrStudioError } from '../core/errors.js';
import type { RgbaImage } from '../core/image.js';
import type { Registry } from '../core/registry.js';
import { createSymbologyRegistry } from '../symbology/registry.js';
import { err, ok } from '../core/result.js';
import type { Result } from '../core/result.js';
import type { Binarised } from './binarise.js';
import { binarise, binariseHybrid } from './binarise.js';
import type { MatrixRead, SymbologyEntry } from '../symbology/types.js';
import { erasureFlags } from './erasures.js';
import type { FinderPattern, FinderTolerance } from './finder.js';
import {
	LENIENT_FINDER_TOLERANCE,
	STRICT_FINDER_TOLERANCE,
	candidateTriples,
	findFinderPatterns,
} from './finder.js';
import { finderFrame } from './frame.js';
import type { GreyImage } from './grey.js';
import { downscaleHalf, fitPixels, looksInverted, toGrey, upscaleSmooth } from './grey.js';
import type { GridHypothesis } from './locate-qr.js';
import { qrHypotheses, qrTimingAgreement, strictHypothesis } from './locate-qr.js';
import { TIMING_AGREEMENT, microHypotheses, rmqrHypotheses } from './locate-single.js';
import type { SampledGrid } from './sample.js';
import { sampleGrid } from './sample.js';
import type { PlainLocation } from './plain.js';
import { plainLuminance, plainReaderGrid, plainReaderLocations, plainThreshold } from './plain.js';
import {
	STRICT_MAX_SPECKLE,
	finderCentresClosed,
	finderRingsTraceable,
	fixedPatternsAgree,
	speckle,
	strictSamples,
} from './strict.js';
import type { Homography } from './transform.js';
import { apply, moduleWidth } from './transform.js';
import { TILED_EXTRA_ERRORS, TILED_SHARP_PIXELS, TILED_SIZE, tiledGrids } from './tiled.js';
import type {
	DecodeFrame,
	DecodeOptions,
	DecodeStage,
	DecodedSymbol,
	Point,
	Rung,
	TelemetrySink,
} from './types.js';

/**
 * The working ceiling, in pixels. 2.5 megapixels is 1826 by 1369 at 4:3,
 * which holds a 141-module symbol at 9.7 pixels a module across the short
 * edge; Nyquist is 2. Measured in the authenticator, four megapixels read
 * nothing two and a half did not, and cost a 50 MB transient on a phone.
 */
export const DEFAULT_MAX_PIXELS = 2_500_000;

/**
 * The strict profile's working ceiling. It reads at the picture's own scale,
 * as the readers it is held to do: fitted to the scanner's ceiling, a version
 * 40 symbol drawn at 10 pixels a module came down to 7, and its size measured
 * off by two modules where zxing-cpp and jsQR, at full resolution, read it.
 * Twelve megapixels holds such a symbol whole and keeps one strict read under
 * a couple of seconds.
 */
export const STRICT_MAX_PIXELS = 12_000_000;

/** The binarised frame handed to telemetry is a picture for a person: a megapixel is more than any overlay shows. */
export const TELEMETRY_PIXELS = 1_000_000;

/**
 * The scanner's ladder, cheapest and most likely first.
 *
 * `inverted` here means the opposite of what the picture's corners suggest,
 * not light-on-dark: the guess is usually right, so the second rung tries the
 * other way round. The order is the authenticator's, set by what a camera can
 * reach in its per-frame budget: both polarities at native and half scale come
 * first, because on 32 dim scenes those four rungs won 23, and the double
 * scale rung costs five to twelve times any other and goes last, where only a
 * still picture's budget reaches it.
 */
const LADDER: readonly Rung[] = [
	{ binariser: 'hybrid', scale: 'one', inverted: false, majorityVote: false },
	{ binariser: 'hybrid', scale: 'one', inverted: true, majorityVote: false },
	// Half scale is the cheapest rung and the one that reads a dim capture: the
	// 2x2 average takes sensor noise out from under the binariser.
	{ binariser: 'hybrid', scale: 'half', inverted: false, majorityVote: true },
	{ binariser: 'hybrid', scale: 'half', inverted: true, majorityVote: true },
	// A global threshold, for the scene the local one over-fits.
	{ binariser: 'otsu', scale: 'one', inverted: false, majorityVote: false },
	{ binariser: 'hybrid', scale: 'one', inverted: false, majorityVote: true },
	{ binariser: 'sauvola', scale: 'one', inverted: false, majorityVote: true },
	{ binariser: 'sauvola', scale: 'one', inverted: true, majorityVote: true },
	// A symbol too small to sample, interpolated up.
	{ binariser: 'hybrid', scale: 'double', inverted: false, majorityVote: false },
];

/**
 * How many of the ladder's rungs look for the one-finder symbologies. They are
 * read from clean pictures only, and a clean picture reads on the first rung
 * in its own polarity, so the rest of the ladder would only spend time.
 */
const SINGLE_FINDER_RUNGS = 2;

/** Finder candidates the one-finder locators consider, strongest first. */
const SINGLE_FINDER_CANDIDATES = 12;

/** Modules of the lenient grid that may fall outside the picture, as a fraction; they read as erasures. */
const LENIENT_OUTSIDE = 0.1;

const STAGE_RANK: Readonly<Record<DecodeStage, number>> = {
	finders: 0,
	geometry: 1,
	format: 2,
	version: 3,
	'reed-solomon': 4,
	segments: 5,
	margin: 6,
};

/** The stage a symbology's refusal names, read as one of ours. An unknown name ranks as format. */
function stageOf(error: QrStudioError): DecodeStage {
	const stage = error.params.stage;
	if (error.code === 'decode/unsupported') return 'segments';
	return typeof stage === 'string' && stage in STAGE_RANK ? (stage as DecodeStage) : 'format';
}

interface Profile {
	readonly strict: boolean;
	readonly rungs: readonly Rung[];
	readonly tolerance: FinderTolerance;
	readonly erasures: boolean;
}

/** A symbology this reader can locate, with its legal sizes. */
interface Target {
	readonly entry: SymbologyEntry;
	readonly kind: 'qr' | 'micro' | 'rmqr';
	/** `${width}x${height}` to version. */
	readonly versions: ReadonlyMap<string, string>;
	readonly sizes: readonly { readonly width: number; readonly height: number }[];
}

/** Everything one decode accumulates, so the helpers below stay small. */
interface Run {
	readonly profile: Profile;
	readonly targets: readonly Target[];
	readonly maxSymbols: number;
	readonly emit: TelemetrySink | undefined;
	readonly found: DecodedSymbol[];
	/** Modules across each found symbol, to grow its mask by one. */
	readonly modules: number[];
	furthest: DecodeStage;
	/** The refusal at the furthest stage, kept for its code. */
	refusal: QrStudioError | undefined;
	/** A grid landed on a symbol somewhere: the difference between not found and unreadable. */
	landed: boolean;
	finders: number;
	/** The picture as given, for the plain reader's own look at it. */
	readonly source: RgbaImage;
}

/** One rung's thresholded picture and how its coordinates map back to the source. */
interface Stage {
	readonly grey: GreyImage;
	readonly binarised: Binarised;
	readonly bits: Uint8Array;
	readonly inverted: boolean;
	readonly majorityVote: boolean;
	/** Source pixels per stage pixel, per axis. */
	readonly scaleX: number;
	readonly scaleY: number;
	readonly singleFinder: boolean;
	/** The strict profile's speckle measure, worked out the first time a read needs it. */
	speckle?: number;
	/** Where a plain reader would lay its grids here, likewise. */
	plain?: readonly PlainLocation[];
	/** The same grey thresholded at the middle of each block's range, likewise. */
	midrange?: Binarised;
	/** The picture as the plain reader thresholds it, likewise. */
	plainBits?: Binarised;
}

/* Option checks: a wrong option is a bug in the caller, so it throws a TypeError. */

function checkImage(image: RgbaImage): void {
	if (
		image === null ||
		typeof image !== 'object' ||
		!Number.isInteger(image.width) ||
		!Number.isInteger(image.height) ||
		image.width < 1 ||
		image.height < 1 ||
		image.data === null ||
		typeof image.data !== 'object' ||
		image.data.length !== image.width * image.height * 4
	) {
		throw new TypeError(
			'decodeImage takes an RgbaImage: whole-number sides and four bytes a pixel',
		);
	}
}

function positiveInteger(value: number | undefined, name: string): number | undefined {
	if (value === undefined) return undefined;
	if (!Number.isInteger(value) || value < 1)
		throw new TypeError(`${name} is a whole number of 1 or more`);
	return value;
}

function resolveProfile(options: DecodeOptions): Profile {
	const profile = options.profile ?? 'lenient';
	if (profile !== 'lenient' && profile !== 'strict-v1') {
		throw new TypeError("profile is 'lenient' or 'strict-v1'");
	}
	const polarity = options.polarity;
	if (polarity !== undefined && polarity !== 'dark-on-light' && polarity !== 'light-on-dark') {
		throw new TypeError("polarity is 'dark-on-light' or 'light-on-dark'");
	}
	if (profile === 'strict-v1') {
		return {
			strict: true,
			// One binariser, at native scale, in the design's own polarity, one
			// centre sample a module: the profile's whole definition, and what a
			// phone does.
			rungs: [
				{
					binariser: 'hybrid-mean',
					scale: 'one',
					inverted: (polarity ?? 'dark-on-light') === 'light-on-dark',
					majorityVote: false,
				},
			],
			tolerance: STRICT_FINDER_TOLERANCE,
			erasures: false,
		};
	}
	return {
		strict: false,
		rungs: LADDER,
		tolerance: LENIENT_FINDER_TOLERANCE,
		erasures: options.erasures ?? true,
	};
}

/** The symbologies to look for, with their sizes, in registry order: QR first in the built-in one. */
function resolveTargets(
	registry: Registry<SymbologyEntry>,
	wanted: readonly string[] | undefined,
): Target[] {
	if (wanted !== undefined) {
		if (!Array.isArray(wanted)) throw new TypeError('symbologies is a list of symbology ids');
		for (const id of wanted) {
			if (!registry.has(id))
				throw new TypeError('symbologies names one this registry does not hold');
		}
	}
	const out: Target[] = [];
	for (const entry of registry.list()) {
		if (wanted !== undefined && !wanted.includes(entry.id)) continue;
		if (entry.id !== 'qr' && entry.id !== 'micro' && entry.id !== 'rmqr') continue;
		const versions = new Map<string, string>();
		const sizes: { width: number; height: number }[] = [];
		for (const version of entry.versions) {
			const size = entry.size(version);
			versions.set(`${size.width}x${size.height}`, version);
			sizes.push(size);
		}
		out.push({ entry, kind: entry.id, versions, sizes });
	}
	return out;
}

/* Masking what was found, so the next look finds something else. */

/**
 * Paint a quad light in a picture's bits, grown by a module, the quad given in
 * source pixels and the bits `scaleX` and `scaleY` source pixels to one.
 * Pixels are tested at their centres against the four edges of the convex
 * quad.
 */
function paintQuad(
	target: Binarised,
	scaleX: number,
	scaleY: number,
	quad: readonly [Point, Point, Point, Point],
	modules: number,
): void {
	const { bits, width, height } = target;
	const local = quad.map((p) => ({ x: p.x / scaleX, y: p.y / scaleY }));
	const cx = (local[0]!.x + local[1]!.x + local[2]!.x + local[3]!.x) / 4;
	const cy = (local[0]!.y + local[1]!.y + local[2]!.y + local[3]!.y) / 4;
	const grow = 1 + 2 / Math.max(1, modules);
	const corners = local.map((p) => ({ x: cx + (p.x - cx) * grow, y: cy + (p.y - cy) * grow }));
	const xs = corners.map((p) => p.x);
	const ys = corners.map((p) => p.y);
	const x0 = Math.max(0, Math.floor(Math.min(...xs)));
	const x1 = Math.min(width - 1, Math.ceil(Math.max(...xs)));
	const y0 = Math.max(0, Math.floor(Math.min(...ys)));
	const y1 = Math.min(height - 1, Math.ceil(Math.max(...ys)));
	// The sign of the quad's winding, so "inside" is the same side of every edge.
	let area = 0;
	for (let i = 0; i < 4; i += 1) {
		const a = corners[i]!;
		const b = corners[(i + 1) % 4]!;
		area += a.x * b.y - b.x * a.y;
	}
	const sign = area >= 0 ? 1 : -1;
	for (let y = y0; y <= y1; y += 1) {
		for (let x = x0; x <= x1; x += 1) {
			let inside = true;
			for (let i = 0; i < 4 && inside; i += 1) {
				const a = corners[i]!;
				const b = corners[(i + 1) % 4]!;
				const cross = (b.x - a.x) * (y + 0.5 - a.y) - (b.y - a.y) * (x + 0.5 - a.x);
				if (cross * sign < 0) inside = false;
			}
			if (inside) bits[y * width + x] = 0;
		}
	}
}

/**
 * Paint a found symbol out of a rung's bits, and out of the plain reader's
 * own picture (which is at the source's scale), so the next search finds the
 * next symbol.
 */
function maskQuad(
	stage: Stage,
	quad: readonly [Point, Point, Point, Point],
	modules: number,
): void {
	paintQuad(stage.binarised, stage.scaleX, stage.scaleY, quad, modules);
	if (stage.plainBits !== undefined) paintQuad(stage.plainBits, 1, 1, quad, modules);
	// A plain reader shown the picture with this symbol covered picks again.
	stage.plain = undefined;
}

/** Whether a new symbol is one already found: its centre falls inside an earlier one's quad. */
function alreadyFound(run: Run, corners: readonly [Point, Point, Point, Point]): boolean {
	const cx = (corners[0].x + corners[1].x + corners[2].x + corners[3].x) / 4;
	const cy = (corners[0].y + corners[1].y + corners[2].y + corners[3].y) / 4;
	return run.found.some(({ corners: quad }) => {
		let positive = 0;
		let negative = 0;
		for (let i = 0; i < 4; i += 1) {
			const a = quad[i]!;
			const b = quad[(i + 1) % 4]!;
			const cross = (b.x - a.x) * (cy - a.y) - (b.y - a.y) * (cx - a.x);
			if (cross > 0) positive += 1;
			if (cross < 0) negative += 1;
		}
		return positive === 0 || negative === 0;
	});
}

/* Reading one grid. */

/**
 * The version a grid's size is. Always there: every locator is handed the
 * sizes this map was built from and offers no others.
 */
function versionFor(target: Target, grid: GridHypothesis): string {
	return target.versions.get(`${grid.width}x${grid.height}`) as string;
}

/** Whether a sampled grid sits on a symbol, by its timing pattern. */
function landedOn(target: Target, grid: SampledGrid): boolean {
	const { matrix } = grid;
	if (target.kind === 'qr') return qrTimingAgreement(matrix.data, matrix.width) >= TIMING_AGREEMENT;
	// The one-finder locators only offer grids whose timing patterns already read
	// in the thresholded picture.
	return true;
}

function remember(run: Run, stage: DecodeStage, error?: QrStudioError): void {
	if (STAGE_RANK[stage] > STAGE_RANK[run.furthest]) {
		run.furthest = stage;
		run.refusal = error;
	} else if (stage === run.furthest && run.refusal === undefined) {
		run.refusal = error;
	}
}

/**
 * Read one sampled grid: with erasures first when the lenient reader has any
 * worth trying, then without. Null when the symbology refuses it.
 */
function readGrid(run: Run, target: Target, grid: SampledGrid, version: string): MatrixRead | null {
	const { entry } = target;
	const attempts: (Uint8Array | undefined)[] = [];
	if (!run.profile.strict && run.profile.erasures) {
		const erasures = erasureFlags(grid, entry.layout(version));
		if (erasures !== null) attempts.push(erasures.flags);
	}
	attempts.push(undefined);
	for (const flags of attempts) {
		try {
			return entry.read(
				grid.matrix,
				flags === undefined ? { strict: run.profile.strict } : { strict: false, erasures: flags },
			);
		} catch (error) {
			if (!(error instanceof QrStudioError)) throw error;
			remember(run, stageOf(error), error);
		}
	}
	return null;
}

function cornersOf(stage: Stage, transform: Homography, width: number, height: number) {
	const corner = (u: number, v: number): Point => {
		const p = apply(transform, u, v);
		return { x: p.x * stage.scaleX, y: p.y * stage.scaleY };
	};
	return [corner(0, 0), corner(width, 0), corner(width, height), corner(0, height)] as const;
}

/**
 * The strict profile's margins, for a symbol that read: its modules wide
 * enough and not drawn out too far, the picture not speckled, its fixed
 * patterns reading the same under both common thresholds (see `strict.ts`),
 * and for QR finder rings a reader can trace with centres it can settle on,
 * from version 7 the grid
 * zxing-cpp lays in tiles reading as well (see `tiled.ts`), and the grid a
 * plain reader would sample reading to the same bytes (see `plain.ts`).
 */
function keepsMargin(
	run: Run,
	stage: Stage,
	target: Target,
	hypothesis: GridHypothesis,
	read: MatrixRead,
): boolean {
	const tiled = target.kind === 'qr' && hypothesis.width >= TILED_SIZE;
	if (!strictSamples(hypothesis.transform, hypothesis.width, hypothesis.height, tiled)) {
		return false;
	}
	stage.speckle ??= speckle(stage.binarised);
	if (stage.speckle > STRICT_MAX_SPECKLE) return false;
	const midrange = (stage.midrange ??= binariseHybrid(stage.grey));
	const layout = target.entry.layout(read.version);
	if (!fixedPatternsAgree(stage.binarised, midrange, stage.grey, hypothesis.transform, layout)) {
		return false;
	}
	if (target.kind !== 'qr') return true;
	if (!finderRingsTraceable(stage.grey, midrange, hypothesis.transform, hypothesis.width)) {
		return false;
	}
	if (!finderCentresClosed(midrange, hypothesis.transform, hypothesis.width)) return false;
	if (tiled && !tiledGridReads(target, midrange, hypothesis, read)) {
		return false;
	}
	// At the source's own size, as the plain reader takes a picture: its
	// scores are in pixels, so its choices change with the scale.
	stage.plainBits ??= plainThreshold(plainLuminance(run.source), stage.inverted);
	stage.plain ??= plainReaderLocations(stage.plainBits);
	for (const location of stage.plain) {
		const grid = plainReaderGrid(stage.plainBits, location);
		if (grid === null) continue;
		try {
			// Read as forgivingly as the plain reader decodes: format information to
			// three bits, either way round. Its grid is what is being tested.
			if (
				sameBytes(target.entry.read(grid, { strict: false }).bitstream.bytes, read.bitstream.bytes)
			) {
				return true;
			}
		} catch (error) {
			if (!(error instanceof QrStudioError)) throw error;
		}
	}
	return false;
}

/**
 * Whether the grids zxing-cpp might lay in tiles from version 7 (see
 * `tiled.ts`), on its own threshold and from each finder centre it might
 * take, all read to the same bytes with no block more than
 * `TILED_EXTRA_ERRORS` worse than this read, or below `TILED_SHARP_PIXELS` a
 * module no block worse at all.
 */
function tiledGridReads(
	target: Target,
	midrange: Binarised,
	hypothesis: GridHypothesis,
	read: MatrixRead,
): boolean {
	const { transform, width, height } = hypothesis;
	const extra =
		moduleWidth(transform, width / 2, height / 2) >= TILED_SHARP_PIXELS ? TILED_EXTRA_ERRORS : 0;
	return tiledGrids(midrange, transform, width).every((matrix) => {
		try {
			const tiled = target.entry.read(matrix, { strict: false });
			return (
				sameBytes(tiled.bitstream.bytes, read.bitstream.bytes) &&
				tiled.errorsPerBlock.every(
					(errors, i) => errors <= (read.errorsPerBlock[i] as number) + extra,
				)
			);
		} catch (error) {
			if (!(error instanceof QrStudioError)) throw error;
			return false;
		}
	});
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
	return a.length === b.length && a.every((byte, i) => byte === b[i]);
}

interface Found {
	readonly symbol: DecodedSymbol;
	readonly modules: number;
}

/** Sample, check and read one hypothesis; the decoded symbol, or null. */
function attemptGrid(
	run: Run,
	stage: Stage,
	target: Target,
	hypothesis: GridHypothesis & { readonly mirrored?: boolean },
): Found | null {
	const version = versionFor(target, hypothesis);
	const grid = sampleGrid(
		{ grey: stage.grey, binarised: stage.binarised },
		hypothesis.transform,
		hypothesis.width,
		hypothesis.height,
		{ majorityVote: stage.majorityVote, outside: run.profile.strict ? 0 : LENIENT_OUTSIDE },
	);
	if (grid === null) {
		remember(run, 'geometry');
		return null;
	}
	const landed = landedOn(target, grid);
	if (!landed) {
		remember(run, 'geometry');
		// The strict reader reads only a grid that demonstrably sits on a symbol.
		if (run.profile.strict) return null;
	}
	// Remember the furthest stage only from grids on a symbol: a format read
	// that fails on a grid in the wrong place says nothing about the symbol.
	const before = { furthest: run.furthest, refusal: run.refusal };
	const read = readGrid(run, target, grid, version);
	if (!landed) {
		run.furthest = before.furthest;
		run.refusal = before.refusal;
	} else {
		run.landed = true;
	}
	if (read === null) return null;
	run.landed = true;
	if (run.profile.strict && !keepsMargin(run, stage, target, hypothesis, read)) {
		remember(run, 'margin');
		return null;
	}
	const corners = cornersOf(stage, hypothesis.transform, hypothesis.width, hypothesis.height);
	const symbol: DecodedSymbol = Object.freeze({
		symbology: target.entry.id,
		corners,
		// A left-handed rMQR grid sampled the mirror image the right way round; the
		// symbology saw a plain symbol, so the reflection is recorded here.
		read: hypothesis.mirrored === true ? Object.freeze({ ...read, mirrored: true }) : read,
		inverted: stage.inverted,
		minConfidence: grid.minConfidence,
	});
	run.emit?.({
		stage: 'located',
		symbology: symbol.symbology,
		corners,
		width: hypothesis.width,
		height: hypothesis.height,
		transform: [
			hypothesis.transform[0] * stage.scaleX,
			hypothesis.transform[1] * stage.scaleX,
			hypothesis.transform[2] * stage.scaleX,
			hypothesis.transform[3] * stage.scaleY,
			hypothesis.transform[4] * stage.scaleY,
			hypothesis.transform[5] * stage.scaleY,
			hypothesis.transform[6],
			hypothesis.transform[7],
			hypothesis.transform[8],
		],
	});
	run.emit?.({
		stage: 'sampled',
		symbology: symbol.symbology,
		width: hypothesis.width,
		height: hypothesis.height,
		modules: new Uint8Array(grid.matrix.data),
		uncertain: new Uint8Array(grid.uncertain),
	});
	run.emit?.({
		stage: 'corrected',
		symbology: symbol.symbology,
		version: read.version,
		ecLevel: read.ecLevel,
		errorsPerBlock: read.errorsPerBlock,
		erasuresUsed: read.erasuresUsed,
	});
	return { symbol, modules: hypothesis.width };
}

/** The first symbol any locator finds and reads in a rung's current bits, or null. */
function findOne(run: Run, stage: Stage, patterns: readonly FinderPattern[]): Found | null {
	const { profile } = run;
	for (const target of run.targets) {
		if (target.kind !== 'qr') continue;
		const legal = new Set(target.sizes.map((size) => size.width));
		// The strict reader tries the best triple only, as jsQR does: a reader that
		// has to hunt through combinations to find the symbol is not one a phone
		// is.
		const triples = candidateTriples(patterns);
		// Three finders that could be one symbol's: past the finders, whatever
		// the grids make of them.
		if (triples.length > 0) remember(run, 'geometry');
		if (profile.strict) {
			const best = triples[0];
			const hypothesis = best === undefined ? null : strictHypothesis(stage.binarised, best, legal);
			const symbol = hypothesis === null ? null : attemptGrid(run, stage, target, hypothesis);
			if (symbol !== null) return symbol;
			continue;
		}
		for (const triple of triples) {
			for (const hypothesis of qrHypotheses(stage.binarised, triple, legal)) {
				const symbol = attemptGrid(run, stage, target, hypothesis);
				if (symbol !== null) return symbol;
			}
		}
	}
	if (!stage.singleFinder) return null;
	const singles = run.targets.filter((target) => target.kind !== 'qr');
	if (singles.length === 0) return null;
	for (const pattern of patterns.slice(0, SINGLE_FINDER_CANDIDATES)) {
		const frame = finderFrame(stage.binarised, pattern);
		if (frame === null) continue;
		for (const target of singles) {
			const hypotheses =
				target.kind === 'micro'
					? microHypotheses(
							stage.binarised,
							frame,
							target.sizes.map((size) => size.width),
						)
					: rmqrHypotheses(stage.binarised, frame, target.sizes, !profile.strict);
			if (hypotheses.length === 0) remember(run, 'geometry');
			for (const hypothesis of hypotheses) {
				const symbol = attemptGrid(run, stage, target, hypothesis);
				if (symbol !== null) return symbol;
			}
		}
	}
	return null;
}

function invertGrey(image: GreyImage): GreyImage {
	const data = new Uint8Array(image.data.length);
	for (let i = 0; i < data.length; i += 1) data[i] = 255 - (image.data[i] as number);
	return { data, width: image.width, height: image.height };
}

/** A rung's working picture, thresholded, in the rung's polarity, with what was found masked out. */
function prepareStage(
	run: Run,
	fitted: GreyImage,
	source: RgbaImage,
	rung: Rung,
	attempt: number,
): Stage {
	const scaled =
		rung.scale === 'half'
			? downscaleHalf(fitted)
			: rung.scale === 'double'
				? upscaleSmooth(fitted, 2)
				: fitted;
	// Light-on-dark is read by inverting the grey and thresholding that, rather
	// than flipping the thresholded bits. The binariser assumes a flat area is
	// light ground, which is what keeps a plain quiet zone clean, and on a dark
	// ground that assumption only holds the right way up.
	const grey = rung.inverted ? invertGrey(scaled) : scaled;
	const binarised = binarise(grey, rung.binariser);
	const stage: Stage = {
		grey,
		binarised,
		bits: binarised.bits,
		inverted: rung.inverted,
		majorityVote: rung.majorityVote,
		scaleX: source.width / grey.width,
		scaleY: source.height / grey.height,
		singleFinder: run.profile.strict || attempt <= SINGLE_FINDER_RUNGS,
	};
	run.found.forEach((symbol, i) => maskQuad(stage, symbol.corners, run.modules[i] as number));
	return stage;
}

/** The binarised picture for telemetry, decimated to at most a megapixel by an integer stride. */
function binarisedFrame(stage: Stage, attempt: number, rung: Rung): DecodeFrame {
	const { width, height } = stage.binarised;
	let stride = 1;
	while (Math.ceil(width / stride) * Math.ceil(height / stride) > TELEMETRY_PIXELS) stride += 1;
	const w = Math.ceil(width / stride);
	const h = Math.ceil(height / stride);
	const bits = new Uint8Array(w * h);
	for (let y = 0; y < h; y += 1) {
		for (let x = 0; x < w; x += 1)
			bits[y * w + x] = stage.bits[y * stride * width + x * stride] as number;
	}
	return { stage: 'binarised', attempt, rung, width: w, height: h, bits };
}

/**
 * Find and read every code in a picture, up to `maxSymbols`.
 *
 * A failed Result is 'decode/not-found' when no grid ever landed on a symbol,
 * and 'decode/unreadable' (or the symbology's own 'decode/unsupported') when
 * one did and its read was refused; both carry `params.stage`, the furthest
 * stage reached. Nothing here reads a clock unless `options.clock` is given,
 * so a picture gives the same answer every time.
 *
 * The ladder stops after the first rung that reads anything, having looked
 * again on that rung, with each find masked out, until it finds nothing more:
 * several codes in one picture are nearly always under the same light, and a
 * camera frame with one code in it should not pay for eight more rungs.
 */
export function decodeImage(
	image: RgbaImage,
	options: DecodeOptions = {},
	symbologies?: Registry<SymbologyEntry>,
): Result<readonly DecodedSymbol[]> {
	checkImage(image);
	const profile = resolveProfile(options);
	const registry = symbologies ?? defaultSymbologies();
	const targets = resolveTargets(registry, options.symbologies);
	const budget = options.budget ?? {};
	const maxPixels =
		positiveInteger(budget.maxPixels, 'budget.maxPixels') ??
		(profile.strict ? STRICT_MAX_PIXELS : DEFAULT_MAX_PIXELS);
	const maxAttempts =
		positiveInteger(budget.maxAttempts, 'budget.maxAttempts') ?? profile.rungs.length;
	const maxSymbols = positiveInteger(options.maxSymbols, 'maxSymbols') ?? 8;
	const clock = options.clock;
	if (clock !== undefined && typeof clock !== 'function')
		throw new TypeError('clock is a function');
	if (budget.maxMs !== undefined) {
		if (typeof budget.maxMs !== 'number' || !(budget.maxMs >= 0)) {
			throw new TypeError('budget.maxMs is a number of milliseconds');
		}
		if (clock === undefined) throw new TypeError('budget.maxMs needs a clock to measure it by');
	}
	const emit = options.onTelemetry;
	const started = clock?.();
	const elapsed = (): number | null => (clock === undefined ? null : clock() - (started as number));

	const full = toGrey(image);
	const fitted = fitPixels(full, maxPixels);
	emit?.({
		stage: 'source',
		width: image.width,
		height: image.height,
		workWidth: fitted.width,
		workHeight: fitted.height,
	});
	// The lenient ladder's polarity guess: the caller's, or the picture's corners.
	const startInverted = profile.strict
		? false
		: options.polarity !== undefined
			? options.polarity === 'light-on-dark'
			: looksInverted(fitted);

	const run: Run = {
		profile,
		targets,
		maxSymbols,
		emit,
		found: [],
		modules: [],
		furthest: 'finders',
		refusal: undefined,
		landed: false,
		finders: 0,
		source: image,
	};
	let attempts = 0;
	for (const listed of profile.rungs.slice(0, maxAttempts)) {
		if (budget.maxMs !== undefined && (elapsed() as number) > budget.maxMs) break;
		attempts += 1;
		const rung: Rung = profile.strict
			? listed
			: { ...listed, inverted: listed.inverted !== startInverted };
		const stage = prepareStage(run, fitted, image, rung, attempts);
		if (attempts === 1 && emit !== undefined) emit(binarisedFrame(stage, attempts, rung));
		// Look again after every find, with it masked out, until a look finds
		// nothing new. Bounded twice over: by maxSymbols, and by the looks, so a
		// find that somehow survives its own mask cannot loop.
		for (let look = 0; look < maxSymbols + 2 && run.found.length < maxSymbols; look += 1) {
			const patterns = findFinderPatterns(stage.binarised, profile.tolerance);
			run.finders = Math.max(run.finders, patterns.length);
			emit?.({
				stage: 'finders',
				attempt: attempts,
				patterns: patterns.map((p) => ({
					x: p.x * stage.scaleX,
					y: p.y * stage.scaleY,
					moduleSize: p.moduleSize * stage.scaleX,
					confidence: p.count,
				})),
			});
			const next = findOne(run, stage, patterns);
			if (next === null) break;
			const { symbol, modules } = next;
			if (!alreadyFound(run, symbol.corners)) {
				run.found.push(symbol);
				run.modules.push(modules);
			}
			maskQuad(stage, symbol.corners, modules);
		}
		if (run.found.length > 0) break;
	}

	if (run.found.length > 0) {
		emit?.({ stage: 'decoded', symbols: run.found.length, attempts, ms: elapsed() });
		return ok(Object.freeze(run.found.slice()));
	}
	const failure = failureOf(run);
	emit?.({
		stage: 'failed',
		code: failure.code as 'decode/not-found' | 'decode/unreadable' | 'decode/unsupported',
		reached: run.landed ? run.furthest : run.furthest === 'finders' ? 'finders' : 'geometry',
		attempts,
		ms: elapsed(),
	});
	return err(failure);
}

const NOT_FOUND = 'No code was found in this picture.';
const UNREADABLE = 'A code was found here, but it is too damaged or unclear to read.';

function failureOf(run: Run): QrStudioError {
	if (!run.landed) {
		return new QrStudioError('decode/not-found', NOT_FOUND, {
			stage: run.furthest === 'finders' ? 'finders' : 'geometry',
			finders: run.finders,
		});
	}
	if (run.refusal !== undefined && run.refusal.code === 'decode/unsupported') return run.refusal;
	return new QrStudioError('decode/unreadable', UNREADABLE, { stage: run.furthest });
}

/**
 * Read an already sampled matrix with whichever registered symbology has a
 * version of its size. Pure: throws QrStudioError 'decode/unreadable' with
 * params { stage }, the furthest stage any symbology reached.
 */
export function decodeMatrix(
	matrix: BitMatrix,
	options: { readonly strict?: boolean; readonly symbologies?: readonly string[] } = {},
	symbologies?: Registry<SymbologyEntry>,
): MatrixRead {
	const strict = options.strict ?? false;
	if (typeof strict !== 'boolean') throw new TypeError('strict is true or false');
	const registry = symbologies ?? defaultSymbologies();
	if (options.symbologies !== undefined) resolveTargets(registry, options.symbologies);
	let refusal: QrStudioError | undefined;
	let rank = -1;
	for (const entry of registry.list()) {
		if (options.symbologies !== undefined && !options.symbologies.includes(entry.id)) continue;
		const fits = entry.versions.some((version) => {
			const size = entry.size(version);
			return size.width === matrix.width && size.height === matrix.height;
		});
		if (!fits) continue;
		try {
			return entry.read(matrix, { strict });
		} catch (error) {
			if (!(error instanceof QrStudioError)) throw error;
			const stage = STAGE_RANK[stageOf(error)];
			if (stage > rank) {
				rank = stage;
				refusal = error;
			}
		}
	}
	throw (
		refusal ??
		new QrStudioError('decode/unreadable', 'This is not a size any code here comes in.', {
			stage: 'version',
		})
	);
}

/** The registry used when none is passed: the built-in symbologies. */
function defaultSymbologies(): Registry<SymbologyEntry> {
	return createSymbologyRegistry();
}
