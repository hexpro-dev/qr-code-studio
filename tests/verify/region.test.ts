/**
 * The reader conformance's capture rule takes: a pair put in a whole code
 * among one family's modules and read from the scan check's captures. The
 * shipped table is held to it in tests/conformance/captures-*.test.ts.
 */

import { describe, expect, it } from 'vitest';
import { createDesignRegistries } from '../../src/design/registries.js';
import { regionCaptureReader } from '../../src/verify/region.js';

const registries = createDesignRegistries();

describe('regionCaptureReader', () => {
	const read = regionCaptureReader({ seeds: 2, densities: [6], contents: ['small'] });

	it('reads a plain finder among dots in every capture', () => {
		expect(read({ id: 'dot' }, { id: 'square' }, { id: 'square-centre' }, registries)).toEqual({
			captures: 4,
			missed: [],
			missedCount: 0,
		});
	});

	it('says where a styled finder among dots is missed', () => {
		const result = read({ id: 'dot' }, { id: 'octagon' }, { id: 'flower-centre' }, registries);
		expect(result.missed).toEqual(['small link at 6 px, baseline: 1 of 2']);
		expect(result.missedCount).toBe(1);
	});

	it('reads a short and a long link at 6, 8 and 10 pixels a module, clean and inked, eight seeds each, by default', () => {
		const full = regionCaptureReader()(
			{ id: 'square' },
			{ id: 'square' },
			{ id: 'square-centre' },
			registries,
		);
		expect(full.captures).toBe(2 * 3 * 2 * 8);
		expect(full.missed).toEqual([]);
	});
});
