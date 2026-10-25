/**
 * The malformed-input contract for the CSV reader, which reads whatever file
 * a person drops in.
 *
 * The three properties `tests/fuzz/` holds every parser of untrusted input
 * to, and one more:
 *
 *   1. Only `QrStudioError` escapes, and only 'batch/malformed-csv' or
 *      'batch/too-many-rows'.
 *   2. Every call finishes, quickly. The watchdog in `tests/fuzz/watchdog.ts`
 *      watches from another thread and names the input if one ever stalls.
 *   3. Nothing is left unhandled (the setup file's guard fails the run on a
 *      stray rejection).
 *   4. What comes back is a table: every row as wide as the header, a row
 *      number for each, increasing from 2.
 *
 * The corpus is seeded mutations of realistic exports (cuts, insertions of
 * quotes, delimiters and line breaks, swapped bytes), plus noise over the
 * characters CSV gives meaning to. The seed is in every label.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseCsv } from '../../src/batch/csv.js';
import type { ParseCsvOptions } from '../../src/batch/types.js';
import { isQrStudioError } from '../../src/core/errors.js';
import { seeded } from '../core/helpers.js';
import type { Seeded } from '../core/helpers.js';
import type { Watchdog } from '../fuzz/watchdog.js';
import { startWatchdog } from '../fuzz/watchdog.js';

const BUDGET_MS = 500;
const ALLOWED = new Set(['batch/malformed-csv', 'batch/too-many-rows']);
const MEANINGFUL = [
	'"',
	',',
	';',
	'\t',
	'\r',
	'\n',
	'\r\n',
	'""',
	'\ufeff',
	'sep=',
	' ',
	'a',
	'1',
	'\u00e9',
];

const SOURCES = [
	'\ufeffSKU,Name,URL\r\nEX-1,"Example, one",https://example.com/1\r\nEX-2,Two,https://example.com/2\r\n',
	'sep=;\r\nArtikel;Preis\r\nEX-1;12,50\r\n"EX;2";3,00\r\n;\r\n',
	'ssid\tpassword\nExample Network\t"multi\nline"\n',
	'a,b,c\n1\n1,2,3,4\n\n\n,,\n',
	'"a""b",c\r"x\r\ny",z\r',
];

interface Input {
	readonly label: string;
	readonly text: string;
}

function mutate(random: Seeded, source: string): string {
	const at = random.int(source.length + 1);
	switch (random.int(5)) {
		case 0:
			return source.slice(0, at);
		case 1:
			return (
				source.slice(0, at) +
				(MEANINGFUL[random.int(MEANINGFUL.length)] as string) +
				source.slice(at)
			);
		case 2: {
			const end = at + random.int(8);
			return source.slice(0, at) + source.slice(end);
		}
		case 3: {
			let out = source;
			for (let i = 0; i < 1 + random.int(6); i += 1) {
				const where = random.int(out.length + 1);
				out = out.slice(0, where) + '"' + out.slice(where);
			}
			return out;
		}
		default:
			return source.slice(at) + source.slice(0, at);
	}
}

function noise(random: Seeded, length: number): string {
	let out = '';
	for (let i = 0; i < length; i += 1) out += MEANINGFUL[random.int(MEANINGFUL.length)] as string;
	return out;
}

function buildCorpus(): Input[] {
	const random = seeded(0xc5f);
	const corpus: Input[] = SOURCES.map((text, i) => ({ label: `source ${i}`, text }));
	SOURCES.forEach((source, index) => {
		let current = source;
		for (let i = 0; i < 300; i += 1) {
			// Mutations build on each other half the time, so damage compounds.
			current = mutate(random, random.int(2) === 0 ? source : current);
			corpus.push({ label: `source ${index} mutation ${i}`, text: current });
		}
	});
	for (let i = 0; i < 1500; i += 1) {
		corpus.push({ label: `noise ${i}`, text: noise(random, random.int(120)) });
	}
	return corpus;
}

const corpus = buildCorpus();
const OPTIONS: readonly ParseCsvOptions[] = [
	{},
	{ delimiter: ',' },
	{ delimiter: ';' },
	{ delimiter: '\t' },
	{ maxRows: 3 },
];
let watchdog: Watchdog;

beforeAll(() => {
	watchdog = startWatchdog();
});

afterAll(async () => {
	await watchdog.stop();
});

describe('the CSV reader on malformed input', () => {
	it('has a corpus worth running', () => {
		expect(corpus.length).toBeGreaterThan(3000);
	});

	it('lets nothing but its two codes escape, finishes every call, and returns tables', () => {
		const problems: string[] = [];
		let refused = 0;
		let read = 0;
		for (const input of corpus) {
			OPTIONS.forEach((options, o) => {
				const label = `${input.label} options ${o}`;
				watchdog.beat(label);
				const started = performance.now();
				try {
					const table = parseCsv(input.text, options);
					read += 1;
					const width = table.headers.length;
					if (width < 1) problems.push(`${label}: no header`);
					if (table.rows.some((row) => row.length !== width)) problems.push(`${label}: ragged`);
					if (table.rowNumbers.length !== table.rows.length) problems.push(`${label}: row numbers`);
					let last = 1;
					for (const number of table.rowNumbers) {
						if (!(number > last)) problems.push(`${label}: row numbers out of order`);
						last = number;
					}
				} catch (error) {
					refused += 1;
					if (!isQrStudioError(error)) {
						problems.push(
							`${label} threw ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`,
						);
					} else if (!ALLOWED.has(error.code)) problems.push(`${label} threw ${error.code}`);
				}
				const ms = performance.now() - started;
				if (ms > BUDGET_MS) problems.push(`${label} took ${Math.round(ms)}ms`);
			});
		}
		expect(problems).toEqual([]);
		// Both sides of the contract are exercised.
		expect(refused).toBeGreaterThan(corpus.length / 4);
		expect(read).toBeGreaterThan(corpus.length / 4);
	});
});
