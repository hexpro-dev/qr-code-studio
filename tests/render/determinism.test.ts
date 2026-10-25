import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { GOLDENS, checkGoldens, sha256Hex } from './goldens.js';
import { seeded } from './scenes.js';

describe('the golden renders', () => {
	it('hash with a SHA-256 that agrees with node:crypto', () => {
		// The FIPS 180-2 vectors, then lengths either side of every padding
		// boundary, then random bytes.
		expect(sha256Hex(new TextEncoder().encode('abc'))).toBe(
			'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
		);
		expect(sha256Hex(new Uint8Array(0))).toBe(
			'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
		);
		const random = seeded(3);
		for (const length of [1, 55, 56, 57, 63, 64, 65, 119, 120, 1000, 4097]) {
			const bytes = Uint8Array.from({ length }, () => Math.floor(random() * 256));
			expect(sha256Hex(bytes)).toBe(createHash('sha256').update(bytes).digest('hex'));
		}
	});

	it('give the same bytes twice and the committed digests', () => {
		for (const golden of GOLDENS) {
			const bytes = golden.render();
			expect(golden.render(), golden.name).toEqual(bytes);
			expect(sha256Hex(bytes), golden.name).toBe(createHash('sha256').update(bytes).digest('hex'));
		}
		expect(checkGoldens()).toEqual([]);
	});
});
