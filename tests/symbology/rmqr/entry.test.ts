/**
 * The rMQR symbology entry as the layers above see it.
 */

import { describe, expect, it } from 'vitest';
import { QrStudioError } from '../../../src/core/index.js';
import { RMQR } from '../../../src/symbology/rmqr/entry.js';
import { rmqrVersionsBySize } from '../../../src/symbology/rmqr/tables.js';

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

	it('stops at the codewords until the bitstream reader is merged', () => {
		const built = RMQR.build(new Uint8Array(6), 'R7x43', 'M', 'auto');
		expect(() => RMQR.read(built.matrix, { strict: true })).toThrow(QrStudioError);
		try {
			RMQR.read(built.matrix, { strict: true });
		} catch (error) {
			expect((error as QrStudioError).code).toBe('decode/unsupported');
		}
	});
});
