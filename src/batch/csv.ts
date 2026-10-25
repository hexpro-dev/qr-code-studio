/**
 * Reading a spreadsheet export: RFC 4180, with what spreadsheets really
 * write.
 *
 * RFC 4180 (section 2) is the grammar: cells separated by a delimiter,
 * records by line breaks, a cell that holds a delimiter, a quote or a line
 * break wrapped in double quotes, and a quote inside one written twice. On top
 * of that, the things Excel, Google Sheets and Numbers do that the RFC does
 * not mention:
 *
 * - A UTF-8 byte order mark at the start, which Excel writes so that it can
 *   read its own file back. It is not part of the first header.
 * - Line breaks of any kind: CRLF from Windows, LF from everything else, CR
 *   alone from old Macs. Inside a quoted cell they are all read as LF, which
 *   is what a multi-line content field takes and what Excel writes for Alt
 *   and Enter.
 * - A semicolon or a tab as the delimiter. Excel writes semicolons wherever
 *   the decimal separator is a comma (most of Europe and South America), and
 *   "Unicode text" is tab separated. 'auto' sniffs which, and honours the
 *   `sep=;` first line Excel reads and writes as a hint.
 * - Rows of nothing but delimiters at the end, which Excel exports for rows
 *   that were formatted but never filled, and blank lines anywhere. Neither
 *   is a row. A blank line still counts towards row numbers, because a
 *   spreadsheet shows it as a row, and numbers here are the ones a person
 *   finds their cell by.
 * - Ragged rows. A short row is padded with empty cells and a long one cut
 *   to the header, each with a warning rather than a refusal, because one
 *   bad line should not stop five hundred good ones.
 *
 * What is refused is what cannot be read without guessing: a quoted cell
 * that never closes, a quote in the middle of an unquoted cell, and text
 * straight after a closing quote. A guess there shifts every later cell into
 * the wrong column, so the file is refused with the row and column it went
 * wrong at, and never the text of the cell.
 */

import { issue } from '../core/issue.js';
import type { Issue } from '../core/issue.js';
import { MalformedCsvError, TooManyRowsError } from './errors.js';
import { BATCH_ISSUES } from './issues.js';
import type { CsvDelimiter, CsvTable, ParseCsvOptions } from './types.js';

/** The most data rows read by default: a large print run, and a ZIP's entry count leaves room for it. */
export const DEFAULT_MAX_ROWS = 10_000;
/** The highest `maxRows` a caller may ask for. A ZIP holds 65,535 entries without ZIP64. */
export const MAX_ROWS_LIMIT = 65_000;

const QUOTE = 0x22;
const CR = 0x0d;
const LF = 0x0a;
const BOM = 0xfeff;

const DELIMITERS: readonly CsvDelimiter[] = [',', ';', '\t'];

/** Records looked at to sniff the delimiter, and the most text that takes. */
const SNIFF_RECORDS = 20;
const SNIFF_CHARS = 65_536;

/**
 * Which delimiter the text uses, from up to its first 20 records.
 *
 * A delimiter that appears the same number of times, outside quotes, in
 * every record is the answer; among several, the one that appears most, then
 * tab, semicolon and comma in that order, because a tab inside text is rare
 * and a semicolon file has commas in its numbers. When none is consistent,
 * the one the header uses most, and a comma when the header uses none (a file
 * with one column).
 */
export function sniffDelimiter(text: string): CsvDelimiter {
	if (typeof text !== 'string') throw new TypeError('sniffDelimiter: text is a string.');
	return sniffFrom(text, text.charCodeAt(0) === BOM ? 1 : 0);
}

function sniffFrom(text: string, start: number): CsvDelimiter {
	const end = Math.min(text.length, start + SNIFF_CHARS);
	const counts: number[][] = [];
	let current = [0, 0, 0];
	let inQuote = false;
	let blank = true;
	for (let i = start; i < end; i += 1) {
		const c = text.charCodeAt(i);
		if (c === QUOTE) {
			inQuote = !inQuote;
			blank = false;
			continue;
		}
		if (inQuote) continue;
		if (c === CR || c === LF) {
			if (c === CR && text.charCodeAt(i + 1) === LF) i += 1;
			if (!blank) counts.push(current);
			current = [0, 0, 0];
			blank = true;
			if (counts.length === SNIFF_RECORDS) break;
			continue;
		}
		blank = false;
		const which = c === 0x2c ? 0 : c === 0x3b ? 1 : c === 0x09 ? 2 : -1;
		if (which >= 0) current[which] = (current[which] as number) + 1;
	}
	if (!blank) {
		// A record cut off by the sample's end is not a fair count, unless it is
		// the end of the file or the only record there is.
		if ((end === text.length && !inQuote) || counts.length === 0) counts.push(current);
	}
	if (counts.length === 0) return ',';
	let best: CsvDelimiter | null = null;
	let bestCount = 0;
	// Tab, then semicolon, then comma, so an equal count goes to the earlier.
	for (const which of [2, 1, 0]) {
		const first = (counts[0] as number[])[which] as number;
		if (first === 0 || !counts.every((record) => record[which] === first)) continue;
		if (first > bestCount) {
			best = DELIMITERS[which] as CsvDelimiter;
			bestCount = first;
		}
	}
	if (best !== null) return best;
	const header = counts[0] as number[];
	let chosen = 0;
	for (const which of [2, 1, 0])
		if ((header[which] as number) > (header[chosen] as number)) chosen = which;
	return DELIMITERS[chosen] as CsvDelimiter;
}

/** An Excel `sep=` first line: the delimiter it names and where the data starts. */
function sepLine(text: string, start: number): { delimiter: CsvDelimiter; next: number } | null {
	if (text.slice(start, start + 4).toLowerCase() !== 'sep=') return null;
	const delimiter = text[start + 4];
	if (delimiter !== ',' && delimiter !== ';' && delimiter !== '\t') return null;
	const after = start + 5;
	if (after === text.length) return { delimiter, next: after };
	const c = text.charCodeAt(after);
	if (c === LF) return { delimiter, next: after + 1 };
	if (c === CR)
		return { delimiter, next: text.charCodeAt(after + 1) === LF ? after + 2 : after + 1 };
	return null;
}

function checkOptions(options: ParseCsvOptions): { delimiter: CsvDelimiter | 'auto'; max: number } {
	if (typeof options !== 'object' || options === null) {
		throw new TypeError('parseCsv: options is an object.');
	}
	const delimiter = options.delimiter ?? 'auto';
	if (delimiter !== 'auto' && !DELIMITERS.includes(delimiter)) {
		throw new TypeError("parseCsv: delimiter is ',', ';', a tab or 'auto'.");
	}
	const max = options.maxRows ?? DEFAULT_MAX_ROWS;
	if (!Number.isInteger(max) || max < 1 || max > MAX_ROWS_LIMIT) {
		throw new TypeError(`parseCsv: maxRows is a whole number from 1 to ${MAX_ROWS_LIMIT}.`);
	}
	return { delimiter, max };
}

/** The folding a header is matched by when no header is exactly the name asked for. */
export function foldHeader(name: string): string {
	return name.trim().toLowerCase();
}

/** A spreadsheet export as headers and rows. Throws 'batch/malformed-csv' and 'batch/too-many-rows'. */
export function parseCsv(text: string, options: ParseCsvOptions = {}): CsvTable {
	if (typeof text !== 'string') throw new TypeError('parseCsv: text is a string.');
	const checked = checkOptions(options);
	let at = text.charCodeAt(0) === BOM ? 1 : 0;
	let line = 1;
	const sep = sepLine(text, at);
	if (sep !== null) {
		at = sep.next;
		line = 2;
	}
	const delimiter =
		checked.delimiter !== 'auto' ? checked.delimiter : (sep?.delimiter ?? sniffFrom(text, at));
	const delim = delimiter.charCodeAt(0);
	const n = text.length;

	let headers: string[] | null = null;
	const rows: (readonly string[])[] = [];
	const rowNumbers: number[] = [];
	const issues: Issue[] = [];
	// Rows of nothing but empty cells, held back until a row with something in
	// it shows they were not the end of the file. Kept as their row numbers
	// only: every cell in them is empty.
	const pending: number[] = [];
	let record = 0;

	const accept = (cells: string[], rowNumber: number, empty: boolean): void => {
		const width = (headers as string[]).length;
		const index = rows.length;
		if (empty) {
			cells = new Array<string>(width).fill('');
		} else if (cells.length < width) {
			issues.push(
				issue(BATCH_ISSUES.shortRow, ['rows', index], 'warning', {
					row: rowNumber,
					cells: cells.length,
					expected: width,
				}),
			);
			while (cells.length < width) cells.push('');
		} else if (cells.length > width) {
			if (cells.slice(width).some((cell) => cell !== '')) {
				issues.push(
					issue(BATCH_ISSUES.longRow, ['rows', index], 'warning', {
						row: rowNumber,
						cells: cells.length,
						expected: width,
					}),
				);
			}
			cells.length = width;
		}
		rows.push(Object.freeze(cells));
		rowNumbers.push(rowNumber);
		if (rows.length > checked.max) throw new TooManyRowsError(checked.max);
	};

	while (at < n) {
		const first = text.charCodeAt(at);
		if (first === LF || first === CR) {
			// A blank line: a row in a spreadsheet's numbering, nothing here.
			record += 1;
			line += 1;
			at += first === CR && text.charCodeAt(at + 1) === LF ? 2 : 1;
			continue;
		}
		record += 1;
		const cells: string[] = [];
		for (;;) {
			const column = cells.length + 1;
			if (at < n && text.charCodeAt(at) === QUOTE) {
				const opened = { row: record, column, line };
				at += 1;
				let value = '';
				for (;;) {
					const close = text.indexOf('"', at);
					if (close === -1) throw new MalformedCsvError('unterminated-quote', opened);
					const part = text.slice(at, close);
					if (part.includes('\r') || part.includes('\n')) {
						const normal = part.replace(/\r\n?/g, '\n');
						for (let i = 0; i < normal.length; i += 1) if (normal.charCodeAt(i) === LF) line += 1;
						value += normal;
					} else value += part;
					if (text.charCodeAt(close + 1) === QUOTE) {
						value += '"';
						at = close + 2;
						continue;
					}
					at = close + 1;
					break;
				}
				if (at < n) {
					const next = text.charCodeAt(at);
					if (next !== delim && next !== CR && next !== LF) {
						throw new MalformedCsvError('text-after-quote', { row: record, column, line });
					}
				}
				cells.push(value);
			} else {
				let end = at;
				while (end < n) {
					const c = text.charCodeAt(end);
					if (c === delim || c === CR || c === LF) break;
					if (c === QUOTE)
						throw new MalformedCsvError('stray-quote', { row: record, column, line });
					end += 1;
				}
				cells.push(text.slice(at, end));
				at = end;
			}
			if (at >= n) break;
			const c = text.charCodeAt(at);
			if (c === delim) {
				at += 1;
				continue;
			}
			at += c === CR && text.charCodeAt(at + 1) === LF ? 2 : 1;
			line += 1;
			break;
		}

		if (headers === null) {
			// Excel exports columns that were formatted and never named as empty
			// headers at the end; they cannot be mapped, so they are dropped.
			while (cells.length > 1 && cells[cells.length - 1] === '') cells.pop();
			headers = cells;
			const seen = new Map<string, number>();
			headers.forEach((name, index) => {
				if (name === '') return;
				const folded = foldHeader(name);
				if (seen.has(folded)) {
					issues.push(
						issue(BATCH_ISSUES.duplicateHeader, ['headers', index], 'warning', {
							column: index + 1,
							first: (seen.get(folded) as number) + 1,
						}),
					);
				} else seen.set(folded, index);
			});
			continue;
		}
		if (cells.every((cell) => cell === '')) {
			pending.push(record);
			continue;
		}
		for (const held of pending) accept([], held, true);
		pending.length = 0;
		accept(cells, record, false);
	}

	if (headers === null) throw new MalformedCsvError('empty', { row: 1, column: 1, line });
	return Object.freeze({
		headers: Object.freeze(headers),
		rows: Object.freeze(rows),
		delimiter,
		rowNumbers: Object.freeze(rowNumbers),
		issues: Object.freeze(issues),
	});
}
