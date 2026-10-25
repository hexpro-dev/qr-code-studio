/**
 * A small TrueType writer for the parser's tests.
 *
 * The real fonts exercise the common paths. Everything else a font file can
 * say (composites that scale, shear or match points, both kerning tables in
 * every format, the character map formats, and every way of getting any of it
 * wrong) is built here from a description, so each branch of the parser has a
 * file that reaches it and the test says in plain terms what is in that file.
 *
 * Tables are described as lists of fields. A field can be an offset to a
 * child table, which is laid out after the parent's own fields and patched
 * in, so nested structures (GPOS especially) read as they are specified.
 */

export type Field =
	| { readonly u8: number }
	| { readonly i8: number }
	| { readonly u16: number }
	| { readonly i16: number }
	| { readonly u32: number }
	| { readonly tag: string }
	| { readonly bytes: Uint8Array }
	/** A 16 bit offset to a child, from the start of this table; null writes 0. */
	| { readonly offset16: Uint8Array | null }
	| { readonly offset32: Uint8Array | null };

/** Lay out fields, then the children they point to, in order. */
export function table(fields: readonly Field[]): Uint8Array {
	let size = 0;
	for (const field of fields) size += fieldSize(field);
	const children: Uint8Array[] = [];
	const placed: number[] = [];
	let end = size;
	for (const field of fields) {
		const child =
			'offset16' in field ? field.offset16 : 'offset32' in field ? field.offset32 : null;
		if (child === null || child === undefined) continue;
		placed.push(end);
		children.push(child);
		end += child.length;
	}
	const out = new Uint8Array(end);
	const view = new DataView(out.buffer);
	let at = 0;
	let child = 0;
	for (const field of fields) {
		if ('u8' in field) view.setUint8(at, field.u8);
		else if ('i8' in field) view.setInt8(at, field.i8);
		else if ('u16' in field) view.setUint16(at, field.u16);
		else if ('i16' in field) view.setInt16(at, field.i16);
		else if ('u32' in field) view.setUint32(at, field.u32);
		else if ('tag' in field) for (let i = 0; i < 4; i += 1) out[at + i] = field.tag.charCodeAt(i);
		else if ('bytes' in field) out.set(field.bytes, at);
		else if ('offset16' in field) {
			if (field.offset16 !== null) view.setUint16(at, placed[child++] as number);
		} else if (field.offset32 !== null) view.setUint32(at, placed[child++] as number);
		at += fieldSize(field);
	}
	children.forEach((bytes, i) => out.set(bytes, placed[i] as number));
	return out;
}

function fieldSize(field: Field): number {
	if ('u8' in field || 'i8' in field) return 1;
	if ('u16' in field || 'i16' in field || 'offset16' in field) return 2;
	if ('u32' in field || 'offset32' in field) return 4;
	if ('tag' in field) return 4;
	return field.bytes.length;
}

export const u16s = (values: readonly number[]): Field[] => values.map((u16) => ({ u16 }));

/** A point of a simple glyph: x, y, and whether it is on the curve. */
export type Point = readonly [number, number, boolean];

export type TestGlyph =
	| { readonly contours: readonly (readonly Point[])[]; readonly instructions?: number }
	| { readonly components: readonly TestComponent[] }
	| { readonly raw: Uint8Array }
	| null;

export interface TestComponent {
	readonly glyph: number;
	readonly dx?: number;
	readonly dy?: number;
	/** Point numbers to line up, parent then child, instead of an offset. */
	readonly match?: readonly [number, number];
	readonly words?: boolean;
	readonly scale?: number;
	readonly xyScale?: readonly [number, number];
	readonly twoByTwo?: readonly [number, number, number, number];
	readonly scaledOffset?: boolean;
	readonly extraFlags?: number;
}

/** A simple glyph, with every coordinate written as a word (the reader's other paths are reached by the real fonts). */
function simpleGlyph(contours: readonly (readonly Point[])[], instructions = 0): Uint8Array {
	const points = contours.flat();
	const fields: Field[] = [{ i16: contours.length }, ...u16s([0, 0, 0, 0])];
	let total = 0;
	for (const contour of contours) {
		total += contour.length;
		fields.push({ u16: total - 1 });
	}
	fields.push({ u16: instructions }, { bytes: new Uint8Array(instructions) });
	for (const [, , on] of points) fields.push({ u8: on ? 1 : 0 });
	let last = 0;
	for (const [x] of points) {
		fields.push({ i16: x - last });
		last = x;
	}
	last = 0;
	for (const [, y] of points) {
		fields.push({ i16: y - last });
		last = y;
	}
	return table(fields);
}

const f2dot14 = (value: number): Field => ({ i16: Math.round(value * 16384) });

function compositeGlyph(components: readonly TestComponent[]): Uint8Array {
	const fields: Field[] = [{ i16: -1 }, ...u16s([0, 0, 0, 0])];
	components.forEach((component, i) => {
		const xy = component.match === undefined;
		let flags = component.extraFlags ?? 0;
		if (component.words) flags |= 0x0001;
		if (xy) flags |= 0x0002;
		if (component.scale !== undefined) flags |= 0x0008;
		if (i + 1 < components.length) flags |= 0x0020;
		if (component.xyScale !== undefined) flags |= 0x0040;
		if (component.twoByTwo !== undefined) flags |= 0x0080;
		if (component.scaledOffset) flags |= 0x0800;
		fields.push({ u16: flags }, { u16: component.glyph });
		const [a1, a2] = xy
			? [component.dx ?? 0, component.dy ?? 0]
			: (component.match as [number, number]);
		if (component.words)
			fields.push(xy ? { i16: a1 } : { u16: a1 }, xy ? { i16: a2 } : { u16: a2 });
		else fields.push(xy ? { i8: a1 } : { u8: a1 }, xy ? { i8: a2 } : { u8: a2 });
		if (component.scale !== undefined) fields.push(f2dot14(component.scale));
		if (component.xyScale !== undefined) fields.push(...component.xyScale.map(f2dot14));
		if (component.twoByTwo !== undefined) fields.push(...component.twoByTwo.map(f2dot14));
	});
	return table(fields);
}

export function glyphBytes(glyph: TestGlyph): Uint8Array {
	if (glyph === null) return new Uint8Array(0);
	if ('raw' in glyph) return glyph.raw;
	if ('components' in glyph) return compositeGlyph(glyph.components);
	return simpleGlyph(glyph.contours, glyph.instructions);
}

/** A format 4 subtable mapping each code point in the map, one segment a code point, plus the final 0xFFFF segment. */
export function cmap4(map: ReadonlyMap<number, number>, rangeOffsets = false): Uint8Array {
	const codes = [...map.keys()].sort((a, b) => a - b);
	const segments = codes.length + 1;
	const ends = [...codes, 0xffff];
	const starts = [...codes, 0xffff];
	const deltas = [...codes.map((c) => ((map.get(c) as number) - c) & 0xffff), 1];
	// With rangeOffsets, each segment points into the glyph array instead of
	// using its delta.
	const ranges = codes.map((_, i) => (rangeOffsets ? (segments - i) * 2 + i * 2 : 0));
	const glyphArray = rangeOffsets ? codes.map((c) => map.get(c) as number) : [];
	return table([
		...u16s([4, 0, 0, segments * 2, 0, 0, 0]),
		...u16s(ends),
		{ u16: 0 },
		...u16s(starts),
		...u16s(rangeOffsets ? [...codes.map(() => 0), 1] : deltas),
		...u16s([...ranges, 0]),
		...u16s(glyphArray),
	]);
}

/** A format 12 subtable of groups: start, end, first glyph. */
export function cmap12(groups: readonly (readonly [number, number, number])[]): Uint8Array {
	return table([
		{ u16: 12 },
		{ u16: 0 },
		{ u32: 16 + groups.length * 12 },
		{ u32: 0 },
		{ u32: groups.length },
		...groups.flatMap(([start, end, glyph]) => [{ u32: start }, { u32: end }, { u32: glyph }]),
	]);
}

/** A cmap table from (platform, encoding, subtable) records. */
export function cmapTable(records: readonly (readonly [number, number, Uint8Array])[]): Uint8Array {
	return table([
		{ u16: 0 },
		{ u16: records.length },
		...records.flatMap(([platform, encoding, subtable]) => [
			{ u16: platform },
			{ u16: encoding },
			{ offset32: subtable },
		]),
	]);
}

export interface TestFontSpec {
	readonly glyphs: readonly TestGlyph[];
	readonly advances?: readonly number[];
	/** How many advances hmtx gives in full; the rest repeat the last. Default all. */
	readonly metrics?: number;
	readonly cmap?: Uint8Array;
	readonly gpos?: Uint8Array;
	readonly kern?: Uint8Array;
	readonly unitsPerEm?: number;
	readonly longLoca?: boolean;
	/** Tables replaced wholesale, after everything else is built. */
	readonly replace?: Readonly<Record<string, Uint8Array>>;
	readonly omit?: readonly string[];
	readonly sfntVersion?: number;
	/** Bytes appended to the file after the tables. */
	readonly trailing?: number;
}

/** The default map: code points 0x41 upwards to glyphs 1 upwards. */
function defaultCmap(glyphCount: number): Uint8Array {
	const map = new Map<number, number>();
	for (let g = 1; g < glyphCount; g += 1) map.set(0x40 + g, g);
	return cmapTable([[3, 1, cmap4(map)]]);
}

export function buildFont(spec: TestFontSpec): Uint8Array {
	const count = spec.glyphs.length;
	const advances = spec.advances ?? spec.glyphs.map((_, i) => 500 + i * 10);
	const metrics = spec.metrics ?? count;
	const glyf: Uint8Array[] = spec.glyphs.map((glyph) => {
		const bytes = glyphBytes(glyph);
		// Glyphs start on even offsets so the short loca format can say where.
		return bytes.length % 2 === 0 ? bytes : Uint8Array.from([...bytes, 0]);
	});
	const offsets: number[] = [0];
	for (const bytes of glyf) offsets.push((offsets[offsets.length - 1] as number) + bytes.length);
	const long = spec.longLoca ?? false;
	const tables: Record<string, Uint8Array> = {
		head: table([
			...u16s([1, 0]),
			{ u32: 0x00010000 },
			{ u32: 0 },
			{ u32: 0x5f0f3cf5 },
			{ u16: 0 },
			{ u16: spec.unitsPerEm ?? 1000 },
			{ bytes: new Uint8Array(16) },
			...u16s([0, 0, 0, 0, 0, 0, 0]),
			{ i16: long ? 1 : 0 },
			{ i16: 0 },
		]),
		hhea: table([
			...u16s([1, 0]),
			{ i16: 800 },
			{ i16: -200 },
			{ i16: 90 },
			{ bytes: new Uint8Array(24) },
			{ u16: metrics },
		]),
		maxp: table([{ u32: 0x00005000 }, { u16: count }]),
		hmtx: table([
			...advances.slice(0, metrics).flatMap((advance) => [{ u16: advance }, { i16: 0 }]),
			...advances.slice(metrics).map(() => ({ i16: 0 })),
		]),
		loca: table(offsets.map((offset) => (long ? { u32: offset } : { u16: offset / 2 }))),
		glyf: Uint8Array.from(glyf.flatMap((bytes) => [...bytes])),
		cmap: spec.cmap ?? defaultCmap(count),
	};
	if (spec.gpos) tables.GPOS = spec.gpos;
	if (spec.kern) tables.kern = spec.kern;
	for (const [tag, bytes] of Object.entries(spec.replace ?? {})) tables[tag] = bytes;
	for (const tag of spec.omit ?? []) delete tables[tag];
	return sfnt(tables, spec.sfntVersion ?? 0x00010000, spec.trailing ?? 0);
}

/** Wrap tables in a directory, in tag order, each four byte aligned. */
export function sfnt(
	tables: Readonly<Record<string, Uint8Array>>,
	version = 0x00010000,
	trailing = 0,
): Uint8Array {
	const tags = Object.keys(tables).sort();
	const header: Field[] = [{ u32: version }, ...u16s([tags.length, 0, 0, 0])];
	let at = 12 + tags.length * 16;
	const body: number[] = [];
	for (const tag of tags) {
		const bytes = tables[tag] as Uint8Array;
		header.push({ tag }, { u32: 0 }, { u32: at }, { u32: bytes.length });
		body.push(...bytes);
		const padded = (4 - (bytes.length % 4)) % 4;
		for (let i = 0; i < padded; i += 1) body.push(0);
		at += bytes.length + padded;
	}
	return Uint8Array.from([...table(header), ...body, ...new Array<number>(trailing).fill(0)]);
}

// GPOS

export type Coverage = { readonly format: 1 | 2; readonly glyphs: readonly number[] };

export function coverageTable(coverage: Coverage): Uint8Array {
	const glyphs = coverage.glyphs;
	if (coverage.format === 1) return table(u16s([1, glyphs.length, ...glyphs]));
	// One range per run of consecutive glyphs.
	const ranges: number[][] = [];
	glyphs.forEach((glyph, index) => {
		const last = ranges[ranges.length - 1];
		if (last !== undefined && last[1] === glyph - 1) last[1] = glyph;
		else ranges.push([glyph, glyph, index]);
	});
	return table(u16s([2, ranges.length, ...ranges.flat()]));
}

/** Class definitions: format 1 over a contiguous run from `start`, or format 2 as ranges. */
export function classDefTable(
	def:
		| { readonly format: 1; readonly start: number; readonly classes: readonly number[] }
		| { readonly format: 2; readonly ranges: readonly (readonly [number, number, number])[] },
): Uint8Array {
	if (def.format === 1) return table(u16s([1, def.start, def.classes.length, ...def.classes]));
	return table(u16s([2, def.ranges.length, ...def.ranges.flat()]));
}

/** A value record with the given format, x advance as given and every other field zero. */
function valueRecord(format: number, advance: number): Field[] {
	const fields: Field[] = [];
	for (let bit = 0; bit < 8; bit += 1) {
		if (!(format & (1 << bit))) continue;
		fields.push(bit === 2 ? { i16: advance } : { i16: 0 });
	}
	return fields;
}

export interface PairFormat1 {
	readonly format: 1;
	readonly coverage: Coverage;
	readonly valueFormat1?: number;
	readonly valueFormat2?: number;
	/** Per covered glyph, in coverage order: [second, x advance] pairs. */
	readonly sets: readonly (readonly (readonly [number, number])[])[];
}

export interface PairFormat2 {
	readonly format: 2;
	readonly coverage: Coverage;
	readonly valueFormat1?: number;
	readonly valueFormat2?: number;
	readonly classDef1: Uint8Array;
	readonly classDef2: Uint8Array;
	readonly class1Count: number;
	readonly class2Count: number;
	/** class1Count rows of class2Count x advances. */
	readonly values: readonly (readonly number[])[];
}

export function pairSubtable(subtable: PairFormat1 | PairFormat2): Uint8Array {
	const v1 = subtable.valueFormat1 ?? 0x0004;
	const v2 = subtable.valueFormat2 ?? 0;
	if (subtable.format === 1) {
		return table([
			{ u16: 1 },
			{ offset16: coverageTable(subtable.coverage) },
			{ u16: v1 },
			{ u16: v2 },
			{ u16: subtable.sets.length },
			...subtable.sets.map((set) => ({
				offset16: table([
					{ u16: set.length },
					...set.flatMap(([second, advance]) => [
						{ u16: second },
						...valueRecord(v1, advance),
						...valueRecord(v2, 0),
					]),
				]),
			})),
		]);
	}
	return table([
		{ u16: 2 },
		{ offset16: coverageTable(subtable.coverage) },
		{ u16: v1 },
		{ u16: v2 },
		{ offset16: subtable.classDef1 },
		{ offset16: subtable.classDef2 },
		{ u16: subtable.class1Count },
		{ u16: subtable.class2Count },
		...subtable.values.flatMap((row) =>
			row.flatMap((advance) => [...valueRecord(v1, advance), ...valueRecord(v2, 0)]),
		),
	]);
}

export interface TestLookup {
	readonly type: number;
	readonly flag?: number;
	readonly subtables: readonly Uint8Array[];
}

/** An extension subtable wrapping `inner` as `type`. */
export function extension(inner: Uint8Array, type = 2, format = 1): Uint8Array {
	return table([{ u16: format }, { u16: type }, { offset32: inner }]);
}

export interface GposSpec {
	/** Scripts: tag, and the feature indices of the default language system (null for none). */
	readonly scripts: readonly (readonly [string, readonly number[] | null])[];
	readonly features: readonly (readonly [string, readonly number[]])[];
	readonly lookups: readonly TestLookup[];
	readonly version?: number;
	readonly nullLists?: boolean;
}

export function gposTable(spec: GposSpec): Uint8Array {
	const scriptList = table([
		{ u16: spec.scripts.length },
		...spec.scripts.flatMap(([tag, features]) => [
			{ tag },
			{
				offset16: table([
					{
						offset16:
							features === null
								? null
								: table([{ u16: 0 }, { u16: 0xffff }, { u16: features.length }, ...u16s(features)]),
					},
					{ u16: 0 },
				]),
			},
		]),
	]);
	const featureList = table([
		{ u16: spec.features.length },
		...spec.features.flatMap(([tag, lookups]) => [
			{ tag },
			{ offset16: table([{ u16: 0 }, { u16: lookups.length }, ...u16s(lookups)]) },
		]),
	]);
	const lookupList = table([
		{ u16: spec.lookups.length },
		...spec.lookups.map((lookup) => ({
			offset16: table([
				{ u16: lookup.type },
				{ u16: lookup.flag ?? 0 },
				{ u16: lookup.subtables.length },
				...lookup.subtables.map((subtable) => ({ offset16: subtable })),
				...((lookup.flag ?? 0) & 0x10 ? [{ u16: 0 }] : []),
			]),
		})),
	]);
	const empty = spec.nullLists === true;
	return table([
		{ u16: spec.version ?? 1 },
		{ u16: 0 },
		{ offset16: empty ? null : scriptList },
		{ offset16: empty ? null : featureList },
		{ offset16: empty ? null : lookupList },
	]);
}

/** The simplest GPOS: one script, one kern feature, the given lookups. */
export function kernGpos(lookups: readonly TestLookup[]): Uint8Array {
	return gposTable({
		scripts: [['latn', [0]]],
		features: [['kern', lookups.map((_, i) => i)]],
		lookups,
	});
}

// kern

export interface KernSubtable {
	readonly pairs: readonly (readonly [number, number, number])[];
	/** Coverage bits; default horizontal format 0. */
	readonly coverage?: number;
	readonly format?: number;
	/** Override the length field. */
	readonly length?: number;
}

function kernBody(pairs: readonly (readonly [number, number, number])[]): Field[] {
	return [
		...u16s([pairs.length, 0, 0, 0]),
		...pairs.flatMap(([l, r, v]) => [{ u16: l }, { u16: r }, { i16: v }]),
	];
}

/** Microsoft's kern table: version 0, 16 bit lengths, format in the coverage's high byte. */
export function kernMicrosoft(subtables: readonly KernSubtable[]): Uint8Array {
	const parts = subtables.map((sub) => {
		const body = table(kernBody(sub.pairs));
		const coverage = sub.coverage ?? ((sub.format ?? 0) << 8) | 0x0001;
		return table([
			{ u16: 0 },
			{ u16: sub.length ?? (6 + body.length) & 0xffff },
			{ u16: coverage },
			{ bytes: body },
		]);
	});
	return table([{ u16: 0 }, { u16: subtables.length }, ...parts.map((bytes) => ({ bytes }))]);
}

/** Apple's kern table: version 1.0, 32 bit lengths, format in the coverage's low byte. */
export function kernApple(subtables: readonly KernSubtable[]): Uint8Array {
	const parts = subtables.map((sub) => {
		const body = table(kernBody(sub.pairs));
		return table([
			{ u32: sub.length ?? 8 + body.length },
			{ u16: sub.coverage ?? sub.format ?? 0 },
			{ u16: 0 },
			{ bytes: body },
		]);
	});
	return table([
		{ u32: 0x00010000 },
		{ u32: subtables.length },
		...parts.map((bytes) => ({ bytes })),
	]);
}

/** A square of the given size at x, y, wound as TrueType winds outer contours (clockwise, y up). */
export function square(x: number, y: number, size: number): Point[] {
	return [
		[x, y, true],
		[x, y + size, true],
		[x + size, y + size, true],
		[x + size, y, true],
	];
}
