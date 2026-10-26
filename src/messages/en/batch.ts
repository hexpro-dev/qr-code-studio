/**
 * English sentences for the batch layer: reading a spreadsheet export,
 * making each row's content and file name, and writing the files.
 *
 * Errors are found by their code and reason: 'batch/malformed-csv' is
 * `batch.malformed-csv.<reason>` (params.reason), 'batch/too-many-rows' and
 * 'batch/unknown-column' have one sentence each. Issues use their own code as
 * the key, and placeholders in braces come from the issue's params; none of
 * them is ever a cell's text. A row also carries issues from the layers below
 * (a content type's validation, the encoder, the label sheets), which are in
 * those layers' catalogues. `tests/batch/messages.test.ts` provokes every key
 * here, checks each placeholder is a param its issue carries, and fails on a
 * key the layer uses that is missing.
 */

export const BATCH_MESSAGES: Readonly<Record<string, string>> = Object.freeze({
	'batch.malformed-csv.unterminated-quote':
		'This file has a quoted cell that never ends, so it cannot be read. Check row {row}, column {column}.',
	'batch.malformed-csv.stray-quote':
		'Row {row}, column {column} has a quote mark in the middle of a cell. Save the file again from your spreadsheet, or put that cell in quotes.',
	'batch.malformed-csv.text-after-quote':
		'Row {row}, column {column} has text straight after the end of a quoted cell. Save the file again from your spreadsheet.',
	'batch.malformed-csv.empty': 'This file has no rows in it.',
	'batch.too-many-rows':
		'This file has more than {max, plural, one {# row} other {# rows}}. Split it into smaller files and make each batch on its own.',
	'batch.unknown-column':
		'This refers to a column the file does not have. Choose one of its columns.',

	'batch.csv.short-row':
		'Row {row} has {cells, plural, one {# cell} other {# cells}} where the header has {expected}. The missing ones were left empty.',
	'batch.csv.long-row':
		'Row {row} has {cells} cells where the header has {expected}. The extra ones have no column and were left out.',
	'batch.csv.duplicate-header':
		'Column {column} has the same name as column {first}. Anything that refers to that name uses column {first}.',
	'batch.csv.windows-1252':
		'This file is not in UTF-8, so it was read as Western European (Windows-1252). If accented letters look wrong, save it from your spreadsheet as CSV UTF-8.',
	'batch.csv.utf-16': 'This file is in UTF-16, and was read as that.',
	'batch.csv.odd-length': 'This file ends partway through a character. The last byte was left out.',

	'batch.issue.empty-row': 'This row is empty, so no code was made for it.',
	'batch.issue.number-format':
		'Write this number with a full stop for the decimal point and no thousands separators, such as 1250.50.',
	'batch.issue.filename-fallback':
		'The file name for this row came out empty, so the row number was used instead.',
	'batch.issue.filename-cleaned': 'Characters a file name cannot hold were taken out of this one.',
	'batch.issue.filename-numbered':
		'Another row has the same file name, so this one has {number} on the end.',
	'batch.issue.eps-fallback':
		"EPS cannot carry this design's transparency, so this code was saved as a PDF instead.",
	'batch.issue.failed': 'This code could not be made.',
	'batch.issue.check-failed':
		'This code did not pass the scan check. Phones may not read it reliably at this size.',
	'batch.issue.check-warned': 'This code passed the scan check, with something to look at.',
	'batch.issue.check-unavailable': 'The scan check could not be run for this code.',
});
