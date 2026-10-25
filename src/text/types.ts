/**
 * The shapes the text layer hands out: a font, a glyph's outline, and a laid
 * out caption.
 *
 * A caption in an export is never live text. It is drawn as filled paths, so
 * a PDF or an SVG of a design looks the same on a machine that has never seen
 * the font, the scan check sees exactly what is printed, and nothing in a
 * file can be selected, searched or copied out of it.
 */

import type { MessageKey } from '../core/issue.js';
import type { Registry } from '../core/registry.js';
import type { Path } from '../geometry/path.js';

/**
 * One glyph's contours as the font stores them: TrueType quadratic points in
 * font units, y up, composite glyphs already resolved into their components.
 */
export interface GlyphOutline {
	/** x, y pairs. */
	readonly points: Float64Array;
	/** 1 where the point is on the curve, 0 where it is a quadratic control point. */
	readonly onCurve: Uint8Array;
	/** One past the last point of each contour, in order. */
	readonly ends: readonly number[];
}

/**
 * A font the layout can draw with.
 *
 * Glyphs are numbered as the font numbers them, and glyph 0 is the font's
 * "missing" glyph, which this package never draws: a code point the font has
 * no glyph for is reported, never substituted.
 */
export interface Font {
	/** Kebab-case, unique within a registry. Travels in design files. */
	readonly id: string;
	/** What a font picker calls it. */
	readonly labelKey: MessageKey;
	/** Font units to the em. */
	readonly unitsPerEm: number;
	/** The line box above the baseline, in font units (positive). */
	readonly ascender: number;
	/** The line box below the baseline, in font units (negative or zero). */
	readonly descender: number;
	readonly lineGap: number;
	readonly glyphCount: number;
	/** The glyph for a code point, or 0 when the font has none. */
	glyphIndex(codePoint: number): number;
	/** How far the pen moves after the glyph, in font units. */
	advance(glyph: number): number;
	/** The adjustment to the pen between two glyphs, in font units, added after `left`'s advance. */
	kerning(left: number, right: number): number;
	outline(glyph: number): GlyphOutline;
	/** The outline as a path in font units, y up, quadratic. The same object on every call. */
	path(glyph: number): Path;
}

/** The built-in family and any font the website registers at runtime. */
export type FontRegistry = Registry<Font>;

export type TextAlign = 'start' | 'centre' | 'end';

export interface TextBox {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
}

export interface LayoutOptions {
	/** Where `fontId` is looked up. Defaults to the built-in family. */
	readonly fonts?: FontRegistry;
	readonly fontId: string;
	/** The em size in box units. */
	readonly size: number;
	readonly box: TextBox;
	/** Horizontal alignment within the box. Default 'centre'. */
	readonly align?: TextAlign;
	/** Lines beyond this are left out and the result overflows. Default 1. */
	readonly maxLines?: number;
	/** Baseline to baseline, as a multiple of the size. Default 1.2. */
	readonly lineHeight?: number;
	/** Shrink the size until the text fits, down to `minSize`. Default false. */
	readonly shrinkToFit?: boolean;
	/** The floor for `shrinkToFit`. Default half of `size`. */
	readonly minSize?: number;
}

export interface LayoutLine {
	/** The line's text, as it was given (after NFC), without the spaces it was broken at. */
	readonly text: string;
	/** Where the line starts and ends in the normalised text, in UTF-16 code units. */
	readonly start: number;
	readonly end: number;
	/** The pen position at the start of the line, in box units. */
	readonly x: number;
	/** The baseline, in box units. */
	readonly baseline: number;
	/** The advance width of the line, in box units. */
	readonly width: number;
}

export interface LayoutResult {
	/** One path a line, in box units, y down. */
	readonly paths: readonly Path[];
	readonly lines: readonly LayoutLine[];
	/** Code points the font has no glyph for, each once, in the order they first appear. */
	readonly missing: readonly number[];
	/** True when the text does not fit the box at the size used, or was cut to `maxLines`. */
	readonly overflow: boolean;
	/** The size the text was laid out at, after any shrinking. */
	readonly size: number;
}
