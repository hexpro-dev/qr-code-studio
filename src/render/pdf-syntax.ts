/**
 * The pieces of PDF and PostScript syntax both print writers share: numbers,
 * strings, and the function dictionaries that give a gradient its colours.
 *
 * PDF borrowed PostScript's syntax for numbers and dictionaries, so a
 * function dictionary written here means the same thing inside a PDF shading
 * and inside an EPS `shfill`, and the two writers agree about a gradient
 * because they print the same text for it.
 */

import { COORDINATE_LIMIT } from '../geometry/flatten.js';
import type { PrintSpace } from './pdf-colour.js';
import { components } from './pdf-colour.js';
import type { NormalStop } from './scene.js';

/**
 * A number as PDF and PostScript read it, the same in every engine.
 *
 * `toFixed` is exact by specification, unlike `toString`. Neither format
 * reads an exponent, so magnitudes are held within the limit the rasteriser
 * also clamps to, far beyond anything that can be seen. Trailing zeros are
 * trimmed and a negative zero is written 0.
 */
export function num(value: number, decimals = 4): string {
	const held = Math.min(Math.max(value, -COORDINATE_LIMIT), COORDINATE_LIMIT);
	const text = held.toFixed(decimals).replace(/\.?0+$/, '');
	return text === '-0' ? '0' : text;
}

/** Numbers joined by spaces. */
export function nums(values: readonly number[], decimals = 4): string {
	return values.map((value) => num(value, decimals)).join(' ');
}

/**
 * A PDF text string.
 *
 * Printable ASCII goes in a literal string, escaped. Anything else is UTF-16
 * big endian with a byte order mark, in hex, which every reader decodes. What
 * cannot be represented (an unpaired surrogate) or should not be (a control
 * character) becomes U+FFFD, as the SVG writer does with a title.
 */
export function textString(text: string): string {
	if (/^[\x20-\x7e]*$/.test(text)) return `(${text.replace(/[\\()]/g, (c) => `\\${c}`)})`;
	let hex = 'FEFF';
	for (let i = 0; i < text.length; i += 1) {
		let unit = text.charCodeAt(i);
		if (unit >= 0xd800 && unit <= 0xdbff) {
			const low = text.charCodeAt(i + 1);
			if (low >= 0xdc00 && low <= 0xdfff) {
				hex += unit.toString(16).padStart(4, '0') + low.toString(16).padStart(4, '0');
				i += 1;
				continue;
			}
			unit = 0xfffd;
		} else if ((unit >= 0xdc00 && unit <= 0xdfff) || unit < 0x20 || unit === 0x7f) {
			unit = 0xfffd;
		}
		hex += unit.toString(16).padStart(4, '0');
	}
	return `<${hex.toUpperCase()}>`;
}

/** One stretch of a ramp: where it runs, and its colour at each end. */
interface Piece {
	readonly from: string;
	readonly to: string;
	readonly c0: number[];
	readonly c1: number[];
}

/** Decimals kept in a stop's offset. Pieces narrower than this are not written. */
const OFFSET_DECIMALS = 6;

/**
 * The function dictionary for a gradient's stops: from 0 to 1, padded beyond
 * the first and last stop, with a hard edge wherever two stops share an
 * offset.
 *
 * One stretch is an exponential (type 2) function with N 1, which is linear
 * interpolation. Several are a stitching (type 3) function of them, whose
 * bounds must strictly increase; a stretch whose ends round to the same
 * offset is left out, which loses nothing, since it is narrower than a
 * millionth of the gradient. `alpha` gives the function of the stops'
 * opacities instead, one component, for a soft mask.
 */
export function stopsFunction(
	stops: readonly NormalStop[],
	space: PrintSpace,
	alpha = false,
): string {
	const colourOf = (stop: NormalStop): number[] =>
		alpha ? [stop.colour.a] : components(stop.colour, space);
	const pieces: Piece[] = [];
	const add = (from: number, to: number, c0: number[], c1: number[]): void => {
		const a = num(from, OFFSET_DECIMALS);
		const b = num(to, OFFSET_DECIMALS);
		if (a !== b) pieces.push({ from: a, to: b, c0, c1 });
	};
	const first = stops[0] as NormalStop;
	const last = stops[stops.length - 1] as NormalStop;
	add(0, first.offset, colourOf(first), colourOf(first));
	for (let i = 0; i + 1 < stops.length; i += 1) {
		const a = stops[i] as NormalStop;
		const b = stops[i + 1] as NormalStop;
		add(a.offset, b.offset, colourOf(a), colourOf(b));
	}
	add(last.offset, 1, colourOf(last), colourOf(last));
	const exponential = (piece: Piece): string =>
		`<< /FunctionType 2 /Domain [0 1] /C0 [${nums(piece.c0)}] /C1 [${nums(piece.c1)}] /N 1 >>`;
	// Every offset is within 0 to 1, so the pieces cover the domain, and at
	// least one of them has width: the first starts at 0 and the last ends at 1.
	if (pieces.length === 1) return exponential(pieces[0] as Piece);
	const bounds = pieces.slice(1).map((piece) => piece.from);
	const encode = pieces.map(() => '0 1').join(' ');
	return `<< /FunctionType 3 /Domain [0 1] /Functions [${pieces.map(exponential).join(' ')}] /Bounds [${bounds.join(' ')}] /Encode [${encode}] >>`;
}
