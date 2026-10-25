/**
 * Reading a sampled QR matrix: modules in, bitstream out.
 *
 * The order is the specification's, and each step can refuse:
 *
 *   1. format information (level and mask), from either of its two copies;
 *   2. version information from version 7, checked against the size;
 *   3. unmask;
 *   4. extract the codewords along the placement walk;
 *   5. de-interleave;
 *   6. Reed-Solomon per block, through core, with misdecode protection;
 *   7. the bitstream, through `readSegments`.
 *
 * Lifted from the authenticator package's matrix decoder
 * (`src/qr/decode/{extract,blocks,matrix-decoder}.ts` there) and given the
 * two profiles the scan check needs.
 *
 * Strict is the reading of a careful phone: format information with at most
 * one bit corrected and both copies agreeing, version information required
 * from version 7 (the size alone is not trusted), no mirrored attempt and no
 * erasures. It must be at least as hard to satisfy as the readers people use,
 * because the scan check's "this will scan" rests on it.
 *
 * Lenient is the reading of a reader trying hard: format information up to
 * three bits out in either copy (BCH(15, 5) corrects three), each plausible
 * format tried in turn, the size standing in for unreadable version
 * information, erasures honoured, and a mirrored (transposed) attempt when
 * the symbol will not read the right way round.
 *
 * Neither applies the strict profile's error margin, ceil(0.25 * t) of each
 * block left unused. That is the scan check's verdict to give, so the numbers
 * it needs (errors and capacity per block) are reported and nothing more.
 *
 * Every failure is a QrStudioError with code 'decode/unreadable' and a stage:
 * 'version', 'format', 'reed-solomon' (from core) or 'segments' (from the
 * segment layer), or 'decode/unsupported' for a character set this runtime
 * cannot decode.
 */

import type { BitMatrix } from '../../core/bit-matrix.js';
import { QrStudioError } from '../../core/errors.js';
import { qrProfile } from '../../segment/profile.js';
import { readSegments } from '../../segment/read.js';
import type { EcLevel } from '../../segment/types.js';
import type { MatrixRead, ReadOptions } from '../types.js';
import { decodeBlocks, qrBlocks } from './blocks.js';
import { readFormat, readVersion } from './info.js';
import type { QrGeometry } from './layout.js';
import { qrGeometry } from './layout.js';
import { QR_MASKS } from './mask.js';

/** BCH(15, 5) and BCH(18, 6) both have minimum distance 7 or more, so both correct three bits. */
const LENIENT_INFO_BITS = 3;
const STRICT_FORMAT_BITS = 1;

const UNREADABLE = {
	size: 'This is not a size a QR code comes in.',
	version: 'The size of this code and the version it says it is do not match.',
	format: 'The part of this code that says how it was made is too damaged to read.',
} as const;

function unreadable(why: keyof typeof UNREADABLE): QrStudioError {
	return new QrStudioError('decode/unreadable', UNREADABLE[why], {
		stage: why === 'format' ? 'format' : 'version',
	});
}

function wordAt(modules: Uint8Array, positions: Int32Array, msbFirst: boolean): number {
	let word = 0;
	for (let i = 0; i < positions.length; i += 1) {
		const bit = modules[positions[i] as number] as number;
		if (msbFirst) word = word * 2 + bit;
		else word += bit * (1 << i);
	}
	return word;
}

interface FormatCandidate {
	readonly ecLevel: EcLevel;
	readonly mask: number;
	readonly errors: number;
}

/**
 * The formats worth trying, best first. Strict gives one or none; lenient
 * gives each distinct format either copy decodes to, nearest first, the
 * top-left copy first on a tie.
 */
function formatCandidates(
	modules: Uint8Array,
	geometry: QrGeometry,
	strict: boolean,
): FormatCandidate[] {
	const limit = strict ? STRICT_FORMAT_BITS : LENIENT_INFO_BITS;
	const first = readFormat(wordAt(modules, geometry.formatFirst, true), limit);
	const second = readFormat(wordAt(modules, geometry.formatSecond, true), limit);
	if (strict) {
		if (first === undefined || second === undefined) return [];
		if (first.ecLevel !== second.ecLevel || first.mask !== second.mask) return [];
		return [
			{
				ecLevel: first.ecLevel,
				mask: first.mask,
				errors: Math.max(first.distance, second.distance),
			},
		];
	}
	const found = [first, second].filter((read) => read !== undefined);
	found.sort((a, b) => a.distance - b.distance);
	const out: FormatCandidate[] = [];
	for (const read of found) {
		if (out.some((c) => c.ecLevel === read.ecLevel && c.mask === read.mask)) continue;
		out.push({ ecLevel: read.ecLevel, mask: read.mask, errors: read.distance });
	}
	return out;
}

/**
 * Check version information against the size.
 *
 * Below version 7 the size is the only source and it is exact. From 7 the
 * symbol also states its version twice. A copy that decodes to a different
 * version means either heavy damage to that copy or a grid sampled at the
 * wrong size, and carrying on in the second case produces confident
 * nonsense. So strict refuses whenever a copy disagrees or neither agrees,
 * as zxing does; lenient refuses only when a copy disagrees and neither
 * agrees. When neither copy decodes at all, lenient trusts the size, because
 * a grid sampled at the wrong size almost never lands on a legal one; strict
 * does not, because a phone that cannot read the version block does not read
 * the code.
 */
function checkVersion(modules: Uint8Array, geometry: QrGeometry, strict: boolean): void {
	if (geometry.versionFirst.length === 0) return;
	const reads = [
		readVersion(wordAt(modules, geometry.versionFirst, false), LENIENT_INFO_BITS),
		readVersion(wordAt(modules, geometry.versionSecond, false), LENIENT_INFO_BITS),
	];
	const agree = reads.some((read) => read?.version === geometry.version);
	const disagree = reads.some((read) => read !== undefined && read.version !== geometry.version);
	if (strict ? !agree || disagree : !agree && disagree) throw unreadable('version');
}

function readOriented(
	matrix: BitMatrix,
	strict: boolean,
	erasures: Uint8Array | undefined,
	mirrored: boolean,
): MatrixRead {
	const size = matrix.width;
	const version = (size - 17) / 4;
	if (matrix.height !== size || !Number.isInteger(version) || version < 1 || version > 40) {
		throw unreadable('size');
	}
	const geometry = qrGeometry(version);
	const modules = matrix.data;
	const candidates = formatCandidates(modules, geometry, strict);
	if (candidates.length === 0) throw unreadable('format');
	checkVersion(modules, geometry, strict);

	const { placement } = geometry;
	let firstFailure: unknown;
	for (const candidate of candidates) {
		const blocks = qrBlocks(version, candidate.ecLevel);
		const predicate = QR_MASKS[candidate.mask] as (row: number, column: number) => boolean;
		const codewords = new Uint8Array(blocks.totalCodewords);
		const erased = erasures === undefined ? undefined : new Uint8Array(blocks.totalCodewords);
		for (let i = 0; i < codewords.length * 8; i += 1) {
			const index = placement[i] as number;
			const bit =
				(modules[index] as number) ^ (predicate(Math.floor(index / size), index % size) ? 1 : 0);
			codewords[i >>> 3] = (codewords[i >>> 3] as number) | (bit << (7 - (i & 7)));
			if (erased !== undefined && (erasures as Uint8Array)[index] !== 0) erased[i >>> 3] = 1;
		}
		let decoded;
		try {
			decoded = decodeBlocks(codewords, blocks, erased);
		} catch (error) {
			firstFailure ??= error;
			continue;
		}
		// Reed-Solomon accepted this reading, so it is the right one: a failure
		// in the bitstream from here on is final, never a cue to try another.
		const bitstream = readSegments(decoded.data, blocks.dataBits, qrProfile(version));
		return Object.freeze({
			version: String(version),
			ecLevel: candidate.ecLevel,
			mask: candidate.mask,
			bitstream,
			errorsPerBlock: decoded.errorsPerBlock,
			capacityPerBlock: decoded.capacityPerBlock,
			erasuresUsed: decoded.erasuresUsed,
			formatErrors: candidate.errors,
			mirrored,
		});
	}
	throw firstFailure;
}

/** The transpose of a row-major square flag map, to follow a mirrored matrix. */
function transpose(flags: Uint8Array, size: number): Uint8Array {
	const out = new Uint8Array(flags.length);
	for (let y = 0; y < size; y += 1) {
		for (let x = 0; x < size; x += 1) out[x * size + y] = flags[y * size + x] as number;
	}
	return out;
}

/** Read a sampled matrix. Pure: throws QrStudioError 'decode/unreadable' with params { stage }. */
export function readQr(matrix: BitMatrix, options: ReadOptions): MatrixRead {
	if (typeof options?.strict !== 'boolean') throw new TypeError('read needs { strict: boolean }');
	const { strict } = options;
	const erasures = strict ? undefined : options.erasures;
	if (
		erasures !== undefined &&
		(!(erasures instanceof Uint8Array) || erasures.length !== matrix.data.length)
	) {
		throw new TypeError('erasures has one byte for every module of the matrix');
	}
	if (strict) return readOriented(matrix, true, undefined, false);
	try {
		return readOriented(matrix, false, erasures, false);
	} catch (error) {
		// A reading that got past Reed-Solomon is the right way round, whatever
		// went wrong after it.
		if (error instanceof QrStudioError && error.params.stage === 'segments') throw error;
		if (matrix.width !== matrix.height) throw error;
		try {
			const flags = erasures === undefined ? undefined : transpose(erasures, matrix.width);
			return readOriented(matrix.mirrored(), false, flags, true);
		} catch {
			throw error;
		}
	}
}
