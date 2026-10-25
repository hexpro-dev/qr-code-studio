/**
 * Micro QR as a symbology entry: codewords in, a finished matrix out, and the
 * way back.
 *
 * Building is placement, masking and format information over codewords the
 * encode layer has already filled; reading is the reverse with correction,
 * handing the corrected data codewords to the bitstream reader. Both sides go
 * through the same cached layout, so a module's meaning is decided once.
 *
 * Most phone cameras do not read Micro QR. The entry says so in
 * `phoneReadable`, and the studio shows `MICRO_MESSAGE_KEYS.notPhoneReadable`
 * wherever the symbology is offered.
 */

import { BitMatrix, QrStudioError } from '../../core/index.js';
import { correctCodewords, dataCodewordCount, encodeCodewords } from './blocks.js';
import type {
	BlockLayout,
	BuiltSymbol,
	DecodedBitstream,
	EcLevel,
	MatrixRead,
	SymbologyEntry,
} from './contract-types.js';
import {
	decodeMicroFormat,
	microFormatWord,
	readMicroFormatWord,
	writeMicroFormat,
} from './format.js';
import { microGeometry, microLayout } from './layout.js';
import { MICRO_MASKS, microMaskScore } from './mask.js';
import { applyMask, placeCodewords, readCodewordStream } from './modules.js';
import { microProfile } from './profile.js';
import { checkErasures, readEitherWay, unreadable } from './read-helpers.js';
import { MICRO_VERSIONS, microBlocks, microBySize, microLevel, microSpec } from './tables.js';

export const MICRO_ID = 'micro';

/** Every message key this symbology hands to a view. The catalogue is src/messages/en/micro.ts. */
export const MICRO_MESSAGE_KEYS = Object.freeze({
	label: 'symbology.micro.label',
	/** Shown wherever Micro QR is offered. */
	notPhoneReadable: 'symbology.micro.not-phone-readable',
	/**
	 * M1's only level. ISO/IEC 18004 gives M1 error detection and no
	 * correction; its format symbol number names no level at all. The contract's
	 * levels are L, M, Q and H, so M1 is recorded as 'L', as BWIPP and
	 * zxing-cpp record it, and this key is how a view says what that 'L' means.
	 */
	detectionOnly: 'symbology.micro.detection-only',
});

export const MICRO_MASK_IDS: readonly number[] = Object.freeze([0, 1, 2, 3]);

function checkMask(mask: number | 'auto'): void {
	if (mask === 'auto') return;
	if (!Number.isInteger(mask) || mask < 0 || mask > 3) {
		throw new TypeError("a Micro QR mask is 0, 1, 2, 3 or 'auto'");
	}
}

/**
 * Place, mask and add format information. `codewords` are the data codewords
 * only, in order; the check symbols are added here. M1's and M3's last data
 * codeword is 4 bits, carried in the high nibble with the low nibble zero.
 */
export function buildMicro(
	codewords: Uint8Array,
	version: string,
	ec: EcLevel,
	mask: number | 'auto',
): BuiltSymbol {
	const spec = microSpec(version);
	const level = microLevel(version, ec);
	const blocks = microBlocks(version, ec);
	if (!(codewords instanceof Uint8Array) || codewords.length !== dataCodewordCount(blocks)) {
		throw new TypeError(
			`${spec.version}-${level.ecLevel} takes ${dataCodewordCount(blocks)} data codewords`,
		);
	}
	if (
		blocks.lastDataCodewordBits === 4 &&
		((codewords[codewords.length - 1] as number) & 0x0f) !== 0
	) {
		throw new TypeError(`the last data codeword of ${spec.version} is 4 bits, in the high nibble`);
	}
	checkMask(mask);
	const all = encodeCodewords(blocks, codewords);
	const geometry = microGeometry(version);
	const layout = microLayout(version, ec);
	const unmasked = placeCodewords(geometry, layout, all);
	let best: { matrix: BitMatrix; mask: number; score: number } | undefined;
	for (const candidate of mask === 'auto' ? MICRO_MASK_IDS : [mask]) {
		const matrix = unmasked.clone();
		applyMask(matrix, geometry, MICRO_MASKS[candidate] as (typeof MICRO_MASKS)[number]);
		writeMicroFormat(matrix, microFormatWord(level.symbolNumber, candidate));
		// Scored with the format written, unlike BWIPP, which scores first. The
		// edges scored are column and row size - 1 and the format sits on
		// column and row 8, which no Micro QR size has as its last, so the
		// score is the same either way.
		const score = microMaskScore(matrix);
		if (best === undefined || score > best.score) best = { matrix, mask: candidate, score };
	}
	const chosen = best as { matrix: BitMatrix; mask: number };
	return Object.freeze({
		symbology: MICRO_ID,
		version: spec.version,
		ecLevel: level.ecLevel,
		mask: chosen.mask,
		matrix: chosen.matrix,
		layout,
		blocks,
		codewords: all,
	});
}

export interface ReadOptions {
	readonly strict: boolean;
	readonly erasures?: Uint8Array;
}

/** A read as far as the corrected data codewords: everything in MatrixRead except the bitstream. */
export interface CodewordRead {
	readonly version: string;
	readonly ecLevel: EcLevel;
	readonly mask: number;
	readonly blocks: BlockLayout;
	/** Corrected data codewords; a 4 bit last codeword is in the high nibble. */
	readonly data: Uint8Array;
	readonly errorsPerBlock: readonly number[];
	readonly capacityPerBlock: readonly number[];
	readonly erasuresUsed: number;
	readonly formatErrors: number;
	readonly mirrored: boolean;
}

function readOnce(
	matrix: BitMatrix,
	strict: boolean,
	erasures: Uint8Array | undefined,
	mirrored: boolean,
): CodewordRead {
	const spec = matrix.width === matrix.height ? microBySize(matrix.width) : undefined;
	if (spec === undefined) throw unreadable('size');
	// Strict is the scan check's profile: one bit of format damage at most,
	// because a phone reader that is any less sure gives up.
	const format = decodeMicroFormat(readMicroFormatWord(matrix), strict ? 1 : 3);
	// A symbol number that names another version means the grid was sampled
	// at the wrong size, or the format is damaged past what it can say.
	const level = spec.levels.find((candidate) => candidate.symbolNumber === format?.symbolNumber);
	if (format === undefined || level === undefined) throw unreadable('format');
	const blocks = microBlocks(spec.version, level.ecLevel);
	const stream = readCodewordStream(
		matrix,
		microGeometry(spec.version),
		microLayout(spec.version, level.ecLevel),
		blocks.totalCodewords,
		MICRO_MASKS[format.mask] as (typeof MICRO_MASKS)[number],
		erasures,
	);
	const corrected = correctCodewords(blocks, stream.codewords, erasures && stream.erased);
	return Object.freeze({
		version: spec.version,
		ecLevel: level.ecLevel,
		mask: format.mask,
		blocks,
		data: corrected.data,
		errorsPerBlock: corrected.errorsPerBlock,
		capacityPerBlock: corrected.capacityPerBlock,
		erasuresUsed: corrected.erasuresUsed,
		formatErrors: format.distance,
		mirrored,
	});
}

/**
 * Read a sampled matrix as far as its corrected data codewords. Pure: throws
 * QrStudioError 'decode/unreadable' with params { stage } ('size', 'format' or
 * 'reed-solomon'). Strict reads take no erasures and no reflection.
 */
export function readMicroCodewords(matrix: BitMatrix, options: ReadOptions): CodewordRead {
	if (!(matrix instanceof BitMatrix)) throw new TypeError('read takes a BitMatrix');
	checkErasures(matrix, options.erasures);
	const strict = options.strict === true;
	return readEitherWay(
		matrix,
		strict,
		strict ? undefined : options.erasures,
		(grid, flags, mirrored) => readOnce(grid, strict, flags, mirrored),
	);
}

/**
 * The bitstream stage, waiting on src/segment. Until it is merged a read
 * stops at the codewords, and says so with a code a caller can recognise.
 */
function decodeBitstream(): DecodedBitstream {
	throw new QrStudioError(
		'decode/unsupported',
		'Reading the content of this kind of code is not available in this version.',
		{ stage: 'segments' },
	);
}

export const MICRO_QR: SymbologyEntry = Object.freeze({
	id: MICRO_ID,
	labelKey: MICRO_MESSAGE_KEYS.label,
	quietZone: 2,
	phoneReadable: false,
	versions: MICRO_VERSIONS,
	ecLevels(version: string): readonly EcLevel[] {
		return Object.freeze(microSpec(version).levels.map((candidate) => candidate.ecLevel));
	},
	size(version: string): { width: number; height: number } {
		const { size } = microSpec(version);
		return { width: size, height: size };
	},
	profile: microProfile,
	blocks: microBlocks,
	layout: microLayout,
	masks(version: string): readonly number[] {
		microSpec(version);
		return MICRO_MASK_IDS;
	},
	build: buildMicro,
	read(matrix: BitMatrix, options: ReadOptions): MatrixRead {
		const read = readMicroCodewords(matrix, options);
		return Object.freeze({
			version: read.version,
			ecLevel: read.ecLevel,
			mask: read.mask,
			bitstream: decodeBitstream(),
			errorsPerBlock: read.errorsPerBlock,
			capacityPerBlock: read.capacityPerBlock,
			erasuresUsed: read.erasuresUsed,
			formatErrors: read.formatErrors,
			mirrored: read.mirrored,
		});
	},
});
