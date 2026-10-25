/**
 * QR's tables and per-version geometry, against the arithmetic the
 * specification guarantees and against the `qrcode` package's own tables.
 *
 * A transcription slip in a table of 160 rows produces symbols that look
 * right and fail at one version and level, so every row is checked two ways:
 * invariants that hold for the whole of ISO/IEC 18004 (blocks summing to the
 * total, group 2 one codeword longer, the data region exactly the codewords
 * plus the remainder bits), and an independent implementation's numbers.
 */

import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import type { EcLevel, Mode } from '../../../src/segment/types.js';
import { ROLES, ROLE_CODES, roleAt } from '../../../src/symbology/roles.js';
import {
	blockCapacity,
	decodeBlocks,
	interleaveBlocks,
	interleaveOrder,
	qrBlocks,
} from '../../../src/symbology/qr/blocks.js';
import {
	formatBits,
	readFormat,
	readVersion,
	versionBits,
} from '../../../src/symbology/qr/info.js';
import { qrGeometry } from '../../../src/symbology/qr/layout.js';
import {
	ALIGNMENT_CENTRES,
	EC_FORMAT_BITS,
	EC_INDEX,
	EC_LEVELS,
	REMAINDER_BITS,
	TOTAL_CODEWORDS,
	ecRow,
	misdecodeProtection,
} from '../../../src/symbology/qr/tables.js';
import { capacity } from './oracles.js';

const require = createRequire(import.meta.url);
const levels = require('qrcode/lib/core/error-correction-level') as Record<EcLevel, unknown>;
const ecc = require('qrcode/lib/core/error-correction-code') as {
	getBlocksCount(version: number, level: unknown): number;
	getTotalCodewordsCount(version: number, level: unknown): number;
};
const utils = require('qrcode/lib/core/utils') as {
	getSymbolTotalCodewords(version: number): number;
};
const alignment = require('qrcode/lib/core/alignment-pattern') as {
	getRowColCoords(version: number): number[];
};
const versionInfo = require('qrcode/lib/core/version') as {
	getEncodedBits(version: number): number;
	getCapacity(version: number, level: unknown, mode: unknown): number;
};
const formatInfo = require('qrcode/lib/core/format-info') as {
	getEncodedBits(level: unknown, mask: number): number;
};
const modes = require('qrcode/lib/core/mode') as Record<string, unknown>;

const VERSIONS = Array.from({ length: 40 }, (_, i) => i + 1);

describe('the QR tables', () => {
	it('agree with qrcode on blocks, check codewords and totals at every version and level', () => {
		for (const version of VERSIONS) {
			expect(TOTAL_CODEWORDS[version - 1]).toBe(utils.getSymbolTotalCodewords(version));
			for (const level of EC_LEVELS) {
				const layout = qrBlocks(version, level);
				const ecTotal = layout.blocks.reduce((sum, b) => sum + b.ecCount, 0);
				expect(layout.blocks.length, `${version}-${level}`).toBe(
					ecc.getBlocksCount(version, levels[level]),
				);
				expect(ecTotal, `${version}-${level}`).toBe(
					ecc.getTotalCodewordsCount(version, levels[level]),
				);
			}
		}
	});

	it('keep the invariants of ISO/IEC 18004 Table 9 in every row', () => {
		for (const version of VERSIONS) {
			for (const level of EC_LEVELS) {
				const row = ecRow(version, level);
				const total =
					row.group1Blocks * (row.group1Data + row.ecPerBlock) +
					row.group2Blocks * (row.group2Data + row.ecPerBlock);
				expect(total, `${version}-${level}`).toBe(TOTAL_CODEWORDS[version - 1]);
				if (row.group2Blocks > 0) expect(row.group2Data).toBe(row.group1Data + 1);
				const layout = qrBlocks(version, level);
				expect(layout.totalCodewords).toBe(total);
				expect(layout.lastDataCodewordBits).toBe(8);
				expect(layout.dataBits).toBe(
					8 * (row.group1Blocks * row.group1Data + row.group2Blocks * row.group2Data),
				);
				expect(qrBlocks(version, level)).toBe(layout);
			}
		}
		// Stronger levels never hold more.
		for (const version of VERSIONS) {
			const bits = EC_LEVELS.map((level) => qrBlocks(version, level).dataBits);
			expect([...bits].sort((a, b) => b - a)).toEqual(bits);
		}
		expect(() => ecRow(41, 'L')).toThrow(TypeError);
	});

	it('hold the character capacities qrcode reports', () => {
		const names: Record<Mode, string> = {
			numeric: 'NUMERIC',
			alphanumeric: 'ALPHANUMERIC',
			byte: 'BYTE',
			kanji: 'KANJI',
		};
		for (const version of VERSIONS) {
			for (const level of EC_LEVELS) {
				for (const mode of ['numeric', 'alphanumeric', 'byte', 'kanji'] as Mode[]) {
					expect(capacity(mode, version, level), `${version}-${level} ${mode}`).toBe(
						versionInfo.getCapacity(version, levels[level], modes[names[mode]]),
					);
				}
			}
		}
		// The published extremes: 40-L holds 7089 digits and 2953 bytes, 1-H 7 bytes.
		expect(capacity('numeric', 40, 'L')).toBe(7089);
		expect(capacity('byte', 40, 'L')).toBe(2953);
		expect(capacity('byte', 1, 'H')).toBe(7);
	});

	it('have the alignment centres qrcode computes, and the misdecode protection of Table 9', () => {
		for (const version of VERSIONS) {
			const expected = version === 1 ? [] : alignment.getRowColCoords(version);
			expect([...(ALIGNMENT_CENTRES[version - 1] ?? [])]).toEqual(expected);
		}
		const p = (version: number, level: EcLevel) => misdecodeProtection(version, level);
		expect([p(1, 'L'), p(1, 'M'), p(1, 'Q'), p(1, 'H'), p(2, 'L'), p(3, 'L')]).toEqual([
			3, 2, 1, 1, 2, 1,
		]);
		expect([p(2, 'M'), p(3, 'M'), p(4, 'L'), p(40, 'H')]).toEqual([0, 0, 0, 0]);
		// floor((ec - p) / 2): 1-L corrects 2, 1-M 4, 1-Q 6, 1-H 8.
		expect(
			EC_LEVELS.map((level) => blockCapacity(qrBlocks(1, level).blocks[0]!.ecCount, p(1, level))),
		).toEqual([2, 4, 6, 8]);
	});

	it('order the levels both ways the specification does', () => {
		expect(EC_INDEX).toEqual({ L: 0, M: 1, Q: 2, H: 3 });
		expect(EC_FORMAT_BITS).toEqual({ M: 0, L: 1, H: 2, Q: 3 });
	});
});

describe('format and version information', () => {
	it('match qrcode for every level, mask and version', () => {
		for (const level of EC_LEVELS) {
			for (let mask = 0; mask < 8; mask += 1) {
				expect(formatBits(level, mask), `${level} ${mask}`).toBe(
					formatInfo.getEncodedBits(levels[level], mask),
				);
				expect(readFormat(formatBits(level, mask), 0)).toEqual({
					ecLevel: level,
					mask,
					distance: 0,
				});
			}
		}
		for (let version = 7; version <= 40; version += 1) {
			expect(versionBits(version)).toBe(versionInfo.getEncodedBits(version));
			expect(readVersion(versionBits(version) ^ 0b101, 3)).toEqual({ version, distance: 2 });
		}
		// ISO/IEC 18004 Annex C's example: M with mask 101 is 100000011001110.
		expect(formatBits('M', 5)).toBe(0b100000011001110);
		// Annex D's: version 7 is 000111110010010100.
		expect(versionBits(7)).toBe(0b000111110010010100);
		expect(readFormat(0, 3)).toBeUndefined();
		expect(readVersion(0, 3)).toBeUndefined();
	});
});

describe('the layout of every version', () => {
	it('gives every module one role and the data region exactly the codewords and remainder bits', () => {
		for (const version of VERSIONS) {
			const geometry = qrGeometry(version);
			const { layout, size, placement } = geometry;
			expect([layout.width, layout.height]).toEqual([size, size]);
			const counts = new Map<number, number>();
			for (const code of layout.roles) counts.set(code, (counts.get(code) ?? 0) + 1);
			const count = (role: keyof typeof ROLE_CODES) => counts.get(ROLE_CODES[role]) ?? 0;
			const centres = ALIGNMENT_CENTRES[version - 1]!.length;
			const alignments = centres === 0 ? 0 : centres * centres - 3;
			expect(count('finder')).toBe(3 * 49);
			expect(count('alignment')).toBe(25 * alignments);
			expect(count('format')).toBe(30);
			expect(count('dark-module')).toBe(1);
			expect(count('version')).toBe(version >= 7 ? 36 : 0);
			expect(placement.length).toBe(count('data'));
			expect(placement.length).toBe(
				8 * TOTAL_CODEWORDS[version - 1]! + REMAINDER_BITS[version - 1]!,
			);
			// Every data module carries exactly one codeword bit, apart from the
			// remainder, and every codeword bit sits in exactly one module.
			const seen = new Set<number>();
			for (let i = 0; i < layout.dataBits.length; i += 1) {
				const bit = layout.dataBits[i]!;
				if (bit < 0) continue;
				expect(layout.roles[i]).toBe(ROLE_CODES.data);
				seen.add(bit);
			}
			expect(seen.size).toBe(8 * TOTAL_CODEWORDS[version - 1]!);
			expect(qrGeometry(version)).toBe(geometry);
			expect(layout.regions.map((r) => [r.x, r.y, r.width, r.kind])).toEqual([
				[0, 0, 7, 'concentric-7'],
				[size - 7, 0, 7, 'concentric-7'],
				[0, size - 7, 7, 'concentric-7'],
			]);
		}
		expect(() => qrGeometry(0)).toThrow(TypeError);
	});

	it('places the first codeword in the bottom-right corner, most significant bit first', () => {
		const { layout } = qrGeometry(1);
		const at = (x: number, y: number) => layout.dataBits[y * 21 + x];
		expect([at(20, 20), at(19, 20), at(20, 19), at(19, 19)]).toEqual([7, 6, 5, 4]);
		expect(roleAt(layout, 0, 0)).toBe('finder');
		expect(roleAt(layout, 7, 7)).toBe('separator');
		expect(roleAt(layout, 10, 6)).toBe('timing');
		expect(roleAt(layout, 8, 13)).toBe('dark-module');
		expect(roleAt(layout, 8, 0)).toBe('format');
		expect(roleAt(layout, 20, 20)).toBe('data');
		expect(roleAt(qrGeometry(7).layout, 0, 34)).toBe('version');
		expect(roleAt(qrGeometry(2).layout, 18, 18)).toBe('alignment');
		expect(() => roleAt(layout, 21, 0)).toThrow(RangeError);
		expect(ROLES.map((role) => ROLE_CODES[role])).toEqual(ROLES.map((_, i) => i));
	});
});

describe('blocks', () => {
	it('interleave group 1 then group 2, skipping the shorter blocks', () => {
		// 5-Q: two blocks of 15 and two of 16 data codewords, 18 check each.
		const layout = qrBlocks(5, 'Q');
		const data = Uint8Array.from({ length: 62 }, (_, i) => i);
		const placed = interleaveBlocks(data, layout);
		expect(Array.from(placed.subarray(0, 8))).toEqual([0, 15, 30, 46, 1, 16, 31, 47]);
		// The last data codeword is the 16th of the fourth block alone.
		expect(placed[61]).toBe(61);
		const order = interleaveOrder(layout);
		expect(order.block[60]).toBe(2);
		expect(order.offset[61]).toBe(15);
		expect(interleaveOrder(layout)).toBe(order);
		expect(() => interleaveBlocks(new Uint8Array(3), layout)).toThrow(RangeError);
		expect(() => decodeBlocks(new Uint8Array(3), layout)).toThrow(RangeError);
		const decoded = decodeBlocks(placed, layout);
		expect(Array.from(decoded.data)).toEqual(Array.from(data));
	});
});
