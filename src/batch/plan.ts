/**
 * From a table and a mapping to the rows a batch will make: each row's
 * content, built and validated by its content type, and its file name.
 *
 * A cell is text, and a content type's fields are text, numbers, yes or no
 * and lists, so each cell is read as its field's kind:
 *
 * - Text, multi-line text and secrets exactly as written, spaces and all; a
 *   Wi-Fi password can start with a space.
 * - Other text kinds (links, addresses, numbers to dial, dates, codes) with
 *   the spaces round them dropped, which a spreadsheet adds and a reader
 *   does not want. Currency, country and BIC codes in capitals; a choice
 *   matched to its option ignoring case.
 * - Numbers only as a plain decimal with a full stop, as CSV writes them in
 *   English. A comma or a thousands separator is refused with its own issue
 *   rather than guessed at: "1,250" is a thousand and a quarter in one
 *   country and one and a quarter in the next, and this may be an amount of
 *   money.
 * - Yes or no from true, false, yes, no, y, n, 1, 0, on and off, in any case,
 *   which covers what Excel, Sheets and people write.
 * - A list (a contact card's phone numbers, an email's recipients) split at
 *   line breaks, and also at semicolons and commas for addresses and numbers
 *   (neither can contain one) and at spaces for links (which cannot either).
 *
 * An empty cell takes the field's default, as an untouched form would show
 * it, and a field the mapping leaves out does too. Every row is then checked
 * by the content type exactly as the form is, so a batch never makes a code
 * the studio would refuse to.
 */

import { hasErrors, issue } from '../core/issue.js';
import type { Issue } from '../core/issue.js';
import type { FieldSchema, FieldValue, PayloadType, PayloadValue } from '../payload/types.js';
import { UnknownColumnError } from './errors.js';
import { sanitiseFilename, uniqueFilenames } from './filename.js';
import { BATCH_ISSUES } from './issues.js';
import { compileTemplate, fillTemplate, findColumn } from './template.js';
import type { CompiledTemplate } from './template.js';
import type { BatchMapping, BatchRegistries, BatchRow, CsvTable, FieldSource } from './types.js';

const PLAIN_NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
/** Digits with commas, dots, spaces or apostrophes between them: a number written for a person. */
const GROUPED_NUMBER = /^[+-]?\d[\d.,'\s\u00a0\u202f]*$/;

const TRUE = new Set(['true', 'yes', 'y', '1', 'on']);
const FALSE = new Set(['false', 'no', 'n', '0', 'off']);

/** Kinds taken exactly as written. */
const VERBATIM = new Set(['text', 'multiline', 'secret']);
/** Kinds written in capitals. */
const CAPITALS = new Set(['currency', 'country', 'bic']);
const NUMBERS = new Set(['number', 'integer', 'amount', 'latitude', 'longitude']);

function emptyValue(field: FieldSchema): FieldValue {
	if (field.default !== undefined) return field.default;
	if (field.multiple) return [];
	if (NUMBERS.has(field.kind) || field.kind === 'boolean') return null;
	return '';
}

function splitList(field: FieldSchema, text: string): string[] {
	const separator =
		field.kind === 'email' || field.kind === 'tel'
			? /[;,\r\n]+/
			: field.kind === 'url'
				? /\s+/
				: /\r?\n/;
	return text
		.split(separator)
		.map((item) => item.trim())
		.filter((item) => item !== '');
}

/** A cell as its field's kind, and an issue when it cannot be read as one without guessing. */
function cellValue(field: FieldSchema, text: string): { value: FieldValue; issue?: Issue } {
	if (field.multiple) {
		const items = splitList(field, text);
		return { value: items.length === 0 ? emptyValue(field) : items };
	}
	if (VERBATIM.has(field.kind)) return { value: text === '' ? emptyValue(field) : text };
	const trimmed = text.trim();
	if (trimmed === '') return { value: emptyValue(field) };
	if (NUMBERS.has(field.kind)) {
		if (PLAIN_NUMBER.test(trimmed)) return { value: Number(trimmed) };
		if (GROUPED_NUMBER.test(trimmed)) {
			return {
				value: Number.NaN,
				issue: issue(BATCH_ISSUES.numberFormat, ['fields', field.key]),
			};
		}
		// Not a number at all; validation says so in its own words.
		return { value: Number.NaN };
	}
	if (field.kind === 'boolean') {
		const lower = trimmed.toLowerCase();
		if (TRUE.has(lower)) return { value: true };
		if (FALSE.has(lower)) return { value: false };
		// Left as text, which validation reports as the wrong kind of value.
		return { value: trimmed };
	}
	if (field.kind === 'select') {
		const lower = trimmed.toLowerCase();
		const option = field.options?.find((candidate) => candidate.value.toLowerCase() === lower);
		return { value: option?.value ?? trimmed };
	}
	if (CAPITALS.has(field.kind)) return { value: trimmed.toUpperCase() };
	return { value: trimmed };
}

interface CompiledField {
	readonly field: FieldSchema;
	readonly template: CompiledTemplate;
}

function checkTable(table: CsvTable): void {
	if (
		typeof table !== 'object' ||
		table === null ||
		!Array.isArray(table.headers) ||
		!Array.isArray(table.rows) ||
		!table.headers.every((header) => typeof header === 'string')
	) {
		throw new TypeError('planBatch: table is what parseCsv returns.');
	}
	table.rows.forEach((row, index) => {
		if (!Array.isArray(row) || !row.every((cell) => typeof cell === 'string')) {
			throw new TypeError(`planBatch: row ${index} is a list of strings.`);
		}
	});
	if (table.rowNumbers !== undefined) {
		if (
			!Array.isArray(table.rowNumbers) ||
			table.rowNumbers.length !== table.rows.length ||
			!table.rowNumbers.every((number) => Number.isInteger(number) && number >= 2)
		) {
			throw new TypeError('planBatch: table.rowNumbers gives a row number from 2 for every row.');
		}
	}
}

function isSource(value: unknown): value is FieldSource {
	if (typeof value !== 'object' || value === null) return false;
	const keys = Object.keys(value);
	if (keys.length !== 1) return false;
	const source = value as Record<string, unknown>;
	return (
		(keys[0] === 'column' && typeof source.column === 'string') ||
		(keys[0] === 'template' && typeof source.template === 'string')
	);
}

function compileFields(
	type: PayloadType,
	mapping: BatchMapping,
	headers: readonly string[],
): CompiledField[] {
	if (typeof mapping.fields !== 'object' || mapping.fields === null) {
		throw new TypeError('planBatch: mapping.fields is an object of field sources.');
	}
	const compiled: CompiledField[] = [];
	for (const key of Object.keys(mapping.fields)) {
		const field = type.fields.find((candidate) => candidate.key === key);
		if (field === undefined) {
			throw new TypeError(
				`planBatch: this content type has no field called ${JSON.stringify(key)}.`,
			);
		}
		const source: unknown = mapping.fields[key];
		if (!isSource(source)) {
			throw new TypeError(
				`planBatch: the source of field ${JSON.stringify(key)} is { column } or { template }.`,
			);
		}
		let template: CompiledTemplate;
		if ('column' in source) {
			const index = findColumn(headers, source.column);
			if (index === -1) throw new UnknownColumnError({ part: 'field', field: key });
			template = { parts: [{ index }], columns: [index] };
		} else {
			const result = compileTemplate(source.template, headers);
			if ('missing' in result) throw new UnknownColumnError({ part: 'field', field: key });
			template = result;
		}
		compiled.push({ field, template });
	}
	// In the type's own field order, so issues come out in the order a form shows them.
	return compiled.sort((a, b) => type.fields.indexOf(a.field) - type.fields.indexOf(b.field));
}

/** The rows of a batch: content and file name for each, every problem as an issue on its row. */
export function planBatch(
	table: CsvTable,
	mapping: BatchMapping,
	registries: BatchRegistries,
): readonly BatchRow[] {
	checkTable(table);
	if (typeof mapping !== 'object' || mapping === null || typeof mapping.typeId !== 'string') {
		throw new TypeError('planBatch: mapping gives at least the content type.');
	}
	if (typeof mapping.filename !== 'string') {
		throw new TypeError('planBatch: mapping.filename is a template string.');
	}
	if (typeof registries !== 'object' || registries === null || !registries.payloads) {
		throw new TypeError('planBatch: registries gives at least the content types.');
	}
	const type = registries.payloads.require(mapping.typeId);
	if (type.generate === false) {
		throw new TypeError('planBatch: this content type can be read but not made.');
	}
	const fields = compileFields(type, mapping, table.headers);
	const filename = compileTemplate(mapping.filename, table.headers);
	if ('missing' in filename) throw new UnknownColumnError({ part: 'filename' });
	const read = new Set(fields.flatMap((entry) => entry.template.columns));

	// Reading the file's own warnings, by the row they belong to.
	const tableIssues = new Map<number, Issue[]>();
	for (const found of table.issues ?? []) {
		if (found.path[0] !== 'rows' || typeof found.path[1] !== 'number') continue;
		const list = tableIssues.get(found.path[1]) ?? [];
		list.push(found);
		tableIssues.set(found.path[1], list);
	}

	const drafts = table.rows.map((cells, index) => {
		const rowNumber = table.rowNumbers?.[index] ?? index + 2;
		const issues: Issue[] = [...(tableIssues.get(index) ?? [])];
		let content: string | null = null;
		if (read.size === 0 || [...read].every((column) => (cells[column] ?? '') === '')) {
			issues.push(issue(BATCH_ISSUES.emptyRow, [], 'warning'));
		} else {
			const value: Record<string, FieldValue> = {};
			const unread = new Set<string>();
			const conversion: Issue[] = [];
			for (const field of type.fields) value[field.key] = emptyValue(field);
			for (const { field, template } of fields) {
				const text = fillTemplate(template, cells, field.kind === 'url' && !field.multiple);
				const cell = cellValue(field, text);
				value[field.key] = cell.value;
				if (cell.issue !== undefined) {
					conversion.push(cell.issue);
					unread.add(field.key);
				}
			}
			const validated = type
				.validate(value as PayloadValue)
				.filter((found) => !unread.has(found.path[1] as string));
			const found = [...conversion, ...validated];
			issues.push(...found);
			if (!hasErrors(found)) content = type.build(value as PayloadValue).text;
		}
		const raw = fillTemplate(filename, cells, false);
		const name = sanitiseFilename(raw);
		if (name === '') issues.push(issue(BATCH_ISSUES.filenameFallback, ['filename'], 'info'));
		else if (name !== raw.trim()) {
			issues.push(issue(BATCH_ISSUES.filenameCleaned, ['filename'], 'info'));
		}
		return { index, rowNumber, issues, content, name };
	});

	const names = uniqueFilenames(
		drafts.map((draft) => ({ name: draft.name, fallback: `qr-${draft.rowNumber}` })),
	);
	return Object.freeze(
		drafts.map((draft, i) => {
			const unique = names[i] as { name: string; number: number | null };
			if (unique.number !== null) {
				draft.issues.push(
					issue(BATCH_ISSUES.filenameNumbered, ['filename'], 'info', { number: unique.number }),
				);
			}
			return Object.freeze({
				index: draft.index,
				rowNumber: draft.rowNumber,
				typeId: type.id,
				filename: unique.name,
				content: draft.content,
				issues: Object.freeze(draft.issues),
			});
		}),
	);
}
