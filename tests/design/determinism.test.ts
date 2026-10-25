import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { DESIGN_GOLDENS, checkDesignGoldens } from './goldens.js';

describe('the golden designs', () => {
	it('give the same bytes twice and the committed digests', () => {
		for (const golden of DESIGN_GOLDENS) {
			const bytes = golden.render();
			expect(golden.render(), golden.name).toEqual(bytes);
			expect(createHash('sha256').update(bytes).digest('hex'), golden.name).toBe(golden.sha256);
		}
		expect(checkDesignGoldens()).toEqual([]);
	});
});
