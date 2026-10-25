/**
 * Conformance for module shapes.
 *
 * A reader decides each module by sampling near its centre, and a module
 * shape that leaves its centre light, or ink that lands in a light
 * neighbour, is a wrong bit before any camera is involved. So every shape is
 * drawn at 16 pixels a module for all 256 neighbour masks, at each sampled
 * set of parameters, and held to four rules:
 *
 * - centre-cross: the five points at the centre and 0.2 either side of it
 *   on both axes are inked at 0.98 or more (every pixel touching each point);
 * - outside-cell: nothing is inked outside the cell, except, for a shape that
 *   connects, in an edge neighbour that is dark;
 * - light-neighbour: nothing reaches within 0.3 of a light neighbour's centre;
 * - deterministic: the same mask, parameters and seed draw the same path.
 */

import { createPrng } from '../core/prng.js';
import { bounds } from '../geometry/measure.js';
import { PathBuilder } from '../geometry/path.js';
import type { Path } from '../geometry/path.js';
import { NEIGHBOUR_OFFSETS } from '../design/neighbours.js';
import type { ModuleShape, ResolvedParams } from '../design/types.js';
import { rasterise } from '../render/raster.js';
import { sampleParams } from './sample.js';
import type { Violation } from './types.js';

/** Pixels a module the shape is drawn at. */
export const MODULE_PIXELS = 16;
/** The share of each centre cross point that must be inked. */
export const CENTRE_CROSS_MIN = 0.98;
/** How far the cross points sit from the centre, in modules. */
export const CENTRE_CROSS_ARM = 0.2;
/** The radius round a light neighbour's centre that nothing may enter. */
export const LIGHT_DISC_RADIUS = 0.3;

export interface ModuleShapeCheckOptions {
	/** Seeds the parameter mixtures and each module's stream. Default 1. */
	readonly seed?: number;
	/** How many seeded parameter mixtures to draw beside the defaults and extremes. Default 3. */
	readonly mixtures?: number;
}

function draw(shape: ModuleShape, neighbours: number, params: ResolvedParams, seed: number): Path {
	const out = new PathBuilder();
	shape.path({ neighbours, params, prng: createPrng(seed).fork(neighbours) }, out);
	return out.build();
}

function samePath(a: Path, b: Path): boolean {
	if (a.commands.length !== b.commands.length || a.points.length !== b.points.length) return false;
	for (let i = 0; i < a.commands.length; i += 1) if (a.commands[i] !== b.commands[i]) return false;
	for (let i = 0; i < a.points.length; i += 1) if (a.points[i] !== b.points[i]) return false;
	return true;
}

function hex(mask: number): string {
	return `0x${mask.toString(16).padStart(2, '0')}`;
}

/** Every rule the shape breaks, at most one violation per rule and parameter set. */
export function checkModuleShape(
	shape: ModuleShape,
	options: ModuleShapeCheckOptions = {},
): Violation[] {
	const seed = options.seed ?? 1;
	const violations: Violation[] = [];
	const size = 3 * MODULE_PIXELS;
	for (const params of sampleParams(shape.params, seed, options.mixtures ?? 3)) {
		const where = `params ${JSON.stringify(params)}`;
		const broken = new Set<string>();
		const report = (rule: string, detail: string): void => {
			if (broken.has(rule)) return;
			broken.add(rule);
			violations.push({ entry: shape.id, rule, detail: `${where}, ${detail}` });
		};
		for (let mask = 0; mask < 256; mask += 1) {
			const path = draw(shape, mask, params, seed);
			if (!samePath(path, draw(shape, mask, params, seed))) {
				report('deterministic', `neighbours ${hex(mask)}: two draws differ`);
			}
			const box = bounds(path);
			if (box === null) {
				report('centre-cross', `neighbours ${hex(mask)}: nothing is drawn`);
				continue;
			}
			// Beyond the three by three window the raster below cannot see.
			if (box.x < -1 || box.y < -1 || box.x + box.width > 2 || box.y + box.height > 2) {
				report('outside-cell', `neighbours ${hex(mask)}: the shape reaches past its neighbours`);
			}
			const placed = new PathBuilder().transform([1, 0, 0, 1, 1, 1]).append(path).build();
			const image = rasterise(
				{
					width: 3,
					height: 3,
					background: null,
					layers: [
						{
							kind: 'path',
							path: placed,
							paint: { kind: 'solid', colour: { r: 0, g: 0, b: 0, a: 1 } },
						},
					],
				},
				{ width: size },
			);
			const alpha = (x: number, y: number): number =>
				(image.data[(y * size + x) * 4 + 3] as number) / 255;

			for (const [dx, dy] of [
				[0, 0],
				[-CENTRE_CROSS_ARM, 0],
				[CENTRE_CROSS_ARM, 0],
				[0, -CENTRE_CROSS_ARM],
				[0, CENTRE_CROSS_ARM],
			] as const) {
				const px = (1.5 + dx) * MODULE_PIXELS;
				const py = (1.5 + dy) * MODULE_PIXELS;
				// Every pixel whose closed square holds the point.
				const xs = Number.isInteger(px) ? [px - 1, px] : [Math.floor(px)];
				const ys = Number.isInteger(py) ? [py - 1, py] : [Math.floor(py)];
				let least = 1;
				for (const y of ys) for (const x of xs) least = Math.min(least, alpha(x, y));
				if (least < CENTRE_CROSS_MIN) {
					report(
						'centre-cross',
						`neighbours ${hex(mask)}: the point ${0.5 + dx}, ${0.5 + dy} is inked ${least.toFixed(3)}`,
					);
				}
			}

			for (let y = 0; y < size; y += 1) {
				for (let x = 0; x < size; x += 1) {
					if (alpha(x, y) === 0) continue;
					const cx = Math.floor(x / MODULE_PIXELS) - 1;
					const cy = Math.floor(y / MODULE_PIXELS) - 1;
					if (cx === 0 && cy === 0) continue;
					const bit = NEIGHBOUR_OFFSETS.findIndex(([ox, oy]) => ox === cx && oy === cy);
					const dark = (mask & (1 << bit)) !== 0;
					const edge = cx === 0 || cy === 0;
					if (!(shape.connects && edge && dark)) {
						report(
							'outside-cell',
							`neighbours ${hex(mask)}: ink at ${((x + 0.5) / MODULE_PIXELS - 1).toFixed(3)}, ${((y + 0.5) / MODULE_PIXELS - 1).toFixed(3)} in the cell at ${cx}, ${cy}`,
						);
					}
					if (!dark) {
						const ux = (x + 0.5) / MODULE_PIXELS - (1.5 + cx);
						const uy = (y + 0.5) / MODULE_PIXELS - (1.5 + cy);
						if (ux * ux + uy * uy < LIGHT_DISC_RADIUS * LIGHT_DISC_RADIUS) {
							report(
								'light-neighbour',
								`neighbours ${hex(mask)}: ink within ${LIGHT_DISC_RADIUS} of the light neighbour at ${cx}, ${cy}`,
							);
						}
					}
				}
			}
		}
	}
	return violations;
}
