/**
 * The compiled table loader, on tables written here by hand.
 *
 * The built-in tables are checked against their sources in
 * `opentype.test.ts`. These are the loader's own promises: it decodes
 * nothing until asked, it reads composites, kerning classes and the character
 * map as `src/text/compiled.ts` describes them, and a damaged table of any
 * kind is a `FontMalformedError` rather than a wrong glyph.
 */

import { describe, expect, it } from 'vitest';
import { deflateRaw } from '../../src/core/deflate.js';
import { decodeBase64 } from '../../src/text/base64.js';
import { COMPILED_VERSION, loadCompiledFont } from '../../src/text/compiled.js';
import type { CompiledFontData } from '../../src/text/compiled.js';
import { FontMalformedError } from '../../src/text/errors.js';

class Writer {
	readonly bytes: number[] = [];
	u(value: number): this {
		let rest = value;
		while (rest >= 0x80) {
			this.bytes.push((rest % 0x80) | 0x80);
			rest = Math.floor(rest / 0x80);
		}
		this.bytes.push(rest);
		return this;
	}
	s(value: number): this {
		return this.u(value >= 0 ? value * 2 : -value * 2 - 1);
	}
	raw(...bytes: number[]): this {
		this.bytes.push(...bytes);
		return this;
	}
}

function data(bytes: number[], overrides: Partial<CompiledFontData> = {}): CompiledFontData {
	const raw = Uint8Array.from(bytes);
	return {
		id: 'hand-made',
		labelKey: 'text.font.registered',
		unitsPerEm: 1000,
		ascender: 800,
		descender: -200,
		lineGap: 0,
		glyphCount: 4,
		length: raw.length,
		data: Buffer.from(deflateRaw(raw)).toString('base64'),
		...overrides,
	};
}

interface Parts {
	version?: number;
	count?: number;
	cmap?: (w: Writer) => void;
	glyphs?: (w: Writer) => void;
	kerning?: (w: Writer) => void;
	trailing?: number[];
}

/**
 * Four glyphs: notdef (empty), a triangle, a composite of two triangles, and
 * a composite of the composite. 'A' maps to 1, 'B' to 2, 'C' to 3. Kerning:
 * glyph 1 against glyph 2 is -40, everything else 0.
 */
function table(parts: Parts = {}): number[] {
	const w = new Writer();
	w.u(parts.version ?? COMPILED_VERSION).u(parts.count ?? 4);
	if (parts.cmap) parts.cmap(w);
	else w.u(3).u(0x41).s(1).u(0).s(0).u(0).s(0);
	w.u(500).u(600).u(700).u(800);
	if (parts.glyphs) parts.glyphs(w);
	else {
		w.u(0);
		// One contour of three points: (0,0) on, (50,100) off, (100,0) on.
		w.u(2).u(3);
		w.u(0 * 2 + 1).s(0);
		w.u(100 * 2 + 0).s(100);
		w.u(100 * 2 + 1).s(-100);
		w.u(2 * 2 + 1)
			.u(1)
			.s(0)
			.s(0)
			.u(1)
			.s(200)
			.s(-10);
		w.u(1 * 2 + 1)
			.u(2)
			.s(5)
			.s(5);
	}
	if (parts.kerning) parts.kerning(w);
	else {
		// Left classes: glyph 1 is class 1, the rest 0. Right: glyph 2 is class 1.
		w.u(2).u(2);
		w.u(0).u(1).u(0).u(0);
		w.u(0).u(0).u(1).u(0);
		// Column by column: right class 0 against left 0, 1; then right class 1.
		w.s(0).s(0).s(0).s(-40);
	}
	w.raw(...(parts.trailing ?? []));
	return w.bytes;
}

function refusal(source: CompiledFontData): string {
	const font = loadCompiledFont(source);
	try {
		font.glyphIndex(0x41);
	} catch (error) {
		expect(error).toBeInstanceOf(FontMalformedError);
		const { table: where, reason } = error as FontMalformedError;
		return `${where} ${reason}`;
	}
	throw new Error('expected the table to be refused');
}

describe('a compiled table', () => {
	it('gives its metrics without decoding, and decodes on first use', () => {
		const broken = loadCompiledFont(data([1, 2, 3], { data: '!!!!' }));
		expect([
			broken.id,
			broken.unitsPerEm,
			broken.ascender,
			broken.descender,
			broken.glyphCount,
		]).toEqual(['hand-made', 1000, 800, -200, 4]);
		expect(() => broken.glyphIndex(0x41)).toThrow(FontMalformedError);
	});

	it('reads the map, advances, outlines, composites and kerning', () => {
		const font = loadCompiledFont(data(table()));
		expect([0x40, 0x41, 0x42, 0x43, 0x44].map((c) => font.glyphIndex(c))).toEqual([0, 1, 2, 3, 0]);
		expect([0, 1, 2, 3].map((g) => font.advance(g))).toEqual([500, 600, 700, 800]);
		expect(Array.from(font.outline(1).points)).toEqual([0, 0, 50, 100, 100, 0]);
		expect(Array.from(font.outline(1).onCurve)).toEqual([1, 0, 1]);
		expect(font.outline(0).ends).toEqual([]);
		expect(Array.from(font.outline(2).points)).toEqual([
			0, 0, 50, 100, 100, 0, 200, -10, 250, 90, 300, -10,
		]);
		expect(font.outline(2).ends).toEqual([3, 6]);
		expect(Array.from(font.outline(3).points).slice(0, 2)).toEqual([5, 5]);
		expect(font.kerning(1, 2)).toBe(-40);
		expect(font.kerning(2, 1)).toBe(0);
		expect(font.kerning(1, 1)).toBe(0);
	});
});

describe('a damaged compiled table', () => {
	it('is refused for base64 that is not base64', () => {
		expect(refusal(data(table(), { data: 'abc' }))).toBe('compiled truncated');
		expect(refusal(data(table(), { data: 'ab!d' }))).toBe('compiled out-of-range');
		expect(refusal(data(table(), { data: 'a=bc' }))).toBe('compiled out-of-range');
		expect(refusal(data(table(), { data: 'abéd' }))).toBe('compiled out-of-range');
	});

	it('is refused for a stream that does not inflate, or inflates past its length', () => {
		expect(refusal(data(table(), { data: Buffer.from([0xff, 0xff]).toString('base64') }))).toBe(
			'compiled truncated',
		);
		const good = data(table());
		expect(refusal({ ...good, length: good.length - 1 })).toBe('compiled truncated');
	});

	it('is refused for a version, a count or a glyph number it does not expect', () => {
		expect(refusal(data(table({ version: 2 })))).toBe('compiled unsupported');
		expect(refusal(data(table({ count: 5 })))).toBe('compiled out-of-range');
		expect(refusal(data(table({ cmap: (w) => w.u(1).u(0x41).s(8) })))).toBe(
			'compiled out-of-range',
		);
		expect(
			refusal(
				data(
					table({
						glyphs: (w) =>
							w
								.u(0)
								.u(0)
								.u(1 * 2 + 1)
								.u(9)
								.s(0)
								.s(0)
								.u(0),
					}),
				),
			),
		).toBe('compiled out-of-range');
	});

	it('is refused for a number that runs on, a stream that stops, or bytes left over', () => {
		expect(refusal(data(table({ cmap: (w) => w.raw(0x81, 0x80, 0x80, 0x80, 0x80, 0x01) })))).toBe(
			'compiled out-of-range',
		);
		expect(refusal(data([1, 4, 1]))).toBe('compiled truncated');
		expect(refusal(data(table({ trailing: [0] })))).toBe('compiled out-of-range');
	});

	it('is refused for a kerning class out of range', () => {
		const left = (w: Writer): void => {
			w.u(1).u(1).u(0).u(1).u(0).u(0).u(0).u(0).u(0).u(0).s(0);
		};
		expect(refusal(data(table({ kerning: left })))).toBe('compiled out-of-range');
		const right = (w: Writer): void => {
			w.u(1).u(1).u(0).u(0).u(0).u(0).u(0).u(0).u(3).u(0).s(0);
		};
		expect(refusal(data(table({ kerning: right })))).toBe('compiled out-of-range');
	});

	it('is refused for composites nested deeper than the build ever writes', () => {
		// Glyph 1 refers to itself: decoding is fine, drawing it is not.
		const looped = (w: Writer): void => {
			w.u(0)
				.u(1 * 2 + 1)
				.u(1)
				.s(0)
				.s(0)
				.u(0)
				.u(0);
		};
		const font = loadCompiledFont(data(table({ glyphs: looped })));
		expect(font.glyphIndex(0x41)).toBe(1);
		expect(() => font.outline(1)).toThrow(FontMalformedError);
	});
});

describe('base64', () => {
	it('decodes every padding length and every character of the alphabet', () => {
		for (const length of [0, 1, 2, 3, 4, 5, 300]) {
			const bytes = Uint8Array.from({ length }, (_, i) => (i * 37 + 11) & 0xff);
			expect(Array.from(decodeBase64(Buffer.from(bytes).toString('base64')))).toEqual(
				Array.from(bytes),
			);
		}
		const all = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
		expect(Array.from(decodeBase64(all))).toEqual(Array.from(Buffer.from(all, 'base64')));
	});
});
