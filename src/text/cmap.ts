/**
 * The character map: which glyph draws which code point.
 *
 * Two subtable formats cover every Unicode font in practice: format 4 for the
 * Basic Multilingual Plane and format 12 for everything. A format 12 subtable
 * is preferred when there is one, since it is the complete map; otherwise a
 * format 4. A font with neither (a symbol font, or one mapped only for old Mac
 * encodings) has no Unicode map this layer can use, and is refused.
 *
 * Both formats are checked in full as they are read: segments and groups in
 * order, nothing past the end of the table, and every glyph they name inside
 * the font. A lookup afterwards is a binary search that cannot fail.
 */

import { malformed } from './errors.js';
import type { Table } from './reader.js';

export type CharMap = (codePoint: number) => number;

/** Platform and encoding pairs that mean Unicode, best first, with the format each is used for. */
const PREFERENCE: readonly (readonly [number, number, number])[] = [
	[3, 10, 12],
	[0, 6, 12],
	[0, 4, 12],
	[3, 1, 4],
	[0, 3, 4],
	[0, 2, 4],
	[0, 1, 4],
	[0, 0, 4],
];

export function parseCmap(table: Table, glyphCount: number): CharMap {
	if (table.u16(0) !== 0) malformed('cmap', 'unsupported');
	const count = table.u16(2);
	const records: { platform: number; encoding: number; offset: number }[] = [];
	for (let i = 0; i < count; i += 1) {
		const at = 4 + i * 8;
		records.push({
			platform: table.u16(at),
			encoding: table.u16(at + 2),
			offset: table.u32(at + 4),
		});
	}
	for (const [platform, encoding, format] of PREFERENCE) {
		for (const record of records) {
			if (record.platform !== platform || record.encoding !== encoding) continue;
			if (table.u16(record.offset) !== format) continue;
			return format === 12
				? format12(table.slice(record.offset), glyphCount)
				: format4(table, record.offset, glyphCount);
		}
	}
	return malformed('cmap', 'unsupported');
}

/** Index of the last entry in `starts` at or below `value`, or -1. */
function floorSearch(starts: Uint32Array, value: number): number {
	let lo = 0;
	let hi = starts.length - 1;
	let found = -1;
	while (lo <= hi) {
		const mid = (lo + hi) >>> 1;
		if ((starts[mid] as number) <= value) {
			found = mid;
			lo = mid + 1;
		} else {
			hi = mid - 1;
		}
	}
	return found;
}

function format12(table: Table, glyphCount: number): CharMap {
	const length = table.u32(4);
	const groups = table.u32(12);
	// A length that claims less than the groups need, or more than the file
	// holds, is the same broken table either way.
	if (length > table.length || length < 16 || groups > (length - 16) / 12) {
		malformed('cmap', 'truncated');
	}
	const starts = new Uint32Array(groups);
	const ends = new Uint32Array(groups);
	const glyphs = new Uint32Array(groups);
	let previousEnd = -1;
	for (let i = 0; i < groups; i += 1) {
		const at = 16 + i * 12;
		const start = table.u32(at);
		const end = table.u32(at + 4);
		const glyph = table.u32(at + 8);
		if (start <= previousEnd) malformed('cmap', 'unsorted');
		if (end < start || end > 0x10ffff || glyph + (end - start) >= glyphCount) {
			malformed('cmap', 'out-of-range');
		}
		starts[i] = start;
		ends[i] = end;
		glyphs[i] = glyph;
		previousEnd = end;
	}
	return (codePoint) => {
		const i = floorSearch(starts, codePoint);
		if (i < 0 || codePoint > (ends[i] as number)) return 0;
		return (glyphs[i] as number) + codePoint - (starts[i] as number);
	};
}

function format4(cmap: Table, offset: number, glyphCount: number): CharMap {
	// The length field is 16 bits, and a large format 4 subtable overflows it,
	// so the subtable is taken to run to the end of the cmap and every read is
	// still checked against that.
	const table = cmap.slice(offset);
	const doubled = table.u16(6);
	if (doubled === 0 || doubled % 2 !== 0) malformed('cmap', 'out-of-range');
	const segments = doubled / 2;
	const endAt = 14;
	const startAt = endAt + doubled + 2;
	const deltaAt = startAt + doubled;
	const rangeAt = deltaAt + doubled;
	const starts = new Uint32Array(segments);
	const ends = new Uint32Array(segments);
	const deltas = new Int32Array(segments);
	const ranges = new Uint32Array(segments);
	let previousEnd = -1;
	for (let i = 0; i < segments; i += 1) {
		const end = table.u16(endAt + i * 2);
		const start = table.u16(startAt + i * 2);
		if (start <= previousEnd) malformed('cmap', 'unsorted');
		if (end < start) malformed('cmap', 'out-of-range');
		starts[i] = start;
		ends[i] = end;
		deltas[i] = table.i16(deltaAt + i * 2);
		ranges[i] = table.u16(rangeAt + i * 2);
		previousEnd = end;
	}
	const lookup = (i: number, codePoint: number): number => {
		const delta = deltas[i] as number;
		const range = ranges[i] as number;
		if (range === 0) return (codePoint + delta) & 0xffff;
		const at = rangeAt + i * 2 + range + ((codePoint - (starts[i] as number)) << 1);
		const raw = table.u16(at);
		return raw === 0 ? 0 : (raw + delta) & 0xffff;
	};
	// Every code point the map covers is checked once here: at most 65536 of
	// them, since segments are in order and cannot overlap. After this a
	// lookup cannot read outside the table or name a glyph the font lacks.
	for (let i = 0; i < segments; i += 1) {
		for (let c = starts[i] as number; c <= (ends[i] as number); c += 1) {
			if (lookup(i, c) >= glyphCount) malformed('cmap', 'out-of-range');
		}
	}
	return (codePoint) => {
		if (codePoint > 0xffff) return 0;
		const i = floorSearch(starts, codePoint);
		if (i < 0 || codePoint > (ends[i] as number)) return 0;
		return lookup(i, codePoint);
	};
}
