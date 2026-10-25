/**
 * The ladders climb: for one seed, each level of an axis does more damage
 * than the level before it, to the same photograph.
 *
 * The strict reader's verdict along a ladder is not something a test can
 * promise (a reader can fail one capture and read a harsher one), which is
 * why the report claims only an unbroken run of passes from the mildest
 * level. What the ladder itself controls is the damage, and that must grow:
 * every capture is measured against the mildest level's capture of the same
 * seed, on the same canvas, and the difference must rise with every step.
 */

import { describe, expect, it } from 'vitest';
import type { RgbaImage } from '../../src/core/image.js';
import { renderCapture } from '../../src/verify/capture.js';
import { DISTANCE_LADDER, LADDERS } from '../../src/verify/ladders.js';
import { prepare, renderMaster } from '../../src/verify/prepare.js';
import { job, registries } from './helpers.js';

const prepared = prepare(job(), registries);
const master = renderMaster(prepared, 15);
const { width, height } = prepared.built.scene;

function capture(axis: (typeof LADDERS)[number]['axis'], level: number, seed: number) {
	return renderCapture(master, width, height, 7, { axis, level, seed, pxPerModule: 8 });
}

function difference(a: RgbaImage, b: RgbaImage): number {
	expect([a.width, a.height]).toEqual([b.width, b.height]);
	let sum = 0;
	for (let i = 0; i < a.data.length; i += 4)
		sum += Math.abs((a.data[i] as number) - (b.data[i] as number));
	return sum / (a.data.length / 4);
}

function area(quad: readonly { x: number; y: number }[]): number {
	let twice = 0;
	for (let i = 0; i < quad.length; i += 1) {
		const p = quad[i] as { x: number; y: number };
		const q = quad[(i + 1) % quad.length] as { x: number; y: number };
		twice += p.x * q.y - q.x * p.y;
	}
	return Math.abs(twice) / 2;
}

describe('every ladder', () => {
	for (const ladder of LADDERS.filter((l) => l.axis !== 'distance' && l.axis !== 'angle')) {
		it(`${ladder.axis}: each level does more damage to the same photograph`, () => {
			for (const seed of ladder.axis === 'ink' ? [0, 1] : [0]) {
				const mildest = capture(ladder.axis, ladder.levels[0] as number, seed).image;
				let last = 0;
				for (const level of ladder.levels.slice(1)) {
					const now = difference(capture(ladder.axis, level, seed).image, mildest);
					expect(now, `${ladder.axis} ${level} seed ${seed}`).toBeGreaterThan(last);
					last = now;
				}
			}
		});
	}

	it('angle: each level foreshortens the code further', () => {
		const ladder = LADDERS.find((l) => l.axis === 'angle')!;
		let last = Number.POSITIVE_INFINITY;
		for (const level of ladder.levels) {
			const now = area(capture('angle', level, 0).quad);
			expect(now).toBeLessThan(last);
			last = now;
		}
	});

	it('distance: each level puts fewer pixels on a module', () => {
		for (let i = 1; i < DISTANCE_LADDER.length; i += 1) {
			expect(DISTANCE_LADDER[i] as number).toBeLessThan(DISTANCE_LADDER[i - 1] as number);
		}
		const near = capture('distance', 8, 0);
		const far = renderCapture(master, width, height, 7, {
			axis: 'distance',
			level: 4,
			seed: 0,
			pxPerModule: 4,
		});
		expect(far.image.width).toBeLessThan(near.image.width);
	});

	it('names its typical level among its levels', () => {
		for (const ladder of LADDERS) expect(ladder.levels).toContain(ladder.typical);
	});
});
