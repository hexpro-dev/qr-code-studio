/**
 * Micro QR's layout: every module's role, the regions a design may restyle,
 * and the codeword bit each data module carries.
 */

import { describe, expect, it } from 'vitest';
import { microBlocks, microSpec, MICRO_VERSIONS } from '../../../src/symbology/micro/tables.js';
import {
	MICRO_FORMAT_MODULES,
	microGeometry,
	microLayout,
} from '../../../src/symbology/micro/layout.js';
import { ROLE_CODES } from '../../../src/symbology/roles.js';
import type { ModuleRole, SymbolLayout } from '../../../src/symbology/types.js';

function roleAt(layout: SymbolLayout, x: number, y: number): ModuleRole {
	const code = layout.roles[y * layout.width + x];
	return (Object.keys(ROLE_CODES) as ModuleRole[]).find((role) => ROLE_CODES[role] === code)!;
}

function count(layout: SymbolLayout, role: ModuleRole): number {
	return layout.roles.filter((code) => code === ROLE_CODES[role]).length;
}

describe('Micro QR layout', () => {
	it('gives every function pattern its role and size', () => {
		for (const version of MICRO_VERSIONS) {
			const layout = microLayout(version);
			const size = microSpec(version).size;
			expect([layout.width, layout.height]).toEqual([size, size]);
			expect(count(layout, 'finder')).toBe(49);
			expect(count(layout, 'separator')).toBe(15);
			expect(count(layout, 'timing')).toBe(2 * (size - 8));
			expect(count(layout, 'format')).toBe(15);
			for (const absent of [
				'alignment',
				'version',
				'dark-module',
				'sub-finder',
				'corner-finder',
			] as const) {
				expect(count(layout, absent)).toBe(0);
			}
		}
	});

	it('draws the finder, separator and timing as the figures show them', () => {
		const { template } = microGeometry('M4');
		const top = Array.from({ length: 17 }, (_, x) => template.get(x, 0)).join('');
		const left = Array.from({ length: 17 }, (_, y) => template.get(0, y)).join('');
		// Finder edge, light separator, then timing dark on even columns.
		expect(top).toBe('11111110101010101');
		expect(left).toBe('11111110101010101');
		const centre = Array.from({ length: 8 }, (_, x) => template.get(x, 3)).join('');
		expect(centre).toBe('10111010');
		expect(roleAt(microLayout('M4'), 7, 7)).toBe('separator');
	});

	it('puts the format bits where BWIPP does, most significant first', () => {
		// barcode.ps qrcode.formatfimmap, micro: (x, y) from bit 14 down to bit 0.
		expect(MICRO_FORMAT_MODULES).toEqual([
			[1, 8],
			[2, 8],
			[3, 8],
			[4, 8],
			[5, 8],
			[6, 8],
			[7, 8],
			[8, 8],
			[8, 7],
			[8, 6],
			[8, 5],
			[8, 4],
			[8, 3],
			[8, 2],
			[8, 1],
		]);
		for (const [x, y] of MICRO_FORMAT_MODULES)
			expect(roleAt(microLayout('M2'), x, y)).toBe('format');
	});

	it('offers the finder as one concentric region', () => {
		for (const version of MICRO_VERSIONS) {
			expect(microLayout(version).regions).toEqual([
				{ role: 'finder', kind: 'concentric-7', x: 0, y: 0, width: 7, height: 7, rotation: 0 },
			]);
		}
	});

	it('maps every codeword bit to exactly one module, skipping half of the 4 bit codeword', () => {
		for (const version of MICRO_VERSIONS) {
			for (const level of microSpec(version).levels) {
				const blocks = microBlocks(version, level.ecLevel);
				const layout = microLayout(version, level.ecLevel);
				const seen = new Set<number>();
				layout.dataBits.forEach((bit, module) => {
					const isData = layout.roles[module] === ROLE_CODES.data;
					expect(bit >= 0).toBe(isData);
					if (bit >= 0) seen.add(bit);
				});
				const short = blocks.lastDataCodewordBits === 4 ? level.dataCodewords - 1 : -1;
				const expected: number[] = [];
				for (let cw = 0; cw < blocks.totalCodewords; cw += 1) {
					for (let bit = 0; bit < 8; bit += 1)
						if (cw !== short || bit >= 4) expected.push(cw * 8 + bit);
				}
				expect([...seen].sort((a, b) => a - b)).toEqual(expected);
			}
		}
	});

	it('places bits from the bottom right corner upwards, two columns at a time', () => {
		const layout = microLayout('M2');
		const at = (x: number, y: number): number => layout.dataBits[y * 13 + x]!;
		// Codeword 0, bit 7 then 6, at the bottom right; bits 5 and 4 one row up.
		expect([at(12, 12), at(11, 12), at(12, 11), at(11, 11)]).toEqual([7, 6, 5, 4]);
	});

	it('maps M3 differently at L and M, and shares a layout where the mapping is the same', () => {
		expect(microLayout('M3')).toBe(microLayout('M3', 'L'));
		expect(microLayout('M3', 'M')).not.toBe(microLayout('M3', 'L'));
		expect(microLayout('M3', 'M').roles).toBe(microLayout('M3', 'L').roles);
		expect(microLayout('M3', 'M').dataBits).not.toEqual(microLayout('M3', 'L').dataBits);
		expect(microLayout('M2', 'M')).toBe(microLayout('M2', 'L'));
		expect(microLayout('M4', 'Q')).toBe(microLayout('M4'));
		expect(microGeometry('M1')).toBe(microGeometry('M1'));
		expect(Object.isFrozen(microLayout('M1'))).toBe(true);
	});

	it('refuses an unknown version', () => {
		expect(() => microLayout('M0')).toThrow(TypeError);
		expect(() => microLayout('M3', 'H')).toThrow(TypeError);
	});
});
