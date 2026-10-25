/**
 * Design paints to scene paints.
 *
 * A design says what a gradient means relative to the thing it fills ("left
 * to right across the symbol", "from the centre of each module"); a scene
 * says where, in user units. This is the one place the first becomes the
 * second, so the SVG, the raster and the scan check all see the same
 * gradient.
 *
 * Angles are degrees, 0 pointing right and growing clockwise as seen with y
 * down, which is how `render` and `geometry` turn as well. A linear gradient
 * runs through the centre of its box and is just long enough that the box's
 * corners land on its first and last stops, as a CSS linear-gradient is.
 * Radial and conic centres and the radial radius are fractions of the box;
 * the radius is a fraction of the box's longer side, so a radius of 0.5
 * reaches the edges of a square symbol and the ends of a rectangular one.
 */

import { PI, cos, sin } from '../core/math.js';
import type { Prng } from '../core/prng.js';
import type { Registry } from '../core/registry.js';
import { parseColour } from '../render/colour.js';
import type { Colour, ScenePaint, Stop } from '../render/types.js';
import { resolveParams } from './params.js';
import type { Box, DesignPaint, DesignStop, FillEntry, Ink } from './types.js';

/** An ink as a scene colour, with its print value carried beside the screen one. */
export function inkColour(ink: Ink): Colour {
	if (typeof ink === 'string') return parseColour(ink);
	const colour = parseColour(ink.srgb);
	return {
		...colour,
		cmyk: [ink.cmyk[0], ink.cmyk[1], ink.cmyk[2], ink.cmyk[3]],
	};
}

/**
 * The unit vector for an angle, exact at whole quarter turns.
 *
 * cos(pi / 2) in floating point is 6e-17, not zero, and a vertical gradient
 * built from it would put its ends a hair off the box's edges in the SVG.
 */
export function direction(degrees: number): readonly [number, number] {
	const reduced = ((degrees % 360) + 360) % 360;
	if (reduced === 0) return [1, 0];
	if (reduced === 90) return [0, 1];
	if (reduced === 180) return [-1, 0];
	if (reduced === 270) return [0, -1];
	const radians = reduced * (PI / 180);
	return [cos(radians), sin(radians)];
}

function stops(list: readonly DesignStop[]): Stop[] {
	return list.map((stop) => ({ offset: stop.offset, colour: inkColour(stop.ink) }));
}

/**
 * A linear gradient through the centre of `box` at `angle`, just long enough
 * that the box's corners land on its ends.
 */
export function linearPaint(angle: number, list: readonly Stop[], box: Box): ScenePaint {
	const [dx, dy] = direction(angle);
	const half = (box.width * Math.abs(dx) + box.height * Math.abs(dy)) / 2;
	const cx = box.x + box.width / 2;
	const cy = box.y + box.height / 2;
	return {
		kind: 'linear',
		x1: cx - dx * half,
		y1: cy - dy * half,
		x2: cx + dx * half,
		y2: cy + dy * half,
		stops: list,
	};
}

/**
 * Whether a paint is worked out once over its whole box or once per module.
 * An entry fill says which it is; a missing entry counts as the whole box,
 * since the builder will have replaced it.
 */
export function paintSpace(paint: DesignPaint, fills: Registry<FillEntry>): 'symbol' | 'module' {
	if (paint.kind === 'solid') return 'symbol';
	if (paint.kind === 'entry') return fills.get(paint.ref.id)?.space ?? 'symbol';
	return paint.space;
}

/**
 * The scene paint for `paint` filling `box`. An entry fill must be in
 * `fills`; the scene builder checks that before it gets here.
 */
export function resolvePaint(
	paint: DesignPaint,
	box: Box,
	fills: Registry<FillEntry>,
	prng: Prng,
): ScenePaint {
	switch (paint.kind) {
		case 'solid':
			return { kind: 'solid', colour: inkColour(paint.ink) };
		case 'linear':
			return linearPaint(paint.angle, stops(paint.stops), box);
		case 'radial':
			return {
				kind: 'radial',
				cx: box.x + paint.cx * box.width,
				cy: box.y + paint.cy * box.height,
				r: paint.radius * Math.max(box.width, box.height),
				stops: stops(paint.stops),
			};
		case 'conic':
			return {
				kind: 'conic',
				cx: box.x + paint.cx * box.width,
				cy: box.y + paint.cy * box.height,
				angle: paint.angle,
				stops: stops(paint.stops),
			};
		case 'entry': {
			const entry = fills.require(paint.ref.id);
			return entry.resolve(resolveParams(entry.params, paint.ref.params), box, prng);
		}
	}
}
