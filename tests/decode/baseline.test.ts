/**
 * The scanner's decode rates, per kind of damage and level, against a
 * committed baseline.
 *
 * Every cell is the share of 50 seeded captures (tests/helpers/corpus.ts) the
 * lenient profile reads to the right text. A change that costs any cell more
 * than 2 points fails here; a change that gains is recorded by rerunning with
 * UPDATE_DECODE_BASELINE=1 and committing bench/decode-baseline.json, so the
 * diff shows what moved.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { decodeImage } from '../../src/decode/decoder.js';
import type { DamageKind } from '../helpers/corpus.js';
import { DAMAGE_KINDS, capture } from '../helpers/corpus.js';

const FILE = resolve(dirname(fileURLToPath(import.meta.url)), '../../bench/decode-baseline.json');
const LEVELS = [0.15, 0.4, 0.65, 0.9] as const;
const PER_CELL = 50;
const ROWS = [...DAMAGE_KINDS, 'inverted', 'mirrored'] as const;
const TOLERANCE = 2;

interface Baseline {
	readonly profile: 'lenient';
	readonly capturesPerCell: number;
	readonly levels: readonly number[];
	/** Percent read, per row, one number per level. */
	readonly rates: Readonly<Record<string, readonly number[]>>;
}

/** The baseline as prettier writes it, one row a line, so an update is a clean diff. */
function format(rates: Readonly<Record<string, readonly number[]>>): string {
	const rows = ROWS.map((row) => `\t\t"${row}": [${(rates[row] ?? []).join(', ')}]`);
	return [
		'{',
		'\t"profile": "lenient",',
		`\t"capturesPerCell": ${PER_CELL},`,
		`\t"levels": [${LEVELS.join(', ')}],`,
		'\t"rates": {',
		rows.join(',\n'),
		'\t}',
		'}',
		'',
	].join('\n');
}

function rate(row: (typeof ROWS)[number], levelIndex: number): number {
	let read = 0;
	for (let i = 0; i < PER_CELL; i += 1) {
		const seed = 1_000_000 + ROWS.indexOf(row) * 10_000 + levelIndex * 1000 + i;
		const flagged = row === 'inverted' || row === 'mirrored';
		const shot = capture(seed, {
			severity: LEVELS[levelIndex] as number,
			...(flagged
				? { invert: row === 'inverted', mirror: row === 'mirrored' }
				: { kind: row as DamageKind }),
		});
		const result = decodeImage(shot.image);
		if (result.ok && result.value.some((found) => found.read.bitstream.text === shot.text))
			read += 1;
	}
	return Math.round((read / PER_CELL) * 1000) / 10;
}

describe('the lenient decode rates', () => {
	it(`stay within ${TOLERANCE} points of the committed baseline at every level`, async () => {
		const rates: Record<string, number[]> = {};
		for (const row of ROWS) {
			const cells: number[] = [];
			for (let index = 0; index < LEVELS.length; index += 1) {
				cells.push(rate(row, index));
				// Hand the event loop a turn between cells. Run as one block, the
				// test holds its worker for minutes on a CI runner and vitest's
				// worker channel times out.
				await new Promise<void>((resolve) => setImmediate(resolve));
			}
			rates[row] = cells;
		}
		if (process.env.UPDATE_DECODE_BASELINE === '1') writeFileSync(FILE, format(rates));
		const baseline = JSON.parse(readFileSync(FILE, 'utf8')) as Baseline;
		expect(baseline.capturesPerCell).toBe(PER_CELL);
		expect(baseline.levels).toEqual(LEVELS);
		const regressions: string[] = [];
		for (const row of ROWS) {
			LEVELS.forEach((level, index) => {
				const before = baseline.rates[row]?.[index];
				const now = rates[row]?.[index] as number;
				if (before === undefined || now < before - TOLERANCE) {
					regressions.push(`${row} at ${level}: ${now}% against ${before ?? 'nothing'}%`);
				}
			});
		}
		expect(regressions).toEqual([]);
	}, 600_000);
});
