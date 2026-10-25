/**
 * The symbology contract: what QR, Micro QR and rMQR each provide, so that
 * encode, decode, design and verify can work over any of them.
 *
 * A symbology here is everything below the bitstream: version tables, the
 * role of every module, Reed-Solomon block structure, masks, and format and
 * version information. The bitstream itself is the segment layer's, reached
 * through `profile(version)`.
 */

import type { BitMatrix } from '../core/bit-matrix.js';
import type { MessageKey } from '../core/issue.js';
import type { BitstreamProfile, DecodedBitstream, EcLevel } from '../segment/types.js';

export type ModuleRole =
	| 'data'
	| 'finder'
	| 'separator'
	| 'timing'
	| 'alignment'
	| 'format'
	| 'version'
	| 'dark-module'
	| 'sub-finder'
	| 'corner-finder';

export interface StyleableRegion {
	readonly role: 'finder' | 'sub-finder' | 'corner-finder';
	readonly kind: 'concentric-7' | 'concentric-5' | 'corner-l';
	/** Top-left module. */
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
	/** For asymmetric kinds (corner-l). */
	readonly rotation: 0 | 90 | 180 | 270;
}

export interface SymbolLayout {
	readonly width: number;
	readonly height: number;
	/** ROLE_CODES per module, row major. */
	readonly roles: Uint8Array;
	/**
	 * For data modules: codeword index * 8 + bit (7 = most significant), where
	 * the codeword index is the position in the interleaved sequence as placed.
	 * -1 for anything else, including the remainder bits a symbol ends on.
	 */
	readonly dataBits: Int32Array;
	readonly regions: readonly StyleableRegion[];
}

export interface BlockLayout {
	/** In interleaving order: QR's group 1 blocks, then group 2. */
	readonly blocks: readonly { readonly dataCount: number; readonly ecCount: number }[];
	readonly totalCodewords: number;
	/** Misdecode protection codewords (ISO 18004 Table 9): errors correctable per block is floor((ec - p) / 2). */
	readonly p: number;
	/** M1 and M3 end their data with a 4-bit codeword. */
	readonly lastDataCodewordBits: 8 | 4;
	/** Capacity for the bitstream, in bits. */
	readonly dataBits: number;
}

export interface BuiltSymbol {
	/** 'qr' | 'micro' | 'rmqr' */
	readonly symbology: string;
	/** '1'..'40', 'M1'..'M4', 'R7x43'..'R17x139' */
	readonly version: string;
	readonly ecLevel: EcLevel;
	readonly mask: number;
	readonly matrix: BitMatrix;
	readonly layout: SymbolLayout;
	readonly blocks: BlockLayout;
	/** Interleaved, data then check codewords, as placed. */
	readonly codewords: Uint8Array;
}

export interface MatrixRead {
	readonly version: string;
	readonly ecLevel: EcLevel;
	readonly mask: number;
	readonly bitstream: DecodedBitstream;
	/** Symbol errors Reed-Solomon corrected in each block, erasures not counted. */
	readonly errorsPerBlock: readonly number[];
	/** floor((ec - p) / 2) for each block. */
	readonly capacityPerBlock: readonly number[];
	readonly erasuresUsed: number;
	/** Bits corrected in format information. */
	readonly formatErrors: number;
	readonly mirrored: boolean;
}

export interface ReadOptions {
	readonly strict: boolean;
	/**
	 * One byte per module, row major over the matrix, nonzero where the module
	 * is known to be unreliable (under a logo, outside the frame). A codeword
	 * with any such module becomes an erasure. Lenient reads only; the strict
	 * profile reads without them.
	 */
	readonly erasures?: Uint8Array;
}

export interface SymbologyEntry {
	readonly id: string;
	readonly labelKey: MessageKey;
	/** Minimum, in modules: 4 for QR, 2 for Micro and rMQR. */
	readonly quietZone: number;
	/** False for Micro QR and rMQR. */
	readonly phoneReadable: boolean;
	/** Smallest first. */
	readonly versions: readonly string[];
	ecLevels(version: string): readonly EcLevel[];
	size(version: string): { width: number; height: number };
	profile(version: string): BitstreamProfile;
	blocks(version: string, ec: EcLevel): BlockLayout;
	/** Cached; the same object for the same version. */
	layout(version: string): SymbolLayout;
	/** 0..7 for QR, 0..3 for Micro, [0] for rMQR (fixed). */
	masks(version: string): readonly number[];
	/**
	 * Place codewords, apply the mask (or choose one), write format and version
	 * information.
	 *
	 * `codewords` are the data codewords: the bitstream after its terminator
	 * and padding, `blocks(version, ec)` sum of `dataCount` of them (for M1 and
	 * M3, the final 4-bit codeword in the high nibble of the last byte). The
	 * symbology adds the Reed-Solomon check codewords and interleaves, so that
	 * build and read are mirror images and every symbology-specific step of
	 * either lives in the symbology; `interleaveBlocks` does both for any
	 * `BlockLayout` whose codewords are all 8 bits. The result's `codewords`
	 * is the full interleaved sequence as placed.
	 */
	build(codewords: Uint8Array, version: string, ec: EcLevel, mask: number | 'auto'): BuiltSymbol;
	/** Read a sampled matrix. Pure: throws QrStudioError 'decode/unreadable' with params { stage }. */
	read(matrix: BitMatrix, options: ReadOptions): MatrixRead;
}
