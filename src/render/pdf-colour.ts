/**
 * Colour for the print writers: sRGB as it is, or CMYK for a press.
 *
 * In CMYK a colour that carries its own print value (`Colour.cmyk`, from an
 * ink in the design) is written as that value. Anything else is converted by
 * one fixed formula, the same in every engine:
 *
 *     k = 1 - max(r, g, b)
 *     c = (1 - r - k) / (1 - k), and likewise m from g and y from b
 *
 * with r, g and b from 0 to 1, and black (k = 1) written as 0 0 0 1. Every
 * neutral, r = g = b, comes out as black ink alone: white is 0 0 0 0, mid grey
 * is 0 0 0 0.5, and black is 0 0 0 1, never a rich black that would put four
 * inks on the fine edges of a code and smear it when the plates are a hair out
 * of register. That is the rule a printer asks for, and it is why this formula
 * (full grey component replacement) is the one used.
 *
 * It is not a colour-managed conversion. There is no ICC profile, no ink limit
 * and no dot gain: a saturated sRGB blue comes out as the nominal process
 * colour, which prints duller than it looks on a screen. A design that needs
 * a particular printed colour says so with a print value on its ink, which
 * this writes unchanged.
 */

import type { Colour } from './types.js';

export type PrintSpace = 'srgb' | 'cmyk';

/** Throw a TypeError unless `space` is one of the two. */
export function checkSpace(space: unknown, where: string): PrintSpace {
	if (space !== 'srgb' && space !== 'cmyk') {
		throw new TypeError(`${where}: colour is 'srgb' or 'cmyk'.`);
	}
	return space;
}

/** Throw a TypeError unless a print value, when there is one, is four numbers from 0 to 1. */
export function checkCmyk(colour: Colour, where: string): void {
	const cmyk: unknown = colour.cmyk;
	if (cmyk === undefined) return;
	if (!Array.isArray(cmyk) || cmyk.length !== 4) {
		throw new TypeError(`${where}: a print value is four numbers, c, m, y and k.`);
	}
	for (const value of cmyk as unknown[]) {
		if (typeof value !== 'number' || !(value >= 0 && value <= 1)) {
			throw new TypeError(`${where}: each part of a print value is a number from 0 to 1.`);
		}
	}
}

/** The formula above, for channels from 0 to 255. */
export function rgbToCmyk(r: number, g: number, b: number): [number, number, number, number] {
	if (r === g && g === b) return [0, 0, 0, 1 - r / 255];
	const rr = r / 255;
	const gg = g / 255;
	const bb = b / 255;
	const k = 1 - Math.max(rr, gg, bb);
	const rest = 1 - k;
	return [(1 - rr - k) / rest, (1 - gg - k) / rest, (1 - bb - k) / rest, k];
}

/** A colour's components in the space being written: three from 0 to 1, or four. */
export function components(colour: Colour, space: PrintSpace): number[] {
	if (space === 'srgb') return [colour.r / 255, colour.g / 255, colour.b / 255];
	if (colour.cmyk !== undefined) return [...colour.cmyk];
	return rgbToCmyk(colour.r, colour.g, colour.b);
}
