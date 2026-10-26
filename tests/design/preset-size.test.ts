import { describe, expect, it } from 'vitest';
import { presetSizeMm } from '../../src/design/preset-size.js';
import { createDesignRegistries } from '../../src/design/registries.js';
import type { Preset } from '../../src/design/types.js';

const classic = createDesignRegistries().presets.require('classic-black');

describe('presetSizeMm', () => {
	it('gives the size for the level asked for, and minSizeMm for the own level or one not given', () => {
		const preset: Preset = { ...classic, minSizeMm: 25, sizesMm: { M: 25, H: 31 } };
		expect(presetSizeMm(preset)).toBe(25);
		expect(presetSizeMm(preset, 'H')).toBe(31);
		expect(presetSizeMm(preset, 'Q')).toBe(25);
		expect(presetSizeMm({ ...preset, sizesMm: undefined }, 'H')).toBe(25);
	});
});
