/**
 * rMQR's layout: roles, the overlaps in the shortest symbols, the regions a
 * design may restyle, the two format copies, and the placement order.
 */

import { describe, expect, it } from 'vitest';
import { ROLE_CODES } from '../../../src/symbology/roles.js';
import type { ModuleRole, SymbolLayout } from '../../../src/symbology/types.js';
import {
	rmqrFormatModulesNearFinder,
	rmqrFormatModulesNearSubFinder,
	rmqrGeometry,
	rmqrLayout,
} from '../../../src/symbology/rmqr/layout.js';
import { rmqrSpecs } from '../../../src/symbology/rmqr/tables.js';

function roleAt(layout: SymbolLayout, x: number, y: number): ModuleRole {
	const code = layout.roles[y * layout.width + x];
	return (Object.keys(ROLE_CODES) as ModuleRole[]).find((role) => ROLE_CODES[role] === code)!;
}

function count(layout: SymbolLayout, role: ModuleRole): number {
	return layout.roles.filter((code) => code === ROLE_CODES[role]).length;
}

describe('rMQR layout', () => {
	it('has a finder, a sub-pattern, two format copies and no QR-only roles in every size', () => {
		for (const spec of rmqrSpecs()) {
			const layout = rmqrLayout(spec.version);
			expect([layout.width, layout.height]).toEqual([spec.width, spec.height]);
			expect(count(layout, 'finder')).toBe(49);
			expect(count(layout, 'sub-finder')).toBe(25);
			expect(count(layout, 'format')).toBe(36);
			expect(count(layout, 'alignment')).toBe(18 * spec.alignmentColumns.length);
			for (const absent of ['version', 'dark-module'] as const)
				expect(count(layout, absent)).toBe(0);
		}
	});

	it('resolves the overlaps of the shortest symbols the way BWIPP and zint do', () => {
		const r7 = rmqrLayout('R7x43');
		// The finder fills the left end: no bottom left corner pattern at all.
		expect(roleAt(r7, 0, 6)).toBe('finder');
		expect(count(r7, 'corner-finder')).toBe(5);
		// The top right corner's last module is the sub-pattern's.
		expect(roleAt(r7, 42, 2)).toBe('sub-finder');
		expect(roleAt(r7, 41, 1)).toBe('corner-finder');
		const r9 = rmqrLayout('R9x43');
		// The separator crosses the bottom left corner, leaving its bottom row.
		expect([roleAt(r9, 0, 8), roleAt(r9, 1, 8), roleAt(r9, 2, 8)]).toEqual([
			'corner-finder',
			'corner-finder',
			'corner-finder',
		]);
		expect([roleAt(r9, 0, 7), roleAt(r9, 1, 7)]).toEqual(['separator', 'separator']);
		expect(count(rmqrLayout('R11x27'), 'corner-finder')).toBe(12);
	});

	it('offers the finder, the sub-pattern and each whole corner L as regions', () => {
		expect(rmqrLayout('R7x59').regions).toEqual([
			{ role: 'finder', kind: 'concentric-7', x: 0, y: 0, width: 7, height: 7, rotation: 0 },
			{ role: 'sub-finder', kind: 'concentric-5', x: 54, y: 2, width: 5, height: 5, rotation: 0 },
			{ role: 'corner-finder', kind: 'corner-l', x: 56, y: 0, width: 3, height: 3, rotation: 90 },
		]);
		expect(rmqrLayout('R9x59').regions).toHaveLength(3);
		expect(rmqrLayout('R13x99').regions.at(-1)).toEqual({
			role: 'corner-finder',
			kind: 'corner-l',
			x: 0,
			y: 10,
			width: 3,
			height: 3,
			rotation: 270,
		});
	});

	it('draws each corner L as its rotation says', () => {
		// In its own frame: corner at the top left, arms right and down, the
		// module inside the bend light.
		const canonical = ['111', '10.', '1..'];
		const rotate = (rows: string[]): string[] =>
			rows[0]!.split('').map((_, x) =>
				rows
					.map((row) => row[x])
					.reverse()
					.join(''),
			);
		const { template } = rmqrGeometry('R13x43');
		const layout = rmqrLayout('R13x43');
		for (const region of layout.regions.filter((r) => r.kind === 'corner-l')) {
			let expected = canonical;
			for (let turn = 0; turn < region.rotation; turn += 90) expected = rotate(expected);
			const drawn = Array.from({ length: 3 }, (_, dy) =>
				Array.from({ length: 3 }, (_, dx) => {
					const x = region.x + dx;
					const y = region.y + dy;
					return roleAt(layout, x, y) === 'corner-finder' ? String(template.get(x, y)) : '.';
				}).join(''),
			);
			expect(drawn).toEqual(expected);
		}
	});

	it('puts the format copies where BWIPP does, most significant bit first', () => {
		// barcode.ps qrcode.formatfimmap, rmqr: the first copy as (x, y), bit 17 down to 0.
		expect(rmqrFormatModulesNearFinder()).toEqual([
			[11, 3],
			[11, 2],
			[11, 1],
			[10, 5],
			[10, 4],
			[10, 3],
			[10, 2],
			[10, 1],
			[9, 5],
			[9, 4],
			[9, 3],
			[9, 2],
			[9, 1],
			[8, 5],
			[8, 4],
			[8, 3],
			[8, 2],
			[8, 1],
		]);
		const second = rmqrFormatModulesNearSubFinder(43, 7);
		expect(second.slice(0, 4)).toEqual([
			[40, 1],
			[39, 1],
			[38, 1],
			[37, 5],
		]);
		expect(second.at(-1)).toEqual([35, 1]);
	});

	it('runs timing along the edges and down each alignment column', () => {
		const { template } = rmqrGeometry('R11x59');
		const layout = rmqrLayout('R11x59');
		for (const column of [19, 39]) {
			expect(roleAt(layout, column, 1)).toBe('alignment');
			expect(template.get(column, 1)).toBe(0);
			for (let y = 3; y <= 7; y += 1) {
				expect(roleAt(layout, column, y)).toBe('timing');
				expect(template.get(column, y)).toBe(y % 2 === 0 ? 1 : 0);
			}
		}
		for (let x = 12; x < 18; x += 1) {
			expect(template.get(x, 0)).toBe(x % 2 === 0 ? 1 : 0);
			expect(template.get(x, 10)).toBe(x % 2 === 0 ? 1 : 0);
		}
		expect(roleAt(layout, 58, 5)).toBe('timing');
		// In R11 the finder and separator cover the left edge's timing; in R15
		// some of it shows between the separator and the corner pattern.
		expect(roleAt(layout, 0, 7)).toBe('separator');
		expect(roleAt(rmqrLayout('R15x43'), 0, 9)).toBe('timing');
	});

	it('starts placement one column in from the right edge, at the bottom', () => {
		const layout = rmqrLayout('R7x43');
		const at = (x: number, y: number): number => layout.dataBits[y * 43 + x]!;
		for (let y = 0; y < 7; y += 1) expect(roleAt(layout, 42, y)).not.toBe('data');
		expect(at(41, 6)).toBe(-1); // the sub-pattern's bottom row
		// The first three column pairs are all patterns and format; the fourth
		// runs downwards, and its first data module takes codeword 0's top bit.
		expect(layout.dataBits.indexOf(7)).toBe(1 * 43 + 34);
		expect(at(35, 1)).toBe(-1);
		expect(layout.dataBits.filter((bit) => bit >= 0).length).toBe(13 * 8);
	});

	it('caches one layout per version, shared by both levels', () => {
		expect(rmqrLayout('R15x77')).toBe(rmqrLayout('R15x77'));
		expect(rmqrGeometry('R15x77')).toBe(rmqrGeometry('R15x77'));
		expect(Object.isFrozen(rmqrLayout('R15x77'))).toBe(true);
		expect(() => rmqrLayout('R8x43')).toThrow(TypeError);
	});
});
