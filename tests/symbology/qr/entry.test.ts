/**
 * QR as a registry entry: the contract every symbology meets, as QR meets it.
 */

import { describe, expect, it } from 'vitest';
import { Registry } from '../../../src/core/registry.js';
import { qrProfile } from '../../../src/segment/profile.js';
import { createQrSymbology } from '../../../src/symbology/qr/entry.js';
import { createSymbologyRegistry } from '../../../src/symbology/registry.js';
import { ROLES, ROLE_CODES } from '../../../src/symbology/roles.js';
import type { SymbologyEntry } from '../../../src/symbology/types.js';

describe('the symbology registry', () => {
	it('holds QR, a fresh instance each time, and takes more entries', () => {
		const registry = createSymbologyRegistry();
		expect(registry.ids()).toEqual(['qr']);
		expect(createSymbologyRegistry()).not.toBe(registry);
		const extra: SymbologyEntry = { ...createQrSymbology(), id: 'test-symbology' };
		registry.register(extra);
		expect(registry.ids()).toEqual(['qr', 'test-symbology']);
		expect(createSymbologyRegistry().has('test-symbology')).toBe(false);
		expect(registry).toBeInstanceOf(Registry);
	});

	it('numbers the roles once, data first', () => {
		expect(ROLE_CODES.data).toBe(0);
		expect(ROLES).toEqual([
			'data',
			'finder',
			'separator',
			'timing',
			'alignment',
			'format',
			'version',
			'dark-module',
			'sub-finder',
			'corner-finder',
		]);
		expect(Object.isFrozen(ROLE_CODES)).toBe(true);
	});
});

describe('the QR entry', () => {
	const qr = createQrSymbology();

	it('describes QR Model 2', () => {
		expect(qr).toMatchObject({
			id: 'qr',
			labelKey: 'symbology.qr.label',
			quietZone: 4,
			phoneReadable: true,
		});
		expect(qr.versions).toEqual(Array.from({ length: 40 }, (_, i) => String(i + 1)));
		expect(qr.ecLevels('7')).toEqual(['L', 'M', 'Q', 'H']);
		expect(qr.size('1')).toEqual({ width: 21, height: 21 });
		expect(qr.size('40')).toEqual({ width: 177, height: 177 });
		expect(qr.profile('9')).toBe(qrProfile(9));
		expect(qr.masks('3')).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
		expect(qr.layout('12')).toBe(qr.layout('12'));
		expect(qr.blocks('5', 'Q').blocks).toHaveLength(4);
	});

	it('builds and reads through version strings', () => {
		// An empty bitstream: the terminator, then pad codewords.
		const data = new Uint8Array(qr.blocks('2', 'H').dataBits / 8).fill(0xec);
		data[0] = 0;
		const symbol = qr.build(data, '2', 'H', 'auto');
		expect(symbol).toMatchObject({ symbology: 'qr', version: '2', ecLevel: 'H' });
		expect(symbol.layout).toBe(qr.layout('2'));
		expect(symbol.codewords).toHaveLength(44);
		const read = qr.read(symbol.matrix, { strict: true });
		expect(read).toMatchObject({ version: '2', ecLevel: 'H', mask: symbol.mask });
		expect(read.bitstream.text).toBe('');
	});

	it('refuses version strings and levels that are not QR', () => {
		for (const version of ['0', '41', '01', 'M1', ' 1', '']) {
			expect(() => qr.size(version), version).toThrow(TypeError);
			expect(() => qr.ecLevels(version)).toThrow(TypeError);
			expect(() => qr.masks(version)).toThrow(TypeError);
		}
		expect(() => qr.blocks('1', 'X' as 'L')).toThrow(TypeError);
		expect(() => qr.build(new Uint8Array(19), '1', 'L', -1)).toThrow(TypeError);
	});
});
