/**
 * A conic gradient as flat wedges, for formats that have no conic gradient.
 *
 * SVG 1.1 and 2 have linear and radial gradients only, so `sceneToSvg` draws
 * a conic paint as a fan of solid wedges about its centre, clipped to the
 * shape. The rasteriser draws the true gradient; this is built to match it to
 * within a level.
 *
 * How many wedges: each stretch between two stops is cut so that neighbouring
 * wedges differ by at most one level in any channel, but never into wedges
 * narrower than a quarter of a degree (1440 to the turn, where a wedge is
 * under a pixel wide within 230 pixels of the centre) and never wider than
 * 45 degrees (so a straight outer edge at twice the needed radius still
 * covers the box). A stretch of one colour, such as the padding before the
 * first stop, needs only the 45 degree minimum. Neighbouring wedges of the
 * same colour are then joined into one fan, so a gradient of two similar
 * colours is a handful of paths rather than a thousand.
 *
 * Anti-aliased renderers let the background through where two separately
 * filled shapes meet edge to edge, and wedges a fraction of a pixel wide meet
 * edge to edge many times within one pixel, so the leak adds up to a visible
 * streak. So each opaque fan is drawn on past its end, under the fans that
 * follow it, by up to 45 degrees or to the end of its run of opaque fans,
 * whichever comes first. Every point is then under at least one fan drawn
 * whole, and only the run's first edge and the clip are anti-aliased against
 * what lies beneath. 45 degrees is a pixel's width a pixel and a half from the
 * centre, which bounds the seams to that disc. A translucent fan cannot be
 * drawn on under its neighbour without showing through it. When every stop
 * shares one opacity, which is the usual way a gradient is translucent, the
 * fans are drawn opaque and the group carries the opacity, which is the same
 * picture with no seams. Otherwise translucent fans meet edge to edge, and a
 * renderer that leaks at shared edges shows faint seams there.
 *
 * Every fan is finally clipped to the box it has to cover, which the caller
 * makes the shape's bounds within the scene. The fans' outer points lie far
 * beyond the shape, and geometry far outside the picture is where renderers
 * have their own trouble: resvg, for one, drops a clipped element inside a
 * translucent group entirely once its geometry reaches past the left edge.
 */

import { TAU, cos, hypot, sin } from '../core/math.js';
import type { Box } from '../geometry/measure.js';
import { conicStart, ramp, rampStraight } from './paint.js';
import type { NormalPaint } from './scene.js';

/** The fans, and the opacity of the group that holds them. */
export interface Wedges {
	readonly opacity: number;
	readonly fans: readonly Wedge[];
}

/** One fan: its colour, and the points round its outer edge in order (x, y pairs). */
export interface Wedge {
	readonly r: number;
	readonly g: number;
	readonly b: number;
	readonly a: number;
	/** The apex, then the outer points. */
	readonly points: readonly number[];
}

const MIN_PER_TURN = 8;
const MAX_PER_TURN = 1440;
/** The furthest out a fan's outer points go. */
const FAR_LIMIT = 1e150;

/** How far, as a share of a turn, an opaque fan is drawn on beneath the ones after it. */
const UNDERLAP = 1 / 8;

interface Piece {
	readonly from: number;
	readonly to: number;
	readonly r: number;
	readonly g: number;
	readonly b: number;
	readonly a: number;
}

/** The fans that draw `paint` over `box`, in the order they are to be drawn. */
export function conicWedges(paint: Extract<NormalPaint, { kind: 'conic' }>, box: Box): Wedges {
	const { cx, cy } = paint;
	const shared = (paint.stops[0] as (typeof paint.stops)[number]).colour.a;
	const uniform = paint.stops.every((stop) => stop.colour.a === shared);
	const opacity = uniform ? shared : 1;
	// With one opacity throughout, the fans are drawn opaque and the group
	// carries it.
	const stops = uniform
		? paint.stops.map((stop) => ({ offset: stop.offset, colour: { ...stop.colour, a: 1 } }))
		: paint.stops;
	const steps = ramp(stops);
	const offsets = stops.map((stop) => stop.offset);
	const spans: [number, number, number][] = [];
	const first = offsets[0] as number;
	const last = offsets[offsets.length - 1] as number;
	if (first > 0) spans.push([0, first, 0]);
	for (let i = 0; i + 1 < stops.length; i += 1) {
		const from = offsets[i] as number;
		const to = offsets[i + 1] as number;
		if (to === from) continue;
		const a = (stops[i] as (typeof stops)[number]).colour;
		const b = (stops[i + 1] as (typeof stops)[number]).colour;
		const levels = Math.max(
			Math.abs(a.r - b.r),
			Math.abs(a.g - b.g),
			Math.abs(a.b - b.b),
			Math.abs(a.a - b.a) * 255,
		);
		spans.push([from, to, levels]);
	}
	if (last < 1) spans.push([last, 1, 0]);

	const pieces: Piece[] = [];
	const colour = new Float64Array(4);
	for (const [from, to, levels] of spans) {
		const span = to - from;
		const fewest = Math.ceil(span * MIN_PER_TURN);
		const most = Math.ceil(span * MAX_PER_TURN);
		const count = Math.max(fewest, Math.min(most, Math.ceil(levels)));
		for (let j = 0; j < count; j += 1) {
			const a = from + (span * j) / count;
			const b = j + 1 === count ? to : from + (span * (j + 1)) / count;
			rampStraight(steps, (a + b) / 2, colour);
			pieces.push({
				from: a,
				to: b,
				r: Math.round((colour[0] as number) * 255),
				g: Math.round((colour[1] as number) * 255),
				b: Math.round((colour[2] as number) * 255),
				// Alpha to the four decimals the SVG writer keeps.
				a: Math.round((colour[3] as number) * 10000) / 10000,
			});
		}
	}

	// Far enough out that the fans cover the box: twice the distance to its
	// furthest corner, so a chord across 56 degrees still clears it.
	let reach = 0;
	for (const [x, y] of [
		[box.x, box.y],
		[box.x + box.width, box.y],
		[box.x, box.y + box.height],
		[box.x + box.width, box.y + box.height],
	] as const) {
		reach = Math.max(reach, hypot(x - cx, y - cy));
	}
	// Held finite for a centre absurdly far from the shape, where the fans then
	// fall short of it and draw nothing rather than overflow into NaN.
	const radius = Math.min(2 * (reach + 1), FAR_LIMIT);
	const start = conicStart(paint.angle);
	const far = (t: number, out: number[]): void => {
		const angle = start + t * TAU;
		out.push(cx + radius * cos(angle), cy + radius * sin(angle));
	};

	// Join neighbouring pieces of one colour into runs.
	const runs: { from: number; to: number; head: Piece; bounds: number[] }[] = [];
	for (const piece of pieces) {
		const previous = runs[runs.length - 1];
		if (previous !== undefined && sameColour(previous.head, piece)) {
			previous.to = piece.to;
			previous.bounds.push(piece.from);
		} else {
			runs.push({ from: piece.from, to: piece.to, head: piece, bounds: [piece.from] });
		}
	}

	const fans: Wedge[] = [];
	for (let i = 0; i < runs.length; i += 1) {
		const run = runs[i] as (typeof runs)[number];
		const points: number[] = [cx, cy];
		for (const t of run.bounds) far(t, points);
		far(run.to, points);
		if (run.head.a === 1) {
			// Drawn on beneath the opaque runs that follow, up to the cap.
			let end = run.to;
			for (let j = i + 1; j < runs.length; j += 1) {
				const next = runs[j] as (typeof runs)[number];
				if (next.head.a !== 1) break;
				end = next.to;
			}
			const reachTo = Math.min(end, run.to + UNDERLAP);
			if (reachTo > run.to) far(reachTo, points);
		}
		const clipped = clipToBox(points, box);
		if (clipped.length >= 6) {
			fans.push({ r: run.head.r, g: run.head.g, b: run.head.b, a: run.head.a, points: clipped });
		}
	}
	return { opacity, fans };
}

/**
 * A polygon clipped to an axis-aligned box, by Sutherland and Hodgman.
 *
 * The box is convex, so this is exact for any polygon, convex or not; a fan of
 * more than half a turn can come back with edges that run along the box and
 * back, which fill nothing.
 */
export function clipToBox(points: readonly number[], box: Box): number[] {
	let current = points.slice();
	const edges: [axis: 0 | 1, bound: number, keepAbove: boolean][] = [
		[0, box.x, true],
		[0, box.x + box.width, false],
		[1, box.y, true],
		[1, box.y + box.height, false],
	];
	for (const [axis, bound, keepAbove] of edges) {
		const input = current;
		current = [];
		const n = input.length / 2;
		for (let i = 0; i < n; i += 1) {
			const ax = input[i * 2] as number;
			const ay = input[i * 2 + 1] as number;
			const j = (i + 1) % n;
			const bx = input[j * 2] as number;
			const by = input[j * 2 + 1] as number;
			const av = axis === 0 ? ax : ay;
			const bv = axis === 0 ? bx : by;
			const aIn = keepAbove ? av >= bound : av <= bound;
			const bIn = keepAbove ? bv >= bound : bv <= bound;
			if (aIn) current.push(ax, ay);
			if (aIn !== bIn) {
				const t = (bound - av) / (bv - av);
				if (axis === 0) current.push(bound, ay + (by - ay) * t);
				else current.push(ax + (bx - ax) * t, bound);
			}
		}
		if (current.length === 0) break;
	}
	return current;
}

function sameColour(a: Piece, b: Piece): boolean {
	return a.r === b.r && a.g === b.g && a.b === b.b && a.a === b.a;
}
