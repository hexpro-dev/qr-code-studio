/**
 * The issue codes the batch layer raises, in one place so the message
 * catalogue and its test can be checked against them in both directions.
 *
 * Severity is part of the meaning. An error skips the row; a warning is
 * written into the manifest beside a row that was still made; an info issue
 * is for a view and is left out of the manifest, where it would repeat on
 * every line.
 */

export const BATCH_ISSUES = {
	// Reading the file.
	/** Warning, path ['rows', i]: fewer cells than the header, padded with empty ones. */
	shortRow: 'batch.csv.short-row',
	/** Warning, path ['rows', i]: more cells than the header; the extra ones have no column to map. */
	longRow: 'batch.csv.long-row',
	/** Warning, path ['headers', i]: a header used before; a mapping finds the first. */
	duplicateHeader: 'batch.csv.duplicate-header',
	/** Warning: the bytes were not UTF-8, and were read as Windows-1252 (Western European). */
	windows1252: 'batch.csv.windows-1252',
	/** Info: the bytes started with a UTF-16 byte order mark and were read as UTF-16. */
	utf16: 'batch.csv.utf-16',
	/** Warning: a UTF-16 file with an odd number of bytes; the last byte was dropped. */
	oddLength: 'batch.csv.odd-length',

	// Making each row's content.
	/** Warning: every mapped cell in the row is empty, so it is skipped. */
	emptyRow: 'batch.issue.empty-row',
	/** Error, path ['fields', key]: a number with a decimal comma or thousands separators, which is ambiguous. */
	numberFormat: 'batch.issue.number-format',
	/** Info: the file name template gave nothing usable, so the row number was used. */
	filenameFallback: 'batch.issue.filename-fallback',
	/** Info: characters a file name cannot hold were removed or replaced. */
	filenameCleaned: 'batch.issue.filename-cleaned',
	/** Info, params { number }: another row has the same file name, so this one is numbered. */
	filenameNumbered: 'batch.issue.filename-numbered',

	// Drawing and writing each file.
	/** Warning: EPS cannot carry this design's transparency, so the row was written as a PDF. */
	epsFallback: 'batch.issue.eps-fallback',
	/** Error, params { code }: drawing the row failed for a reason this layer has no sentence for. */
	failed: 'batch.issue.failed',
	/** Warning: the scan check failed for this row. */
	checkFailed: 'batch.issue.check-failed',
	/** Info: the scan check passed with warnings. */
	checkWarned: 'batch.issue.check-warned',
	/** Warning, params { code }: the scan check could not be run for this row. */
	checkUnavailable: 'batch.issue.check-unavailable',
} as const;

export type BatchIssueCode = (typeof BATCH_ISSUES)[keyof typeof BATCH_ISSUES];
