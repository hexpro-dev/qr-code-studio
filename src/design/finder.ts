/**
 * Measuring a finder the way a strict reader sees it.
 *
 * A reader finds a finder by the ratio of dark and light runs along lines
 * through its centre: 1:1:3:1:1 for the 7 by 7 finder, 1:1:1:1:1 for rMQR's
 * 5 by 5 sub-finder. The strict profile allows 0.35 of a module per run,
 * three times that for the 3 module centre, after estimating the module from
 * the whole pattern's length, and it checks both diagonals as well as the
 * axes. This file draws a ring and a centre at 4 pixels a module, thresholds
 * them, and measures that with sub-pixel edges from the exact centre.
 *
 * On the axes the runs are also held to their nominal lengths in modules,
 * not only to the ratio, because the reader takes its module size for the
 * rest of the symbol from the finder: a finder that is the right shape but
 * the wrong size would throw every later sample off.
 *
 * The diagonals are held to 0.35 here although the strict reader allows them
 * half a module. That half module is slack for the reader's own error (it
 * walks whole pixel steps from a centre it knows to the nearest pixel), and
 * this measurement has none: given half a module too, it accepts 73 more of
 * the catalogue's pairs at sampled settings, and the strict reader misses 34
 * of those at some density from 5 pixels a module, phase or small roll.
 *
 * Pairs are checked rather than shapes because the diagonals depend on both:
 * a round ring round a square centre leaves too little light past the
 * centre's corners. `regionPairConforms` is what the validator, the scene
 * builder and the studio's pair table ask.
 *
 * This is a model of the strict reader, and the model is what runs when a
 * design is validated or drawn, because the root of the package must not
 * pull in the decoder. The strict reader's own tests (`strictFindsFinder`,
 * `ringKind`) are asked in the conformance suite instead, which holds every
 * built-in ring and centre to them: no pair this file accepts may be one the
 * strict reader misses, and no ring may trace differently from its
 * `ringKind`. Readers trace a ring's sides as well as cross it (see
 * `ringKind` in decode), so a ring that says it is `dotted` is never a
 * finder here; a `round` one is, with a warning from the validator.
 */

import { flattenPath } from '../geometry/flatten.js';
import { PathBuilder } from '../geometry/path.js';
import type { Path } from '../geometry/path.js';
import { rasterise } from '../render/raster.js';
import type {
	ModuleFamily,
	ModuleShape,
	RegionKind,
	RegionShape,
	ResolvedParams,
	RingKind,
} from './types.js';

/** Slack per run, in modules, as the strict reader allows it on the axes. */
export const FINDER_TOLERANCE = 0.35;
/** The narrowest the light ring between ring and centre may be, in modules. */
export const LIGHT_RING_MIN = 0.6;
/** Pixels a module the runs are measured at. */
export const FINDER_PIXELS = 4;

export interface FinderProblem {
	readonly rule: 'finder-runs' | 'light-ring' | 'ring-not-traceable';
	readonly detail: string;
}

/** What a ring says it is to a reader that traces its sides; `cornered` unless it says otherwise. */
export function ringKindOf(shape: RegionShape): RingKind {
	return shape.ringKind ?? 'cornered';
}

/** A region shape's path in its own box, moved by (dx, dy). */
export function regionPath(
	shape: RegionShape,
	kind: RegionKind,
	params: ResolvedParams,
	dx = 0,
	dy = 0,
	out: PathBuilder = new PathBuilder(),
): Path {
	const own = new PathBuilder();
	shape.path({ kind, params }, own);
	return out.transform([1, 0, 0, 1, dx, dy]).append(own.build()).build();
}

/**
 * The runs along a line of coverage samples, as lengths in samples between
 * the points where coverage crosses one half, the light ends trimmed. Null
 * when the line never goes dark.
 *
 * The crossing is placed between the two samples either side of it, in
 * proportion to their coverage, rather than at a pixel edge: a pixel grid at
 * one fixed phase would otherwise make a ring 2.9 samples thick count as 2 in
 * one place and 3 in another, and the verdict on a shape would depend on
 * where its edges happened to fall rather than on the shape.
 */
function runsOf(line: readonly number[]): number[] | null {
	const edges: number[] = [];
	for (let i = 0; i + 1 < line.length; i += 1) {
		const a = line[i] as number;
		const b = line[i + 1] as number;
		if (a >= 0.5 !== b >= 0.5) edges.push(i + 0.5 + (0.5 - a) / (b - a));
	}
	const first = line[0] as number;
	const last = line[line.length - 1] as number;
	if (first >= 0.5) edges.unshift(0);
	if (last >= 0.5) edges.push(line.length);
	if (edges.length < 2) return null;
	const runs: number[] = [];
	for (let i = 1; i < edges.length; i += 1)
		runs.push((edges[i] as number) - (edges[i - 1] as number));
	return runs;
}

/** The strict reader's test: five runs within slack of the nominal ratio, by the pattern's own module. */
function ratioHolds(runs: readonly number[], nominal: readonly number[]): boolean {
	const total = runs.reduce((sum, run) => sum + run, 0);
	const units = nominal.reduce((sum, n) => sum + n, 0);
	const module = total / units;
	const slack = module * FINDER_TOLERANCE;
	return runs.every(
		(run, i) => Math.abs(run - (nominal[i] as number) * module) < (nominal[i] as number) * slack,
	);
}

/** The shortest distance between two segments, zero where they cross. */
function segmentDistance(
	ax: number,
	ay: number,
	bx: number,
	by: number,
	cx: number,
	cy: number,
	dx: number,
	dy: number,
): number {
	const cross = (px: number, py: number, qx: number, qy: number, rx: number, ry: number): number =>
		(qx - px) * (ry - py) - (qy - py) * (rx - px);
	const d1 = cross(ax, ay, bx, by, cx, cy);
	const d2 = cross(ax, ay, bx, by, dx, dy);
	const d3 = cross(cx, cy, dx, dy, ax, ay);
	const d4 = cross(cx, cy, dx, dy, bx, by);
	if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
		return 0;
	}
	return Math.min(
		pointToSegment(ax, ay, cx, cy, dx, dy),
		pointToSegment(bx, by, cx, cy, dx, dy),
		pointToSegment(cx, cy, ax, ay, bx, by),
		pointToSegment(dx, dy, ax, ay, bx, by),
	);
}

function pointToSegment(
	px: number,
	py: number,
	ax: number,
	ay: number,
	bx: number,
	by: number,
): number {
	const vx = bx - ax;
	const vy = by - ay;
	const length = vx * vx + vy * vy;
	const t = length === 0 ? 0 : Math.min(Math.max(((px - ax) * vx + (py - ay) * vy) / length, 0), 1);
	const qx = ax + t * vx - px;
	const qy = ay + t * vy - py;
	return Math.sqrt(qx * qx + qy * qy);
}

function segmentsOf(path: Path): number[] {
	const out: number[] = [];
	flattenPath(path, { tolerance: 0.002 }, (x0, y0, x1, y1) => {
		out.push(x0, y0, x1, y1);
	});
	return out;
}

/** The narrowest gap between the outlines of two paths, in their units. */
export function outlineGap(a: Path, b: Path): number {
	const first = segmentsOf(a);
	const second = segmentsOf(b);
	let best = Infinity;
	for (let i = 0; i < first.length; i += 4) {
		for (let j = 0; j < second.length; j += 4) {
			const d = segmentDistance(
				first[i] as number,
				first[i + 1] as number,
				first[i + 2] as number,
				first[i + 3] as number,
				second[j] as number,
				second[j + 1] as number,
				second[j + 2] as number,
				second[j + 3] as number,
			);
			if (d < best) best = d;
		}
	}
	return best;
}

function format(value: number): string {
	return value.toFixed(3);
}

/**
 * Everything wrong with a ring and centre as a finder of `kind`, measured as
 * the strict reader would. Empty when the pair is a good finder.
 */
export function finderProblems(
	outer: RegionShape,
	outerParams: ResolvedParams,
	inner: RegionShape,
	innerParams: ResolvedParams,
	kind: 'concentric-7' | 'concentric-5',
): FinderProblem[] {
	const size = kind === 'concentric-7' ? 7 : 5;
	const nominal = kind === 'concentric-7' ? [1, 1, 3, 1, 1] : [1, 1, 1, 1, 1];
	const ringPath = regionPath(outer, kind, outerParams, 1, 1);
	const centrePath = regionPath(inner, kind, innerParams, 1, 1);
	const both = new PathBuilder().append(ringPath).append(centrePath).build();
	const span = size + 2;
	const pixels = span * FINDER_PIXELS;
	const image = rasterise(
		{
			width: span,
			height: span,
			background: null,
			layers: [
				{ kind: 'path', path: both, paint: { kind: 'solid', colour: { r: 0, g: 0, b: 0, a: 1 } } },
			],
		},
		{ width: pixels },
	);
	const cover = (x: number, y: number): number =>
		(image.data[(y * pixels + x) * 4 + 3] as number) / 255;

	const problems: FinderProblem[] = [];
	if (kind === 'concentric-7' && ringKindOf(outer) === 'dotted') {
		problems.push({
			rule: 'ring-not-traceable',
			detail: `${kind}: a ring of dots, whose sides a reader cannot trace`,
		});
	}
	const centre = pixels / 2;
	const lines: { name: string; samples: number[]; axis: boolean }[] = [];
	for (const at of [centre - 1, centre]) {
		lines.push({
			name: `row ${at}`,
			samples: Array.from({ length: pixels }, (_, x) => cover(x, at)),
			axis: true,
		});
		lines.push({
			name: `column ${at}`,
			samples: Array.from({ length: pixels }, (_, y) => cover(at, y)),
			axis: true,
		});
	}
	lines.push({
		name: 'diagonal',
		samples: Array.from({ length: pixels }, (_, i) => cover(i, i)),
		axis: false,
	});
	lines.push({
		name: 'anti-diagonal',
		samples: Array.from({ length: pixels }, (_, i) => cover(i, pixels - 1 - i)),
		axis: false,
	});

	for (const line of lines) {
		const runs = runsOf(line.samples);
		if (runs === null || runs.length !== 5) {
			problems.push({
				rule: 'finder-runs',
				detail: `${kind} ${line.name}: ${runs === null ? 0 : runs.length} runs where 5 are needed`,
			});
			continue;
		}
		if (line.axis) {
			const modules = runs.map((run) => run / FINDER_PIXELS);
			const off = modules.findIndex(
				(run, i) => Math.abs(run - (nominal[i] as number)) > FINDER_TOLERANCE,
			);
			if (off !== -1) {
				problems.push({
					rule: 'finder-runs',
					detail: `${kind} ${line.name}: run ${off} is ${format(modules[off] as number)} modules where ${nominal[off]} is needed`,
				});
			}
		}
		if (!ratioHolds(runs, nominal)) {
			problems.push({
				rule: 'finder-runs',
				detail: `${kind} ${line.name}: runs ${runs.map(format).join(':')} are outside ${nominal.join(':')} by more than ${FINDER_TOLERANCE} of a module`,
			});
		}
	}

	const gap = outlineGap(ringPath, centrePath);
	if (gap < LIGHT_RING_MIN) {
		problems.push({
			rule: 'light-ring',
			detail: `${kind}: the light ring narrows to ${format(gap)} modules`,
		});
	}
	return problems;
}

const cache = new WeakMap<RegionShape, WeakMap<RegionShape, Map<string, boolean>>>();

/** The family of finder pairs a module shape is drawn with; `square` when it does not say, or there is none. */
export function moduleFamilyOf(shape: ModuleShape | undefined): ModuleFamily {
	return shape?.family ?? 'square';
}

/**
 * True when this ring and this centre make a finder of `kind` the strict
 * reader finds, among modules of `family` (default `square`). Remembered per
 * pair of shapes and their parameters, since a design asks about the same
 * pair on every rebuild; keyed by the shapes themselves, so two registries'
 * entries of the same name never share an answer.
 *
 * The runs measured here hold for every family; a QR finder is also held to
 * what the ring says about the family (`unpaired`), which captures of the
 * pair among those modules measured. The alignment patterns take the
 * finder's style and were in those captures, so the smaller kind is asked
 * about by runs alone.
 */
export function regionPairConforms(
	outer: RegionShape,
	outerParams: ResolvedParams,
	inner: RegionShape,
	innerParams: ResolvedParams,
	kind: 'concentric-7' | 'concentric-5',
	family: ModuleFamily = 'square',
): boolean {
	if (kind === 'concentric-7' && outer.unpaired?.[family]?.includes(inner.id) === true) {
		return false;
	}
	let byOuter = cache.get(outer);
	if (byOuter === undefined) {
		byOuter = new WeakMap();
		cache.set(outer, byOuter);
	}
	let byInner = byOuter.get(inner);
	if (byInner === undefined) {
		byInner = new Map();
		byOuter.set(inner, byInner);
	}
	const key = `${kind}|${JSON.stringify(outerParams)}|${JSON.stringify(innerParams)}`;
	let known = byInner.get(key);
	if (known === undefined) {
		known = finderProblems(outer, outerParams, inner, innerParams, kind).length === 0;
		byInner.set(key, known);
	}
	return known;
}
