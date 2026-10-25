/**
 * The built-in fonts' compiled tables, and the loader that turns one back
 * into a `Font`.
 *
 * `scripts/build-fonts.ts` reads the source TrueType files with this layer's
 * own parser, keeps the glyphs a subset of Unicode needs, and writes them to
 * `src/fonts/latin.ts` as one deflated, base64 table a weight. The table is a
 * stream of unsigned LEB128 numbers (`u`) and zigzag signed ones (`s`):
 *
 * - `u` format version (1), `u` glyph count.
 * - The character map: `u` entries, then for each, in code point order,
 *   `u` the gap from the previous code point less one (the first from -1),
 *   and `s` the glyph less the previous entry's glyph less one.
 * - `u` each glyph's advance.
 * - Each glyph's outline. A simple glyph is `u` contours times two, then `u`
 *   each contour's point count, then per point `u` (zigzag x delta times two,
 *   plus one when on the curve) and `s` the y delta, deltas running on from
 *   the glyph's previous point and starting from 0, 0. A composite is `u`
 *   components times two plus one, then per component `u` glyph, `s` x and
 *   `s` y offset. Components are only ever moved: a component the source
 *   scaled or sheared is drawn out into a simple glyph by the build.
 * - Kerning, as the flattened pair table factored into classes: `u` left
 *   classes, `u` right classes, `u` each glyph's left class, `u` each glyph's
 *   right class, then `s` every value of the class matrix, column by column.
 *   Two glyphs share a class exactly when they kern the same against every
 *   glyph, so the matrix is the pair table, losslessly, at a fraction of its
 *   size.
 *
 * Decoding is lazy: a `Font` loaded from a table knows its metrics at once
 * and decodes the rest on first use, so creating a registry costs nothing
 * until a caption is drawn. Every read is checked, so a corrupted table is a
 * `FontMalformedError` rather than a wrong picture.
 */

import { inflateRaw } from '../core/deflate.js';
import { isQrStudioError } from '../core/errors.js';
import { decodeBase64 } from './base64.js';
import { malformed } from './errors.js';
import { makeFont } from './font.js';
import type { Font, GlyphOutline } from './types.js';

export interface CompiledFontData {
	readonly id: string;
	readonly labelKey: string;
	readonly unitsPerEm: number;
	readonly ascender: number;
	readonly descender: number;
	readonly lineGap: number;
	readonly glyphCount: number;
	/** The table's length once inflated, which is also the most inflate may produce. */
	readonly length: number;
	/** The deflated table, base64. */
	readonly data: string;
}

/** The format version this loader reads. */
export const COMPILED_VERSION = 1;

/** Composites in a compiled table nest at most this deep; the build keeps them shallower. */
const MAX_NESTING = 8;

class Stream {
	private at = 0;
	constructor(private readonly bytes: Uint8Array) {}

	get done(): boolean {
		return this.at === this.bytes.length;
	}

	u(): number {
		let value = 0;
		let scale = 1;
		for (let i = 0; i < 5; i += 1) {
			if (this.at >= this.bytes.length) malformed('compiled', 'truncated');
			const byte = this.bytes[this.at++] as number;
			value += (byte & 0x7f) * scale;
			if (byte < 0x80) return value;
			scale *= 128;
		}
		return malformed('compiled', 'out-of-range');
	}

	s(): number {
		const value = this.u();
		return value % 2 === 0 ? value / 2 : -(value + 1) / 2;
	}
}

type Glyph =
	| { readonly kind: 'simple'; readonly outline: GlyphOutline }
	| {
			readonly kind: 'composite';
			readonly parts: readonly { glyph: number; dx: number; dy: number }[];
	  };

interface Decoded {
	readonly codes: Uint32Array;
	readonly glyphsOf: Uint16Array;
	readonly advances: Uint16Array;
	readonly glyphs: readonly Glyph[];
	readonly left: Uint16Array;
	readonly right: Uint16Array;
	readonly rightCount: number;
	readonly matrix: Int16Array;
}

function decode(source: CompiledFontData): Decoded {
	let bytes: Uint8Array;
	try {
		bytes = inflateRaw(decodeBase64(source.data), { maxOutput: source.length });
	} catch (error) {
		if (isQrStudioError(error) && error.code === 'font/malformed') throw error;
		return malformed('compiled', 'truncated');
	}
	const stream = new Stream(bytes);
	if (stream.u() !== COMPILED_VERSION) malformed('compiled', 'unsupported');
	const count = stream.u();
	if (count !== source.glyphCount) malformed('compiled', 'out-of-range');
	const glyphIndex = (value: number): number =>
		value >= 0 && value < count ? value : malformed('compiled', 'out-of-range');

	const entries = stream.u();
	const codes = new Uint32Array(entries);
	const glyphsOf = new Uint16Array(entries);
	let code = -1;
	let glyph = -1;
	for (let i = 0; i < entries; i += 1) {
		code += stream.u() + 1;
		glyph += stream.s() + 1;
		codes[i] = code;
		glyphsOf[i] = glyphIndex(glyph);
	}

	const advances = new Uint16Array(count);
	for (let i = 0; i < count; i += 1) advances[i] = stream.u();

	const glyphs: Glyph[] = [];
	for (let i = 0; i < count; i += 1) {
		const head = stream.u();
		const n = Math.floor(head / 2);
		if (head % 2 === 1) {
			const parts: { glyph: number; dx: number; dy: number }[] = [];
			for (let j = 0; j < n; j += 1) {
				parts.push({ glyph: glyphIndex(stream.u()), dx: stream.s(), dy: stream.s() });
			}
			glyphs.push({ kind: 'composite', parts });
			continue;
		}
		const ends: number[] = [];
		let total = 0;
		for (let j = 0; j < n; j += 1) {
			total += stream.u();
			ends.push(total);
		}
		const points = new Float64Array(total * 2);
		const onCurve = new Uint8Array(total);
		let x = 0;
		let y = 0;
		for (let j = 0; j < total; j += 1) {
			const packed = stream.u();
			onCurve[j] = packed % 2;
			const zig = Math.floor(packed / 2);
			x += zig % 2 === 0 ? zig / 2 : -(zig + 1) / 2;
			y += stream.s();
			points[j * 2] = x;
			points[j * 2 + 1] = y;
		}
		glyphs.push({ kind: 'simple', outline: { points, onCurve, ends } });
	}

	const leftCount = stream.u();
	const rightCount = stream.u();
	const left = new Uint16Array(count);
	const right = new Uint16Array(count);
	for (let i = 0; i < count; i += 1) {
		left[i] = stream.u();
		if ((left[i] as number) >= leftCount) malformed('compiled', 'out-of-range');
	}
	for (let i = 0; i < count; i += 1) {
		right[i] = stream.u();
		if ((right[i] as number) >= rightCount) malformed('compiled', 'out-of-range');
	}
	const matrix = new Int16Array(leftCount * rightCount);
	// Stored column by column, so a right class's values against every left
	// class are together; read back into row order for the lookup.
	for (let r = 0; r < rightCount; r += 1) {
		for (let l = 0; l < leftCount; l += 1) matrix[l * rightCount + r] = stream.s();
	}
	if (!stream.done) malformed('compiled', 'out-of-range');
	return { codes, glyphsOf, advances, glyphs, left, right, rightCount, matrix };
}

function resolve(decoded: Decoded, glyph: number, depth: number): GlyphOutline {
	const record = decoded.glyphs[glyph] as Glyph;
	if (record.kind === 'simple') return record.outline;
	if (depth >= MAX_NESTING) malformed('compiled', 'too-large');
	const xs: number[] = [];
	const flags: number[] = [];
	const ends: number[] = [];
	for (const part of record.parts) {
		const outline = resolve(decoded, part.glyph, depth + 1);
		const base = flags.length;
		for (let i = 0; i < outline.onCurve.length; i += 1) {
			xs.push(
				(outline.points[i * 2] as number) + part.dx,
				(outline.points[i * 2 + 1] as number) + part.dy,
			);
			flags.push(outline.onCurve[i] as number);
		}
		for (const end of outline.ends) ends.push(base + end);
	}
	return { points: Float64Array.from(xs), onCurve: Uint8Array.from(flags), ends };
}

/** A `Font` over a compiled table. Nothing is decoded until a glyph or a metric of one is asked for. */
export function loadCompiledFont(source: CompiledFontData): Font {
	let decoded: Decoded | undefined;
	const tables = (): Decoded => {
		decoded ??= decode(source);
		return decoded;
	};
	return makeFont({
		id: source.id,
		labelKey: source.labelKey,
		unitsPerEm: source.unitsPerEm,
		ascender: source.ascender,
		descender: source.descender,
		lineGap: source.lineGap,
		glyphCount: source.glyphCount,
		glyphIndex(codePoint) {
			const { codes, glyphsOf } = tables();
			let lo = 0;
			let hi = codes.length - 1;
			while (lo <= hi) {
				const mid = (lo + hi) >>> 1;
				const at = codes[mid] as number;
				if (at === codePoint) return glyphsOf[mid] as number;
				if (at < codePoint) lo = mid + 1;
				else hi = mid - 1;
			}
			return 0;
		},
		advance: (glyph) => tables().advances[glyph] as number,
		kerning(leftGlyph, rightGlyph) {
			const { left, right, rightCount, matrix } = tables();
			return matrix[
				(left[leftGlyph] as number) * rightCount + (right[rightGlyph] as number)
			] as number;
		},
		outline: (glyph) => resolve(tables(), glyph, 0),
	});
}
