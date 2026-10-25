/**
 * The rMQR symbology entry as the layers above see it.
 */

import { describe, expect, it } from 'vitest';
import { QrStudioError } from '../../../src/core/index.js';
import { createSymbologyRegistry } from '../../../src/symbology/registry.js';
import { createRmqrSymbology } from '../../../src/symbology/rmqr/entry.js';
import { rmqrVersionsBySize } from '../../../src/symbology/rmqr/tables.js';

const RMQR = createRmqrSymbology();

describe('the rMQR entry', () => {
	it('describes itself as the contract asks', () => {
		expect(RMQR.id).toBe('rmqr');
		expect(RMQR.quietZone).toBe(2);
		expect(RMQR.phoneReadable).toBe(false);
		expect(RMQR.versions).toBe(rmqrVersionsBySize());
		expect(RMQR.versions).toHaveLength(32);
		expect(RMQR.ecLevels('R7x43')).toEqual(['M', 'H']);
		expect(RMQR.size('R13x99')).toEqual({ width: 99, height: 13 });
		expect(RMQR.masks('R17x139')).toEqual([0]);
		expect(RMQR.profile('R7x43').charCountBits('numeric')).toBe(4);
		expect(RMQR.blocks('R7x43', 'H').dataBits).toBe(24);
		expect(RMQR.layout('R9x99')).toBe(RMQR.layout('R9x99'));
		expect(Object.isFrozen(RMQR)).toBe(true);
	});

	it('refuses versions it does not have', () => {
		expect(() => RMQR.ecLevels('M1')).toThrow(TypeError);
		expect(() => RMQR.size('R7x27')).toThrow(TypeError);
		expect(() => RMQR.masks('R19x43')).toThrow(TypeError);
	});

	it('reads through to the content', () => {
		// 2468 in numeric mode: 001, count 0100 (4 bits in R7x43), 0011110110 for
		// 246 and 1000 for 8, terminator 000, then the pad codewords.
		const data = Uint8Array.from([0x28, 0x7b, 0x40, 0xec, 0x11, 0xec]);
		const built = RMQR.build(data, 'R7x43', 'M', 'auto');
		const read = RMQR.read(built.matrix, { strict: true });
		expect(read.bitstream.text).toBe('2468');
		expect([read.version, read.ecLevel, read.mask]).toEqual(['R7x43', 'M', 0]);
		expect(RMQR.read(built.matrix.mirrored(), { strict: false }).mirrored).toBe(true);
	});

	it('refuses a malformed bitstream at the segments stage', () => {
		// Mode indicator 011 (byte) with a count far past the data.
		const data = Uint8Array.from([0b0111_1100, 0, 0, 0, 0, 0]);
		const built = RMQR.build(data, 'R7x43', 'M', 0);
		try {
			RMQR.read(built.matrix, { strict: false });
			expect.unreachable();
		} catch (error) {
			expect(error).toBeInstanceOf(QrStudioError);
			expect((error as QrStudioError).params.stage).toBe('segments');
		}
	});

	it('takes { strict: boolean } and nothing looser', () => {
		const built = RMQR.build(new Uint8Array(6), 'R7x43', 'M', 0);
		expect(() => RMQR.read(built.matrix, { strict: 'yes' } as never)).toThrow(TypeError);
	});

	it('is registered after Micro QR', () => {
		expect(createSymbologyRegistry().ids()).toEqual(['qr', 'micro', 'rmqr']);
	});
});
