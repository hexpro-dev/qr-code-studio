/**
 * rMQR's tables against a second transcription of ISO/IEC 23941 (zxing-cpp's,
 * in fields.ts) and against the arithmetic the standard guarantees.
 */

import { describe, expect, it } from 'vitest';
import { blockCapacity } from '../../../src/symbology/qr/blocks.js';
import { ROLE_CODES } from '../../../src/symbology/roles.js';
import type { Mode } from '../../../src/segment/types.js';
import { rmqrLayout } from '../../../src/symbology/rmqr/layout.js';
import { rmqrProfile } from '../../../src/symbology/rmqr/profile.js';
import {
	rmqrBlocks,
	rmqrBySize,
	rmqrSpec,
	rmqrSpecs,
	rmqrVersionsBySize,
} from '../../../src/symbology/rmqr/tables.js';
import { rmqrFields, RMQR_NAMES, ZXING_ALIGNMENT, ZXING_BLOCKS } from './fields.js';

/** BWIPP's alignment positions (qrcode.metrics asp2 and asp3), unrolled as its layout loop does. */
const BWIPP_ALIGNMENT: Readonly<Record<number, readonly [number, number]>> = {
	27: [98, 99],
	43: [22, 99],
	59: [20, 40],
	77: [26, 52],
	99: [24, 50],
	139: [28, 56],
};

describe('rMQR tables', () => {
	it('has the 32 sizes in version indicator order', () => {
		expect(rmqrSpecs().map((spec) => spec.version)).toEqual(RMQR_NAMES);
		expect(rmqrSpecs().map((spec) => spec.indicator)).toEqual(RMQR_NAMES.map((_, i) => i));
	});

	it('agrees with zxing-cpp on every block of every level', () => {
		rmqrSpecs().forEach((spec, i) => {
			spec.levels.forEach((level, l) => {
				const [ecCount, first, firstData, second, secondData] = ZXING_BLOCKS[i]![l]!;
				const expected = [
					...Array.from({ length: first }, () => ({ dataCount: firstData, ecCount })),
					...Array.from({ length: second }, () => ({ dataCount: secondData, ecCount })),
				];
				expect(level.blocks.blocks, `${spec.version}-${level.ecLevel}`).toEqual(expected);
				expect(level.blocks.p).toBe(0);
				expect(level.blocks.lastDataCodewordBits).toBe(8);
			});
		});
	});

	it('places exactly the data modules the layout leaves, with the rest as remainder bits', () => {
		for (const spec of rmqrSpecs()) {
			const layout = rmqrLayout(spec.version);
			const data = layout.roles.filter((role) => role === ROLE_CODES.data).length;
			expect(data).toBe(spec.totalCodewords * 8 + spec.remainderBits);
			expect(spec.remainderBits).toBeLessThan(8);
			for (const level of spec.levels)
				expect(level.blocks.totalCodewords).toBe(spec.totalCodewords);
			const remainder = layout.dataBits.filter(
				(bit, module) => bit < 0 && layout.roles[module] === ROLE_CODES.data,
			).length;
			expect(remainder).toBe(spec.remainderBits);
		}
	});

	it('takes alignment columns from Annex D, which BWIPP derives the same way', () => {
		rmqrSpecs().forEach((spec, i) => {
			expect(spec.alignmentColumns).toEqual(ZXING_ALIGNMENT[i]);
			const [second, third] = BWIPP_ALIGNMENT[spec.width]!;
			const derived: number[] = [];
			for (let x = second - 2; x <= spec.width - 13; x += third - second) derived.push(x + 1);
			expect(spec.alignmentColumns).toEqual(derived);
		});
	});

	it('names each version by its size and finds it again by its size', () => {
		for (const spec of rmqrSpecs()) {
			expect(spec.version).toBe(`R${spec.height}x${spec.width}`);
			expect(rmqrBySize(spec.width, spec.height)).toBe(spec);
			expect(rmqrSpec(spec.version)).toBe(spec);
		}
		expect(rmqrBySize(43, 9)?.version).toBe('R9x43');
		expect(rmqrBySize(9, 43)).toBeUndefined();
		expect(rmqrBySize(27, 7)).toBeUndefined();
	});

	it('lists versions smallest first, by area, ISO order breaking the one tie', () => {
		const order = rmqrVersionsBySize();
		expect(order).toHaveLength(32);
		expect(order.slice(0, 4)).toEqual(['R11x27', 'R7x43', 'R13x27', 'R9x43']);
		const areas = order.map((version) => rmqrSpec(version).width * rmqrSpec(version).height);
		expect(areas).toEqual([...areas].sort((a, b) => a - b));
		expect(order.indexOf('R7x99')).toBeLessThan(order.indexOf('R9x77'));
		expect(order.at(-1)).toBe('R17x139');
		expect(rmqrVersionsBySize()).toBe(order);
	});

	it('corrects floor(ec / 2) errors per block, there being no misdecode protection codewords', () => {
		for (const spec of rmqrSpecs()) {
			for (const level of spec.levels) {
				const block = level.blocks.blocks[0]!;
				expect(blockCapacity(block.ecCount, level.blocks.p)).toBe(Math.floor(block.ecCount / 2));
			}
		}
	});

	it('refuses names and levels that do not exist', () => {
		expect(() => rmqrSpec('R7x27')).toThrow(TypeError);
		expect(() => rmqrSpec('M1')).toThrow(TypeError);
		expect(() => rmqrBlocks('R7x43', 'L')).toThrow(TypeError);
		expect(() => rmqrBlocks('R7x43', 'Q')).toThrow(TypeError);
	});
});

describe('rMQR bitstream profiles', () => {
	it('match zxing-cpp field for field in every version', () => {
		for (const spec of rmqrSpecs()) {
			const profile = rmqrProfile(spec.version);
			const fields = rmqrFields(spec.indicator);
			expect(profile.modeIndicatorBits).toBe(3);
			expect(profile.terminatorBits).toBe(3);
			for (const mode of profile.modes) {
				expect(profile.charCountBits(mode)).toBe(fields.charCountBits[mode]);
				expect(profile.modeIndicator(mode)).toBe(fields.modeIndicator[mode]);
			}
		}
	});

	it('allows ECI and both FNC1 positions, and no structured append', () => {
		const profile = rmqrProfile('R13x77');
		expect([profile.eci, profile.fnc1, profile.structuredAppend]).toEqual([true, true, false]);
		expect(profile.modeIndicator('eci')).toBe(0b111);
		expect(profile.modeIndicator('fnc1-first')).toBe(0b101);
		expect(profile.modeIndicator('fnc1-second')).toBe(0b110);
		expect(profile.modeIndicator('structured-append')).toBeUndefined();
		expect(profile.modes).toEqual(['numeric', 'alphanumeric', 'byte', 'kanji']);
		expect(() => profile.charCountBits('hanzi' as Mode)).toThrow(TypeError);
		expect(rmqrProfile('R13x77')).toBe(profile);
	});
});
