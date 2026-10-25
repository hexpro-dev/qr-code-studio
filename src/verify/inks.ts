/**
 * Every colour a design can put down, sorted into ink and ground, and the
 * two ways a reader sees them: as luma under white light (a phone camera)
 * and as red reflectance under red light (most laser and LED scanners).
 *
 * Paints are read stop by stop rather than averaged: a gradient that ends
 * on a colour too close to the ground has modules in that colour, and those
 * are the ones a reader loses. An entry fill gives its colour parameters, the
 * palette only the first `count` of them.
 */

import type { Colour } from '../render/types.js';
import { inkColour } from '../design/paint.js';
import type { DesignPaint, DesignRegistries, Ink, QrDesignV1 } from '../design/types.js';
import { pow } from '../core/math.js';
import type { Polarity } from './types.js';

/** Every ink a paint can put down. */
export function paintInks(paint: DesignPaint, registries: DesignRegistries): Ink[] {
	switch (paint.kind) {
		case 'solid':
			return [paint.ink];
		case 'entry': {
			const fill = registries.fills.get(paint.ref.id);
			if (fill === undefined) return [];
			const inks: Ink[] = [];
			for (const schema of fill.params) {
				if (schema.kind !== 'colour') continue;
				const given = paint.ref.params?.[schema.key];
				inks.push(typeof given === 'string' ? given : (schema.default as string));
			}
			const count = paint.ref.params?.count ?? fill.params.find((p) => p.key === 'count')?.default;
			return typeof count === 'number' ? inks.slice(0, count) : inks;
		}
		default:
			return paint.stops.map((stop) => stop.ink);
	}
}

export interface DesignInks {
	/** What the modules and finders are drawn in. */
	readonly inks: readonly Colour[];
	/** What they are drawn on: the background (white paper when it is transparent) and drawn light modules. */
	readonly grounds: readonly Colour[];
}

const PAPER_COLOUR: Colour = Object.freeze({ r: 255, g: 255, b: 255, a: 1 });

export function designInks(design: QrDesignV1, registries: DesignRegistries): DesignInks {
	const inks: Ink[] = [...paintInks(design.modules.paint, registries)];
	for (const style of Object.values(design.regions)) {
		if (style?.outerPaint !== undefined) inks.push(...paintInks(style.outerPaint, registries));
		if (style?.innerPaint !== undefined) inks.push(...paintInks(style.innerPaint, registries));
	}
	const grounds: Colour[] =
		design.background === null
			? [PAPER_COLOUR]
			: paintInks(design.background, registries).map((ink) => over(inkColour(ink), PAPER_COLOUR));
	if (design.modules.light !== null) {
		const base = grounds[0] as Colour;
		grounds.push(
			...paintInks(design.modules.light.paint, registries).map((ink) => over(inkColour(ink), base)),
		);
	}
	return { inks: inks.map(inkColour), grounds };
}

/** `top` laid over an opaque `bottom`, in sRGB, as the rasteriser composites. */
export function over(top: Colour, bottom: Colour): Colour {
	const a = top.a;
	return {
		r: top.r * a + bottom.r * (1 - a),
		g: top.g * a + bottom.g * (1 - a),
		b: top.b * a + bottom.b * (1 - a),
		a: 1,
	};
}

/** BT.601 luma, 0 to 255: what the reader converts every pixel to. */
export function luma(colour: Colour): number {
	return 0.299 * colour.r + 0.587 * colour.g + 0.114 * colour.b;
}

/** The red channel as linear reflectance, 0 to 1. */
export function redReflectance(colour: Colour): number {
	const c = colour.r / 255;
	return c <= 0.04045 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4);
}

/** Dark on light when the ink is darker than the ground on average. */
export function polarityOf(inks: DesignInks): Polarity {
	return polaritySign(inks) >= 0 ? 'dark-on-light' : 'light-on-dark';
}

/** Mean ground luma less mean ink luma, as a fraction of the full range: below zero is light on dark. */
export function polaritySign(inks: DesignInks): number {
	const mean = (list: readonly Colour[], ground: Colour): number =>
		list.reduce((sum, c) => sum + luma(over(c, ground)), 0) / Math.max(1, list.length);
	const ground = inks.grounds[0] as Colour;
	const grounds = inks.grounds.reduce((sum, c) => sum + luma(c), 0) / inks.grounds.length;
	return (grounds - mean(inks.inks, ground)) / 255;
}

/**
 * The worst difference between any ink and any ground, as a fraction of the
 * full range, in the design's own polarity: negative when some ink is on the
 * wrong side of some ground.
 */
export function worstDifference(
	inks: DesignInks,
	polarity: Polarity,
	measure: (colour: Colour) => number,
	scale: number,
): number {
	const sign = polarity === 'dark-on-light' ? 1 : -1;
	let worst = Number.POSITIVE_INFINITY;
	for (const ground of inks.grounds) {
		for (const ink of inks.inks) {
			const difference = (sign * (measure(ground) - measure(over(ink, ground)))) / scale;
			if (difference < worst) worst = difference;
		}
	}
	return worst === Number.POSITIVE_INFINITY ? 0 : worst;
}
