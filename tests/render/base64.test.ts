import { describe, expect, it } from 'vitest';
import { base64 } from '../../src/render/base64.js';
import { seeded } from './scenes.js';

describe('base64', () => {
	it('matches Node for every length around the padding, and for a long input', () => {
		const random = seeded(4);
		for (const length of [0, 1, 2, 3, 4, 5, 6, 7, 100, 6143, 6144, 6145, 20000]) {
			const bytes = Uint8Array.from({ length }, () => Math.floor(random() * 256));
			expect(base64(bytes)).toBe(Buffer.from(bytes).toString('base64'));
		}
	});

	it('gives the RFC 4648 test vectors', () => {
		const encode = (text: string): string => base64(new TextEncoder().encode(text));
		expect(['', 'f', 'fo', 'foo', 'foob', 'fooba', 'foobar'].map(encode)).toEqual([
			'',
			'Zg==',
			'Zm8=',
			'Zm9v',
			'Zm9vYg==',
			'Zm9vYmE=',
			'Zm9vYmFy',
		]);
	});
});
