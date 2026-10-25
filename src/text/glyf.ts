/**
 * Glyph outlines from the `glyf` and `loca` tables.
 *
 * A simple glyph is a list of contours of quadratic points, delta coded with
 * flags that say which coordinates are a byte, a word or a repeat. A
 * composite glyph is a list of other glyphs, each moved, and possibly scaled
 * or sheared, into place: accented letters are usually a base letter and a
 * mark.
 *
 * Every glyph is decoded once when the font is parsed, to check it, and
 * again when it is first drawn. The first pass also walks the composite
 * graph: a component must exist, a chain of composites may be at most
 * `MAX_DEPTH` deep (which also rules out a glyph that contains itself), and
 * no glyph may resolve to more than `MAX_POINTS` points, so a file built to
 * double its point count at every level is refused before anything is
 * allocated for it. After that pass, drawing any glyph cannot fail.
 */

import { malformed } from './errors.js';
import type { Table } from './reader.js';
import type { GlyphOutline } from './types.js';

/** How deep composites may nest. FreeType and HarfBuzz allow less than they could; so does this. */
export const MAX_DEPTH = 8;

/** The most points one glyph may resolve to, which is what a simple glyph can hold. A glyph in a text face has tens. */
export const MAX_POINTS = 65536;

const ARG_WORDS = 0x0001;
const ARGS_ARE_XY = 0x0002;
const HAVE_SCALE = 0x0008;
const MORE = 0x0020;
const HAVE_XY_SCALE = 0x0040;
const HAVE_TWO_BY_TWO = 0x0080;
const SCALED_OFFSET = 0x0800;

const ON_CURVE = 0x01;
const X_SHORT = 0x02;
const Y_SHORT = 0x04;
const REPEAT = 0x08;
const X_SAME = 0x10;
const Y_SAME = 0x20;

export interface Component {
	readonly glyph: number;
	/** a, b, c, d of the 2 by 2: x' = a x + c y, y' = b x + d y. */
	readonly a: number;
	readonly b: number;
	readonly c: number;
	readonly d: number;
	/** The offset, when it is given as one. */
	readonly dx: number;
	readonly dy: number;
	/** Point numbers to line up instead, parent first, when the offset is not given directly. */
	readonly match: readonly [number, number] | null;
	/** Whether the offset goes through the 2 by 2 too. */
	readonly scaledOffset: boolean;
}

export type RawGlyph =
	| { readonly kind: 'simple'; readonly outline: GlyphOutline }
	| { readonly kind: 'composite'; readonly components: readonly Component[] };

const EMPTY: RawGlyph = {
	kind: 'simple',
	outline: { points: new Float64Array(0), onCurve: new Uint8Array(0), ends: [] },
};

export interface Glyphs {
	readonly count: number;
	/** The glyph's own record, composites unresolved. */
	raw(glyph: number): RawGlyph;
}

/** Read `loca` and check every glyph in `glyf`. */
export function parseGlyphs(glyf: Table, loca: Table, count: number, longOffsets: boolean): Glyphs {
	const offsets = new Uint32Array(count + 1);
	for (let i = 0; i <= count; i += 1) {
		offsets[i] = longOffsets ? loca.u32(i * 4) : loca.u16(i * 2) * 2;
		if (i > 0 && (offsets[i] as number) < (offsets[i - 1] as number)) malformed('loca', 'unsorted');
	}
	if ((offsets[count] as number) > glyf.length) malformed('loca', 'out-of-range');

	const raw = (glyph: number): RawGlyph => {
		const start = offsets[glyph] as number;
		const length = (offsets[glyph + 1] as number) - start;
		return length === 0 ? EMPTY : decodeGlyph(glyf.slice(start, length), count);
	};

	// Points each glyph resolves to (-1 while not yet known), and how many
	// levels of composite lie beneath it. Both are kept so a glyph reached
	// again is not walked again, and the height is what keeps that honest: a
	// chain of composites a thousand long, met from its shallow end one glyph
	// at a time, would otherwise pass the depth check one level at a time and
	// then recurse a thousand deep when drawn.
	const points = new Int32Array(count).fill(-1);
	const heights = new Uint8Array(count);
	const resolve = (glyph: number, depth: number): number => {
		const known = points[glyph] as number;
		if (known >= 0) {
			if (depth + (heights[glyph] as number) > MAX_DEPTH) malformed('glyf', 'too-large');
			return known;
		}
		// A glyph that contains itself never finishes, so it reaches this.
		if (depth > MAX_DEPTH) malformed('glyf', 'too-large');
		const record = raw(glyph);
		let total = 0;
		let height = 0;
		if (record.kind === 'simple') {
			total = record.outline.onCurve.length;
		} else {
			for (const component of record.components) {
				const own = resolve(component.glyph, depth + 1);
				if (component.match !== null) {
					const [parent, child] = component.match;
					if (parent >= total || child >= own) malformed('glyf', 'out-of-range');
				}
				total += own;
				height = Math.max(height, (heights[component.glyph] as number) + 1);
			}
		}
		if (total > MAX_POINTS) malformed('glyf', 'too-large');
		heights[glyph] = height;
		points[glyph] = total;
		return total;
	};
	for (let glyph = 0; glyph < count; glyph += 1) resolve(glyph, 0);

	return { count, raw };
}

function decodeGlyph(table: Table, count: number): RawGlyph {
	const contours = table.i16(0);
	if (contours >= 0) return { kind: 'simple', outline: decodeSimple(table, contours) };
	if (contours !== -1) malformed('glyf', 'out-of-range');
	return { kind: 'composite', components: decodeComposite(table, count) };
}

function decodeSimple(table: Table, contours: number): GlyphOutline {
	const ends: number[] = [];
	let previous = -1;
	for (let i = 0; i < contours; i += 1) {
		const last = table.u16(10 + i * 2);
		if (last <= previous) malformed('glyf', 'unsorted');
		ends.push(last + 1);
		previous = last;
	}
	const total = previous + 1;
	const instructions = table.u16(10 + contours * 2);
	let at = 12 + contours * 2 + instructions;
	table.need(at, 0);

	const flags = new Uint8Array(total);
	for (let i = 0; i < total;) {
		const flag = table.u8(at);
		at += 1;
		flags[i] = flag;
		i += 1;
		if (flag & REPEAT) {
			const repeat = table.u8(at);
			at += 1;
			if (i + repeat > total) malformed('glyf', 'out-of-range');
			flags.fill(flag, i, i + repeat);
			i += repeat;
		}
	}

	const points = new Float64Array(total * 2);
	const onCurve = new Uint8Array(total);
	let value = 0;
	for (let i = 0; i < total; i += 1) {
		const flag = flags[i] as number;
		onCurve[i] = flag & ON_CURVE;
		if (flag & X_SHORT) {
			const delta = table.u8(at);
			at += 1;
			value += flag & X_SAME ? delta : -delta;
		} else if (!(flag & X_SAME)) {
			value += table.i16(at);
			at += 2;
		}
		points[i * 2] = value;
	}
	value = 0;
	for (let i = 0; i < total; i += 1) {
		const flag = flags[i] as number;
		if (flag & Y_SHORT) {
			const delta = table.u8(at);
			at += 1;
			value += flag & Y_SAME ? delta : -delta;
		} else if (!(flag & Y_SAME)) {
			value += table.i16(at);
			at += 2;
		}
		points[i * 2 + 1] = value;
	}
	return { points, onCurve, ends };
}

function decodeComposite(table: Table, count: number): Component[] {
	const components: Component[] = [];
	let at = 10;
	for (;;) {
		const flags = table.u16(at);
		const glyph = table.u16(at + 2);
		at += 4;
		if (glyph >= count) malformed('glyf', 'out-of-range');
		let arg1: number;
		let arg2: number;
		const xy = (flags & ARGS_ARE_XY) !== 0;
		if (flags & ARG_WORDS) {
			arg1 = xy ? table.i16(at) : table.u16(at);
			arg2 = xy ? table.i16(at + 2) : table.u16(at + 2);
			at += 4;
		} else {
			arg1 = xy ? table.i8(at) : table.u8(at);
			arg2 = xy ? table.i8(at + 1) : table.u8(at + 1);
			at += 2;
		}
		let a = 1;
		let b = 0;
		let c = 0;
		let d = 1;
		if (flags & HAVE_SCALE) {
			a = d = table.f2dot14(at);
			at += 2;
		} else if (flags & HAVE_XY_SCALE) {
			a = table.f2dot14(at);
			d = table.f2dot14(at + 2);
			at += 4;
		} else if (flags & HAVE_TWO_BY_TWO) {
			a = table.f2dot14(at);
			b = table.f2dot14(at + 2);
			c = table.f2dot14(at + 4);
			d = table.f2dot14(at + 6);
			at += 8;
		}
		components.push({
			glyph,
			a,
			b,
			c,
			d,
			dx: xy ? arg1 : 0,
			dy: xy ? arg2 : 0,
			match: xy ? null : [arg1, arg2],
			scaledOffset: (flags & SCALED_OFFSET) !== 0,
		});
		if (!(flags & MORE)) break;
	}
	return components;
}

/**
 * A glyph with its composites resolved into one outline.
 *
 * Components are transformed and placed in order, then their contours are
 * appended, as the format specifies. A component placed by matching points
 * lines up its point `child` (after its own transform) with the composite's
 * point `parent` among those placed so far, both already checked to exist.
 */
export function resolveGlyph(glyphs: Glyphs, glyph: number): GlyphOutline {
	const record = glyphs.raw(glyph);
	if (record.kind === 'simple') return record.outline;
	const xs: number[] = [];
	const flags: number[] = [];
	const ends: number[] = [];
	for (const component of record.components) {
		const part = resolveGlyph(glyphs, component.glyph);
		const base = flags.length;
		const { a, b, c, d } = component;
		const n = part.onCurve.length;
		for (let i = 0; i < n; i += 1) {
			const x = part.points[i * 2] as number;
			const y = part.points[i * 2 + 1] as number;
			xs.push(a * x + c * y, b * x + d * y);
			flags.push(part.onCurve[i] as number);
		}
		let dx = component.dx;
		let dy = component.dy;
		if (component.match !== null) {
			const [parent, child] = component.match;
			dx = (xs[parent * 2] as number) - (xs[(base + child) * 2] as number);
			dy = (xs[parent * 2 + 1] as number) - (xs[(base + child) * 2 + 1] as number);
		} else if (component.scaledOffset) {
			const ox = dx;
			dx = a * ox + c * dy;
			dy = b * ox + d * dy;
		}
		for (let i = base; i < base + n; i += 1) {
			xs[i * 2] = (xs[i * 2] as number) + dx;
			xs[i * 2 + 1] = (xs[i * 2 + 1] as number) + dy;
		}
		for (const end of part.ends) ends.push(base + end);
	}
	return { points: Float64Array.from(xs), onCurve: Uint8Array.from(flags), ends };
}
