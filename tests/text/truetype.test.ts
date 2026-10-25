/**
 * The TrueType parser on files built for each thing it reads, and each way a
 * file can be wrong.
 *
 * The real fonts are checked against opentype.js in `opentype.test.ts`. These
 * are the paths those fonts never take: every composite transform, both
 * character map formats, both kerning tables in every layout, and the
 * refusals, each named by the table and check that refuses it.
 */

import { describe, expect, it } from 'vitest';
import { QrStudioError } from '../../src/core/errors.js';
import { FontMalformedError } from '../../src/text/errors.js';
import { MAX_DEPTH } from '../../src/text/glyf.js';
import { MAX_SUBTABLES } from '../../src/text/kerning.js';
import { Table } from '../../src/text/reader.js';
import { MAX_FONT_BYTES, parseTrueType } from '../../src/text/truetype.js';
import type { Font } from '../../src/text/types.js';
import {
	buildFont,
	classDefTable,
	cmap12,
	cmap4,
	cmapTable,
	extension,
	gposTable,
	kernApple,
	kernGpos,
	kernMicrosoft,
	pairSubtable,
	sfnt,
	square,
	table,
	u16s,
} from './ttf.js';
import type { TestFontSpec, TestGlyph } from './ttf.js';

const parse = (bytes: Uint8Array): Font => parseTrueType(bytes, { id: 'test-font' });

/** The failure parsing `bytes` throws, as table and reason. */
function refusal(bytes: Uint8Array): string {
	try {
		parse(bytes);
	} catch (error) {
		expect(error).toBeInstanceOf(FontMalformedError);
		const { table: where, reason } = error as FontMalformedError;
		expect((error as QrStudioError).code).toBe('font/malformed');
		expect((error as QrStudioError).params).toEqual({ table: where, reason });
		return `${where} ${reason}`;
	}
	throw new Error('expected the font to be refused');
}

const box: TestGlyph = { contours: [square(100, 0, 400)] };
const tri: TestGlyph = {
	contours: [
		[
			[0, 0, true],
			[50, 100, false],
			[100, 0, true],
		],
	],
};

/** Four plain glyphs: notdef, a box, a triangle, an empty glyph. */
function plain(extra: Partial<TestFontSpec> = {}): Uint8Array {
	return buildFont({ glyphs: [box, box, tri, null], ...extra });
}

describe('a well formed font', () => {
	it('reads metrics, the character map, advances and outlines', () => {
		const font = parse(plain({ metrics: 2, advances: [500, 600, 700, 800] }));
		expect(font.id).toBe('test-font');
		expect(font.labelKey).toBe('text.font.registered');
		expect([font.unitsPerEm, font.ascender, font.descender, font.lineGap]).toEqual([
			1000, 800, -200, 90,
		]);
		expect(font.glyphCount).toBe(4);
		expect([0x41, 0x42, 0x43, 0x44, 0x20].map((c) => font.glyphIndex(c))).toEqual([1, 2, 3, 0, 0]);
		// Only two full metrics: the rest take the last advance given.
		expect([0, 1, 2, 3].map((g) => font.advance(g))).toEqual([500, 600, 600, 600]);
		const outline = font.outline(1);
		expect(Array.from(outline.points)).toEqual([100, 0, 100, 400, 500, 400, 500, 0]);
		expect(Array.from(outline.onCurve)).toEqual([1, 1, 1, 1]);
		expect(outline.ends).toEqual([4]);
		expect(font.outline(3).ends).toEqual([]);
		expect(font.kerning(1, 2)).toBe(0);
	});

	it('keeps an outline and a path once worked out', () => {
		const font = parse(plain());
		expect(font.outline(2)).toBe(font.outline(2));
		expect(font.path(2)).toBe(font.path(2));
		// Move, the curve through the control point, and the close draws the base.
		expect(Array.from(font.path(2).commands)).toEqual([0, 2, 4]);
	});

	it('takes a label key and the long loca format', () => {
		const font = parseTrueType(plain({ longLoca: true }), { id: 'mine', labelKey: 'my.label' });
		expect(font.labelKey).toBe('my.label');
		expect(font.outline(2).onCurve.length).toBe(3);
	});

	it("reads Apple's 'true' version and skips instructions", () => {
		const font = parse(
			buildFont({
				glyphs: [box, { contours: [square(0, 0, 10)], instructions: 3 }],
				sfntVersion: 0x74727565,
			}),
		);
		expect(font.outline(1).onCurve.length).toBe(4);
	});

	it('answers 0 for a code point outside Unicode and refuses a glyph number it does not have', () => {
		const font = parse(plain());
		expect(font.glyphIndex(-1)).toBe(0);
		expect(font.glyphIndex(0x110000)).toBe(0);
		expect(font.glyphIndex(1.5)).toBe(0);
		for (const call of [
			() => font.advance(4),
			() => font.outline(-1),
			() => font.path(0.5),
			() => font.kerning(0, 9),
			() => font.kerning(9, 0),
		]) {
			expect(call).toThrow(TypeError);
		}
	});

	it('uses the first table of a tag the directory lists twice', () => {
		const bytes = plain();
		// Rewrite the 'cmap' record's tag as 'head' so 'head' appears twice;
		// the real 'head' record sorts after it, and only the first is used.
		const directory = new DataView(bytes.buffer);
		const count = directory.getUint16(4);
		let cmapAt = -1;
		for (let i = 0; i < count; i += 1) {
			if (String.fromCharCode(...bytes.slice(12 + i * 16, 16 + i * 16)) === 'glyf')
				cmapAt = 12 + i * 16;
		}
		bytes.set([0x68, 0x65, 0x61, 0x64], cmapAt);
		// The first 'head' is now the glyf table, whose first bytes are not a head.
		expect(refusal(bytes)).toBe('head unsupported');
	});
});

describe('the character map', () => {
	const map = new Map([
		[0x41, 1],
		[0x42, 2],
	]);

	it('reads format 4 through its glyph array', () => {
		const font = parse(plain({ cmap: cmapTable([[3, 1, cmap4(map, true)]]) }));
		expect([0x40, 0x41, 0x42, 0x43].map((c) => font.glyphIndex(c))).toEqual([0, 1, 2, 0]);
		expect(font.glyphIndex(0x1f600)).toBe(0);
	});

	it('maps a zero in the glyph array to no glyph', () => {
		const font = parse(plain({ cmap: cmapTable([[0, 3, cmap4(new Map([[0x41, 0]]), true)]]) }));
		expect(font.glyphIndex(0x41)).toBe(0);
	});

	it('prefers a format 12 subtable and reads it', () => {
		const font = parse(
			plain({
				cmap: cmapTable([
					[3, 1, cmap4(map)],
					[
						3,
						10,
						cmap12([
							[0x1f600, 0x1f601, 1],
							[0x20000, 0x20000, 3],
						]),
					],
				]),
			}),
		);
		expect(
			[0x1f5ff, 0x1f600, 0x1f601, 0x1f602, 0x20000, 0x41, 0x10].map((c) => font.glyphIndex(c)),
		).toEqual([0, 1, 2, 0, 3, 0, 0]);
	});

	it('passes over a record whose subtable is not the format it would be used for', () => {
		const font = parse(
			plain({
				cmap: cmapTable([
					[3, 10, cmap4(map)],
					[0, 3, cmap4(map)],
				]),
			}),
		);
		expect(font.glyphIndex(0x42)).toBe(2);
	});

	it('refuses a map it cannot use or that is broken', () => {
		const cases: [Uint8Array, string][] = [
			[table(u16s([1, 0])), 'cmap unsupported'],
			[cmapTable([[1, 0, cmap4(map)]]), 'cmap unsupported'],
			[cmapTable([[3, 10, cmap12([[0x50, 0x40, 1]])]]), 'cmap out-of-range'],
			[cmapTable([[3, 10, cmap12([[0x41, 0x44, 1]])]]), 'cmap out-of-range'],
			[cmapTable([[3, 10, cmap12([[0x110000, 0x110000, 1]])]]), 'cmap out-of-range'],
			[
				cmapTable([
					[
						3,
						10,
						cmap12([
							[0x45, 0x46, 1],
							[0x41, 0x42, 1],
						]),
					],
				]),
				'cmap unsorted',
			],
			[cmapTable([[3, 1, cmap4(new Map([[0x41, 9]]))]]), 'cmap out-of-range'],
			[cmapTable([[3, 1, cmap4(new Map([[0x41, 9]]), true)]]), 'cmap out-of-range'],
		];
		for (const [cmap, expected] of cases) expect(refusal(plain({ cmap })), expected).toBe(expected);
	});

	it('refuses format 12 lengths that do not hold the groups', () => {
		const groups = cmap12([[0x41, 0x41, 1]]);
		const short = groups.slice();
		new DataView(short.buffer).setUint32(4, 20);
		expect(refusal(plain({ cmap: cmapTable([[3, 10, short]]) }))).toBe('cmap truncated');
		const long = groups.slice();
		new DataView(long.buffer).setUint32(4, 4000);
		expect(refusal(plain({ cmap: cmapTable([[3, 10, long]]) }))).toBe('cmap truncated');
		const tiny = groups.slice();
		new DataView(tiny.buffer).setUint32(4, 8);
		expect(refusal(plain({ cmap: cmapTable([[3, 10, tiny]]) }))).toBe('cmap truncated');
	});

	it('refuses format 4 segments that are odd, overlapping or backwards', () => {
		const odd = cmap4(map);
		new DataView(odd.buffer).setUint16(6, 5);
		expect(refusal(plain({ cmap: cmapTable([[3, 1, odd]]) }))).toBe('cmap out-of-range');
		const none = cmap4(map);
		new DataView(none.buffer).setUint16(6, 0);
		expect(refusal(plain({ cmap: cmapTable([[3, 1, none]]) }))).toBe('cmap out-of-range');
		// Segments: ends at 14, starts after the pad. Make the second start
		// before the first ends, then make one end before its start.
		const overlap = cmap4(map);
		new DataView(overlap.buffer).setUint16(14 + 6 + 2 + 2, 0x41);
		expect(refusal(plain({ cmap: cmapTable([[3, 1, overlap]]) }))).toBe('cmap unsorted');
		const backwards = cmap4(map);
		new DataView(backwards.buffer).setUint16(14 + 6 + 2, 0x50);
		expect(refusal(plain({ cmap: cmapTable([[3, 1, backwards]]) }))).toBe('cmap out-of-range');
	});
});

describe('composite glyphs', () => {
	const parts = (components: TestGlyph): Font =>
		parse(buildFont({ glyphs: [box, box, tri, components] }));
	const points = (font: Font, glyph = 3): number[] => Array.from(font.outline(glyph).points);

	it('places components by byte and word offsets', () => {
		const font = parts({
			components: [
				{ glyph: 2, dx: 10, dy: -5 },
				{ glyph: 2, dx: 1000, dy: -1000, words: true },
			],
		});
		expect(points(font)).toEqual([10, -5, 60, 95, 110, -5, 1000, -1000, 1050, -900, 1100, -1000]);
		expect(font.outline(3).ends).toEqual([3, 6]);
		expect(Array.from(font.outline(3).onCurve)).toEqual([1, 0, 1, 1, 0, 1]);
	});

	it('scales, scales each axis, and applies a 2 by 2', () => {
		expect(points(parts({ components: [{ glyph: 2, scale: 0.5 }] }))).toEqual([
			0, 0, 25, 50, 50, 0,
		]);
		expect(points(parts({ components: [{ glyph: 2, xyScale: [1.5, -1] }] }))).toEqual([
			0, 0, 75, -100, 150, 0,
		]);
		// x' = a x + c y, y' = b x + d y: a quarter turn.
		expect(points(parts({ components: [{ glyph: 2, twoByTwo: [0, 1, -1, 0], dx: 5 }] }))).toEqual([
			5, 0, -95, 50, 5, 100,
		]);
	});

	it('moves a scaled offset through the transform only when asked', () => {
		const plainOffset = parts({ components: [{ glyph: 2, scale: 0.5, dx: 20, dy: 10 }] });
		expect(points(plainOffset).slice(0, 2)).toEqual([20, 10]);
		const scaled = parts({
			components: [{ glyph: 2, scale: 0.5, dx: 20, dy: 10, scaledOffset: true }],
		});
		expect(points(scaled).slice(0, 2)).toEqual([10, 5]);
	});

	it('lines up matched points, by byte and by word', () => {
		// The second triangle's point 0 lands on the first's point 2, (100, 0).
		for (const words of [false, true]) {
			const font = parts({ components: [{ glyph: 2 }, { glyph: 2, match: [2, 0], words }] });
			expect(points(font).slice(6)).toEqual([100, 0, 150, 100, 200, 0]);
		}
	});

	it('resolves composites of composites', () => {
		const font = parse(
			buildFont({
				glyphs: [
					box,
					box,
					tri,
					{ components: [{ glyph: 2, dx: 1 }] },
					{ components: [{ glyph: 3, dy: 2 }] },
				],
			}),
		);
		expect(points(font, 4)).toEqual([1, 2, 51, 102, 101, 2]);
	});

	it('refuses components that are missing, too deep, circular or matched out of range', () => {
		const font = (glyphs: TestGlyph[]): string => refusal(buildFont({ glyphs }));
		expect(font([box, { components: [{ glyph: 7 }] }])).toBe('glyf out-of-range');
		expect(font([box, { components: [{ glyph: 1 }] }])).toBe('glyf too-large');
		expect(font([box, { components: [{ glyph: 2 }] }, { components: [{ glyph: 1 }] }])).toBe(
			'glyf too-large',
		);
		expect(font([box, tri, { components: [{ glyph: 1 }, { glyph: 1, match: [3, 0] }] }])).toBe(
			'glyf out-of-range',
		);
		expect(font([box, tri, { components: [{ glyph: 1 }, { glyph: 1, match: [0, 3] }] }])).toBe(
			'glyf out-of-range',
		);
	});

	it('allows a chain exactly as deep as the limit and no deeper, from either end', () => {
		const chain = (length: number, reversed: boolean): Uint8Array => {
			// Glyph 1 is simple; each later glyph wraps the one before. Reversed,
			// the deepest glyph is met first, so the shallow ones are found again
			// through the cache.
			const glyphs: TestGlyph[] = [box, box];
			for (let i = 0; i < length; i += 1)
				glyphs.push({ components: [{ glyph: glyphs.length - 1 }] });
			if (!reversed) return buildFont({ glyphs });
			return buildFont({
				glyphs: [glyphs[0] as TestGlyph, ...glyphs.slice(1).reverse()].map((g, i, all) => {
					if (g === null || !('components' in g)) return g;
					return { components: [{ glyph: i + 1 < all.length ? i + 1 : 1 }] };
				}),
			});
		};
		expect(parse(chain(MAX_DEPTH, false)).outline(MAX_DEPTH + 1).onCurve.length).toBe(4);
		expect(refusal(chain(MAX_DEPTH + 1, false))).toBe('glyf too-large');
		expect(parse(chain(MAX_DEPTH, true)).glyphCount).toBe(MAX_DEPTH + 2);
		expect(refusal(chain(MAX_DEPTH + 1, true))).toBe('glyf too-large');
	});

	it('refuses a composite that resolves to too many points', () => {
		// 2^17 points by doubling: each level holds the one below twice.
		const glyphs: TestGlyph[] = [
			box,
			{ contours: [Array.from({ length: 16384 }, (_, i) => [i, 0, true] as const)] },
		];
		for (let i = 0; i < 3; i += 1) {
			const below = glyphs.length - 1;
			glyphs.push({ components: [{ glyph: below }, { glyph: below }] });
		}
		expect(refusal(buildFont({ glyphs, longLoca: true }))).toBe('glyf too-large');
	});
});

describe('simple glyph refusals', () => {
	const raw = (bytes: number[]): string =>
		refusal(buildFont({ glyphs: [box, { raw: Uint8Array.from(bytes) }] }));
	const header = (contours: number): number[] => [
		(contours >> 8) & 0xff,
		contours & 0xff,
		0,
		0,
		0,
		0,
		0,
		0,
		0,
		0,
	];

	it('refuses contour ends out of order, a negative count other than -1, and a repeat past the end', () => {
		expect(raw([...header(2), 0, 3, 0, 2, 0, 0])).toBe('glyf unsorted');
		expect(raw([...header(-2), 0, 0])).toBe('glyf out-of-range');
		// One contour of two points: a repeated flag claiming five more.
		expect(raw([...header(1), 0, 1, 0, 0, 0x09, 5])).toBe('glyf out-of-range');
	});

	it('refuses a glyph that stops part way', () => {
		expect(raw([...header(1), 0, 1, 0, 0, 1, 1, 0])).toBe('glyf truncated');
		expect(raw([...header(1), 0, 1, 0, 9])).toBe('glyf truncated');
		expect(raw([0])).toBe('glyf truncated');
	});

	it('reads the short and repeated forms', () => {
		// Two points. Flags: on curve, x short positive, y same; then on curve,
		// x short negative, y word.
		const font = parse(
			buildFont({
				glyphs: [
					box,
					{ raw: Uint8Array.from([...header(1), 0, 1, 0, 0, 0x33, 0x03, 10, 4, 0, 20]) },
				],
			}),
		);
		expect(Array.from(font.outline(1).points)).toEqual([10, 0, 6, 20]);
	});
});

describe('the tables every font needs', () => {
	it('refuses a file that is not a TrueType font or is missing a table', () => {
		expect(refusal(plain({ sfntVersion: 0x4f54544f }))).toBe('file unsupported');
		expect(refusal(new Uint8Array(3))).toBe('file truncated');
		for (const tag of ['head', 'maxp', 'hhea', 'hmtx', 'glyf', 'loca', 'cmap']) {
			expect(refusal(plain({ omit: [tag] }))).toBe(`${tag} missing-table`);
		}
	});

	it('refuses a directory entry that runs past the end of the file', () => {
		const bytes = plain();
		new DataView(bytes.buffer).setUint32(12 + 12, 0xffff);
		expect(refusal(bytes)).toBe('file truncated');
	});

	it('refuses head, maxp, hhea and hmtx values out of range', () => {
		const font = plain();
		const head = (patch: (view: DataView) => void): Uint8Array => {
			const bytes = buildFont({ glyphs: [box, box] });
			const copy = bytes.slice();
			// Find head through the directory and patch it.
			const view = new DataView(copy.buffer);
			for (let i = 0; i < view.getUint16(4); i += 1) {
				if (String.fromCharCode(...copy.slice(12 + i * 16, 16 + i * 16)) === 'head') {
					patch(new DataView(copy.buffer, view.getUint32(12 + i * 16 + 8)));
				}
			}
			return copy;
		};
		expect(font.length).toBeGreaterThan(0);
		expect(refusal(head((v) => v.setUint32(12, 0)))).toBe('head unsupported');
		expect(refusal(head((v) => v.setUint16(0, 2)))).toBe('head unsupported');
		expect(refusal(head((v) => v.setUint16(18, 8)))).toBe('head out-of-range');
		expect(refusal(head((v) => v.setUint16(18, 20000)))).toBe('head out-of-range');
		expect(refusal(head((v) => v.setInt16(50, 2)))).toBe('head out-of-range');
		expect(refusal(plain({ replace: { maxp: table([{ u32: 0x00020000 }, { u16: 4 }]) } }))).toBe(
			'maxp unsupported',
		);
		expect(
			refusal(
				buildFont({ glyphs: [], replace: { maxp: table([{ u32: 0x00010000 }, { u16: 0 }]) } }),
			),
		).toBe('maxp out-of-range');
		expect(refusal(plain({ metrics: 0 }))).toBe('hhea out-of-range');
		expect(refusal(plain({ replace: { hhea: table(u16s([1, 0, 800])) } }))).toBe('hhea truncated');
		expect(refusal(plain({ replace: { hmtx: new Uint8Array(6) } }))).toBe('hmtx truncated');
	});

	it('refuses a loca that goes backwards or past the glyphs', () => {
		const backwards = table(u16s([0, 20, 10, 30, 30]));
		expect(refusal(plain({ replace: { loca: backwards } }))).toBe('loca unsorted');
		const past = table(u16s([0, 10, 20, 30, 4000]));
		expect(refusal(plain({ replace: { loca: past } }))).toBe('loca out-of-range');
	});

	it('refuses a file larger than it will read, before reading it', () => {
		const huge = new Uint8Array(MAX_FONT_BYTES + 1);
		expect(refusal(huge)).toBe('file too-large');
	});

	it('refuses arguments of the wrong kind with a TypeError', () => {
		const good = plain();
		const bad: [unknown, unknown][] = [
			[[1, 2, 3], { id: 'a' }],
			[good, null],
			[good, { id: 7 }],
			[good, { id: 'Not Kebab' }],
			[good, { id: 'fine', labelKey: 3 }],
		];
		for (const [bytes, options] of bad) {
			expect(() => parseTrueType(bytes as Uint8Array, options as { id: string })).toThrow(
				TypeError,
			);
		}
	});
});

describe('the bounds-checked reader', () => {
	it('reads every width and sign, and names its table when it runs out', () => {
		const bytes = Uint8Array.from([0xff, 0xfe, 0x80, 0x00, 0x41, 0x7f, 0x01, 0x20]);
		const t = new Table(bytes, 0, bytes.length, 'test');
		expect([t.u8(0), t.i8(0), t.i8(5), t.u16(0), t.i16(0), t.u32(0), t.f2dot14(2)]).toEqual([
			255, -1, 127, 0xfffe, -2, 0xfffe8000, -2,
		]);
		expect(t.tagAt(4)).toBe('A?? ');
		expect(t.slice(2, 2).u16(0)).toBe(0x8000);
		expect(() => t.u32(6)).toThrow(FontMalformedError);
		expect(() => t.slice(4, 8)).toThrow(/damaged/);
		expect(() => t.need(-1, 1)).toThrow(FontMalformedError);
	});
});

// Kerning

const glyphs6: TestGlyph[] = [box, box, box, box, box, box];
const withGpos = (gpos: Uint8Array, kern?: Uint8Array): Font =>
	parse(buildFont({ glyphs: glyphs6, gpos, ...(kern ? { kern } : {}) }));
const pairs = (font: Font): number[][] =>
	[1, 2, 3, 4, 5].map((l) => [1, 2, 3, 4, 5].map((r) => font.kerning(l, r)));

describe('GPOS kerning', () => {
	it('reads format 1 pairs, letting the next subtable try when the pair is not there', () => {
		const font = withGpos(
			kernGpos([
				{
					type: 2,
					subtables: [
						pairSubtable({
							format: 1,
							coverage: { format: 1, glyphs: [1, 3] },
							sets: [
								[
									[2, -50],
									[4, 30],
								],
								[[1, -7]],
							],
						}),
						pairSubtable({
							format: 1,
							coverage: { format: 2, glyphs: [1, 2] },
							sets: [
								[
									[2, -99],
									[5, -11],
								],
								[[2, 12]],
							],
						}),
					],
				},
			]),
		);
		expect(pairs(font)).toEqual([
			[0, -50, 0, 30, -11],
			[0, 12, 0, 0, 0],
			[-7, 0, 0, 0, 0],
			[0, 0, 0, 0, 0],
			[0, 0, 0, 0, 0],
		]);
	});

	it('reads format 2 classes in both class definition formats, a covered pair deciding even at zero', () => {
		const font = withGpos(
			kernGpos([
				{
					type: 2,
					subtables: [
						pairSubtable({
							format: 2,
							coverage: { format: 2, glyphs: [1, 2, 3] },
							classDef1: classDefTable({ format: 1, start: 2, classes: [1, 1] }),
							classDef2: classDefTable({
								format: 2,
								ranges: [
									[1, 1, 2],
									[4, 5, 1],
								],
							}),
							class1Count: 2,
							class2Count: 3,
							values: [
								[0, -10, -20],
								[5, 15, 25],
							],
						}),
						pairSubtable({
							format: 1,
							coverage: { format: 1, glyphs: [1, 5] },
							sets: [[[2, -999]], [[1, 8]]],
						}),
					],
				},
			]),
		);
		expect(pairs(font)).toEqual([
			[-20, 0, 0, -10, -10],
			[25, 5, 5, 15, 15],
			[25, 5, 5, 15, 15],
			[0, 0, 0, 0, 0],
			[8, 0, 0, 0, 0],
		]);
	});

	it('adds the lookups of the feature together, through extensions, in lookup order', () => {
		const first = pairSubtable({
			format: 1,
			coverage: { format: 1, glyphs: [1] },
			sets: [[[2, -10]]],
		});
		const second = pairSubtable({
			format: 1,
			coverage: { format: 1, glyphs: [1] },
			sets: [
				[
					[2, -5],
					[3, 4],
				],
			],
		});
		const font = withGpos(
			gposTable({
				scripts: [
					['DFLT', [1]],
					['latn', [0, 2]],
					['cyrl', null],
				],
				features: [
					['kern', [2]],
					['kern', [0]],
					['mark', [1]],
				],
				lookups: [
					{ type: 9, subtables: [extension(first)] },
					{ type: 4, subtables: [new Uint8Array(8)] },
					{ type: 2, flag: 0x10, subtables: [second] },
				],
			}),
		);
		expect(font.kerning(1, 2)).toBe(-15);
		expect(font.kerning(1, 3)).toBe(4);
	});

	it('uses the x advance wherever the value format puts it, and nothing when it has none', () => {
		const font = withGpos(
			kernGpos([
				{
					type: 2,
					subtables: [
						pairSubtable({
							format: 1,
							coverage: { format: 1, glyphs: [1] },
							valueFormat1: 0x00ff,
							valueFormat2: 0x0005,
							sets: [[[2, -40]]],
						}),
						pairSubtable({
							format: 1,
							coverage: { format: 1, glyphs: [2] },
							valueFormat1: 0x0001,
							sets: [[[3, -40]]],
						}),
						pairSubtable({
							format: 2,
							coverage: { format: 1, glyphs: [3] },
							valueFormat1: 0x0002,
							classDef1: classDefTable({ format: 1, start: 0, classes: [] }),
							classDef2: classDefTable({ format: 1, start: 0, classes: [] }),
							class1Count: 1,
							class2Count: 1,
							values: [[-40]],
						}),
					],
				},
			]),
		);
		expect([font.kerning(1, 2), font.kerning(2, 3), font.kerning(3, 1)]).toEqual([-40, 0, 0]);
	});

	it('treats null lists, and a font with no kern feature, as no GPOS kerning', () => {
		const kern = kernMicrosoft([{ pairs: [[1, 2, -3]] }]);
		expect(
			withGpos(
				gposTable({ scripts: [], features: [], lookups: [], nullLists: true }),
				kern,
			).kerning(1, 2),
		).toBe(-3);
		const markOnly = gposTable({
			scripts: [['latn', [0]]],
			features: [['mark', [0]]],
			lookups: [{ type: 4, subtables: [] }],
		});
		expect(withGpos(markOnly).kerning(1, 2)).toBe(0);
		const contextualOnly = kernGpos([{ type: 8, subtables: [new Uint8Array(4)] }]);
		expect(withGpos(contextualOnly, kern).kerning(1, 2)).toBe(-3);
	});

	it('refuses GPOS that is broken', () => {
		const one = (sub: Uint8Array): Uint8Array => kernGpos([{ type: 2, subtables: [sub] }]);
		const fmt1 = (
			coverage: { format: 1 | 2; glyphs: number[] },
			sets: [number, number][][],
		): Uint8Array => pairSubtable({ format: 1, coverage, sets });
		const fmt2 = (def1: Uint8Array, def2: Uint8Array, c1 = 2, c2 = 2): Uint8Array =>
			pairSubtable({
				format: 2,
				coverage: { format: 1, glyphs: [1] },
				classDef1: def1,
				classDef2: def2,
				class1Count: c1,
				class2Count: c2,
				values: Array.from({ length: c1 }, () => new Array<number>(c2).fill(0)),
			});
		const okDef = classDefTable({ format: 1, start: 1, classes: [1] });
		const cases: [Uint8Array, string][] = [
			[gposTable({ version: 2, scripts: [], features: [], lookups: [] }), 'GPOS unsupported'],
			[one(fmt1({ format: 1, glyphs: [2, 1] }, [[], []])), 'GPOS unsorted'],
			[
				one(
					fmt1({ format: 1, glyphs: [1] }, [
						[
							[3, 1],
							[2, 1],
						],
					]),
				),
				'GPOS unsorted',
			],
			[one(fmt1({ format: 1, glyphs: [1, 2] }, [[]])), 'GPOS out-of-range'],
			[one(table(u16s([3, 0]))), 'GPOS unsupported'],
			[one(fmt2(classDefTable({ format: 1, start: 1, classes: [2] }), okDef)), 'GPOS out-of-range'],
			[one(fmt2(okDef, classDefTable({ format: 2, ranges: [[1, 1, 5]] }))), 'GPOS out-of-range'],
			[
				one(
					fmt2(
						okDef,
						classDefTable({
							format: 2,
							ranges: [
								[3, 4, 1],
								[1, 2, 1],
							],
						}),
					),
				),
				'GPOS unsorted',
			],
			[one(fmt2(okDef, classDefTable({ format: 2, ranges: [[3, 2, 1]] }))), 'GPOS out-of-range'],
			[one(fmt2(okDef, table(u16s([3, 0])))), 'GPOS unsupported'],
			[
				kernGpos([{ type: 9, subtables: [extension(fmt2(okDef, okDef), 2, 2)] }]),
				'GPOS unsupported',
			],
			[kernGpos([{ type: 9, subtables: [extension(fmt2(okDef, okDef), 9)] }]), 'GPOS unsupported'],
			[
				gposTable({
					scripts: [['latn', [4]]],
					features: [['kern', [0]]],
					lookups: [{ type: 2, subtables: [] }],
				}),
				'GPOS out-of-range',
			],
			[
				gposTable({
					scripts: [['latn', [0]]],
					features: [['kern', [3]]],
					lookups: [{ type: 2, subtables: [] }],
				}),
				'GPOS out-of-range',
			],
		];
		for (const [gpos, expected] of cases) {
			expect(refusal(buildFont({ glyphs: glyphs6, gpos })), expected).toBe(expected);
		}
	});

	it('refuses a value format with reserved bits, and coverage ranges that do not follow on', () => {
		const reserved = pairSubtable({
			format: 1,
			coverage: { format: 1, glyphs: [1] },
			valueFormat1: 0x0104,
			sets: [[[2, 1]]],
		});
		expect(
			refusal(buildFont({ glyphs: glyphs6, gpos: kernGpos([{ type: 2, subtables: [reserved] }]) })),
		).toBe('GPOS unsupported');
		const coverage = table(u16s([2, 1, 1, 2, 3]));
		const skipped = table([{ u16: 1 }, { offset16: coverage }, ...u16s([4, 0, 0])]);
		expect(
			refusal(buildFont({ glyphs: glyphs6, gpos: kernGpos([{ type: 2, subtables: [skipped] }]) })),
		).toBe('GPOS out-of-range');
	});

	it('refuses more pair subtables than it will search', () => {
		const sub = pairSubtable({ format: 1, coverage: { format: 1, glyphs: [1] }, sets: [[[2, 1]]] });
		const lookups = [
			{ type: 2, subtables: new Array<Uint8Array>(MAX_SUBTABLES).fill(sub) },
			{ type: 2, subtables: [sub] },
		];
		expect(refusal(buildFont({ glyphs: glyphs6, gpos: kernGpos(lookups) }))).toBe('GPOS too-large');
	});
});

describe('the kern table', () => {
	it("sums Microsoft's horizontal format 0 subtables, an override replacing the total", () => {
		const font = parse(
			buildFont({
				glyphs: glyphs6,
				kern: kernMicrosoft([
					{
						pairs: [
							[1, 2, -10],
							[1, 3, 5],
						],
					},
					{ pairs: [[1, 2, -1]] },
					{ pairs: [[1, 2, 100]], coverage: 0x0003 },
					{ pairs: [[1, 2, 100]], coverage: 0x0005 },
					{ pairs: [[1, 3, 2]], coverage: 0x0009 },
					{ pairs: [], format: 2 },
				]),
			}),
		);
		expect([font.kerning(1, 2), font.kerning(1, 3), font.kerning(2, 1)]).toEqual([-11, 2, 0]);
	});

	it("reads Apple's version, skipping vertical, cross-stream and variation subtables", () => {
		const font = parse(
			buildFont({
				glyphs: glyphs6,
				kern: kernApple([
					{ pairs: [[1, 2, -10]] },
					{ pairs: [[1, 2, -1000]], coverage: 0x8000 },
					{ pairs: [[1, 2, -1000]], coverage: 0x4000 },
					{ pairs: [[1, 2, -1000]], coverage: 0x2000 },
					{ pairs: [[1, 2, -1000]], format: 1 },
				]),
			}),
		);
		expect(font.kerning(1, 2)).toBe(-10);
	});

	it('finds the end of a Microsoft subtable whose 16 bit length overflowed from its pairs', () => {
		const many: [number, number, number][] = [];
		for (let r = 0; r < 11000; r += 1) many.push([1, r, r % 7 === 0 ? -1 : 0]);
		const glyphs: TestGlyph[] = [box, box];
		const font = parse(
			buildFont({
				glyphs,
				kern: kernMicrosoft([{ pairs: many }, { pairs: [[1, 1, -20]] }]),
				replace: { maxp: table([{ u32: 0x00005000 }, { u16: 2 }]) },
			}),
		);
		expect(font.kerning(1, 0)).toBe(-1);
		expect(font.kerning(1, 1)).toBe(-20);
	});

	it('is empty when no subtable is horizontal format 0', () => {
		const font = parse(
			buildFont({
				glyphs: glyphs6,
				kern: kernMicrosoft([{ pairs: [[1, 2, 3]], coverage: 0x0004 }]),
			}),
		);
		expect(font.kerning(1, 2)).toBe(0);
	});

	it('refuses kern tables that are broken', () => {
		const cases: [Uint8Array, string][] = [
			[table(u16s([2, 0])), 'kern unsupported'],
			[
				kernMicrosoft([
					{
						pairs: [
							[1, 3, 1],
							[1, 2, 1],
						],
					},
				]),
				'kern unsorted',
			],
			[kernMicrosoft([{ pairs: [[1, 2, 1]], length: 2 }]), 'kern out-of-range'],
			[table([{ u32: 0x00010000 }, { u32: MAX_SUBTABLES + 1 }]), 'kern too-large'],
			[table(u16s([0, 1, 0, 6])), 'kern truncated'],
		];
		for (const [kern, expected] of cases)
			expect(refusal(buildFont({ glyphs: glyphs6, kern })), expected).toBe(expected);
	});
});

describe('a directory written by hand', () => {
	it('reads tables in any order and ignores ones it does not use', () => {
		const font = buildFont({ glyphs: [box, box] });
		expect(parse(font).glyphCount).toBe(2);
		const withExtra = sfnt({ ...tablesOf(font), DSIG: new Uint8Array(8), name: new Uint8Array(6) });
		expect(parse(withExtra).glyphCount).toBe(2);
	});
});

/** The tables of a font this file built, by tag. */
function tablesOf(bytes: Uint8Array): Record<string, Uint8Array> {
	const view = new DataView(bytes.buffer, bytes.byteOffset);
	const out: Record<string, Uint8Array> = {};
	for (let i = 0; i < view.getUint16(4); i += 1) {
		const at = 12 + i * 16;
		const tag = String.fromCharCode(...bytes.slice(at, at + 4));
		const offset = view.getUint32(at + 8);
		out[tag] = bytes.slice(offset, offset + view.getUint32(at + 12));
	}
	return out;
}
