/**
 * The public shape of the batch layer, as docs/CONTRACTS.md (`batch`) gives
 * it.
 *
 * Additions to the contract, each optional or new so a caller written to the
 * contract alone still works, and each listed in the branch report:
 *
 * - `CsvTable.delimiter`, `rowNumbers` and `issues`: which delimiter was used
 *   (worth showing when it was sniffed), the spreadsheet row number of each
 *   data row (blank lines count, as a spreadsheet shows them), and the
 *   warnings reading the file raised, such as a row with fewer cells than
 *   the header.
 * - `BatchRow.rowNumber` and `typeId`. The manifest and the fallback file
 *   name give the row a person sees in their spreadsheet, not an index; and
 *   `runBatch` needs the content type for its constraints, which the
 *   contract's row did not carry.
 * - `BatchOutput` options beyond the contract's: `dpi`, `colourSpace` and
 *   `includeContent` for a ZIP, `sizeMm` and `skip` for a sheet, a sheet
 *   template given as a `SheetTemplate` as well as by id, and the
 *   verification mode on both. They live on the output rather than in a
 *   separate argument so the studio's `batch` command carries them as it is.
 * - `runBatch` takes a fifth argument for what cannot be posted to a worker:
 *   the per-row verifier, fonts, the seed and the archive date.
 * - Each progress event may carry the outcome of the row it follows, which
 *   is how a sheet run (a PDF, with no manifest inside it) reports skipped
 *   rows and labels too small for their codes.
 * - `BatchRegistries` is what batch needs from the root `createRegistries()`
 *   bag. The root bag satisfies it structurally.
 */

import type { Issue } from '../core/issue.js';
import type { Registry } from '../core/registry.js';
import type { DesignOverlay, DesignRegistries, QrDesignV1 } from '../design/types.js';
import type { PayloadRegistry } from '../payload/registry.js';
import type { SheetTemplate } from '../render/impose.js';
import type { SymbologyEntry } from '../symbology/types.js';
import type { FontRegistry } from '../text/types.js';

export type CsvDelimiter = ',' | ';' | '\t';

export interface CsvTable {
	readonly headers: readonly string[];
	/** Every row has exactly as many cells as there are headers: short rows are padded, with an issue. */
	readonly rows: readonly (readonly string[])[];
	/** The delimiter the file was read with. A contract addition. */
	readonly delimiter: CsvDelimiter;
	/** The spreadsheet row number of each data row; the header is row 1. A contract addition. */
	readonly rowNumbers: readonly number[];
	/** Warnings from reading: ragged rows, duplicate headers. Path `['rows', index]` or `['headers', index]`. A contract addition. */
	readonly issues: readonly Issue[];
}

export interface ParseCsvOptions {
	/** Default 'auto': sniffed from the first rows, or from an Excel `sep=` line. */
	readonly delimiter?: CsvDelimiter | 'auto';
	/** Data rows, the header not counted. Default 10,000. */
	readonly maxRows?: number;
}

export type TextEncodingName = 'utf-8' | 'utf-16le' | 'utf-16be' | 'windows-1252';

export interface DecodedText {
	readonly text: string;
	readonly encoding: TextEncodingName;
	readonly issues: readonly Issue[];
}

/** Where one content field's value comes from. */
export type FieldSource = { readonly column: string } | { readonly template: string };

export interface BatchMapping {
	readonly typeId: string;
	/** Each field from a column, or from a template such as `https://example.com/t/{id}`. */
	readonly fields: Readonly<Record<string, FieldSource>>;
	/** A template such as `label-{sku}`; sanitised, and duplicates numbered `-2`, `-3`. */
	readonly filename: string;
}

export interface BatchRow {
	/** The row's index in `CsvTable.rows`. */
	readonly index: number;
	/** The row number a spreadsheet shows for it; the header is row 1. A contract addition. */
	readonly rowNumber: number;
	/** The content type every field was validated by. A contract addition. */
	readonly typeId: string;
	/** A safe, unique file name without its extension, which `runBatch` adds. */
	readonly filename: string;
	/** The text of the code, or null when the row has error issues. */
	readonly content: string | null;
	readonly issues: readonly Issue[];
}

/** The parts of the root registries bag that batch uses. */
export interface BatchRegistries {
	readonly symbologies: Registry<SymbologyEntry>;
	readonly payloads: PayloadRegistry;
	readonly design: DesignRegistries;
}

/**
 * Which rows the scan check runs on. 'sampled' checks every Nth row written
 * (`verifyEvery`, default 20) and the row with the longest content, which
 * makes the densest code. When the output gives none, a batch of up to 10
 * rows is checked in full and a larger one not at all.
 */
export type BatchVerifyMode = 'off' | 'sampled' | 'all';

interface BatchOutputOptions {
	readonly verify?: BatchVerifyMode;
	/** For 'sampled': check every this-many rows written. A whole number from 1. Default 20. */
	readonly verifyEvery?: number;
}

export interface BatchZipOutput extends BatchOutputOptions {
	readonly kind: 'zip';
	readonly format: 'svg' | 'png' | 'pdf' | 'eps';
	/** PNG: the whole artwork's width in pixels. Defaults to the print size at the resolution, else 1024. */
	readonly widthPx?: number;
	/** PNG: pixels per inch, written into the file. Defaults to the design's. */
	readonly dpi?: number;
	/** Printed width of each symbol, quiet zone included. Defaults to the design's, else 30 for PDF and EPS. */
	readonly sizeMm?: number;
	/** PDF and EPS. Defaults to the design's. */
	readonly colourSpace?: 'srgb' | 'cmyk';
	/** Write each row's content into the manifest. Default false: a manifest is shared more widely than codes are. */
	readonly includeContent?: boolean;
}

export interface BatchSheetOutput extends BatchOutputOptions {
	readonly kind: 'sheet';
	/** A built-in template's id (`builtInSheets`), or a template of the caller's own. */
	readonly template: string | SheetTemplate;
	readonly colourSpace: 'srgb' | 'cmyk';
	/**
	 * Printed width of each symbol, quiet zone included. Defaults to the
	 * design's. With neither, each code is scaled to fill its label.
	 */
	readonly sizeMm?: number;
	/** Labels on the first sheet already used. Default 0. */
	readonly skip?: number;
}

export type BatchOutput = BatchZipOutput | BatchSheetOutput;

/** What a verifier is asked to check: one row's content in the design it was drawn with. */
export interface BatchVerifyRequest {
	readonly index: number;
	readonly rowNumber: number;
	readonly content: string;
	/** The design after the content type's constraints, exactly as the file was drawn. */
	readonly design: QrDesignV1;
	/** What the content type draws over its code whatever the design: the Swiss QR-bill's cross. */
	readonly overlay: DesignOverlay | null;
	/** Printed width of the symbol with its quiet zone, when the output has one. */
	readonly sizeMm: number | null;
	/** Pixels per inch, for a PNG. */
	readonly dpi: number | null;
	readonly seed: number;
}

export interface BatchVerifyResult {
	readonly verdict: 'pass' | 'warn' | 'fail';
	/** Anything more to say about this row; added to its issues. */
	readonly issues?: readonly Issue[];
}

/**
 * Checks one row. May return the result, or an iterator to drive one step at
 * a time (verify's own generator), so a long check is time-sliced with the
 * rest of the batch rather than run in one go.
 */
export type BatchVerifier = (
	request: BatchVerifyRequest,
) => BatchVerifyResult | Iterator<unknown, BatchVerifyResult>;

export interface RunBatchOptions {
	/** The scan check for one row. Without one, verification is off. */
	readonly verifyRow?: BatchVerifier;
	/** Fonts for frame captions. Default: the built-in family. */
	readonly fonts?: FontRegistry;
	/** The design's seed for anything random-looking, the same for every row. Default 0. */
	readonly seed?: number;
	/** The date every ZIP entry carries. Default 1980-01-01, as core's writer. */
	readonly date?: { readonly year: number; readonly month: number; readonly day: number };
}

export type BatchStatus = 'written' | 'skipped';

/** What happened to one row. */
export interface BatchOutcome {
	readonly index: number;
	readonly rowNumber: number;
	readonly typeId: string;
	/** The entry's name in the ZIP, extension included; null for a skipped row or a sheet. */
	readonly filename: string | null;
	readonly status: BatchStatus;
	/** The scan check's verdict, or null when the row was not checked. */
	readonly check: 'pass' | 'warn' | 'fail' | null;
	/** Where the code went on a sheet: 1-based page and label, in reading order. */
	readonly sheet: { readonly page: number; readonly label: number } | null;
	readonly issues: readonly Issue[];
}

export interface BatchProgress {
	readonly done: number;
	readonly total: number;
	/** The row just finished. Absent for steps within a row and for writing the file. A contract addition. */
	readonly row?: BatchOutcome;
}
