import { describe, expect, it } from 'vitest';
import { flattenPath } from '../../src/geometry/flatten.js';
import { area, bounds } from '../../src/geometry/measure.js';
import { PathBuilder } from '../../src/geometry/path.js';
import type { Path } from '../../src/geometry/path.js';

/**
 * The shoelace area of a finely flattened copy, an independent route to the
 * same number. The chords cut inside the curve, so it falls short by about the
 * perimeter times the tolerance, which is what the precision below allows.
 */
function flattenedArea(path: Path): number {
	let twice = 0;
	flattenPath(path, { tolerance: 1e-7 }, (x0, y0, x1, y1) => {
		twice += x0 * y1 - x1 * y0;
	});
	return twice / 2;
}

describe('bounds', () => {
	it('is null for a path that draws nothing', () => {
		expect(bounds(new PathBuilder().build())).toBeNull();
	});

	it('is the corners of a rectangle, whichever way it was drawn', () => {
		expect(bounds(new PathBuilder().rect(4, 5, -3, 2).build())).toEqual({
			x: 1,
			y: 5,
			width: 3,
			height: 2,
		});
	});

	it('is tight around curves, not around their control points', () => {
		const circle = bounds(new PathBuilder().circle(10, 10, 3).build());
		expect(circle).toEqual({ x: 7, y: 7, width: 6, height: 6 });
		// The control point sits at y = 2 and the curve only reaches y = 1.
		const quad = bounds(new PathBuilder().moveTo(0, 0).quadTo(1, 2, 2, 0).build());
		expect(quad).toEqual({ x: 0, y: 0, width: 2, height: 1 });
		// An S curve turns twice along x.
		const s = bounds(new PathBuilder().moveTo(0, 0).cubicTo(4, 1, -3, 2, 1, 3).build());
		expect(s?.x).toBeLessThan(0);
		expect((s?.x ?? 0) + (s?.width ?? 0)).toBeGreaterThan(1);
		expect(s?.height).toBe(3);
	});

	it('handles the degenerate curves', () => {
		// A cubic whose derivative is linear in one coordinate.
		const linear = bounds(new PathBuilder().moveTo(0, 0).cubicTo(1, 1, 2, 1, 3, 0).build());
		expect(linear?.height).toBeCloseTo(0.75, 12);
		// One whose derivative never changes sign, and a straight one.
		expect(bounds(new PathBuilder().moveTo(0, 0).cubicTo(1, 0, 2, 0, 3, 0).build())).toEqual({
			x: 0,
			y: 0,
			width: 3,
			height: 0,
		});
		expect(bounds(new PathBuilder().moveTo(0, 0).quadTo(1, 1, 2, 2).build())?.width).toBe(2);
		// A cubic with a double turning point at its start.
		expect(bounds(new PathBuilder().moveTo(0, 0).cubicTo(0, 0, 0, 0, 1, 1).build())?.width).toBe(1);
		// A cubic with no real turning point.
		expect(bounds(new PathBuilder().moveTo(0, 0).cubicTo(1, 3, 2, 3, 3, 9).build())?.height).toBe(
			9,
		);
	});
});

describe('area', () => {
	it('is positive for a shape drawn like rect and negative for one drawn the other way', () => {
		expect(area(new PathBuilder().rect(0, 0, 3, 2).build())).toBe(6);
		expect(area(new PathBuilder().rect(3, 0, -3, 2).build())).toBe(-6);
	});

	it('subtracts a hole wound the other way', () => {
		const ring = new PathBuilder().rect(0, 0, 4, 4).rect(3, 1, -2, 2).build();
		expect(area(ring)).toBe(12);
	});

	it('closes an open subpath', () => {
		expect(area(new PathBuilder().moveTo(0, 0).lineTo(2, 0).lineTo(2, 2).build())).toBe(2);
	});

	it('is the closed form for curves, matching a fine flattening', () => {
		const circle = new PathBuilder().circle(5, 5, 2).build();
		// The four arc approximation encloses slightly more than pi r^2.
		expect(area(circle)).toBeGreaterThan(Math.PI * 4);
		expect(area(circle)).toBeCloseTo(flattenedArea(circle), 5);
		const quad = new PathBuilder().moveTo(0, 0).quadTo(1, 2, 2, 0).build();
		expect(area(quad)).toBeCloseTo(-4 / 3, 14);
		const mixed = new PathBuilder()
			.moveTo(1, 1)
			.cubicTo(5, -2, 7, 6, 3, 4)
			.quadTo(0, 6, -1, 2)
			.lineTo(0, 0)
			.close()
			.build();
		expect(area(mixed)).toBeCloseTo(flattenedArea(mixed), 5);
	});

	it('does not depend on where the shape is', () => {
		const here = new PathBuilder().circle(0, 0, 1).build();
		const there = new PathBuilder().circle(1e6, -1e6, 1).build();
		expect(area(there)).toBeCloseTo(area(here), 9);
	});
});
