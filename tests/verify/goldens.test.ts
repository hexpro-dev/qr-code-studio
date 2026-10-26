import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { VERIFY_GOLDENS, checkVerifyGoldens, reportBytes } from './goldens.js';

describe('the golden scan checks', () => {
	it('give the same report twice and the committed digests', () => {
		for (const golden of VERIFY_GOLDENS) {
			const bytes = reportBytes(golden);
			expect(createHash('sha256').update(bytes).digest('hex'), golden.name).toBe(golden.sha256);
		}
		expect(checkVerifyGoldens()).toEqual([]);
	}, 120_000);
});
