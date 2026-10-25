/**
 * The Micro QR symbology entry as the layers above see it.
 */

import { describe, expect, it } from 'vitest';
import { QrStudioError } from '../../../src/core/index.js';
import { MICRO_QR } from '../../../src/symbology/micro/entry.js';

describe('the Micro QR entry', () => {
	it('describes itself as the contract asks', () => {
		expect(MICRO_QR.id).toBe('micro');
		expect(MICRO_QR.quietZone).toBe(2);
		expect(MICRO_QR.phoneReadable).toBe(false);
		expect(MICRO_QR.versions).toEqual(['M1', 'M2', 'M3', 'M4']);
		expect(MICRO_QR.versions.map((version) => MICRO_QR.ecLevels(version))).toEqual([
			['L'],
			['L', 'M'],
			['L', 'M'],
			['L', 'M', 'Q'],
		]);
		expect(MICRO_QR.versions.map((version) => MICRO_QR.size(version))).toEqual([
			{ width: 11, height: 11 },
			{ width: 13, height: 13 },
			{ width: 15, height: 15 },
			{ width: 17, height: 17 },
		]);
		expect(MICRO_QR.masks('M2')).toEqual([0, 1, 2, 3]);
		expect(MICRO_QR.profile('M4').modeIndicatorBits).toBe(3);
		expect(MICRO_QR.blocks('M3', 'M').dataBits).toBe(68);
		expect(MICRO_QR.layout('M1')).toBe(MICRO_QR.layout('M1'));
		expect(Object.isFrozen(MICRO_QR)).toBe(true);
	});

	it('refuses versions it does not have', () => {
		expect(() => MICRO_QR.ecLevels('M5')).toThrow(TypeError);
		expect(() => MICRO_QR.size('R7x43')).toThrow(TypeError);
		expect(() => MICRO_QR.masks('1')).toThrow(TypeError);
	});

	it('builds through the entry', () => {
		const built = MICRO_QR.build(
			Uint8Array.from([0x40, 0x18, 0xac, 0xc3, 0x00]),
			'M2',
			'L',
			'auto',
		);
		expect([built.symbology, built.version, built.ecLevel, built.mask]).toEqual([
			'micro',
			'M2',
			'L',
			1,
		]);
	});

	it('stops at the codewords until the bitstream reader is merged', () => {
		const built = MICRO_QR.build(
			Uint8Array.from([0x40, 0x18, 0xac, 0xc3, 0x00]),
			'M2',
			'L',
			'auto',
		);
		try {
			MICRO_QR.read(built.matrix, { strict: true });
			expect.unreachable();
		} catch (error) {
			expect(error).toBeInstanceOf(QrStudioError);
			expect((error as QrStudioError).code).toBe('decode/unsupported');
		}
	});
});
