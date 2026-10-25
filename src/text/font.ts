/**
 * The one way a `Font` is put together, whichever source it came from.
 *
 * A font parsed from a file and the compiled built-in family both describe
 * themselves as a `FontSource`, and this wraps either in the public `Font`:
 * it checks the glyph numbers a caller passes, and it keeps each glyph's
 * outline and path once they have been worked out, so a caption that uses
 * the letter e nine times resolves its composite and builds its path once.
 *
 * The caches belong to the font object, not to the module, so two registries
 * never share state and dropping a font drops everything it held.
 */

import type { MessageKey } from '../core/issue.js';
import type { Path } from '../geometry/path.js';
import { outlinePath } from './outline.js';
import type { Font, GlyphOutline } from './types.js';

export interface FontSource {
	readonly id: string;
	readonly labelKey: MessageKey;
	readonly unitsPerEm: number;
	readonly ascender: number;
	readonly descender: number;
	readonly lineGap: number;
	readonly glyphCount: number;
	glyphIndex(codePoint: number): number;
	advance(glyph: number): number;
	kerning(left: number, right: number): number;
	outline(glyph: number): GlyphOutline;
}

/** Unicode's whole range. Anything else has no glyph in any font. */
const MAX_CODE_POINT = 0x10ffff;

export function makeFont(source: FontSource): Font {
	const outlines = new Map<number, GlyphOutline>();
	const paths = new Map<number, Path>();
	const check = (glyph: number, method: string): void => {
		if (!Number.isInteger(glyph) || glyph < 0 || glyph >= source.glyphCount) {
			throw new TypeError(`Font.${method}: that is not a glyph number in this font.`);
		}
	};
	const outline = (glyph: number): GlyphOutline => {
		check(glyph, 'outline');
		let found = outlines.get(glyph);
		if (found === undefined) {
			found = source.outline(glyph);
			outlines.set(glyph, found);
		}
		return found;
	};
	return Object.freeze({
		id: source.id,
		labelKey: source.labelKey,
		unitsPerEm: source.unitsPerEm,
		ascender: source.ascender,
		descender: source.descender,
		lineGap: source.lineGap,
		glyphCount: source.glyphCount,
		glyphIndex(codePoint: number): number {
			if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > MAX_CODE_POINT) return 0;
			return source.glyphIndex(codePoint);
		},
		advance(glyph: number): number {
			check(glyph, 'advance');
			return source.advance(glyph);
		},
		kerning(left: number, right: number): number {
			check(left, 'kerning');
			check(right, 'kerning');
			return source.kerning(left, right);
		},
		outline,
		path(glyph: number): Path {
			check(glyph, 'path');
			let found = paths.get(glyph);
			if (found === undefined) {
				found = outlinePath(outline(glyph));
				paths.set(glyph, found);
			}
			return found;
		},
	});
}
