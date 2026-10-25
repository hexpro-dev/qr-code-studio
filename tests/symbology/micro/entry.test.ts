/**
 * The Micro QR symbology entry as the layers above see it.
 */

import { describe, expect, it } from 'vitest';
import { QrStudioError } from '../../../src/core/index.js';
import { createSymbologyRegistry } from '../../../src/symbology/registry.js';
import { createMicroQrSymbology } from '../../../src/symbology/micro/entry.js';

const MICRO_QR = createMicroQrSymbology();

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

	it('reads through to the content', () => {
		const built = MICRO_QR.build(
			Uint8Array.from([0x40, 0x18, 0xac, 0xc3, 0x00]),
			'M2',
			'L',
			'auto',
		);
		const read = MICRO_QR.read(built.matrix, { strict: true });
		expect(read.bitstream.text).toBe('01234567');
		expect(read.bitstream.segments).toEqual([{ mode: 'numeric', eci: null, length: 8 }]);
		expect([read.version, read.ecLevel, read.mask, read.mirrored]).toEqual(['M2', 'L', 1, false]);
		expect(MICRO_QR.read(built.matrix.mirrored(), { strict: false }).mirrored).toBe(true);
	});

	it('refuses a malformed bitstream at the segments stage, without trying the reflection', () => {
		// M4's mode indicators run 000 to 011; 100 is none of them.
		const data = new Uint8Array(16);
		data[0] = 0b1000_0000;
		const built = MICRO_QR.build(data, 'M4', 'L', 0);
		for (const strict of [false, true]) {
			try {
				MICRO_QR.read(built.matrix, { strict });
				expect.unreachable();
			} catch (error) {
				expect(error).toBeInstanceOf(QrStudioError);
				expect((error as QrStudioError).params.stage).toBe('segments');
			}
		}
	});

	it('takes { strict: boolean } and nothing looser', () => {
		const built = MICRO_QR.build(new Uint8Array(5), 'M2', 'L', 0);
		expect(() => MICRO_QR.read(built.matrix, {} as { strict: boolean })).toThrow(TypeError);
		expect(() => MICRO_QR.read(built.matrix, null as unknown as { strict: boolean })).toThrow(
			TypeError,
		);
	});

	it('is registered after QR', () => {
		const registry = createSymbologyRegistry();
		expect(registry.require('micro').phoneReadable).toBe(false);
		expect(registry.ids().indexOf('micro')).toBeGreaterThan(registry.ids().indexOf('qr'));
	});
});
