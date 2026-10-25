import { describe, expect, it } from 'vitest';
import { checkColour, formatColour, parseColour } from '../../src/render/colour.js';
import type { Colour } from '../../src/render/types.js';

describe('parseColour', () => {
	it('reads the four hex forms, in either case', () => {
		expect(parseColour('#0b76d9')).toEqual({ r: 11, g: 118, b: 217, a: 1 });
		expect(parseColour('#0B76D9')).toEqual({ r: 11, g: 118, b: 217, a: 1 });
		expect(parseColour('#fa0')).toEqual({ r: 255, g: 170, b: 0, a: 1 });
		expect(parseColour('#fa08')).toEqual({ r: 255, g: 170, b: 0, a: 136 / 255 });
		expect(parseColour('#00000080')).toEqual({ r: 0, g: 0, b: 0, a: 128 / 255 });
	});

	it('refuses everything else with a TypeError that does not repeat the value', () => {
		const refused = [
			'black',
			'rgb(0, 0, 0)',
			'#12',
			'#12345',
			'#1234567',
			'#123456789',
			'#ggg',
			' #000',
			'#000 ',
			'url(#a)',
			'var(--x)',
			'',
			'#000000\n',
		];
		for (const text of refused) {
			expect(() => parseColour(text)).toThrow(TypeError);
			try {
				parseColour(text);
			} catch (error) {
				if (text.length > 0) expect((error as Error).message).not.toContain(text.trim());
			}
		}
		expect(() => parseColour(0 as unknown as string)).toThrow(TypeError);
		expect(() => parseColour(null as unknown as string)).toThrow(TypeError);
	});
});

describe('formatColour', () => {
	it('writes six digits for an opaque colour and eight otherwise', () => {
		expect(formatColour({ r: 11, g: 118, b: 217, a: 1 })).toBe('#0b76d9');
		expect(formatColour({ r: 0, g: 0, b: 0, a: 0.5 })).toBe('#00000080');
		expect(formatColour({ r: 255, g: 255, b: 255, a: 0 })).toBe('#ffffff00');
	});

	it('gives back exactly the eight digits it was parsed from, for every alpha', () => {
		for (let alpha = 0; alpha < 256; alpha += 1) {
			const text = `#12abef${alpha.toString(16).padStart(2, '0')}`;
			const expected = alpha === 255 ? '#12abef' : text;
			expect(formatColour(parseColour(text))).toBe(expected);
		}
	});
});

describe('checkColour', () => {
	it('accepts whole channels and an alpha from 0 to 1, with or without a print value', () => {
		expect(() => checkColour({ r: 0, g: 255, b: 7, a: 0 }, 'test')).not.toThrow();
		expect(() => checkColour({ r: 0, g: 0, b: 0, a: 1, cmyk: [0, 0, 0, 1] }, 'test')).not.toThrow();
	});

	it('refuses what a hex colour cannot say', () => {
		const refused: unknown[] = [
			null,
			'#000',
			{ r: 0.5, g: 0, b: 0, a: 1 },
			{ r: -1, g: 0, b: 0, a: 1 },
			{ r: 0, g: 256, b: 0, a: 1 },
			{ r: 0, g: 0, b: Number.NaN, a: 1 },
			{ r: 0, g: 0, b: '0', a: 1 },
			{ r: 0, g: 0, b: 0, a: 1.5 },
			{ r: 0, g: 0, b: 0, a: -0.1 },
			{ r: 0, g: 0, b: 0, a: Number.NaN },
			{ r: 0, g: 0, b: 0 },
		];
		for (const colour of refused) {
			expect(() => checkColour(colour as Colour, 'test')).toThrow(TypeError);
			expect(() => formatColour(colour as Colour)).toThrow(TypeError);
		}
	});
});
