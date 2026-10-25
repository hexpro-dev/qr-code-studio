/**
 * Reading a TrueType font file, for fonts the website lets a person add.
 *
 * Only what drawing a caption needs is read: the table directory, `head`,
 * `hhea`, `maxp`, `hmtx`, `loca`, `glyf`, `cmap` (formats 4 and 12), and
 * kerning from GPOS or `kern`. Hinting, names, substitution and everything
 * else are left alone, which also means nothing in them can trip the parser.
 * A font with PostScript outlines (`OTTO`), a collection, or a WOFF wrapper is
 * refused as a format this reader does not handle.
 *
 * The parser is strict and does its checking up front. Every table is
 * bounded by the directory, every glyph is decoded once, the composite graph
 * is walked with a depth and size limit, the character map and the kerning
 * subtables are checked in full, and anything out of place throws
 * `FontMalformedError` ('font/malformed'). The work is bounded by the size of
 * the file, and a font that parses can draw every glyph it has without
 * another check failing.
 */

import { malformed } from './errors.js';
import { makeFont } from './font.js';
import { parseCmap } from './cmap.js';
import { parseGlyphs, resolveGlyph } from './glyf.js';
import type { Glyphs } from './glyf.js';
import { parseKerning } from './kerning.js';
import { Table } from './reader.js';
import type { Font } from './types.js';

/** The largest file this reader will look at: a full CJK face is about a quarter of it. */
export const MAX_FONT_BYTES = 64 * 1024 * 1024;

const KEBAB = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

export interface ParseFontOptions {
	/** The id it is registered under: kebab-case. */
	readonly id: string;
	/** What a font picker calls it. Defaults to 'text.font.registered'. */
	readonly labelKey?: string;
}

function directory(bytes: Uint8Array): Map<string, Table> {
	const file = new Table(bytes, 0, bytes.length, 'file');
	const version = file.u32(0);
	// 0x00010000, or 'true' as some old Apple fonts write it.
	if (version !== 0x00010000 && version !== 0x74727565) malformed('file', 'unsupported');
	const count = file.u16(4);
	const tables = new Map<string, Table>();
	for (let i = 0; i < count; i += 1) {
		const at = 12 + i * 16;
		const tag = file.tagAt(at);
		const offset = file.u32(at + 8);
		const length = file.u32(at + 12);
		// Checksums are not checked: browsers do not, and fonts in the wild get
		// them wrong without anything else being wrong.
		const table = file.slice(offset, length);
		if (!tables.has(tag)) tables.set(tag, new Table(bytes, table.start, length, tag));
	}
	return tables;
}

function required(tables: Map<string, Table>, tag: string): Table {
	return tables.get(tag) ?? malformed(tag, 'missing-table');
}

/**
 * Parse a TrueType font. Throws `FontMalformedError` for anything this reader
 * cannot use; throws a TypeError for an argument of the wrong kind.
 */
export function parseTrueType(bytes: Uint8Array, options: ParseFontOptions): Font {
	return parseTrueTypeTables(bytes, options).font;
}

/**
 * The font, with the glyph records behind it.
 *
 * For the build script, which keeps composite glyphs as composites when it
 * compiles the built-in family, and so needs them unresolved.
 */
export function parseTrueTypeTables(
	bytes: Uint8Array,
	options: ParseFontOptions,
): { readonly font: Font; readonly glyphs: Glyphs } {
	if (!(bytes instanceof Uint8Array)) throw new TypeError('parseTrueType: bytes is a Uint8Array.');
	if (typeof options !== 'object' || options === null || typeof options.id !== 'string') {
		throw new TypeError('parseTrueType: options gives at least the id.');
	}
	if (!KEBAB.test(options.id)) throw new TypeError('parseTrueType: the id must be kebab-case.');
	const labelKey = options.labelKey ?? 'text.font.registered';
	if (typeof labelKey !== 'string') throw new TypeError('parseTrueType: labelKey is a string.');
	if (bytes.length > MAX_FONT_BYTES) malformed('file', 'too-large');

	const tables = directory(bytes);
	const head = required(tables, 'head');
	if (head.u16(0) !== 1 || head.u32(12) !== 0x5f0f3cf5) malformed('head', 'unsupported');
	const unitsPerEm = head.u16(18);
	if (unitsPerEm < 16 || unitsPerEm > 16384) malformed('head', 'out-of-range');
	const locaFormat = head.i16(50);
	if (locaFormat !== 0 && locaFormat !== 1) malformed('head', 'out-of-range');

	const maxp = required(tables, 'maxp');
	const maxpVersion = maxp.u32(0);
	if (maxpVersion !== 0x00005000 && maxpVersion !== 0x00010000) malformed('maxp', 'unsupported');
	const glyphCount = maxp.u16(4);
	if (glyphCount === 0) malformed('maxp', 'out-of-range');

	const hhea = required(tables, 'hhea');
	hhea.need(0, 36);
	const ascender = hhea.i16(4);
	const descender = hhea.i16(6);
	const lineGap = hhea.i16(8);
	const metrics = hhea.u16(34);
	if (metrics === 0 || metrics > glyphCount) malformed('hhea', 'out-of-range');

	const hmtx = required(tables, 'hmtx');
	hmtx.need(0, metrics * 4 + (glyphCount - metrics) * 2);
	const advances = new Uint16Array(glyphCount);
	for (let i = 0; i < glyphCount; i += 1) {
		advances[i] = hmtx.u16(Math.min(i, metrics - 1) * 4);
	}

	const glyphs = parseGlyphs(
		required(tables, 'glyf'),
		required(tables, 'loca'),
		glyphCount,
		locaFormat === 1,
	);
	const glyphIndex = parseCmap(required(tables, 'cmap'), glyphCount);
	const kerning = parseKerning(tables.get('GPOS') ?? null, tables.get('kern') ?? null);

	const font = makeFont({
		id: options.id,
		labelKey,
		unitsPerEm,
		ascender,
		descender,
		lineGap,
		glyphCount,
		glyphIndex,
		advance: (glyph) => advances[glyph] as number,
		kerning,
		outline: (glyph) => resolveGlyph(glyphs, glyph),
	});
	return { font, glyphs };
}
