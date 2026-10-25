import { createHash } from 'node:crypto';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { sha256 } from '../../src/payload/hash.js';

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex');
const ascii = (text: string) => new TextEncoder().encode(text);

describe('sha256', () => {
	it('reproduces the FIPS 180-2 vectors', () => {
		// FIPS 180-2, appendix B.1, B.2 and B.3.
		expect(hex(sha256(ascii('abc')))).toBe(
			'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
		);
		expect(hex(sha256(ascii('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')))).toBe(
			'248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
		);
		expect(hex(sha256(ascii('a'.repeat(1000000))))).toBe(
			'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0',
		);
	});

	it('hashes the empty message', () => {
		expect(hex(sha256(new Uint8Array()))).toBe(
			'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
		);
	});

	it('handles every length around a block boundary', () => {
		for (let length = 50; length <= 130; length += 1) {
			const bytes = new Uint8Array(length).fill(length);
			expect(hex(sha256(bytes)), `length ${length}`).toBe(
				createHash('sha256').update(bytes).digest('hex'),
			);
		}
	});

	it('agrees with node:crypto', () => {
		fc.assert(
			fc.property(fc.uint8Array({ maxLength: 300 }), (bytes) => {
				expect(hex(sha256(bytes))).toBe(createHash('sha256').update(bytes).digest('hex'));
			}),
		);
	});
});
