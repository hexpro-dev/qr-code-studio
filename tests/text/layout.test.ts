/**
 * Caption layout: breaking, kerning, alignment, vertical placement,
 * shrinking, missing characters and the refusals.
 *
 * Expected widths are worked out here from the font's own advances and
 * kerning, so a test fails when the layout adds them up differently, not when
 * a font table changes.
 */

import { describe, expect, it } from 'vitest';
import { QrStudioError } from '../../src/core/errors.js';
import { Registry } from '../../src/core/registry.js';
import { bounds } from '../../src/geometry/measure.js';
import { MAX_TEXT_LENGTH, layoutText, textToPaths } from '../../src/text/layout.js';
import { builtInFonts, createFontRegistry } from '../../src/text/registry.js';
import { parseTrueType } from '../../src/text/truetype.js';
import type { Font, LayoutOptions } from '../../src/text/types.js';
import { buildFont, square } from './ttf.js';

const bold = builtInFonts()[1] as Font;
const regular = builtInFonts()[0] as Font;

/** The width of `text` on one line in font units, the way the layout should add it up. */
function measure(font: Font, text: string): number {
	let width = 0;
	let previous = -1;
	for (const char of text) {
		const glyph = font.glyphIndex(char.codePointAt(0) as number);
		if (glyph === 0) continue;
		if (previous >= 0) width += font.kerning(previous, glyph);
		width += font.advance(glyph);
		previous = glyph;
	}
	return width;
}

const box = { x: 10, y: 20, width: 100, height: 30 };
const base: LayoutOptions = { fontId: 'plex-sans-bold', size: 10, box };

describe('one line', () => {
	it('kerns, centres, and sits its line box in the middle of the box', () => {
		const result = layoutText('AVATAR', base);
		const width = (measure(bold, 'AVATAR') * 10) / 1000;
		const advances = [...'AVATAR'].reduce(
			(sum, c) => sum + bold.advance(bold.glyphIndex(c.codePointAt(0) as number)),
			0,
		);
		// Plex kerns A against V and T: the kerned width is the narrower.
		expect(measure(bold, 'AVATAR')).toBeLessThan(advances);
		expect(result.lines).toHaveLength(1);
		const line = result.lines[0]!;
		expect(line.width).toBeCloseTo(width, 12);
		expect(line.x).toBeCloseTo(10 + (100 - width) / 2, 12);
		// Line box 12 tall in a box 30 tall: 9 above, then half the leading
		// (12 - 13 = -1, so -0.5) and the ascender (10.25).
		expect(line.baseline).toBeCloseTo(20 + 9 - 0.5 + 10.25, 12);
		expect([line.text, line.start, line.end]).toEqual(['AVATAR', 0, 6]);
		expect(result.overflow).toBe(false);
		expect(result.size).toBe(10);
		expect(result.missing).toEqual([]);
	});

	it('aligns to the start and the end', () => {
		const width = (measure(bold, 'Menu') * 10) / 1000;
		expect(layoutText('Menu', { ...base, align: 'start' }).lines[0]!.x).toBe(10);
		expect(layoutText('Menu', { ...base, align: 'end' }).lines[0]!.x).toBeCloseTo(110 - width, 12);
	});

	it('draws in box units, y down, glyph by glyph along the pen', () => {
		const result = layoutText('H', { ...base, align: 'start' });
		const shape = bounds(result.paths[0]!)!;
		const glyph = bold.outline(bold.glyphIndex(0x48));
		let top = -Infinity;
		let left = Infinity;
		for (let i = 0; i < glyph.onCurve.length; i += 1) {
			top = Math.max(top, glyph.points[i * 2 + 1] as number);
			left = Math.min(left, glyph.points[i * 2] as number);
		}
		const { baseline } = result.lines[0]!;
		expect(shape.y).toBeCloseTo(baseline - top / 100, 9);
		expect(shape.y + shape.height).toBeCloseTo(baseline, 9);
		expect(shape.x).toBeCloseTo(10 + left / 100, 9);
	});

	it('keeps runs of spaces inside a line and drops them at its ends', () => {
		const result = layoutText('  a   b  ', { ...base, align: 'start' });
		expect(result.lines[0]!.text).toBe('a   b');
		expect(result.lines[0]!.width).toBeCloseTo((measure(bold, 'a   b') * 10) / 1000, 12);
	});

	it('lays out nothing for empty text', () => {
		const result = layoutText('', base);
		expect(result.lines).toEqual([]);
		expect(result.paths).toEqual([]);
		expect(result.overflow).toBe(false);
	});

	it('gives the same paths twice', () => {
		const a = layoutText('Scan for the menu', { ...base, maxLines: 2 });
		const b = layoutText('Scan for the menu', { ...base, maxLines: 2 });
		expect(a.paths.map((p) => Array.from(p.points))).toEqual(
			b.paths.map((p) => Array.from(p.points)),
		);
	});
});

describe('several lines', () => {
	it('breaks greedily at spaces and stacks the lines about the middle', () => {
		const text = 'Scan this code to see the menu';
		const result = layoutText(text, {
			...base,
			maxLines: 3,
			box: { ...box, width: 75, height: 40 },
		});
		expect(result.lines.map((line) => line.text)).toEqual(['Scan this code', 'to see the menu']);
		for (const line of result.lines) {
			expect(text.slice(line.start, line.end)).toBe(line.text);
			expect(line.width).toBeLessThanOrEqual(75);
			expect(line.width).toBeCloseTo((measure(bold, line.text) * 10) / 1000, 12);
		}
		// The first line is the greedy one: the next word would not have fitted.
		expect((measure(bold, 'Scan this code to') * 10) / 1000).toBeGreaterThan(75);
		const [first, second] = result.lines;
		expect(second!.baseline - first!.baseline).toBeCloseTo(12, 12);
		expect(first!.baseline).toBeCloseTo(20 + (40 - 24) / 2 - 0.5 + 10.25, 12);
		expect(result.paths).toHaveLength(2);
		expect(result.overflow).toBe(false);
	});

	it('breaks at line feeds, keeps empty lines, and ignores carriage returns', () => {
		const result = layoutText('one\r\n\ntwo', {
			...base,
			maxLines: 3,
			box: { ...box, height: 40 },
		});
		expect(result.lines.map((line) => [line.text, line.start, line.end])).toEqual([
			['one', 0, 3],
			['', 5, 5],
			['two', 6, 9],
		]);
		expect(result.lines[1]!.width).toBe(0);
		expect(result.paths[1]!.commands.length).toBe(0);
	});

	it('treats a line of spaces as an empty line', () => {
		expect(layoutText('   ', base).lines.map((line) => line.text)).toEqual(['']);
	});

	it('keeps words joined by a no-break space together', () => {
		const result = layoutText('see the\u00a0menu', {
			...base,
			maxLines: 2,
			box: { ...box, width: 50 },
		});
		expect(result.lines.map((line) => line.text)).toEqual(['see', 'the\u00a0menu']);
	});

	it('cuts to maxLines and says it overflowed', () => {
		const result = layoutText('one two three', {
			...base,
			box: { ...box, width: 25 },
			maxLines: 2,
		});
		expect(result.lines.map((line) => line.text)).toEqual(['one', 'two']);
		expect(result.overflow).toBe(true);
	});

	it('overflows on a word wider than the box, and on lines taller than it', () => {
		expect(layoutText('Supercalifragilisticexpialidocious', base).overflow).toBe(true);
		expect(
			layoutText('one\ntwo\nthree', { ...base, maxLines: 3, box: { ...box, height: 30 } }).overflow,
		).toBe(true);
	});
});

describe('shrinking to fit', () => {
	const tight = { ...base, box: { x: 0, y: 0, width: 60, height: 14 } };

	it('finds the largest size that fits, between the floor and the size asked for', () => {
		const result = layoutText('Scan me for the menu', { ...tight, shrinkToFit: true, maxLines: 1 });
		expect(result.overflow).toBe(false);
		expect(result.size).toBeLessThan(10);
		expect(result.size).toBeGreaterThanOrEqual(5);
		expect(result.lines[0]!.width).toBeLessThanOrEqual(60);
		// Within the search's precision of not fitting.
		const larger = layoutText('Scan me for the menu', { ...tight, size: result.size + 1e-5 });
		expect(larger.overflow).toBe(true);
	});

	it('uses the size asked for when it fits', () => {
		expect(layoutText('Menu', { ...tight, shrinkToFit: true }).size).toBe(10);
	});

	it('wraps onto more lines as it shrinks when it may', () => {
		const result = layoutText('Scan me for the menu', {
			...base,
			box: { x: 0, y: 0, width: 60, height: 30 },
			shrinkToFit: true,
			maxLines: 2,
		});
		expect(result.lines).toHaveLength(2);
		expect(result.overflow).toBe(false);
	});

	it('stops at the floor and overflows when even that does not fit', () => {
		const result = layoutText('Supercalifragilisticexpialidocious', {
			...tight,
			shrinkToFit: true,
			minSize: 8,
		});
		expect(result.size).toBe(8);
		expect(result.overflow).toBe(true);
	});
});

describe('characters the font cannot draw', () => {
	it('reports each missing code point once, in order, and gives it no room', () => {
		const result = layoutText('A\u{1f600}B中\u{1f600}', { ...base, align: 'start' });
		expect(result.missing).toEqual([0x1f600, 0x4e2d]);
		expect(result.lines[0]!.text).toBe('A\u{1f600}B中\u{1f600}');
		expect(result.lines[0]!.width).toBeCloseTo((measure(bold, 'AB') * 10) / 1000, 12);
	});

	it('knows Greek and Cyrillic are in Bold and not in Regular', () => {
		expect(layoutText('Ωμέγα Жук', base).missing).toEqual([]);
		const inRegular = layoutText('Ωμέγα Жук', { ...base, fontId: 'plex-sans-regular' });
		expect(inRegular.missing).toHaveLength(8);
		expect(regular.glyphIndex(0x3a9)).toBe(0);
	});

	it('composes a typed accent with its letter first', () => {
		const result = layoutText('Cafe\u0301', base);
		expect(result.missing).toEqual([]);
		expect(result.lines[0]!.text).toBe('Café');
	});

	it('refuses to draw text with pieces missing through textToPaths', () => {
		expect(textToPaths('Menu', base)).toHaveLength(1);
		try {
			textToPaths('Menu \u{1f600}中', base);
			throw new Error('expected a refusal');
		} catch (error) {
			expect(error).toBeInstanceOf(QrStudioError);
			expect((error as QrStudioError).code).toBe('font/missing-glyphs');
			expect((error as QrStudioError).params).toEqual({ count: 2 });
			expect((error as QrStudioError).message).not.toContain('Menu');
		}
	});
});

describe('fonts', () => {
	it('uses the registry it is given, and the built-in family when given none', () => {
		const glyphs = [{ contours: [square(0, 0, 500)] }, { contours: [square(0, 0, 500)] }];
		const custom = parseTrueType(buildFont({ glyphs, advances: [500, 700] }), { id: 'blocks' });
		const fonts = createFontRegistry();
		fonts.register(custom);
		const result = layoutText('AA', { ...base, fonts, fontId: 'blocks', align: 'start' });
		expect(result.lines[0]!.width).toBeCloseTo(14, 12);
		expect(() => layoutText('AA', { ...base, fontId: 'blocks' })).toThrow(QrStudioError);
		expect(() => layoutText('A', { ...base, fonts: new Registry<Font>('font') })).toThrow(
			/does not include/,
		);
	});

	it('makes a fresh registry each time, sharing the built-in fonts', () => {
		const a = createFontRegistry();
		const b = createFontRegistry();
		expect(a).not.toBe(b);
		expect(a.ids()).toEqual(['plex-sans-regular', 'plex-sans-bold']);
		expect(a.get('plex-sans-bold')).toBe(b.get('plex-sans-bold'));
		expect(a.get('plex-sans-bold')!.labelKey).toBe('text.font.plex-sans-bold');
	});
});

describe('options', () => {
	it('refuses arguments of the wrong kind with a TypeError', () => {
		const bad: [unknown, unknown][] = [
			[3, base],
			['x'.repeat(MAX_TEXT_LENGTH + 1), base],
			['a', null],
			['a', { ...base, fontId: 3 }],
			['a', { ...base, size: 0 }],
			['a', { ...base, size: Number.NaN }],
			['a', { ...base, box: null }],
			['a', { ...base, box: { ...box, x: Infinity } }],
			['a', { ...base, box: { ...box, y: '1' } }],
			['a', { ...base, box: { ...box, width: -1 } }],
			['a', { ...base, box: { ...box, height: -1 } }],
			['a', { ...base, align: 'left' }],
			['a', { ...base, maxLines: 0 }],
			['a', { ...base, maxLines: 1.5 }],
			['a', { ...base, lineHeight: 0 }],
			['a', { ...base, shrinkToFit: 'yes' }],
			['a', { ...base, minSize: -1 }],
			['a', { ...base, minSize: 11 }],
		];
		for (const [text, options] of bad) {
			expect(() => layoutText(text as string, options as LayoutOptions)).toThrow(TypeError);
		}
		expect(
			layoutText('x '.repeat(MAX_TEXT_LENGTH / 2), { ...base, maxLines: 1000 }).lines.length,
		).toBeGreaterThan(1);
	});
});
