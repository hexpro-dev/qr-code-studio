import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { sha256Hex } from './goldens.js';
import { PRINT_GOLDENS, checkPrintGoldens } from './pdf-goldens.js';

describe('the golden prints', () => {
	it('give the same bytes twice and the committed digests', () => {
		for (const golden of PRINT_GOLDENS) {
			const bytes = golden.render();
			expect(golden.render(), golden.name).toEqual(bytes);
			expect(sha256Hex(bytes), golden.name).toBe(createHash('sha256').update(bytes).digest('hex'));
		}
		expect(checkPrintGoldens()).toEqual([]);
	});
});
