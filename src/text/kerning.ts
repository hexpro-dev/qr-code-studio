/**
 * Pair kerning, from GPOS or from the older `kern` table.
 *
 * GPOS kerning is the `kern` feature's pair adjustment lookups (type 2, or
 * type 9 extensions wrapping them), each a list of subtables: format 1 lists
 * pairs glyph by glyph, format 2 kerns classes of glyphs against each other.
 * Within one lookup the first subtable that covers the pair decides it; across
 * lookups the adjustments add up, because a shaper applies every lookup of the
 * feature in turn. That is what HarfBuzz, CoreText and DirectWrite do, and
 * what resvg does through rustybuzz. (opentype.js's `getKerningValue` stops at
 * the first lookup that covers the left glyph, which disagrees with all of them
 * for fonts that spread their kerning over several lookups, as IBM Plex does.)
 *
 * Which lookups: those the `kern` feature names in the default language
 * system of every script the font lists, together, in lookup order. Arabic
 * shaping and the like are out of scope, so a lookup meant for one script
 * still only ever meets the glyphs of that script.
 *
 * Only the first glyph's x advance is used. A value record can also move the
 * second glyph without moving the pen, or move it vertically; neither is
 * kerning as a line of Latin text uses it, and both are skipped.
 *
 * The older `kern` table is read only when GPOS has no kerning, as shapers
 * do. Its format 0 subtables (Microsoft's and Apple's headers both) are
 * summed, horizontal ones only, an override replacing what came before.
 *
 * Everything is read and checked when the font is parsed. A query is then a
 * handful of binary searches in typed arrays.
 */

import { malformed } from './errors.js';
import type { Table } from './reader.js';

export type Kerning = (left: number, right: number) => number;

/** The most pair subtables the kern lookups may hold between them. */
export const MAX_SUBTABLES = 1024;

const NONE: Kerning = () => 0;

/** A coverage table as a function from glyph to coverage index, or -1. */
type Coverage = (glyph: number) => number;
/** A class definition as a function from glyph to class. */
type ClassDef = (glyph: number) => number;

type Subtable =
	| {
			readonly format: 1;
			readonly coverage: Coverage;
			/** Per coverage index: the second glyphs, sorted, and the adjustment for each. */
			readonly seconds: readonly Uint16Array[];
			readonly values: readonly Int16Array[];
	  }
	| {
			readonly format: 2;
			readonly coverage: Coverage;
			readonly first: ClassDef;
			readonly second: ClassDef;
			readonly secondCount: number;
			readonly values: Int16Array;
	  };

/** Index of `value` in a sorted array, or -1. */
function search(sorted: Uint16Array | Uint32Array, value: number): number {
	let lo = 0;
	let hi = sorted.length - 1;
	while (lo <= hi) {
		const mid = (lo + hi) >>> 1;
		const at = sorted[mid] as number;
		if (at === value) return mid;
		if (at < value) lo = mid + 1;
		else hi = mid - 1;
	}
	return -1;
}

/** Index of the last range starting at or before `value`, or -1. */
function floor(starts: Uint16Array, value: number): number {
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

/** Read sorted, non-overlapping ranges of `record` bytes each: start, end, then a value. */
function ranges(
	table: Table,
	at: number,
	count: number,
	record: number,
): { starts: Uint16Array; ends: Uint16Array; values: Uint16Array } {
	const starts = new Uint16Array(count);
	const ends = new Uint16Array(count);
	const values = new Uint16Array(count);
	let previous = -1;
	for (let i = 0; i < count; i += 1) {
		const where = at + i * record;
		const start = table.u16(where);
		const end = table.u16(where + 2);
		if (start <= previous) malformed('GPOS', 'unsorted');
		if (end < start) malformed('GPOS', 'out-of-range');
		starts[i] = start;
		ends[i] = end;
		values[i] = table.u16(where + 4);
		previous = end;
	}
	return { starts, ends, values };
}

/** A coverage table, and how many glyphs it covers. */
function coverage(table: Table): { coverage: Coverage; size: number } {
	const format = table.u16(0);
	const count = table.u16(2);
	if (format === 1) {
		const glyphs = new Uint16Array(count);
		for (let i = 0; i < count; i += 1) {
			glyphs[i] = table.u16(4 + i * 2);
			if (i > 0 && (glyphs[i] as number) <= (glyphs[i - 1] as number)) {
				malformed('GPOS', 'unsorted');
			}
		}
		return { coverage: (glyph) => search(glyphs, glyph), size: count };
	}
	if (format !== 2) malformed('GPOS', 'unsupported');
	const { starts, ends, values } = ranges(table, 4, count, 6);
	// Each range's first index must follow on from the one before, so the
	// indices are exactly 0 to size - 1 and index the pair sets directly.
	let size = 0;
	for (let i = 0; i < count; i += 1) {
		if (values[i] !== size) malformed('GPOS', 'out-of-range');
		size += (ends[i] as number) - (starts[i] as number) + 1;
	}
	return {
		coverage: (glyph) => {
			const i = floor(starts, glyph);
			if (i < 0 || glyph > (ends[i] as number)) return -1;
			return (values[i] as number) + glyph - (starts[i] as number);
		},
		size,
	};
}

/** A class definition, every class below `classes`. Glyphs it does not list are class 0. */
function classDef(table: Table, classes: number): ClassDef {
	const format = table.u16(0);
	if (format === 1) {
		const start = table.u16(2);
		const count = table.u16(4);
		const values = new Uint16Array(count);
		for (let i = 0; i < count; i += 1) {
			values[i] = table.u16(6 + i * 2);
			if ((values[i] as number) >= classes) malformed('GPOS', 'out-of-range');
		}
		return (glyph) => {
			const i = glyph - start;
			return i >= 0 && i < count ? (values[i] as number) : 0;
		};
	}
	if (format !== 2) malformed('GPOS', 'unsupported');
	const { starts, ends, values } = ranges(table, 4, table.u16(2), 6);
	for (const value of values) if (value >= classes) malformed('GPOS', 'out-of-range');
	return (glyph) => {
		const i = floor(starts, glyph);
		return i < 0 || glyph > (ends[i] as number) ? 0 : (values[i] as number);
	};
}

/** Bytes a value record takes, and where its x advance sits in it (or -1). */
function valueLayout(format: number): { size: number; advance: number } {
	if (format & 0xff00) malformed('GPOS', 'unsupported');
	let size = 0;
	let advance = -1;
	for (let bit = 0; bit < 8; bit += 1) {
		if (!(format & (1 << bit))) continue;
		if (bit === 2) advance = size;
		size += 2;
	}
	return { size, advance };
}

function pairSubtable(table: Table): Subtable {
	const format = table.u16(0);
	const { coverage: covers, size } = coverage(table.slice(table.u16(2)));
	const first = valueLayout(table.u16(4));
	const second = valueLayout(table.u16(6));
	const record = first.size + second.size;
	const read = (at: number): number => (first.advance < 0 ? 0 : table.i16(at + first.advance));
	if (format === 1) {
		const count = table.u16(8);
		if (size > count) malformed('GPOS', 'out-of-range');
		const seconds: Uint16Array[] = [];
		const values: Int16Array[] = [];
		for (let i = 0; i < count; i += 1) {
			const set = table.slice(table.u16(10 + i * 2));
			const pairs = set.u16(0);
			set.need(2, pairs * (2 + record));
			const glyphs = new Uint16Array(pairs);
			const adjust = new Int16Array(pairs);
			for (let j = 0; j < pairs; j += 1) {
				const at = 2 + j * (2 + record);
				glyphs[j] = set.u16(at);
				if (j > 0 && (glyphs[j] as number) <= (glyphs[j - 1] as number)) {
					malformed('GPOS', 'unsorted');
				}
				adjust[j] = first.advance < 0 ? 0 : set.i16(at + 2 + first.advance);
			}
			seconds.push(glyphs);
			values.push(adjust);
		}
		return { format: 1, coverage: covers, seconds, values };
	}
	if (format !== 2) malformed('GPOS', 'unsupported');
	const firstCount = table.u16(12);
	const secondCount = table.u16(14);
	const firstClass = classDef(table.slice(table.u16(8)), firstCount);
	const secondClass = classDef(table.slice(table.u16(10)), secondCount);
	const values = new Int16Array(firstCount * secondCount);
	table.need(16, values.length * record);
	for (let i = 0; i < values.length; i += 1) values[i] = read(16 + i * record);
	return {
		format: 2,
		coverage: covers,
		first: firstClass,
		second: secondClass,
		secondCount,
		values,
	};
}

/** The lookup indices the `kern` feature names, across every script's default language system. */
function kernLookups(table: Table, featureList: Table, lookupCount: number): number[] {
	const features = featureList.u16(0);
	const chosen = new Set<number>();
	const scripts = table.u16(0);
	for (let i = 0; i < scripts; i += 1) {
		const script = table.slice(table.u16(2 + i * 6 + 4));
		const offset = script.u16(0);
		if (offset === 0) continue;
		const langSys = script.slice(offset);
		const count = langSys.u16(4);
		for (let j = 0; j < count; j += 1) {
			const index = langSys.u16(6 + j * 2);
			if (index >= features) malformed('GPOS', 'out-of-range');
			if (featureList.tagAt(2 + index * 6) !== 'kern') continue;
			const feature = featureList.slice(featureList.u16(2 + index * 6 + 4));
			const lookups = feature.u16(2);
			for (let k = 0; k < lookups; k += 1) {
				const lookup = feature.u16(4 + k * 2);
				if (lookup >= lookupCount) malformed('GPOS', 'out-of-range');
				chosen.add(lookup);
			}
		}
	}
	return [...chosen].sort((a, b) => a - b);
}

/** The kern feature's pair lookups, each a list of subtables, or null when there are none. */
function parseGpos(table: Table): Subtable[][] | null {
	if (table.u16(0) !== 1) malformed('GPOS', 'unsupported');
	// A null offset is a list that is not there, which is a font with no
	// kerning in GPOS rather than a broken one.
	if (table.u16(4) === 0 || table.u16(6) === 0 || table.u16(8) === 0) return null;
	const lookupList = table.slice(table.u16(8));
	const lookupCount = lookupList.u16(0);
	const indices = kernLookups(table.slice(table.u16(4)), table.slice(table.u16(6)), lookupCount);
	const lookups: Subtable[][] = [];
	let total = 0;
	for (const index of indices) {
		const lookup = lookupList.slice(lookupList.u16(2 + index * 2));
		const type = lookup.u16(0);
		// Contextual and chained kerning are shaping, not pair kerning, and are
		// left out with the rest of shaping.
		if (type !== 2 && type !== 9) continue;
		const count = lookup.u16(4);
		total += count;
		if (total > MAX_SUBTABLES) malformed('GPOS', 'too-large');
		const subtables: Subtable[] = [];
		for (let i = 0; i < count; i += 1) {
			let subtable = lookup.slice(lookup.u16(6 + i * 2));
			if (type === 9) {
				if (subtable.u16(0) !== 1) malformed('GPOS', 'unsupported');
				// Every subtable of an extension lookup has the one type, and an
				// extension may not wrap another.
				if (subtable.u16(2) !== 2) malformed('GPOS', 'unsupported');
				subtable = subtable.slice(subtable.u32(4));
			}
			subtables.push(pairSubtable(subtable));
		}
		lookups.push(subtables);
	}
	return lookups.length === 0 ? null : lookups;
}

function gposKerning(lookups: readonly Subtable[][]): Kerning {
	return (left, right) => {
		let total = 0;
		for (const subtables of lookups) {
			for (const subtable of subtables) {
				const index = subtable.coverage(left);
				if (index < 0) continue;
				if (subtable.format === 1) {
					const at = search(subtable.seconds[index] as Uint16Array, right);
					// A format 1 subtable that covers the first glyph but not the
					// pair lets the next subtable try.
					if (at < 0) continue;
					total += (subtable.values[index] as Int16Array)[at] as number;
					break;
				}
				total += subtable.values[
					subtable.first(left) * subtable.secondCount + subtable.second(right)
				] as number;
				break;
			}
		}
		return total;
	};
}

/** One format 0 subtable's pairs, as sorted keys and their values. */
function formatZero(
	table: Table,
	at: number,
): { keys: Uint32Array; values: Int16Array; end: number } {
	const pairs = table.u16(at);
	const keys = new Uint32Array(pairs);
	const values = new Int16Array(pairs);
	for (let i = 0; i < pairs; i += 1) {
		const where = at + 8 + i * 6;
		keys[i] = table.u16(where) * 0x10000 + table.u16(where + 2);
		if (i > 0 && (keys[i] as number) <= (keys[i - 1] as number)) malformed('kern', 'unsorted');
		values[i] = table.i16(where + 4);
	}
	return { keys, values, end: at + 8 + pairs * 6 };
}

function parseKern(table: Table): Kerning {
	const parts: { keys: Uint32Array; values: Int16Array; override: boolean }[] = [];
	const apple = table.u16(0) === 1;
	if (!apple && table.u16(0) !== 0) malformed('kern', 'unsupported');
	const count = apple ? table.u32(4) : table.u16(2);
	if (count > MAX_SUBTABLES) malformed('kern', 'too-large');
	let at = apple ? 8 : 4;
	for (let i = 0; i < count; i += 1) {
		// Microsoft: version, length (16 bits), coverage with the format in its
		// high byte. Apple: length (32 bits), coverage with the format in its
		// low byte, tuple index.
		const length = apple ? table.u32(at) : table.u16(at + 2);
		const cover = table.u16(at + 4);
		const header = apple ? 8 : 6;
		const format = apple ? cover & 0xff : cover >> 8;
		const horizontal = apple ? (cover & 0xe000) === 0 : (cover & 0x0007) === 0x0001;
		let next = at + length;
		if (length < header) malformed('kern', 'out-of-range');
		if (format === 0) {
			const { keys, values, end } = formatZero(table, at + header);
			if (horizontal) parts.push({ keys, values, override: !apple && (cover & 0x0008) !== 0 });
			// A large Microsoft subtable overflows its 16 bit length, so the
			// pairs themselves say where it ends.
			next = Math.max(next, end);
		}
		at = next;
	}
	if (parts.length === 0) return NONE;
	return (left, right) => {
		const key = left * 0x10000 + right;
		let total = 0;
		for (const part of parts) {
			const i = search(part.keys, key);
			if (i < 0) continue;
			const value = part.values[i] as number;
			total = part.override ? value : total + value;
		}
		return total;
	};
}

/** The font's pair kerning, from GPOS when it has any, else from `kern`, else none. */
export function parseKerning(gpos: Table | null, kern: Table | null): Kerning {
	if (gpos !== null) {
		const lookups = parseGpos(gpos);
		if (lookups !== null) return gposKerning(lookups);
	}
	return kern === null ? NONE : parseKern(kern);
}
