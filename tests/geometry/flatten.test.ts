import { describe, expect, it } from 'vitest';
import { COORDINATE_LIMIT, MAX_CHORDS, flattenPath } from '../../src/geometry/flatten.js';
import { PathBuilder } from '../../src/geometry/path.js';
import type { Path } from '../../src/geometry/path.js';

type Line = [number, number, number, number];

function lines(path: Path, options: Parameters<typeof flattenPath>[1]): Line[] {
	const out: Line[] = [];
	flattenPath(path, options, (x0, y0, x1, y1) => out.push([x0, y0, x1, y1]));
	return out;
}

function distanceToSegment(px: number, py: number, [x0, y0, x1, y1]: Line): number {
	const dx = x1 - x0;
	const dy = y1 - y0;
	const length2 = dx * dx + dy * dy;
	const t =
		length2 === 0 ? 0 : Math.min(1, Math.max(0, ((px - x0) * dx + (py - y0) * dy) / length2));
	return Math.hypot(px - (x0 + t * dx), py - (y0 + t * dy));
}

describe('flattenPath', () => {
	it('passes straight edges through and closes each subpath', () => {
		const path = new PathBuilder()
			.moveTo(0, 0)
			.lineTo(2, 0)
			.lineTo(2, 2)
			.moveTo(5, 5)
			.lineTo(6, 5)
			.close()
			.build();
		expect(lines(path, { tolerance: 0.1 })).toEqual([
			[0, 0, 2, 0],
			[2, 0, 2, 2],
			[2, 2, 0, 0],
			[5, 5, 6, 5],
			[6, 5, 5, 5],
		]);
	});

	it('does not add a closing edge to a subpath that is already closed', () => {
		const path = new PathBuilder().moveTo(0, 0).lineTo(1, 0).lineTo(0, 0).build();
		expect(lines(path, { tolerance: 0.1 })).toHaveLength(2);
	});

	it('keeps every chord within the tolerance of its curve', () => {
		const tolerance = 0.01;
		const p = [0, 0, 30, -10, -5, 40, 25, 25] as const;
		const path = new PathBuilder()
			.moveTo(p[0], p[1])
			.cubicTo(p[2], p[3], p[4], p[5], p[6], p[7])
			.build();
		const chords = lines(path, { tolerance }).slice(0, -1);
		let worst = 0;
		for (let i = 0; i <= 2000; i += 1) {
			const t = i / 2000;
			const mt = 1 - t;
			const x =
				mt * mt * mt * p[0] + 3 * mt * mt * t * p[2] + 3 * mt * t * t * p[4] + t * t * t * p[6];
			const y =
				mt * mt * mt * p[1] + 3 * mt * mt * t * p[3] + 3 * mt * t * t * p[5] + t * t * t * p[7];
			worst = Math.max(worst, Math.min(...chords.map((chord) => distanceToSegment(x, y, chord))));
		}
		expect(worst).toBeLessThanOrEqual(tolerance);
		expect(chords.length).toBeGreaterThan(10);
	});

	it('ends each curve exactly on its end point, so the outline is watertight', () => {
		const path = new PathBuilder().circle(1 / 3, 1 / 7, 1 / 11).build();
		const out = lines(path, { tolerance: 1e-4, matrix: [3.3, 0, 0, 3.3, 0.1, 0.2] });
		for (let i = 0; i + 1 < out.length; i += 1) {
			expect(out[i]?.[2]).toBe(out[i + 1]?.[0]);
			expect(out[i]?.[3]).toBe(out[i + 1]?.[1]);
		}
		// The four arcs end where they began, so there is no closing edge.
		expect(out[out.length - 1]?.[2]).toBe(out[0]?.[0]);
	});

	it('applies the matrix before measuring, so the tolerance is in output units', () => {
		const path = new PathBuilder().circle(0, 0, 1).build();
		const small = lines(path, { tolerance: 0.01 }).length;
		const large = lines(path, { tolerance: 0.01, matrix: [100, 0, 0, 100, 0, 0] }).length;
		expect(large).toBeGreaterThan(small * 5);
		const quad = new PathBuilder().moveTo(0, 0).quadTo(1, 1, 2, 0).build();
		expect(lines(quad, { tolerance: 0.001 }).length).toBeGreaterThan(5);
		const straight = new PathBuilder().moveTo(0, 0).quadTo(1, 1, 2, 2).build();
		expect(lines(straight, { tolerance: 0.001 })).toHaveLength(2);
	});

	it('draws a curve wholly outside the cull box as its chord', () => {
		const box = { x: 0, y: 0, width: 10, height: 10 };
		for (const [dx, dy] of [
			[-100, 0],
			[100, 0],
			[0, -100],
			[0, 100],
		] as const) {
			const curve = new PathBuilder()
				.moveTo(5 + dx, 5 + dy)
				.cubicTo(8 + dx, 2 + dy, 2 + dx, 2 + dy, 5 + dx, 8 + dy)
				.quadTo(9 + dx, 9 + dy, 5 + dx, 5 + dy)
				.build();
			expect(lines(curve, { tolerance: 0.001, cull: box })).toHaveLength(2);
		}
		const inside = new PathBuilder().moveTo(5, 5).cubicTo(8, 2, 2, 2, 5, 8).build();
		expect(lines(inside, { tolerance: 0.001, cull: box }).length).toBeGreaterThan(3);
	});

	it('caps the chords of an enormous curve and holds coordinates finite', () => {
		const path = new PathBuilder().moveTo(0, 0).cubicTo(1e300, 0, 0, 1e300, 1e300, 1e300).build();
		const out = lines(path, { tolerance: 0.01, matrix: [1e10, 0, 0, 1e10, 0, 0] });
		expect(out.length).toBeLessThanOrEqual(MAX_CHORDS + 1);
		for (const line of out) {
			for (const value of line) {
				expect(Number.isFinite(value)).toBe(true);
				expect(Math.abs(value)).toBeLessThanOrEqual(COORDINATE_LIMIT);
			}
		}
		const negative = lines(new PathBuilder().moveTo(-1e300, -1e300).lineTo(1, 1).build(), {
			tolerance: 1,
			matrix: [1e10, 0, 0, 1e10, 0, 0],
		});
		expect(negative[0]?.[0]).toBe(-COORDINATE_LIMIT);
	});

	it('refuses a tolerance that is not a positive finite number', () => {
		const path = new PathBuilder().rect(0, 0, 1, 1).build();
		for (const tolerance of [0, -1, Number.NaN, Infinity]) {
			expect(() => flattenPath(path, { tolerance }, () => {})).toThrow(TypeError);
		}
	});
});
