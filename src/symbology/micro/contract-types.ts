/**
 * A temporary mirror of the segment and symbology contracts in
 * docs/CONTRACTS.md, for the weeks Micro QR and rMQR are written beside the
 * layers that will own these types.
 *
 * Nothing here is new: every name and field is the contract's, so that the
 * switch to `src/segment/` and `src/symbology/types.ts` is an import path
 * change and nothing else. `ROLE_CODES` is the one value, and the code
 * that uses it never depends on the numbers, only on the names.
 *
 * Delete this file once the shared layers are merged.
 */

import type { BitMatrix, MessageKey } from '../../core/index.js';

export type EcLevel = 'L' | 'M' | 'Q' | 'H';
export type Mode = 'numeric' | 'alphanumeric' | 'byte' | 'kanji';

export interface BitstreamProfile {
	readonly modes: readonly Mode[];
	readonly modeIndicatorBits: number;
	modeIndicator(
		mode: Mode | 'eci' | 'fnc1-first' | 'fnc1-second' | 'structured-append',
	): number | undefined;
	charCountBits(mode: Mode): number;
	readonly terminatorBits: number;
	readonly eci: boolean;
	readonly fnc1: boolean;
	readonly structuredAppend: boolean;
}

export interface DecodedSegment {
	readonly mode: Mode;
	readonly eci: number | null;
	readonly length: number;
}

export interface DecodedBitstream {
	readonly text: string;
	readonly bytes: Uint8Array;
	readonly textSource: 'utf-8' | 'latin1-fallback' | 'shift-jis' | `eci-${number}`;
	readonly segments: readonly DecodedSegment[];
	readonly structuredAppend: { index: number; total: number; parity: number } | null;
	readonly fnc1: 'gs1' | { applicationIndicator: number } | null;
}

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

export const ROLE_CODES: Readonly<Record<ModuleRole, number>> = Object.freeze({
	data: 0,
	finder: 1,
	separator: 2,
	timing: 3,
	alignment: 4,
	format: 5,
	version: 6,
	'dark-module': 7,
	'sub-finder': 8,
	'corner-finder': 9,
});

export interface StyleableRegion {
	readonly role: 'finder' | 'sub-finder' | 'corner-finder';
	readonly kind: 'concentric-7' | 'concentric-5' | 'corner-l';
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
	readonly rotation: 0 | 90 | 180 | 270;
}

export interface SymbolLayout {
	readonly width: number;
	readonly height: number;
	readonly roles: Uint8Array;
	readonly dataBits: Int32Array;
	readonly regions: readonly StyleableRegion[];
}

export interface BlockLayout {
	readonly blocks: readonly { readonly dataCount: number; readonly ecCount: number }[];
	readonly totalCodewords: number;
	readonly p: number;
	readonly lastDataCodewordBits: 8 | 4;
	readonly dataBits: number;
}

export interface BuiltSymbol {
	readonly symbology: string;
	readonly version: string;
	readonly ecLevel: EcLevel;
	readonly mask: number;
	readonly matrix: BitMatrix;
	readonly layout: SymbolLayout;
	readonly blocks: BlockLayout;
	readonly codewords: Uint8Array;
}

export interface MatrixRead {
	readonly version: string;
	readonly ecLevel: EcLevel;
	readonly mask: number;
	readonly bitstream: DecodedBitstream;
	readonly errorsPerBlock: readonly number[];
	readonly capacityPerBlock: readonly number[];
	readonly erasuresUsed: number;
	readonly formatErrors: number;
	readonly mirrored: boolean;
}

export interface SymbologyEntry {
	readonly id: string;
	readonly labelKey: MessageKey;
	readonly quietZone: number;
	readonly phoneReadable: boolean;
	readonly versions: readonly string[];
	ecLevels(version: string): readonly EcLevel[];
	size(version: string): { width: number; height: number };
	profile(version: string): BitstreamProfile;
	blocks(version: string, ec: EcLevel): BlockLayout;
	layout(version: string): SymbolLayout;
	masks(version: string): readonly number[];
	build(codewords: Uint8Array, version: string, ec: EcLevel, mask: number | 'auto'): BuiltSymbol;
	read(matrix: BitMatrix, options: { strict: boolean; erasures?: Uint8Array }): MatrixRead;
}
