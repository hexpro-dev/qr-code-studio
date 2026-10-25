/**
 * A random design, from a seed, built only out of what the catalogue holds.
 *
 * "Shuffle" is a starting point, so it has to be a good one: every design it
 * makes must scan as well as a preset does. Three rules hold that:
 *
 * - finders come only from ring and centre pairs that make a finder the
 *   strict reader finds (`regionPairConforms`), at their default params;
 * - every dark ink is at least 7:1 against the ground by luminance, the
 *   figure the presets aim for, where the conformance floor is 4.5:1. A
 *   gradient between two such inks stays above it all the way along, because
 *   luminance is convex in the sRGB values, so a mix is never lighter than
 *   the lighter of its ends;
 * - shapes keep their default params, which are the ones their own
 *   conformance and the presets were measured at.
 *
 * Everything that is the person's rather than the look is kept: how the
 * symbol is chosen (symbology, level, versions), the quiet zone, the logo
 * and its picture, the output settings and the name. Micro QR and rMQR keep
 * square rings, as the scene builder would draw them anyway.
 *
 * The same seed over the same registries gives the same design: the stream is
 * core's seeded PRNG and every colour is worked out in basic arithmetic.
 */

import { createPrng } from '../core/prng.js';
import type { Prng } from '../core/prng.js';
import { regionPairConforms } from '../design/finder.js';
import { resolveParams } from '../design/params.js';
import type {
	DesignPaint,
	DesignRegistries,
	QrDesignV1,
	RegionShape,
	RegionStyle,
} from '../design/types.js';
import { SHUFFLE_CONTRAST, contrastRatio } from './contrast.js';

/** Fraction of shuffles that put a frame round the code. */
const FRAME_CHANCE = 0.25;
/** Tries at a colour before falling back to black, which always clears the bar. */
const COLOUR_TRIES = 48;

function hex(value: number): string {
	return Math.round(Math.min(255, Math.max(0, value)))
		.toString(16)
		.padStart(2, '0');
}

/** HSL (each 0 to 1) to #rrggbb, by the CSS Color 4 formula. */
export function hslHex(h: number, s: number, l: number): string {
	const a = s * Math.min(l, 1 - l);
	const channel = (n: number): number => {
		const k = (n + h * 12) % 12;
		return (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))) * 255;
	};
	return `#${hex(channel(0))}${hex(channel(8))}${hex(channel(4))}`;
}

function between(prng: Prng, min: number, max: number): number {
	return min + prng.next() * (max - min);
}

function pick<T>(prng: Prng, list: readonly T[]): T {
	return list[prng.int(list.length)] as T;
}

/** A light ground: white two times in five, otherwise a pale tint. */
function ground(prng: Prng): string {
	if (prng.next() < 0.4) return '#ffffff';
	return hslHex(prng.next(), between(prng, 0.2, 0.6), between(prng, 0.94, 0.985));
}

/** A dark ink at 7:1 or more against `against`, or black when none of the tries is. */
export function darkInk(prng: Prng, against: string): string {
	for (let i = 0; i < COLOUR_TRIES; i += 1) {
		const ink = hslHex(prng.next(), between(prng, 0.3, 0.9), between(prng, 0.06, 0.3));
		if (contrastRatio(ink, against) >= SHUFFLE_CONTRAST) return ink;
	}
	return '#000000';
}

function modulesPaint(prng: Prng, against: string, registries: DesignRegistries): DesignPaint {
	const roll = prng.next();
	const first = darkInk(prng, against);
	if (roll < 0.5) return { kind: 'solid', ink: first };
	const second = darkInk(prng, against);
	if (roll < 0.75) {
		return {
			kind: 'linear',
			angle: prng.int(8) * 45,
			space: 'symbol',
			stops: [
				{ offset: 0, ink: first },
				{ offset: 1, ink: second },
			],
		};
	}
	if (roll < 0.9) {
		return {
			kind: 'radial',
			cx: 0.5,
			cy: 0.5,
			radius: 0.7,
			space: 'symbol',
			stops: [
				{ offset: 0, ink: first },
				{ offset: 1, ink: second },
			],
		};
	}
	// An entry fill, with every colour parameter it has given a dark ink, so
	// none of its defaults can come through untested.
	const fills = registries.fills.list();
	if (fills.length === 0) return { kind: 'solid', ink: first };
	const fill = pick(prng, fills);
	const params: Record<string, string | number | boolean> = {};
	for (const schema of fill.params) {
		if (schema.kind === 'colour') params[schema.key] = darkInk(prng, against);
	}
	return { kind: 'entry', ref: { id: fill.id, params } };
}

/** Every ring and centre that make a QR finder together at their default params. */
export function conformingPairs(
	registries: DesignRegistries,
): readonly (readonly [RegionShape, RegionShape])[] {
	const shapes = registries.regionShapes.list();
	const rings = shapes.filter((s) => s.part === 'outer' && s.kinds.includes('concentric-7'));
	const centres = shapes.filter((s) => s.part === 'inner' && s.kinds.includes('concentric-7'));
	const pairs: (readonly [RegionShape, RegionShape])[] = [];
	for (const ring of rings) {
		for (const centre of centres) {
			if (
				regionPairConforms(
					ring,
					resolveParams(ring.params, undefined),
					centre,
					resolveParams(centre.params, undefined),
					'concentric-7',
				)
			) {
				pairs.push([ring, centre]);
			}
		}
	}
	return pairs;
}

function finderStyle(
	prng: Prng,
	base: QrDesignV1,
	pairs: readonly (readonly [RegionShape, RegionShape])[],
	against: string,
): RegionStyle | null {
	const single = base.symbol.symbology !== 'qr';
	const usable = single ? pairs.filter(([ring]) => ring.id === 'square') : pairs;
	if (usable.length === 0) return null;
	const [ring, centre] = pick(prng, usable);
	const style: { -readonly [K in keyof RegionStyle]: RegionStyle[K] } = {
		outer: { id: ring.id },
		inner: { id: centre.id },
	};
	if (prng.next() < 0.3) style.outerPaint = { kind: 'solid', ink: darkInk(prng, against) };
	if (prng.next() < 0.3) style.innerPaint = { kind: 'solid', ink: darkInk(prng, against) };
	return style;
}

/** The design for `seed`, keeping what in `base` is the person's rather than the look. */
export function shuffleDesign(
	base: QrDesignV1,
	seed: number,
	registries: DesignRegistries,
	pairs: readonly (readonly [RegionShape, RegionShape])[] = conformingPairs(registries),
): QrDesignV1 {
	const prng = createPrng(seed);
	const light = ground(prng.fork(1));
	const paint = prng.fork(2);
	const shapes = registries.moduleShapes.list();
	const shape = shapes.length === 0 ? base.modules.shape : { id: pick(prng.fork(3), shapes).id };
	const finder = finderStyle(prng.fork(4), base, pairs, light);
	const frames = registries.frames.list().filter((frame) => frame.id !== 'none');
	const framing = prng.fork(5);
	const framed =
		base.symbol.symbology !== 'rmqr' && frames.length > 0 && framing.next() < FRAME_CHANCE;
	const design: QrDesignV1 = {
		schema: 'qr-design',
		version: 1,
		symbol: base.symbol,
		quietZone: base.quietZone,
		background: { kind: 'solid', ink: light },
		modules: { shape, paint: modulesPaint(paint, light, registries), light: null },
		regions: finder === null ? {} : { finder },
		logo: base.logo,
		frame: framed
			? {
					ref: { id: pick(framing, frames).id },
					paint: { kind: 'solid', ink: darkInk(framing, light) },
				}
			: null,
		output: base.output,
		...(base.assets === undefined ? {} : { assets: base.assets }),
		...(base.name === undefined ? {} : { name: base.name }),
	};
	return design;
}
