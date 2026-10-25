/**
 * The manifest: one line per row of the batch, saying what became of it.
 *
 * Columns, in this order: `row` (the spreadsheet row number), `file` (the
 * entry's name in the ZIP, empty for a skipped row), `type` (the content
 * type), `status` ('written' or 'skipped'), `check` (the scan check's
 * verdict, empty when it did not run), `issues` (the codes of every warning
 * and error on the row, separated by spaces), then `page` and `label` for a
 * sheet, and `content` only when asked for.
 *
 * The content is left out unless the caller opts in. A manifest is the file
 * that gets attached to an email or dropped into a shared drive to say a run
 * went well, and the content of a batch is a customer list or a set of Wi-Fi
 * passwords.
 *
 * Whatever is in it, it is opened in a spreadsheet, and a spreadsheet runs a
 * cell that starts with `=`, `+`, `-` or `@` as a formula, so a product name
 * of `=HYPERLINK(...)` would become a link on the person's own machine (CSV
 * injection; OWASP lists these four, a tab and a carriage return). Every
 * cell starting with one gets a leading apostrophe, which a spreadsheet
 * reads as "this is text". File names need it as much as content does: they
 * are built from the same cells.
 *
 * RFC 4180 throughout: commas, CRLF, a cell quoted when it holds a comma, a
 * quote or a line break. UTF-8 with a byte order mark, without which Excel
 * reads the file as the machine's code page and mangles every accent.
 */

import type { Issue } from '../core/issue.js';
import type { BatchOutcome } from './types.js';

export const MANIFEST_NAME = 'manifest.csv';

const FORMULA_START = /^[=+\-@\t\r]/;

/** A cell a spreadsheet will show as text: a leading apostrophe on anything it would run as a formula. */
export function neutraliseFormula(cell: string): string {
	return FORMULA_START.test(cell) ? `'${cell}` : cell;
}

function quote(cell: string): string {
	return /[",\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
}

/** Rows as RFC 4180 CSV, every cell neutralised, each line ended with CRLF. */
export function writeCsv(rows: readonly (readonly string[])[]): string {
	let out = '';
	for (const row of rows)
		out += `${row.map((cell) => quote(neutraliseFormula(cell))).join(',')}\r\n`;
	return out;
}

/** The codes of a row's warnings and errors, each once, in the order they were raised. */
export function manifestIssues(issues: readonly Issue[]): string {
	const codes: string[] = [];
	for (const found of issues) {
		if (found.severity === 'info' || codes.includes(found.code)) continue;
		codes.push(found.code);
	}
	return codes.join(' ');
}

export interface ManifestOptions {
	/** Each row's content by its index, for the `content` column. Without it there is no such column. */
	readonly content?: (index: number) => string | null;
}

/** The manifest for a batch's outcomes, as the bytes of a UTF-8 CSV file. */
export function batchManifest(
	outcomes: readonly BatchOutcome[],
	options: ManifestOptions = {},
): Uint8Array {
	const sheet = outcomes.some((outcome) => outcome.sheet !== null);
	const content = options.content;
	const header = ['row', 'file', 'type', 'status', 'check', 'issues'];
	if (sheet) header.push('page', 'label');
	if (content !== undefined) header.push('content');
	const lines: string[][] = [header];
	for (const outcome of outcomes) {
		const line = [
			String(outcome.rowNumber),
			outcome.filename ?? '',
			outcome.typeId,
			outcome.status,
			outcome.check ?? '',
			manifestIssues(outcome.issues),
		];
		if (sheet) {
			line.push(
				outcome.sheet === null ? '' : String(outcome.sheet.page),
				outcome.sheet === null ? '' : String(outcome.sheet.label),
			);
		}
		if (content !== undefined) line.push(content(outcome.index) ?? '');
		lines.push(line);
	}
	return new TextEncoder().encode(`\ufeff${writeCsv(lines)}`);
}
