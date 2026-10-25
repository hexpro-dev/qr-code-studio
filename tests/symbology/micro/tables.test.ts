/**
 * Micro QR's tables held to what the specification guarantees, and to a
 * second transcription.
 *
 * The capacities are ISO/IEC 18004 Table 7's data bits for each version and
 * level; the block rows are compared with zxing-cpp's ECBlocks (Apache 2.0,
 * core/src/qrcode/QRVersion.cpp, citing ISO/IEC 18004:2006 Table 9); the field
 * widths with zxing-cpp's QRCodecMode.cpp. The (c, k, r) triples are Table
 * 9's, which is where p comes from.
 */

import { describe, expect, it } from 'vitest';
import { blockCapacity } from '../../../src/symbology/qr/blocks.js';
import { microLayout } from '../../../src/symbology/micro/layout.js';
import { microProfile } from '../../../src/symbology/micro/profile.js';
import {
	MICRO_VERSIONS,
	microBlocks,
	microBySize,
	microLevel,
	microSpec,
} from '../../../src/symbology/micro/tables.js';
import type { EcLevel, Mode } from '../../../src/segment/types.js';
import { ROLE_CODES } from '../../../src/symbology/roles.js';
import { MICRO_FIELDS } from './fields.js';

/** zxing-cpp's Micro QR ECBlocks: check symbols per block, blocks, data codewords. */
const ZXING: Readonly<Record<string, readonly [number, number, number]>> = {
	'M1-L': [2, 1, 3],
	'M2-L': [5, 1, 5],
	'M2-M': [6, 1, 4],
	'M3-L': [6, 1, 11],
	'M3-M': [8, 1, 9],
	'M4-L': [8, 1, 16],
	'M4-M': [10, 1, 14],
	'M4-Q': [14, 1, 10],
};

/** ISO/IEC 18004 Table 9's (c, k, r) for each level. */
const CKR: Readonly<Record<string, readonly [number, number, number]>> = {
	'M1-L': [5, 3, 0],
	'M2-L': [10, 5, 1],
	'M2-M': [10, 4, 2],
	'M3-L': [17, 11, 2],
	'M3-M': [17, 9, 4],
	'M4-L': [24, 16, 3],
	'M4-M': [24, 14, 5],
	'M4-Q': [24, 10, 7],
};

/** ISO/IEC 18004 Table 7: data bits per level. */
const DATA_BITS: Readonly<Record<string, number>> = {
	'M1-L': 20,
	'M2-L': 40,
	'M2-M': 32,
	'M3-L': 84,
	'M3-M': 68,
	'M4-L': 128,
	'M4-M': 112,
	'M4-Q': 80,
};

function everyLevel(): { version: string; ec: EcLevel; key: string }[] {
	return MICRO_VERSIONS.flatMap((version) =>
		microSpec(version).levels.map((level) => ({
			version,
			ec: level.ecLevel,
			key: `${version}-${level.ecLevel}`,
		})),
	);
}

describe('Micro QR tables', () => {
	it('has exactly the eight levels of the specification', () => {
		expect(everyLevel().map((level) => level.key)).toEqual(Object.keys(ZXING));
	});

	it('agrees with zxing-cpp on every block', () => {
		for (const { version, ec, key } of everyLevel()) {
			const blocks = microBlocks(version, ec);
			const [ecCount, count, dataCount] = ZXING[key]!;
			expect(blocks.blocks).toEqual(Array.from({ length: count }, () => ({ dataCount, ecCount })));
		}
	});

	it('keeps Table 9: c = k + 2r + p, with the p this package uses', () => {
		for (const { version, ec, key } of everyLevel()) {
			const blocks = microBlocks(version, ec);
			const [c, k, r] = CKR[key]!;
			expect(blocks.totalCodewords).toBe(c);
			expect(blocks.blocks[0]!.dataCount).toBe(k);
			expect(blocks.p).toBe(c - k - 2 * r);
			expect(blockCapacity(blocks.blocks[0]!.ecCount, blocks.p)).toBe(r);
			expect(microLevel(version, ec).p).toBe(blocks.p);
		}
	});

	it('gives Table 7 its data capacity, with M1 and M3 ending on half a codeword', () => {
		for (const { version, ec, key } of everyLevel()) {
			const blocks = microBlocks(version, ec);
			expect(blocks.dataBits).toBe(DATA_BITS[key]);
			expect(blocks.lastDataCodewordBits).toBe(version === 'M1' || version === 'M3' ? 4 : 8);
		}
	});

	it('fills every data module and no more', () => {
		// 36, 80, 132 and 192 data modules: BWIPP's qrcode.metrics.
		const modules = { M1: 36, M2: 80, M3: 132, M4: 192 };
		for (const version of MICRO_VERSIONS) {
			const layout = microLayout(version);
			const data = layout.roles.filter((role) => role === ROLE_CODES.data).length;
			expect(data).toBe(modules[version]);
			const spec = microSpec(version);
			expect(spec.totalCodewords * 8 - (spec.lastDataCodewordBits === 4 ? 4 : 0)).toBe(data);
			expect(spec.size).toBe(9 + 2 * spec.number);
		}
	});

	it('numbers the symbols 0 to 7 in order, as Table 13 does', () => {
		expect(everyLevel().map(({ version, ec }) => microLevel(version, ec).symbolNumber)).toEqual([
			0, 1, 2, 3, 4, 5, 6, 7,
		]);
	});

	it('refuses versions and levels that do not exist', () => {
		expect(() => microSpec('M5')).toThrow(TypeError);
		expect(() => microSpec('1')).toThrow(TypeError);
		expect(() => microLevel('M1', 'M')).toThrow(TypeError);
		expect(() => microLevel('M3', 'Q')).toThrow(TypeError);
		expect(() => microBlocks('M4', 'H')).toThrow(TypeError);
	});

	it('finds a version by its side and nothing else', () => {
		expect(microBySize(11)?.version).toBe('M1');
		expect(microBySize(17)?.version).toBe('M4');
		expect(microBySize(12)).toBeUndefined();
		expect(microBySize(21)).toBeUndefined();
	});

	it('caches block layouts', () => {
		expect(microBlocks('M4', 'Q')).toBe(microBlocks('M4', 'Q'));
		expect(Object.isFrozen(microBlocks('M4', 'Q'))).toBe(true);
	});
});

describe('Micro QR bitstream profiles', () => {
	it('match zxing-cpp field for field', () => {
		for (const version of MICRO_VERSIONS) {
			const profile = microProfile(version);
			const fields = MICRO_FIELDS[version];
			expect(profile.modeIndicatorBits).toBe(fields.modeBits);
			expect(profile.terminatorBits).toBe(fields.terminatorBits);
			expect([...profile.modes]).toEqual(Object.keys(fields.charCountBits));
			for (const mode of profile.modes) {
				expect(profile.charCountBits(mode)).toBe(fields.charCountBits[mode]);
				expect(profile.modeIndicator(mode)).toBe(fields.modeIndicator[mode]);
			}
		}
	});

	it('carries no ECI, FNC1 or structured append in any version', () => {
		for (const version of MICRO_VERSIONS) {
			const profile = microProfile(version);
			expect([profile.eci, profile.fnc1, profile.structuredAppend]).toEqual([false, false, false]);
			for (const extra of ['eci', 'fnc1-first', 'fnc1-second', 'structured-append'] as const) {
				expect(profile.modeIndicator(extra)).toBeUndefined();
			}
		}
	});

	it('refuses to size a mode the version cannot carry', () => {
		expect(microProfile('M1').modeIndicator('alphanumeric')).toBeUndefined();
		expect(() => microProfile('M1').charCountBits('alphanumeric')).toThrow(TypeError);
		expect(() => microProfile('M2').charCountBits('byte' as Mode)).toThrow(TypeError);
	});

	it('returns one frozen profile per version', () => {
		expect(microProfile('M3')).toBe(microProfile('M3'));
		expect(Object.isFrozen(microProfile('M3'))).toBe(true);
	});
});
