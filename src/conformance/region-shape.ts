/**
 * Conformance for finder shapes.
 *
 * A finder is a ring and a centre together, and on its diagonals the two
 * depend on each other (see design/finder.ts), so a shape is checked as half
 * of a pair. For each concentric kind it declares and each sampled set of its
 * parameters it must make a good finder (1:1:3:1:1, or 1:1:1:1:1 for the
 * sub-finder, within 0.35 of a module along both axes and both diagonals at 4
 * pixels a module, with a light ring of at least 0.6 modules) with at least
 * one of the partners given. A shape no centre can make a finder with, at
 * some setting of its own, is broken; which pairs work is then the scene
 * builder's question, answered by the same measurement.
 *
 * That measurement is a model of the strict reader, so for the QR finder it
 * is held to the reader itself (see finder.ts here): every pair the model
 * accepts, at each sampled setting of the shape and the partners' defaults,
 * must be found by the strict reader's finder search at 6 and 8 pixels a
 * module and four sub-pixel phases, and the ring must trace, by the strict
 * profile's `ringKind`, as its `ringKind` says. A ring that says it is
 * `dotted` needs no partner for the QR finder, since the validator never
 * lets it be one; it only has to be dotted.
 *
 * Outer shapes must also support concentric-7 and corner-l, and their corner
 * pattern is drawn at 16 pixels a module and held to the module rules: each
 * of its five modules inked round the centre cross, nothing within 0.3 of the
 * light module it wraps, nothing in the three modules of its box that belong
 * to data, nothing outside the box.
 */

import { bounds } from '../geometry/measure.js';
import type { Path } from '../geometry/path.js';
import { finderProblems, regionPath, ringKindOf } from '../design/finder.js';
import type { FinderProblem } from '../design/finder.js';
import { resolveParams } from '../design/params.js';
import { createDesignRegistries } from '../design/registries.js';
import type { RegionKind, RegionShape, ResolvedParams } from '../design/types.js';
import { rasterise } from '../render/raster.js';
import {
	CENTRE_CROSS_ARM,
	CENTRE_CROSS_MIN,
	LIGHT_DISC_RADIUS,
	MODULE_PIXELS,
} from './module-shape.js';
import { measureRingKind, strictFinderProblems } from './finder.js';
import { sampleParams } from './sample.js';
import type { Violation } from './types.js';

export interface RegionShapeCheckOptions {
	/**
	 * The shapes of the other part to pair with, each at its defaults. Default:
	 * the built-in shapes of the other part.
	 */
	readonly partners?: readonly RegionShape[];
	/** Seeds the parameter mixtures. Default 1. */
	readonly seed?: number;
	readonly mixtures?: number;
}

function samePath(a: Path, b: Path): boolean {
	if (a.commands.length !== b.commands.length || a.points.length !== b.points.length) return false;
	for (let i = 0; i < a.commands.length; i += 1) if (a.commands[i] !== b.commands[i]) return false;
	for (let i = 0; i < a.points.length; i += 1) if (a.points[i] !== b.points[i]) return false;
	return true;
}

/** The five modules of the corner pattern in its own frame, and the three of its box that are not. */
const L_MODULES: readonly (readonly [number, number])[] = [
	[0, 0],
	[1, 0],
	[2, 0],
	[0, 1],
	[0, 2],
];
const FOREIGN: readonly (readonly [number, number])[] = [
	[2, 1],
	[1, 2],
	[2, 2],
];

function checkCorner(
	shape: RegionShape,
	params: ResolvedParams,
	report: (rule: string, detail: string) => void,
): void {
	const path = regionPath(shape, 'corner-l', params, 1, 1);
	const size = 5 * MODULE_PIXELS;
	const image = rasterise(
		{
			width: 5,
			height: 5,
			background: null,
			layers: [
				{ kind: 'path', path, paint: { kind: 'solid', colour: { r: 0, g: 0, b: 0, a: 1 } } },
			],
		},
		{ width: size },
	);
	const alpha = (x: number, y: number): number =>
		(image.data[(y * size + x) * 4 + 3] as number) / 255;
	for (const [mx, my] of L_MODULES) {
		for (const [dx, dy] of [
			[0, 0],
			[-CENTRE_CROSS_ARM, 0],
			[CENTRE_CROSS_ARM, 0],
			[0, -CENTRE_CROSS_ARM],
			[0, CENTRE_CROSS_ARM],
		] as const) {
			const px = (mx + 1.5 + dx) * MODULE_PIXELS;
			const py = (my + 1.5 + dy) * MODULE_PIXELS;
			const xs = Number.isInteger(px) ? [px - 1, px] : [Math.floor(px)];
			const ys = Number.isInteger(py) ? [py - 1, py] : [Math.floor(py)];
			let least = 1;
			for (const y of ys) for (const x of xs) least = Math.min(least, alpha(x, y));
			if (least < CENTRE_CROSS_MIN) {
				report(
					'corner-cross',
					`the module at ${mx}, ${my} is inked ${least.toFixed(3)} near its centre`,
				);
			}
		}
	}
	for (let y = 0; y < size; y += 1) {
		for (let x = 0; x < size; x += 1) {
			if (alpha(x, y) === 0) continue;
			const mx = Math.floor(x / MODULE_PIXELS) - 1;
			const my = Math.floor(y / MODULE_PIXELS) - 1;
			if (mx < 0 || my < 0 || mx > 2 || my > 2) {
				report('corner-outside', "ink outside the pattern's box");
			} else if (FOREIGN.some(([fx, fy]) => fx === mx && fy === my)) {
				report(
					'corner-outside',
					`ink in the module at ${mx}, ${my}, which is not part of the pattern`,
				);
			} else if (mx === 1 && my === 1) {
				const ux = (x + 0.5) / MODULE_PIXELS - 2.5;
				const uy = (y + 0.5) / MODULE_PIXELS - 2.5;
				if (ux * ux + uy * uy < LIGHT_DISC_RADIUS * LIGHT_DISC_RADIUS) {
					report('corner-light', "ink within 0.3 of the light module's centre");
				}
			}
		}
	}
}

/** Every rule the shape breaks, at most one violation per rule, kind and parameter set. */
export function checkRegionShape(
	shape: RegionShape,
	options: RegionShapeCheckOptions = {},
): Violation[] {
	const violations: Violation[] = [];
	const other = shape.part === 'outer' ? 'inner' : 'outer';
	const partners = (options.partners ?? createDesignRegistries().regionShapes.list()).filter(
		(partner) => partner.part === other,
	);
	const required: readonly RegionKind[] =
		shape.part === 'outer' ? ['concentric-7', 'corner-l'] : ['concentric-7'];
	for (const kind of required) {
		if (!shape.kinds.includes(kind)) {
			violations.push({
				entry: shape.id,
				rule: 'kinds',
				detail: `${shape.part} shapes support ${kind}`,
			});
		}
	}

	for (const params of sampleParams(shape.params, options.seed ?? 1, options.mixtures ?? 3)) {
		const where = `params ${JSON.stringify(params)}`;
		const broken = new Set<string>();
		const report = (rule: string, detail: string): void => {
			if (broken.has(rule)) return;
			broken.add(rule);
			violations.push({ entry: shape.id, rule, detail: `${where}, ${detail}` });
		};
		for (const kind of shape.kinds) {
			const first = regionPath(shape, kind, params);
			if (!samePath(first, regionPath(shape, kind, params))) {
				report('deterministic', `${kind}: two draws differ`);
			}
			if (kind === 'corner-l') {
				if (shape.part === 'outer') checkCorner(shape, params, report);
				continue;
			}
			const size = kind === 'concentric-7' ? 7 : 5;
			const box = bounds(first);
			const [low, high] = shape.part === 'outer' ? [0, size] : [1, size - 1];
			if (
				box === null ||
				box.x < low - 1e-9 ||
				box.y < low - 1e-9 ||
				box.x + box.width > high + 1e-9 ||
				box.y + box.height > high + 1e-9
			) {
				report(
					'outside-box',
					`${kind}: the shape leaves ${shape.part === 'outer' ? 'its box' : "the ring's hole"}`,
				);
				continue;
			}
			// A ring of dots is never a QR finder (the validator refuses it as
			// one), so no centre has to pair with it there; what is asked of it
			// is that it is what it says, by the strict reader's measure.
			const dotted =
				shape.part === 'outer' && kind === 'concentric-7' && ringKindOf(shape) === 'dotted';
			if (dotted) {
				const partner = partners.find((other) => other.kinds.includes(kind));
				if (partner !== undefined) {
					const traced = measureRingKind(
						shape,
						params,
						partner,
						resolveParams(partner.params, undefined),
					);
					if (traced !== 'dotted') {
						report(
							'ring-kind',
							`${kind}: the ring says it is dotted and the strict reader traces it as ${traced ?? 'nothing it can measure'}`,
						);
					}
				}
				continue;
			}
			let closest: FinderProblem[] | null = null;
			let found = false;
			for (const partner of partners) {
				if (!partner.kinds.includes(kind)) continue;
				const partnerParams = resolveParams(partner.params, undefined);
				const [outer, outerParams, inner, innerParams] =
					shape.part === 'outer'
						? [shape, params, partner, partnerParams]
						: [partner, partnerParams, shape, params];
				if (kind === 'concentric-7' && ringKindOf(outer) === 'dotted') continue;
				const problems = finderProblems(outer, outerParams, inner, innerParams, kind);
				if (problems.length > 0) {
					if (closest === null || problems.length < closest.length) closest = problems;
					continue;
				}
				if (kind === 'concentric-7') {
					// Every pair the design layer's model accepts must be one the
					// strict reader finds, and its ring must trace as it says.
					const strict = strictFinderProblems(outer, outerParams, inner, innerParams);
					for (const problem of strict) {
						// How a partner's ring traces is that ring's own violation.
						if (problem.rule === 'ring-kind' && shape.part === 'inner') continue;
						report(problem.rule, `${kind} with ${partner.id}: ${problem.detail}`);
					}
					if (strict.some((problem) => problem.rule === 'strict-finder')) continue;
				}
				found = true;
			}
			if (!found) {
				report(
					'finder',
					`${kind}: no partner makes a finder the strict reader finds${closest === null ? ' (no partner supports this kind)' : `: ${closest.map((problem) => problem.detail).join('; ')}`}`,
				);
			}
		}
	}
	return violations;
}
