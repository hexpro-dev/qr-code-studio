/**
 * The built-in fonts, and the parser on the real files, against opentype.js.
 *
 * opentype.js is an independent reader of the same TrueType files. For every
 * code point in each weight's subset, the compiled table and our parser must
 * agree with it on the glyph, its points (exactly: the subset has no scaled
 * components, so quantising to whole font units loses nothing), its contours
 * and its advance.
 *
 * Kerning is compared lookup by lookup. opentype.js's `getKerningValue`
 * returns the first lookup that covers the left glyph, but a shaper applies
 * every lookup of the `kern` feature and adds them up, and IBM Plex spreads
 * its kerning over three. So the oracle here is opentype.js evaluating each
 * lookup on its own (its `position.getKerningValue` over one lookup at a
 * time), summed; and where that sum and `getKerningValue` disagree, the test
 * checks the disagreement is exactly the first-lookup shortcut and nothing
 * else. `resvg.test.ts` confirms the sum against rustybuzz, which is
 * HarfBuzz.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as opentype from 'opentype.js';
import { describe, expect, it } from 'vitest';
import { BLOCKS, SOURCES } from '../../scripts/build-fonts.js';
import { builtInFonts } from '../../src/text/registry.js';
import { parseTrueType } from '../../src/text/truetype.js';
import type { Font } from '../../src/text/types.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

interface OtPoint {
	readonly x: number;
	readonly y: number;
	readonly onCurve: boolean;
	readonly lastPointOfContour?: boolean;
}
interface OtGlyph {
	readonly advanceWidth: number;
	readonly points?: readonly OtPoint[];
	readonly path: unknown;
}
interface OtLookup {
	readonly subtables: readonly { readonly coverage: unknown }[];
}
interface OtFont {
	charToGlyphIndex(char: string): number;
	getKerningValue(left: number, right: number): number;
	readonly glyphs: { get(index: number): OtGlyph };
	readonly position: {
		readonly defaultKerningTables: readonly OtLookup[];
		getKerningValue(lookups: readonly OtLookup[], left: number, right: number): number;
		getCoverageIndex(coverage: unknown, glyph: number): number;
	};
}

function oracle(file: string): OtFont {
	const bytes = readFileSync(resolve(root, file));
	return opentype.parse(
		bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
	) as unknown as OtFont;
}

for (const [index, source] of SOURCES.entries()) {
	describe(`${source.id} against opentype.js`, () => {
		const ot = oracle(source.file);
		const compiled = builtInFonts()[index] as Font;
		const parsed = parseTrueType(new Uint8Array(readFileSync(resolve(root, source.file))), {
			id: source.id,
		});
		const subset: number[] = [];
		for (const block of source.blocks) {
			const [first, last] = BLOCKS[block];
			for (let c = first; c <= last; c += 1)
				if (ot.charToGlyphIndex(String.fromCodePoint(c)) !== 0) subset.push(c);
		}

		it('keeps exactly the subset', () => {
			expect(compiled.id).toBe(source.id);
			expect(subset.length).toBeGreaterThan(300);
			const kept = new Set(subset);
			for (let c = 0; c < 0x600; c += 1) {
				expect(compiled.glyphIndex(c) !== 0, `U+${c.toString(16)}`).toBe(kept.has(c));
			}
		});

		for (const [name, font] of [
			['the compiled table', compiled],
			['the parser', parsed],
		] as const) {
			it(`gives every glyph's points, contours and advance through ${name}`, () => {
				for (const c of subset) {
					const glyph = ot.glyphs.get(ot.charToGlyphIndex(String.fromCodePoint(c)));
					// Reading the path is what makes opentype.js resolve points.
					void glyph.path;
					const where = `U+${c.toString(16).padStart(4, '0')}`;
					const ours = font.outline(font.glyphIndex(c));
					const theirs = glyph.points ?? [];
					expect(ours.onCurve.length, where).toBe(theirs.length);
					const ends: number[] = [];
					theirs.forEach((point, i) => {
						if (point.lastPointOfContour) ends.push(i + 1);
						expect(ours.points[i * 2], where).toBe(point.x);
						expect(ours.points[i * 2 + 1], where).toBe(point.y);
						expect(ours.onCurve[i], where).toBe(point.onCurve ? 1 : 0);
					});
					expect(ours.ends, where).toEqual(ends);
					expect(font.advance(font.glyphIndex(c)), where).toBe(glyph.advanceWidth);
				}
			});
		}

		it('kerns every pair as the sum of the kern lookups, through both', () => {
			const lookups = ot.position.defaultKerningTables;
			expect(lookups.length).toBe(3);
			const glyphs = subset.map((c) => ({
				ot: ot.charToGlyphIndex(String.fromCodePoint(c)),
				compiled: compiled.glyphIndex(c),
				parsed: parsed.glyphIndex(c),
			}));
			let pairs = 0;
			let shortcut = 0;
			for (const left of glyphs) {
				for (const right of glyphs) {
					const each = lookups.map((lookup) =>
						ot.position.getKerningValue([lookup], left.ot, right.ot),
					);
					const sum = each.reduce((a, b) => a + b, 0);
					expect(compiled.kerning(left.compiled, right.compiled)).toBe(sum);
					expect(parsed.kerning(left.parsed, right.parsed)).toBe(sum);
					if (sum !== 0) pairs += 1;
					const first = ot.getKerningValue(left.ot, right.ot);
					if (first !== sum) {
						shortcut += 1;
						// opentype.js returns the first lookup that has the left glyph
						// in its coverage, and only that.
						const covering = lookups.findIndex((lookup) =>
							lookup.subtables.some(
								(sub) => ot.position.getCoverageIndex(sub.coverage, left.ot) >= 0,
							),
						);
						expect(first).toBe(each[covering]);
					}
				}
			}
			expect(pairs).toBeGreaterThan(10000);
			// Recorded so a change in either reader is noticed.
			expect(shortcut).toBeGreaterThan(0);
		});
	});
}
