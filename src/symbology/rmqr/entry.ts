/**
 * rMQR as a symbology entry: codewords in, a finished matrix out, and the way
 * back.
 *
 * The same shape as the Micro QR entry, with three differences that matter:
 * several Reed-Solomon blocks, interleaved; one fixed mask, so there is
 * nothing to choose and `masks` is [0]; and format information that carries
 * the version, in two copies under different masks, so a reading can be held
 * to both agreeing.
 *
 * Most phone cameras do not read rMQR. The entry says so in `phoneReadable`,
 * and the studio shows `RMQR_MESSAGE_KEYS.notPhoneReadable` wherever the
 * symbology is offered.
 */

import { BitMatrix, QrStudioError } from '../../core/index.js';
import { correctCodewords, dataCodewordCount, encodeCodewords } from '../micro/blocks.js';
import type {
	BuiltSymbol,
	DecodedBitstream,
	EcLevel,
	MatrixRead,
	SymbologyEntry,
} from '../micro/contract-types.js';
import type { CodewordRead, ReadOptions } from '../micro/entry.js';
import { applyMask, placeCodewords, readCodewordStream } from '../micro/modules.js';
import type { MaskPredicate } from '../micro/modules.js';
import { checkErasures, readEitherWay, unreadable } from '../micro/read-helpers.js';
import { decodeRmqrFormat, readRmqrFormatWord, writeRmqrFormat } from './format.js';
import {
	rmqrFormatModulesNearFinder,
	rmqrFormatModulesNearSubFinder,
	rmqrGeometry,
	rmqrLayout,
} from './layout.js';
import { rmqrProfile } from './profile.js';
import { RMQR_LEVELS, rmqrBlocks, rmqrBySize, rmqrSpec, rmqrVersionsBySize } from './tables.js';

export const RMQR_ID = 'rmqr';

/** Every message key this symbology hands to a view. The catalogue is src/messages/en/rmqr.ts. */
export const RMQR_MESSAGE_KEYS = Object.freeze({
	label: 'symbology.rmqr.label',
	/** Shown wherever rMQR is offered. */
	notPhoneReadable: 'symbology.rmqr.not-phone-readable',
});

/**
 * The one mask, QR Model 2's 100: ((i div 2) + (j div 3)) mod 2 = 0, with i
 * the row. BWIPP's `qrcode.formatmaskbits` names the same one for rMQR.
 */
export const RMQR_MASK: MaskPredicate = (x, y) => (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0;

export const RMQR_MASK_IDS: readonly number[] = Object.freeze([0]);

/** The six format data bits: level, then version indicator. */
function formatData(indicator: number, ec: EcLevel): number {
	return (ec === 'H' ? 32 : 0) + indicator;
}

type Modules = readonly (readonly [number, number])[];

/** The finder's copy, then the sub-pattern's. */
function formatCopies(width: number, height: number): readonly [Modules, Modules] {
	return [rmqrFormatModulesNearFinder(), rmqrFormatModulesNearSubFinder(width, height)];
}

/**
 * Place, mask and add format information. `codewords` are the data codewords
 * only, in block order; the check symbols and the interleaving are added
 * here. `mask` is 0 or 'auto', which mean the same thing.
 */
export function buildRmqr(
	codewords: Uint8Array,
	version: string,
	ec: EcLevel,
	mask: number | 'auto',
): BuiltSymbol {
	const spec = rmqrSpec(version);
	const blocks = rmqrBlocks(version, ec);
	if (!(codewords instanceof Uint8Array) || codewords.length !== dataCodewordCount(blocks)) {
		throw new TypeError(`${spec.version}-${ec} takes ${dataCodewordCount(blocks)} data codewords`);
	}
	if (mask !== 'auto' && mask !== 0) throw new TypeError("rMQR has one mask: 0, or 'auto'");
	const all = encodeCodewords(blocks, codewords);
	const geometry = rmqrGeometry(version);
	const layout = rmqrLayout(version);
	const matrix = placeCodewords(geometry, layout, all);
	applyMask(matrix, geometry, RMQR_MASK);
	writeRmqrFormat(matrix, formatCopies(spec.width, spec.height), formatData(spec.indicator, ec));
	return Object.freeze({
		symbology: RMQR_ID,
		version: spec.version,
		ecLevel: ec,
		mask: 0,
		matrix,
		layout,
		blocks,
		codewords: all,
	});
}

function readOnce(
	matrix: BitMatrix,
	strict: boolean,
	erasures: Uint8Array | undefined,
	mirrored: boolean,
): CodewordRead {
	const spec = rmqrBySize(matrix.width, matrix.height);
	if (spec === undefined) throw unreadable('size');
	const [nearFinder, nearSubFinder] = formatCopies(spec.width, spec.height);
	const format = decodeRmqrFormat(
		[readRmqrFormatWord(matrix, nearFinder), readRmqrFormatWord(matrix, nearSubFinder)],
		strict,
	);
	// A format naming another size means a grid sampled at the wrong
	// dimensions, or damage past what the format can say.
	if (format === undefined || (format.data & 31) !== spec.indicator) throw unreadable('format');
	const ecLevel: EcLevel = format.data >= 32 ? 'H' : 'M';
	const blocks = rmqrBlocks(spec.version, ecLevel);
	const stream = readCodewordStream(
		matrix,
		rmqrGeometry(spec.version),
		rmqrLayout(spec.version),
		blocks.totalCodewords,
		RMQR_MASK,
		erasures,
	);
	const corrected = correctCodewords(blocks, stream.codewords, erasures && stream.erased);
	return Object.freeze({
		version: spec.version,
		ecLevel,
		mask: 0,
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
export function readRmqrCodewords(matrix: BitMatrix, options: ReadOptions): CodewordRead {
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

/** The bitstream stage, waiting on src/segment. */
function decodeBitstream(): DecodedBitstream {
	throw new QrStudioError(
		'decode/unsupported',
		'Reading the content of this kind of code is not available in this version.',
		{ stage: 'segments' },
	);
}

export const RMQR: SymbologyEntry = Object.freeze({
	id: RMQR_ID,
	labelKey: RMQR_MESSAGE_KEYS.label,
	quietZone: 2,
	phoneReadable: false,
	get versions(): readonly string[] {
		return rmqrVersionsBySize();
	},
	ecLevels(version: string): readonly EcLevel[] {
		rmqrSpec(version);
		return RMQR_LEVELS;
	},
	size(version: string): { width: number; height: number } {
		const { width, height } = rmqrSpec(version);
		return { width, height };
	},
	profile: rmqrProfile,
	blocks: rmqrBlocks,
	layout: rmqrLayout,
	masks(version: string): readonly number[] {
		rmqrSpec(version);
		return RMQR_MASK_IDS;
	},
	build: buildRmqr,
	read(matrix: BitMatrix, options: ReadOptions): MatrixRead {
		const read = readRmqrCodewords(matrix, options);
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
