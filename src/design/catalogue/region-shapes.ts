/**
 * The built-in finder shapes: outer rings and inner centres.
 *
 * A finder is found by the 1:1:3:1:1 ratio a reader sees along every line
 * through its centre, so each shape here keeps the ring one module thick on
 * both axes and the centre three modules across, and rounds or cuts its
 * corners by amounts that keep the diagonals inside the strict reader's 0.35
 * of a module. The ring's hole is the outer edge brought in by one module
 * (a rounded corner's hole has the radius less one), which is what keeps the
 * ring one module thick round a corner as well as along a side.
 *
 * Whether a particular ring and centre work together on the diagonals
 * depends on both (a round ring leaves too little light round a square
 * centre's corners), so pairs are checked where they are chosen, by
 * `regionPairConforms`, and conformance asks of each shape that it makes a
 * good finder with at least one partner at every setting. The sub-finder of rMQR (concentric-5) is the same ring
 * round a one-module centre; the corner pattern (corner-l) is an L of five
 * modules, square or rounded.
 */

import type { PathBuilder } from '../../geometry/path.js';
import { num } from '../params.js';
import type { RegionKind, RegionShape, RegionShapeContext } from '../types.js';
import { direction } from '../paint.js';
import {
	circleContour,
	octagonContour,
	polygonContour,
	roundedBox,
	ring,
	scoopedContour,
	scoopedHole,
	squircleContour,
} from './draw.js';
import type { Contour } from './draw.js';
import { numberParam } from './schema.js';

const BOTH: readonly RegionKind[] = Object.freeze(['concentric-7', 'concentric-5', 'corner-l']);
const CENTRES: readonly RegionKind[] = Object.freeze(['concentric-7', 'concentric-5']);
const SEVEN: readonly RegionKind[] = Object.freeze(['concentric-7']);

/** The side of a concentric kind's box, in modules. */
function boxSize(kind: RegionKind): number {
	return kind === 'concentric-5' ? 5 : 7;
}

/** A radius given for a 7-module ring, scaled to the ring actually drawn. */
function scaled(value: number, kind: RegionKind): number {
	return (value * boxSize(kind)) / 7;
}

/** The corner pattern as a plain L: the corner module and two arms of two. */
function squareL(out: PathBuilder): void {
	out.polygon([0, 0, 3, 0, 3, 1, 1, 1, 1, 3, 0, 3]);
}

/**
 * The corner pattern rounded: a soft outer corner and round arm ends, the
 * inside corner kept square so the light module it wraps stays whole.
 */
function roundedL(out: PathBuilder, corner: number): void {
	roundedBox(0, 0, 3, 1, [corner, 0.5, 0.5, 0]).emit(out);
	roundedBox(0, 0, 1, 3, [corner, 0, 0.5, 0.5]).emit(out);
}

interface OuterDefinition {
	readonly id: string;
	readonly params: RegionShape['params'];
	readonly kinds: readonly RegionKind[];
	/** How a reader that traces the ring's sides takes it; cornered when left out. */
	readonly ringKind?: RegionShape['ringKind'];
	/** The outer edge and the hole, both clockwise, in a box of `size`. */
	readonly ring: (size: number, ctx: RegionShapeContext) => readonly [Contour, Contour];
	/** The corner pattern: rounded with this corner radius, or square when null. */
	readonly corner: (ctx: RegionShapeContext) => number | null;
}

function outer(definition: OuterDefinition): RegionShape {
	return Object.freeze({
		id: definition.id,
		labelKey: `design.region.${definition.id}`,
		params: Object.freeze([...definition.params]),
		kinds: definition.kinds,
		part: 'outer',
		...(definition.ringKind === undefined ? {} : { ringKind: definition.ringKind }),
		path(ctx: RegionShapeContext, out: PathBuilder) {
			if (ctx.kind === 'corner-l') {
				const corner = definition.corner(ctx);
				if (corner === null) squareL(out);
				else roundedL(out, corner);
				return;
			}
			const [edge, hole] = definition.ring(boxSize(ctx.kind), ctx);
			ring(out, edge, hole);
		},
	});
}

function roundedRing(size: number, radius: number, holeRadius: number): [Contour, Contour] {
	return [
		roundedBox(0, 0, size, size, [radius, radius, radius, radius]),
		roundedBox(1, 1, size - 2, size - 2, [holeRadius, holeRadius, holeRadius, holeRadius]),
	];
}

const OUTERS: readonly RegionShape[] = Object.freeze([
	outer({
		id: 'square',
		params: [],
		kinds: BOTH,
		ring: (size) => roundedRing(size, 0, 0),
		corner: () => null,
	}),
	outer({
		id: 'rounded',
		params: [numberParam('radius', 1, 0.5, 1.5, 0.05)],
		kinds: BOTH,
		ring: (size, { kind, params }) => {
			const r = scaled(num(params, 'radius'), kind);
			return roundedRing(size, r, Math.max(r - 1, 0));
		},
		corner: ({ params }) => Math.min(num(params, 'radius'), 1),
	}),
	outer({
		id: 'extra-rounded',
		params: [numberParam('radius', 2.5, 2, 2.5, 0.05)],
		kinds: BOTH,
		ring: (size, { kind, params }) => {
			const r = scaled(num(params, 'radius'), kind);
			return roundedRing(size, r, r - 1);
		},
		corner: () => 1,
	}),
	outer({
		id: 'circle',
		params: [],
		kinds: BOTH,
		// No corners to trace: zxing-cpp finds a round ring square on and loses
		// it at a slant, so the validator warns where one is chosen.
		ringKind: 'round',
		ring: (size) => [
			circleContour(size / 2, size / 2, size / 2),
			circleContour(size / 2, size / 2, size / 2 - 1),
		],
		corner: () => 1,
	}),
	outer({
		id: 'squircle',
		params: [],
		kinds: BOTH,
		ring: (size) => [
			squircleContour(size / 2, size / 2, size / 2, size / 2),
			squircleContour(size / 2, size / 2, size / 2 - 1, size / 2 - 1),
		],
		corner: () => 1,
	}),
	outer({
		id: 'leaf',
		params: [numberParam('radius', 2.5, 1.5, 2.5, 0.05)],
		kinds: BOTH,
		ring: (size, { kind, params }) => {
			const r = scaled(num(params, 'radius'), kind);
			const h = r - 1;
			return [
				roundedBox(0, 0, size, size, [r, 0, r, 0]),
				roundedBox(1, 1, size - 2, size - 2, [h, 0, h, 0]),
			];
		},
		corner: () => 1,
	}),
	outer({
		id: 'cushion',
		params: [numberParam('radius', 1.25, 1, 1.5, 0.05)],
		kinds: BOTH,
		ring: (size, { kind, params }) => {
			const r = scaled(num(params, 'radius'), kind);
			// The hole keeps a softer corner than `rounded` gives it, so both
			// edges of the ring are curved.
			return roundedRing(size, r, Math.max(r - 0.5, 0));
		},
		corner: () => 0.75,
	}),
	// Dots round the ring, with squircles at the four corners: a dot there is
	// too short along the diagonal, where a square module is root two long,
	// and the diagonal runs fall outside the strict ratio with any centre.
	//
	// Its sides are scalloped, and zxing-cpp, which traces a finder ring's
	// straight sides to find the symbol's fourth corner, misses it even square
	// on, so it is never a QR finder: the validator refuses it as one and no
	// centre pairs with it there. It stays in the catalogue so that a design
	// saved with it is refused with a reason rather than as an unknown style,
	// and as the ring the strict reader's tests hold a dotted ring to. The
	// sub-finder and corner pattern it could draw are drawn plainly on rMQR,
	// the only symbol that has them (see the scene builder), so nothing it
	// draws reaches a reader.
	Object.freeze({
		id: 'dot-ring',
		labelKey: 'design.region.dot-ring',
		params: Object.freeze([numberParam('size', 0.94, 0.9, 1, 0.02)]),
		kinds: BOTH,
		part: 'outer',
		ringKind: 'dotted',
		path({ kind, params }: RegionShapeContext, out: PathBuilder) {
			const r = num(params, 'size') / 2;
			if (kind === 'corner-l') {
				for (const [x, y] of [
					[0, 0],
					[1, 0],
					[2, 0],
					[0, 1],
					[0, 2],
				] as const) {
					circleContour(x + 0.5, y + 0.5, r).emit(out);
				}
				return;
			}
			const size = boxSize(kind);
			for (let y = 0; y < size; y += 1) {
				for (let x = 0; x < size; x += 1) {
					const corner = (x === 0 || x === size - 1) && (y === 0 || y === size - 1);
					if (corner) squircleContour(x + 0.5, y + 0.5, r, r).emit(out);
					else if (x === 0 || y === 0 || x === size - 1 || y === size - 1) {
						circleContour(x + 0.5, y + 0.5, r).emit(out);
					}
				}
			}
		},
	} satisfies RegionShape),
	outer({
		id: 'octagon',
		params: [numberParam('cut', 1.1, 0.8, 1.4, 0.05)],
		kinds: BOTH,
		ring: (size, { kind, params }) => {
			const cut = scaled(num(params, 'cut'), kind);
			// A cut edge one module further in, measured square to the cut, is
			// root two further along each side, less the module the box moved.
			return [
				octagonContour(0, 0, size, size, cut),
				octagonContour(1, 1, size - 2, size - 2, Math.max(cut + Math.SQRT2 - 2, 0)),
			];
		},
		corner: () => null,
	}),
	outer({
		id: 'scooped',
		params: [numberParam('bite', 0.8, 0.5, 1, 0.05)],
		kinds: BOTH,
		ring: (size, { kind, params }) => {
			const bite = scaled(num(params, 'bite'), kind);
			return [scoopedContour(0, 0, size, size, bite), scoopedHole(0, 0, size, size, bite)];
		},
		corner: () => null,
	}),
]);

interface InnerDefinition {
	readonly id: string;
	readonly params: RegionShape['params'];
	readonly kinds: readonly RegionKind[];
	/** The centre, clockwise, in the box (x, y, size, size). */
	readonly centre: (x: number, size: number, ctx: RegionShapeContext) => Contour | Contour[];
}

/**
 * A centre shape. Rings and centres share one registry, so a centre's id
 * carries `-centre` after its shape's name: the circle ring is `circle`, the
 * circle centre `circle-centre`.
 */
function inner(definition: InnerDefinition): RegionShape {
	const id = `${definition.id}-centre`;
	return Object.freeze({
		id,
		labelKey: `design.region.${id}`,
		params: Object.freeze([...definition.params]),
		kinds: definition.kinds,
		part: 'inner',
		path(ctx: RegionShapeContext, out: PathBuilder) {
			// The corner pattern has no centre to draw.
			if (ctx.kind === 'corner-l') return;
			const size = ctx.kind === 'concentric-5' ? 1 : 3;
			const drawn = definition.centre(2, size, ctx);
			for (const contour of Array.isArray(drawn) ? drawn : [drawn]) contour.emit(out);
		},
	});
}

/** A value given for a three-module centre, scaled to the centre drawn. */
function centreScaled(value: number, size: number): number {
	return (value * size) / 3;
}

const INNERS: readonly RegionShape[] = Object.freeze([
	inner({
		id: 'square',
		params: [],
		kinds: CENTRES,
		centre: (x, size) => roundedBox(x, x, size, size, [0, 0, 0, 0]),
	}),
	inner({
		id: 'rounded',
		params: [numberParam('radius', 0.5, 0.25, 0.75, 0.05)],
		kinds: CENTRES,
		centre: (x, size, { params }) => {
			const r = centreScaled(num(params, 'radius'), size);
			return roundedBox(x, x, size, size, [r, r, r, r]);
		},
	}),
	inner({
		id: 'circle',
		params: [],
		kinds: CENTRES,
		centre: (x, size) => circleContour(x + size / 2, x + size / 2, size / 2),
	}),
	inner({
		id: 'squircle',
		params: [],
		kinds: CENTRES,
		centre: (x, size) => squircleContour(x + size / 2, x + size / 2, size / 2, size / 2),
	}),
	inner({
		id: 'leaf',
		params: [numberParam('radius', 1.2, 0.75, 1.5, 0.05)],
		kinds: CENTRES,
		centre: (x, size, { params }) => {
			const r = centreScaled(num(params, 'radius'), size);
			return roundedBox(x, x, size, size, [r, 0, r, 0]);
		},
	}),
	inner({
		id: 'octagon',
		// Cut less than 0.45, inside the round ring, the centre's diagonals pass
		// the design layer's runs and the strict reader's finder search still
		// misses the pair at 6 pixels a module.
		params: [numberParam('cut', 0.6, 0.45, 0.9, 0.05)],
		kinds: CENTRES,
		centre: (x, size, { params }) =>
			octagonContour(x, x, size, size, centreScaled(num(params, 'cut'), size)),
	}),
	inner({
		id: 'scooped',
		params: [numberParam('bite', 0.45, 0.3, 0.6, 0.05)],
		kinds: CENTRES,
		centre: (x, size, { params }) =>
			scoopedContour(x, x, size, size, centreScaled(num(params, 'bite'), size)),
	}),
	inner({
		id: 'star',
		params: [numberParam('inner', 0.8, 0.72, 0.9, 0.01)],
		kinds: SEVEN,
		// Eight points: four on the axes at the box's edges and four out to its
		// corners, so the axis runs and the diagonal runs both keep the length
		// a square centre gives them.
		centre: (x, size, { params }) => {
			const c = x + size / 2;
			const half = size / 2;
			const notch = half * num(params, 'inner');
			const points: number[] = [];
			for (let i = 0; i < 16; i += 1) {
				const [dx, dy] = direction(i * 22.5);
				const r = i % 2 === 1 ? notch : i % 4 === 0 ? half : half * Math.SQRT2;
				points.push(c + r * dx, c + r * dy);
			}
			return polygonContour(points);
		},
	}),
	inner({
		id: 'flower',
		params: [numberParam('petal', 0.6, 0.55, 0.7, 0.01)],
		kinds: SEVEN,
		// A disc with eight round petals, four on the axes and four on the
		// diagonals, all inside the three-module box.
		centre: (x, size, { params }) => {
			const c = x + size / 2;
			const petal = (size / 3) * num(params, 'petal');
			const contours: Contour[] = [circleContour(c, c, size / 2 - petal * 0.75)];
			const axis = size / 2 - petal;
			const diagonal = (size / 2) * Math.SQRT2 - petal;
			for (let i = 0; i < 8; i += 1) {
				const along = i % 2 === 0 ? axis : diagonal / Math.SQRT2;
				const dx = [1, 1, 0, -1, -1, -1, 0, 1][i] as number;
				const dy = [0, 1, 1, 1, 0, -1, -1, -1][i] as number;
				contours.push(circleContour(c + dx * along, c + dy * along, petal));
			}
			return contours;
		},
	}),
]);

/** Every built-in region shape, outers first. */
export const BUILT_IN_REGION_SHAPES: readonly RegionShape[] = Object.freeze([...OUTERS, ...INNERS]);
