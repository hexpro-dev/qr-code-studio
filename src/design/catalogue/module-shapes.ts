/**
 * The built-in module shapes.
 *
 * Every one is drawn in its unit cell and stays inside it: the connecting
 * shapes join a dark neighbour by reaching the shared edge exactly, and the
 * builder puts every module of one paint in one path, where two outlines that
 * meet along an edge fill as one region with no seam. Each keeps the cell's
 * centre cross (0.5 plus or minus 0.2 on both axes) inked, which is where a
 * reader samples, and the ranges of their parameters are set so that holds at
 * both ends: conformance draws all 256 neighbour masks at each.
 *
 * A shape that leaves light all round each dark module is in the `dot`
 * family of finder pairs, the hexagon in its own: styled finders that read
 * among squares fail among those (see `RegionShape.unpaired`).
 */

import { cos, sin } from '../../core/math.js';
import { PI } from '../../core/math.js';
import type { PathBuilder } from '../../geometry/path.js';
import { EAST, NORTH, SOUTH, WEST } from '../neighbours.js';
import { num, str } from '../params.js';
import type { ModuleShape, ModuleShapeContext } from '../types.js';
import {
	circleContour,
	polygonContour,
	regularContour,
	roundedBox,
	squircleContour,
	starContour,
} from './draw.js';
import { numberParam, selectParam } from './schema.js';

function has(neighbours: number, bit: number): boolean {
	return (neighbours & bit) !== 0;
}

function shape(entry: ModuleShape): ModuleShape {
	return Object.freeze({ ...entry, params: Object.freeze([...entry.params]) });
}

/** The plain square, which the scene builder also falls back to. */
export const squareModule = shape({
	id: 'square',
	labelKey: 'design.module.square',
	params: [],
	connects: false,
	fillsCell: () => true,
	path(_ctx, out) {
		out.rect(0, 0, 1, 1);
	},
});

const rounded = shape({
	id: 'rounded',
	labelKey: 'design.module.rounded',
	params: [numberParam('radius', 0.3, 0, 0.5, 0.05)],
	connects: false,
	fillsCell: (params) => num(params, 'radius') === 0,
	path({ params }, out) {
		roundedBox(0, 0, 1, 1, [
			num(params, 'radius'),
			num(params, 'radius'),
			num(params, 'radius'),
			num(params, 'radius'),
		]).emit(out);
	},
});

const dot = shape({
	id: 'dot',
	labelKey: 'design.module.dot',
	// Below 0.6 the disc no longer covers the pixels round the centre cross.
	params: [numberParam('size', 0.9, 0.6, 1, 0.05)],
	connects: false,
	family: 'dot',
	path({ params }, out) {
		circleContour(0.5, 0.5, num(params, 'size') / 2).emit(out);
	},
});

const diamond = shape({
	id: 'diamond',
	labelKey: 'design.module.diamond',
	params: [numberParam('size', 1, 0.7, 1, 0.05)],
	connects: false,
	family: 'dot',
	path({ params }, out) {
		const h = num(params, 'size') / 2;
		polygonContour([0.5, 0.5 - h, 0.5 + h, 0.5, 0.5, 0.5 + h, 0.5 - h, 0.5]).emit(out);
	},
});

const squircle = shape({
	id: 'squircle',
	labelKey: 'design.module.squircle',
	params: [numberParam('size', 0.96, 0.7, 1, 0.02)],
	connects: false,
	path({ params }, out) {
		const h = num(params, 'size') / 2;
		squircleContour(0.5, 0.5, h, h).emit(out);
	},
});

/**
 * The house signature: a regular hexagon, as in the hexagon of the Hex Pro
 * mark. Pointy has a corner at the top; flat has an edge there.
 */
const hex = shape({
	id: 'hex',
	labelKey: 'design.module.hex',
	params: [
		numberParam('size', 0.96, 0.75, 1, 0.02),
		selectParam('orientation', 'pointy', ['pointy', 'flat']),
	],
	connects: false,
	family: 'hex',
	path({ params }, out) {
		const r = num(params, 'size') / 2;
		const start = str(params, 'orientation') === 'pointy' ? -90 : 0;
		regularContour(0.5, 0.5, 6, r, start).emit(out);
	},
});

/** A bar across the cell, with round ends where the run of dark modules stops. */
function bar(ctx: ModuleShapeContext, out: PathBuilder, horizontal: boolean): void {
	const t = num(ctx.params, 'thickness');
	const cap = t / 2;
	const before = has(ctx.neighbours, horizontal ? WEST : NORTH) ? 0 : cap;
	const after = has(ctx.neighbours, horizontal ? EAST : SOUTH) ? 0 : cap;
	const offset = 0.5 - t / 2;
	if (horizontal) roundedBox(0, offset, 1, t, [before, after, after, before]).emit(out);
	else roundedBox(offset, 0, t, 1, [before, before, after, after]).emit(out);
}

const barsHorizontal = shape({
	id: 'bars-horizontal',
	labelKey: 'design.module.bars-horizontal',
	params: [numberParam('thickness', 0.8, 0.6, 1, 0.05)],
	connects: true,
	path(ctx, out) {
		bar(ctx, out, true);
	},
});

const barsVertical = shape({
	id: 'bars-vertical',
	labelKey: 'design.module.bars-vertical',
	params: [numberParam('thickness', 0.8, 0.6, 1, 0.05)],
	connects: true,
	path(ctx, out) {
		bar(ctx, out, false);
	},
});

/**
 * The cell, with each corner rounded only where both sides meeting at it are
 * open. Dark neighbours join along whole edges, so a run of modules is one
 * soft-cornered blob and a lone module is a disc at the largest radius.
 */
const fluid = shape({
	id: 'fluid',
	labelKey: 'design.module.fluid',
	params: [numberParam('radius', 0.5, 0.2, 0.5, 0.05)],
	connects: true,
	path({ neighbours, params }, out) {
		const r = num(params, 'radius');
		const n = has(neighbours, NORTH);
		const e = has(neighbours, EAST);
		const s = has(neighbours, SOUTH);
		const w = has(neighbours, WEST);
		roundedBox(0, 0, 1, 1, [n || w ? 0 : r, n || e ? 0 : r, s || e ? 0 : r, s || w ? 0 : r]).emit(
			out,
		);
	},
});

/** Fluid with only the top-left and bottom-right corners allowed to round: a leaf-like edge. */
const classy = shape({
	id: 'classy',
	labelKey: 'design.module.classy',
	params: [numberParam('radius', 0.45, 0.2, 0.5, 0.05)],
	connects: true,
	path({ neighbours, params }, out) {
		const r = num(params, 'radius');
		const topLeft = has(neighbours, NORTH) || has(neighbours, WEST) ? 0 : r;
		const bottomRight = has(neighbours, SOUTH) || has(neighbours, EAST) ? 0 : r;
		roundedBox(0, 0, 1, 1, [topLeft, 0, bottomRight, 0]).emit(out);
	},
});

const cross = shape({
	id: 'cross',
	labelKey: 'design.module.cross',
	params: [numberParam('thickness', 0.6, 0.4, 0.8, 0.05)],
	connects: false,
	path({ params }, out) {
		const a = 0.5 - num(params, 'thickness') / 2;
		const b = 1 - a;
		polygonContour([a, 0, b, 0, b, a, 1, a, 1, b, b, b, b, 1, a, 1, a, b, 0, b, 0, a, a, a]).emit(
			out,
		);
	},
});

const tinySquare = shape({
	id: 'tiny-square',
	labelKey: 'design.module.tiny-square',
	// Under 0.55 the square stops covering the pixels round the centre cross.
	params: [numberParam('scale', 0.7, 0.55, 1, 0.05)],
	connects: false,
	family: 'dot',
	fillsCell: (params) => num(params, 'scale') === 1,
	path({ params }, out) {
		const s = num(params, 'scale');
		const a = (1 - s) / 2;
		out.rect(a, a, s, s);
	},
});

/** The largest tilt mosaic gives a tile, in degrees, at full jitter. */
const MOSAIC_TILT = 18;
/** The smallest tile side: its inscribed circle still covers the centre cross. */
const MOSAIC_MIN = 0.64;

/**
 * Squares of seeded size and tilt. Each tile is as large as it can be at its
 * tilt without leaving the cell, less a seeded share of the room down to the
 * smallest side conformance allows.
 */
const mosaic = shape({
	id: 'mosaic',
	labelKey: 'design.module.mosaic',
	params: [numberParam('jitter', 0.6, 0, 1, 0.05)],
	connects: false,
	family: 'dot',
	path({ params, prng }, out) {
		const jitter = num(params, 'jitter');
		const tilt = (prng.next() * 2 - 1) * MOSAIC_TILT * jitter;
		const shrink = prng.next() * jitter;
		const radians = tilt * (PI / 180);
		const c = cos(radians);
		const s = sin(radians);
		const largest = 1 / (Math.abs(c) + Math.abs(s));
		const side = largest - shrink * (largest - MOSAIC_MIN);
		const h = side / 2;
		const corners: number[] = [];
		for (const [x, y] of [
			[-h, -h],
			[h, -h],
			[h, h],
			[-h, h],
		] as const) {
			corners.push(0.5 + x * c - y * s, 0.5 + x * s + y * c);
		}
		polygonContour(corners).emit(out);
	},
});

/**
 * A five-pointed star, tip up and centred on its own box. With a tip above
 * the centre and one either side, the arms carry three of the cross points
 * and the notch below sits under the fourth; the notches stay at least 0.45
 * of the way out, which keeps the pixels round the centre inked.
 */
const star = shape({
	id: 'star',
	labelKey: 'design.module.star',
	params: [numberParam('inner', 0.55, 0.45, 0.7, 0.01)],
	connects: false,
	family: 'dot',
	path({ params }, out) {
		const outer = 0.5;
		// The lowest tips sit at sin(54) of the radius below the centre, so the
		// star is moved down by half the gap that leaves, centring its box.
		const drop = (outer - outer * 0.8090169943749475) / 2;
		starContour(0.5, 0.5 + drop, 5, outer, outer * num(params, 'inner'), -90).emit(out);
	},
});

/** Every built-in module shape, in the order a picker shows them. */
export const BUILT_IN_MODULE_SHAPES: readonly ModuleShape[] = Object.freeze([
	squareModule,
	rounded,
	dot,
	diamond,
	squircle,
	hex,
	barsHorizontal,
	barsVertical,
	fluid,
	classy,
	cross,
	tinySquare,
	mosaic,
	star,
]);
