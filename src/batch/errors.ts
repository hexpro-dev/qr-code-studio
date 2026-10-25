/**
 * The batch layer's errors.
 *
 * A spreadsheet is somebody's product list, guest list or customer list, so
 * none of these carries a cell's text, a header's text or a file name, in the
 * message or in params. They carry where: the row and column of the problem in
 * the numbering a spreadsheet shows (the header is row 1, the first column is
 * column 1), and the physical line for somebody looking at the file in an
 * editor. That is enough to find the cell and nothing more.
 */

import { QrStudioError } from '../core/errors.js';

/** Why a CSV file could not be read. Each is a message key under `batch.malformed-csv.`. */
export type CsvFailure =
	/** A quoted cell is still open at the end of the file. */
	| 'unterminated-quote'
	/** A quote inside a cell that does not start with one. RFC 4180 section 2.5. */
	| 'stray-quote'
	/** Something other than a delimiter or a line break straight after a closing quote. */
	| 'text-after-quote'
	/** No header row: the file is empty, or holds nothing but blank lines. */
	| 'empty';

const CSV_MESSAGES: Readonly<Record<CsvFailure, string>> = Object.freeze({
	'unterminated-quote':
		'This file has a quoted cell that never ends, so it cannot be read. Check the row it starts on.',
	'stray-quote':
		'This file has a quote mark in the middle of a cell. Save it again from your spreadsheet, or put the cell in quotes.',
	'text-after-quote':
		'This file has text straight after the end of a quoted cell. Save it again from your spreadsheet.',
	empty: 'This file has no rows in it.',
});

/** A CSV file that does not follow RFC 4180 closely enough to read without guessing. */
export class MalformedCsvError extends QrStudioError {
	readonly reason: CsvFailure;

	constructor(reason: CsvFailure, where: { row: number; column: number; line: number }) {
		super('batch/malformed-csv', CSV_MESSAGES[reason], {
			reason,
			row: where.row,
			column: where.column,
			line: where.line,
		});
		this.reason = reason;
	}
}

/** More data rows than the caller allowed. Refused while reading, so a huge file costs no more than the limit. */
export class TooManyRowsError extends QrStudioError {
	constructor(max: number) {
		super(
			'batch/too-many-rows',
			'This file has more rows than this tool makes codes for in one go. Split it into smaller files.',
			{ max },
		);
	}
}

/**
 * A mapping names a column the file does not have.
 *
 * The params say which part of the mapping did it (a content field, by its
 * key, or the file name template), never the column name that was asked for:
 * that was typed by a person and may be a word from their data.
 */
export class UnknownColumnError extends QrStudioError {
	constructor(where: { part: 'field'; field: string } | { part: 'filename' }) {
		super(
			'batch/unknown-column',
			'This refers to a column the file does not have. Choose one of its columns.',
			where.part === 'field' ? { part: 'field', field: where.field } : { part: 'filename' },
		);
	}
}
