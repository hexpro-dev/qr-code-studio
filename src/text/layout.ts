/**
 * Laying out a caption: line breaking, kerning, alignment and shrinking to fit.
 *
 * The text is normalised to NFC first, so an accent typed as a separate mark
 * finds the precomposed letter the font has. It is then broken greedily at
 * spaces (U+0020; a no-break space holds its words together) and at line
 * feeds, kerned pair by pair, and aligned within the box. Each line is one
 * path of quadratic outlines in box units, y down, ready to be a scene node.
 *
 * What is out of scope is left out rather than done badly: there is no
 * shaping (Arabic joining, Indic reordering, ligatures), no bidirectional
 * ordering and no CJK line breaking. A code point the font has no glyph for
 * is reported in `missing` and takes no room. It is never drawn as a box or
 * swapped for a glyph from another font, because a caption that silently
 * says something else is worse than one that says what is missing.
 *
 * Vertical metrics follow CSS: each line is `lineHeight` times the size, the
 * font's line box (ascender to descender) is centred in it, and the block of
 * lines is centred in the box. Everything is `+ - * /` on float64, so the
 * same caption gives the same paths in every engine.
 */

import { QrStudioError } from '../core/errors.js';
import { PathBuilder } from '../geometry/path.js';
import type { Path } from '../geometry/path.js';
import { createFontRegistry } from './registry.js';
import type { Font, LayoutLine, LayoutOptions, LayoutResult, TextAlign } from './types.js';

/** The most UTF-16 code units one caption may have. A frame allows a few dozen. */
export const MAX_TEXT_LENGTH = 4096;

const DEFAULT_LINE_HEIGHT = 1.2;
/** Halvings in the shrink search: the size found is within 2^-24 of the range of the best. */
const SHRINK_STEPS = 24;
/** Room for rounding when comparing a width or a height with the box. */
const SLACK = 1e-9;

const SPACE = 0x20;
const LINE_FEED = 0x0a;
const CARRIAGE_RETURN = 0x0d;

/** One code point: where it is in the text, and the glyph that draws it, or -1. */
interface Item {
	readonly at: number;
	readonly end: number;
	readonly glyph: number;
	readonly space: boolean;
}

/** A run of items between line feeds. */
interface Paragraph {
	readonly start: number;
	readonly items: readonly Item[];
}

interface Line {
	readonly start: number;
	readonly end: number;
	/** Glyphs in order, missing ones already left out. */
	readonly glyphs: readonly number[];
	/** In font units. */
	readonly width: number;
}

function positive(value: unknown, name: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
		throw new TypeError(`layoutText: ${name} is a finite number more than zero.`);
	}
	return value;
}

function finite(value: unknown, name: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		throw new TypeError(`layoutText: ${name} is a finite number.`);
	}
	return value;
}

/** Split normalised text into paragraphs of items, noting the code points with no glyph. */
function itemise(text: string, font: Font, missing: number[]): Paragraph[] {
	const paragraphs: Paragraph[] = [];
	let items: Item[] = [];
	let start = 0;
	const seen = new Set<number>();
	for (let at = 0; at < text.length;) {
		const codePoint = text.codePointAt(at) as number;
		const end = at + (codePoint > 0xffff ? 2 : 1);
		if (codePoint === LINE_FEED) {
			paragraphs.push({ start, items });
			items = [];
			start = end;
		} else if (codePoint !== CARRIAGE_RETURN) {
			const glyph = font.glyphIndex(codePoint);
			if (glyph === 0 && !seen.has(codePoint)) {
				seen.add(codePoint);
				missing.push(codePoint);
			}
			items.push({ at, end, glyph: glyph === 0 ? -1 : glyph, space: codePoint === SPACE });
		}
		at = end;
	}
	paragraphs.push({ start, items });
	return paragraphs;
}

/** The width in font units of `glyphs` set after `previous` (or at the start of a line, for -1). */
function extend(
	font: Font,
	previous: number,
	glyphs: readonly number[],
): { width: number; last: number } {
	let width = 0;
	let last = previous;
	for (const glyph of glyphs) {
		if (last >= 0) width += font.kerning(last, glyph);
		width += font.advance(glyph);
		last = glyph;
	}
	return { width, last };
}

/** Words and the spaces before each, as runs of items. */
function words(items: readonly Item[]): { space: Item[]; word: Item[] }[] {
	const out: { space: Item[]; word: Item[] }[] = [];
	let space: Item[] = [];
	let word: Item[] = [];
	for (const item of items) {
		if (item.space) {
			if (word.length > 0) {
				out.push({ space, word });
				space = [];
				word = [];
			}
			space.push(item);
		} else {
			word.push(item);
		}
	}
	if (word.length > 0) out.push({ space, word });
	return out;
}

const drawn = (items: readonly Item[]): number[] =>
	items.filter((item) => item.glyph >= 0).map((item) => item.glyph);

/** Break every paragraph into lines no wider than `limit` font units, where a word allows. */
function breakLines(font: Font, paragraphs: readonly Paragraph[], limit: number): Line[] {
	const lines: Line[] = [];
	for (const paragraph of paragraphs) {
		const runs = words(paragraph.items);
		if (runs.length === 0) {
			lines.push({ start: paragraph.start, end: paragraph.start, glyphs: [], width: 0 });
			continue;
		}
		let current: {
			start: number;
			end: number;
			glyphs: number[];
			width: number;
			last: number;
		} | null = null;
		for (const run of runs) {
			const word = drawn(run.word);
			const first = run.word[0] as Item;
			const end = (run.word[run.word.length - 1] as Item).end;
			if (current !== null) {
				const joined = [...drawn(run.space), ...word];
				const grown = extend(font, current.last, joined);
				if (current.width + grown.width <= limit) {
					current.glyphs.push(...joined);
					current.width += grown.width;
					current.last = grown.last;
					current.end = end;
					continue;
				}
				lines.push(current);
			}
			const own = extend(font, -1, word);
			current = { start: first.at, end, glyphs: word, width: own.width, last: own.last };
		}
		lines.push(current as Line);
	}
	return lines;
}

interface Settings {
	readonly font: Font;
	readonly paragraphs: readonly Paragraph[];
	readonly box: {
		readonly x: number;
		readonly y: number;
		readonly width: number;
		readonly height: number;
	};
	readonly maxLines: number;
	readonly lineHeight: number;
}

/** Lines at a size, and whether they fit the box. */
function attempt(settings: Settings, size: number): { lines: Line[]; fits: boolean } {
	const { font, box } = settings;
	const scale = size / font.unitsPerEm;
	const limit = (box.width * (1 + SLACK)) / scale;
	const lines = breakLines(font, settings.paragraphs, limit);
	const widest = lines.reduce((most, line) => Math.max(most, line.width), 0);
	const fits =
		lines.length <= settings.maxLines &&
		widest <= limit &&
		lines.length * settings.lineHeight * size <= box.height * (1 + SLACK) + SLACK;
	return { lines, fits };
}

/** Lay out `text` in a box. See the module comment for what this does and does not do. */
export function layoutText(text: string, options: LayoutOptions): LayoutResult {
	if (typeof text !== 'string') throw new TypeError('layoutText: text is a string.');
	if (text.length > MAX_TEXT_LENGTH) {
		throw new TypeError(`layoutText: a caption is at most ${MAX_TEXT_LENGTH} code units.`);
	}
	if (typeof options !== 'object' || options === null) {
		throw new TypeError('layoutText: options gives at least the font, the size and the box.');
	}
	const fonts = options.fonts ?? createFontRegistry();
	if (typeof options.fontId !== 'string') throw new TypeError('layoutText: fontId is a string.');
	const font = fonts.require(options.fontId);
	const size = positive(options.size, 'size');
	const box = options.box;
	if (typeof box !== 'object' || box === null) throw new TypeError('layoutText: box is an object.');
	const x = finite(box.x, 'box.x');
	const y = finite(box.y, 'box.y');
	const width = finite(box.width, 'box.width');
	const height = finite(box.height, 'box.height');
	if (width < 0 || height < 0)
		throw new TypeError('layoutText: the box cannot have a negative size.');
	const align: TextAlign = options.align ?? 'centre';
	if (align !== 'start' && align !== 'centre' && align !== 'end') {
		throw new TypeError('layoutText: align is start, centre or end.');
	}
	const maxLines = options.maxLines ?? 1;
	if (!Number.isInteger(maxLines) || maxLines < 1) {
		throw new TypeError('layoutText: maxLines is a whole number, 1 or more.');
	}
	const lineHeight = positive(options.lineHeight ?? DEFAULT_LINE_HEIGHT, 'lineHeight');
	const shrink = options.shrinkToFit ?? false;
	if (typeof shrink !== 'boolean') throw new TypeError('layoutText: shrinkToFit is true or false.');
	const minSize = positive(options.minSize ?? size / 2, 'minSize');
	if (minSize > size) throw new TypeError('layoutText: minSize cannot be more than size.');

	const normal = text.normalize('NFC');
	const missing: number[] = [];
	const paragraphs = normal.length === 0 ? [] : itemise(normal, font, missing);
	const settings: Settings = {
		font,
		paragraphs,
		box: { x, y, width, height },
		maxLines,
		lineHeight,
	};

	let used = size;
	let result = attempt(settings, size);
	if (!result.fits && shrink) {
		const floor = attempt(settings, minSize);
		if (!floor.fits) {
			used = minSize;
			result = floor;
		} else {
			// The floor fits and the size asked for does not, so the largest size
			// that fits lies between them. Halving keeps the answer one that has
			// been laid out and found to fit.
			let lo = minSize;
			let hi = size;
			let best = floor;
			for (let i = 0; i < SHRINK_STEPS; i += 1) {
				const mid = (lo + hi) / 2;
				const tried = attempt(settings, mid);
				if (tried.fits) {
					lo = mid;
					best = tried;
				} else {
					hi = mid;
				}
			}
			used = lo;
			result = best;
		}
	}

	const kept = result.lines.slice(0, maxLines);
	const scale = used / font.unitsPerEm;
	const pitch = lineHeight * used;
	const top = y + (height - kept.length * pitch) / 2;
	const inner = (pitch - (font.ascender - font.descender) * scale) / 2 + font.ascender * scale;
	const lines: LayoutLine[] = [];
	const paths: Path[] = [];
	kept.forEach((line, i) => {
		const lineWidth = line.width * scale;
		const left =
			align === 'start' ? x : align === 'end' ? x + width - lineWidth : x + (width - lineWidth) / 2;
		const baseline = top + i * pitch + inner;
		const builder = new PathBuilder();
		let pen = 0;
		let previous = -1;
		for (const glyph of line.glyphs) {
			if (previous >= 0) pen += font.kerning(previous, glyph);
			builder
				.transform([scale, 0, 0, -scale, left + pen * scale, baseline])
				.append(font.path(glyph));
			pen += font.advance(glyph);
			previous = glyph;
		}
		paths.push(builder.build());
		lines.push(
			Object.freeze({
				text: normal.slice(line.start, line.end),
				start: line.start,
				end: line.end,
				x: left,
				baseline,
				width: lineWidth,
			}),
		);
	});
	return Object.freeze({
		paths: Object.freeze(paths),
		lines: Object.freeze(lines),
		missing: Object.freeze(missing),
		overflow: !result.fits,
		size: used,
	});
}

/**
 * The paths alone, for a caller that wants all of the text or nothing.
 *
 * Throws `QrStudioError` 'font/missing-glyphs' (params.count, the number of
 * distinct code points) rather than drawing text with pieces left out.
 */
export function textToPaths(text: string, options: LayoutOptions): readonly Path[] {
	const result = layoutText(text, options);
	if (result.missing.length > 0) {
		throw new QrStudioError(
			'font/missing-glyphs',
			'This font cannot draw some of these characters. Choose another font, or change the text.',
			{ count: result.missing.length },
		);
	}
	return result.paths;
}
