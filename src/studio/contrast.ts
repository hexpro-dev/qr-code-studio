/**
 * Luminance contrast between inks, by the WCAG 2 formula.
 *
 * The same measure the preset conformance check uses, written again here
 * because the studio may not import the conformance suite. It goes through
 * core/math.ts rather than Math.pow so that a shuffled design, which is
 * chosen by it, is the same design in every engine.
 */

import { pow } from '../core/math.js';
import { inkColour } from '../design/paint.js';
import type { Ink } from '../design/types.js';

/** What a shuffled design holds every dark ink to against its ground. */
export const SHUFFLE_CONTRAST = 7;

function linear(channel: number): number {
	const c = channel / 255;
	return c <= 0.04045 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4);
}

/** WCAG relative luminance, 0 for black to 1 for white. */
export function luminance(ink: Ink): number {
	const { r, g, b } = inkColour(ink);
	return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** The contrast ratio between two inks, larger over smaller: 1 to 21. */
export function contrastRatio(a: Ink, b: Ink): number {
	const la = luminance(a);
	const lb = luminance(b);
	return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
