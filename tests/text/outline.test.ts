/**
 * TrueType contours to quadratic paths, for each place a contour can start
 * and each run of control points, checked command by command.
 */

import { describe, expect, it } from 'vitest';
import { PathBuilder } from '../../src/geometry/path.js';
import { drawOutline, outlinePath } from '../../src/text/outline.js';
import type { GlyphOutline } from '../../src/text/types.js';

function outline(...contours: (readonly [number, number, 0 | 1][])[]): GlyphOutline {
	const points: number[] = [];
	const onCurve: number[] = [];
	const ends: number[] = [];
	for (const contour of contours) {
		for (const [x, y, on] of contour) {
			points.push(x, y);
			onCurve.push(on);
		}
		ends.push(onCurve.length);
	}
	return { points: Float64Array.from(points), onCurve: Uint8Array.from(onCurve), ends };
}

const commands = (o: GlyphOutline): [number[], number[]] => {
	const path = outlinePath(o);
	return [Array.from(path.commands), Array.from(path.points)];
};

describe('a contour', () => {
	it('starting on the curve draws lines and quadratics in order', () => {
		expect(
			commands(
				outline([
					[0, 0, 1],
					[10, 0, 1],
					[10, 10, 0],
					[0, 10, 1],
				]),
			),
		).toEqual([
			[0, 1, 2, 4],
			[0, 0, 10, 0, 10, 10, 0, 10],
		]);
	});

	it('starting on a control point begins at its last point when that is on the curve', () => {
		expect(
			commands(
				outline([
					[10, 10, 0],
					[0, 10, 1],
					[0, 0, 1],
					[10, 0, 1],
				]),
			),
		).toEqual([
			[0, 2, 1, 4],
			[10, 0, 10, 10, 0, 10, 0, 0],
		]);
	});

	it('of control points only starts at the implied point and closes with a curve', () => {
		expect(
			commands(
				outline([
					[0, 10, 0],
					[10, 10, 0],
					[10, 0, 0],
					[0, 0, 0],
				]),
			),
		).toEqual([
			[0, 2, 2, 2, 2, 4],
			[0, 5, 0, 10, 5, 10, 10, 10, 10, 5, 10, 0, 5, 0, 0, 0, 0, 5],
		]);
	});

	it('ending on a control point curves back to the start', () => {
		expect(
			commands(
				outline([
					[0, 0, 1],
					[10, 0, 1],
					[10, 10, 0],
				]),
			),
		).toEqual([
			[0, 1, 2, 4],
			[0, 0, 10, 0, 10, 10, 0, 0],
		]);
	});

	it('of fewer than two points draws nothing, and contours follow each other', () => {
		const two = outline(
			[[5, 5, 1]],
			[
				[0, 0, 1],
				[1, 0, 1],
				[1, 1, 1],
			],
		);
		expect(commands(two)[0]).toEqual([0, 1, 1, 4]);
		expect(commands(outline())[0]).toEqual([]);
	});

	it('goes through the builder it is given, transform and all', () => {
		const builder = new PathBuilder().transform([2, 0, 0, -2, 100, 50]);
		drawOutline(
			outline([
				[0, 0, 1],
				[10, 0, 1],
				[10, 10, 1],
			]),
			builder,
		);
		expect(Array.from(builder.build().points)).toEqual([100, 50, 120, 50, 120, 30]);
	});
});
