import { describe, expect, it } from 'vitest';
import {
	KAPPA,
	PATH_CLOSE,
	PATH_CUBIC,
	PATH_LINE,
	PATH_MOVE,
	PATH_QUAD,
	PathBuilder,
	checkPath,
	walkPath,
} from '../../src/geometry/path.js';
import type { Path, PathVisitor } from '../../src/geometry/path.js';
import { translate } from '../../src/geometry/matrix.js';

const M = PATH_MOVE;
const L = PATH_LINE;
const Q = PATH_QUAD;
const C = PATH_CUBIC;
const Z = PATH_CLOSE;

function shape(path: Path): { commands: number[]; points: number[] } {
	return { commands: Array.from(path.commands), points: Array.from(path.points) };
}

/** Everything `walkPath` reports, as text, so a test can say what it expects in one line. */
function walked(path: Path): string {
	const out: string[] = [];
	const visitor: PathVisitor = {
		move: (x, y) => out.push(`M${x},${y}`),
		line: (x, y) => out.push(`L${x},${y}`),
		quad: (cx, cy, x, y) => out.push(`Q${cx},${cy},${x},${y}`),
		cubic: (a, b, c, d, x, y) => out.push(`C${a},${b},${c},${d},${x},${y}`),
		close: () => out.push('Z'),
	};
	walkPath(path, visitor);
	return out.join(' ');
}

function raw(commands: number[], points: number[]): Path {
	return { commands: Uint8Array.from(commands), points: Float64Array.from(points) };
}

describe('the command constants', () => {
	it('are the numbers the contract fixes', () => {
		expect([M, L, Q, C, Z]).toEqual([0, 1, 2, 3, 4]);
	});

	it('use the kappa that puts an arc midpoint on the circle', () => {
		expect(KAPPA).toBeCloseTo((4 * (Math.SQRT2 - 1)) / 3, 15);
	});
});

describe('PathBuilder', () => {
	it('starts empty and builds nothing', () => {
		const builder = new PathBuilder();
		expect(builder.empty).toBe(true);
		expect(shape(builder.build())).toEqual({ commands: [], points: [] });
	});

	it('records lines, quads and cubics with their points', () => {
		const path = new PathBuilder()
			.moveTo(0, 0)
			.lineTo(1, 0)
			.quadTo(2, 0, 2, 1)
			.cubicTo(2, 2, 1, 3, 0, 3)
			.close()
			.build();
		expect(shape(path)).toEqual({
			commands: [M, L, Q, C, Z],
			points: [0, 0, 1, 0, 2, 0, 2, 1, 2, 2, 1, 3, 0, 3],
		});
	});

	it('keeps only the last of a run of moves and drops a trailing one', () => {
		const builder = new PathBuilder().moveTo(5, 5).moveTo(1, 1).lineTo(2, 2).moveTo(9, 9);
		expect(shape(builder.build())).toEqual({ commands: [M, L], points: [1, 1, 2, 2] });
		expect(builder.empty).toBe(false);
	});

	it('treats a line with no current point as a move', () => {
		const path = new PathBuilder().lineTo(3, 4).lineTo(5, 6).build();
		expect(shape(path)).toEqual({ commands: [M, L], points: [3, 4, 5, 6] });
	});

	it('starts a curve with no current point at its first control point', () => {
		expect(shape(new PathBuilder().quadTo(1, 2, 3, 4).build())).toEqual({
			commands: [M, Q],
			points: [1, 2, 1, 2, 3, 4],
		});
		expect(shape(new PathBuilder().cubicTo(1, 2, 3, 4, 5, 6).build()).commands).toEqual([M, C]);
	});

	it('continues from the subpath start after a close, as SVG does', () => {
		const path = new PathBuilder()
			.moveTo(1, 1)
			.lineTo(2, 1)
			.lineTo(2, 2)
			.close()
			.lineTo(0, 5)
			.build();
		expect(shape(path)).toEqual({
			commands: [M, L, L, Z, M, L],
			points: [1, 1, 2, 1, 2, 2, 1, 1, 0, 5],
		});
	});

	it('ignores a close with nothing to close', () => {
		expect(shape(new PathBuilder().close().build()).commands).toEqual([]);
		expect(shape(new PathBuilder().moveTo(1, 1).close().close().build()).commands).toEqual([]);
	});

	it('draws a rectangle clockwise as seen', () => {
		expect(shape(new PathBuilder().rect(1, 2, 3, 4).build())).toEqual({
			commands: [M, L, L, L, Z],
			points: [1, 2, 4, 2, 4, 6, 1, 6],
		});
	});

	it('draws a circle as four arcs through the four extremes', () => {
		const path = new PathBuilder().circle(10, 20, 2).build();
		expect(Array.from(path.commands)).toEqual([M, C, C, C, C, Z]);
		const ends = [0, 1, 6, 7, 12, 13, 18, 19, 24, 25].map((i) => path.points[i]);
		expect(ends).toEqual([12, 20, 10, 22, 8, 20, 10, 18, 12, 20]);
	});

	it('draws a polygon and refuses an odd number of coordinates', () => {
		expect(shape(new PathBuilder().polygon([0, 0, 1, 0, 0, 1]).build()).commands).toEqual([
			M,
			L,
			L,
			Z,
		]);
		expect(new PathBuilder().polygon([]).empty).toBe(true);
		expect(() => new PathBuilder().polygon([0, 0, 1])).toThrow(TypeError);
		expect(() => new PathBuilder().polygon('0 0' as unknown as number[])).toThrow(TypeError);
		expect(() => new PathBuilder().polygon([0, Number.NaN])).toThrow(TypeError);
	});

	describe('roundedRect', () => {
		it('is a plain rectangle with no radius', () => {
			const path = new PathBuilder().roundedRect(0, 0, 4, 2, 0).build();
			expect(Array.from(path.commands)).toEqual([M, L, L, L, Z]);
		});

		it('puts each radius on its own corner', () => {
			const path = new PathBuilder().roundedRect(0, 0, 10, 10, [1, 0, 0, 0]).build();
			// One arc, at the top left, which is where the walk ends.
			expect(Array.from(path.commands)).toEqual([M, L, L, L, L, C, Z]);
			expect(Array.from(path.points.slice(0, 2))).toEqual([1, 0]);
		});

		it('clamps radii to half the shorter side, and negatives to zero', () => {
			const big = new PathBuilder().roundedRect(0, 0, 4, 4, 100).build();
			const exact = new PathBuilder().roundedRect(0, 0, 4, 4, 2).build();
			expect(shape(big)).toEqual(shape(exact));
			// Fully rounded, the straight sides vanish and only arcs are left.
			expect(Array.from(exact.commands)).toEqual([M, C, C, C, C, Z]);
			const negative = new PathBuilder().roundedRect(0, 0, 4, 4, -3).build();
			expect(shape(negative)).toEqual(shape(new PathBuilder().roundedRect(0, 0, 4, 4, 0).build()));
		});

		it('mirrors with negative sizes the way rect does', () => {
			const path = new PathBuilder().roundedRect(4, 0, -4, 2, 0).build();
			expect(Array.from(path.points)).toEqual([4, 0, 0, 0, 0, 2, 4, 2]);
		});

		it('refuses radii that are not one number or four', () => {
			expect(() =>
				new PathBuilder().roundedRect(0, 0, 1, 1, [1, 2] as unknown as [
					number,
					number,
					number,
					number,
				]),
			).toThrow(TypeError);
			expect(() => new PathBuilder().roundedRect(0, 0, 1, 1, [1, 2, Number.NaN, 0])).toThrow(
				TypeError,
			);
		});
	});

	describe('transform', () => {
		it('applies to points added after it and replaces the one before', () => {
			const path = new PathBuilder()
				.moveTo(0, 0)
				.transform(translate(10, 0))
				.lineTo(1, 0)
				.transform(translate(0, 10))
				.lineTo(1, 0)
				.build();
			expect(Array.from(path.points)).toEqual([0, 0, 11, 0, 1, 10]);
		});

		it('continues from the transformed start after a close, even if the matrix changed', () => {
			const path = new PathBuilder()
				.transform(translate(5, 5))
				.moveTo(0, 0)
				.lineTo(1, 0)
				.close()
				.transform(translate(100, 100))
				.lineTo(0, 1)
				.build();
			expect(Array.from(path.points)).toEqual([5, 5, 6, 5, 5, 5, 100, 101]);
		});

		it('applies to an appended path', () => {
			const unit = new PathBuilder().rect(0, 0, 1, 1).build();
			const placed = new PathBuilder().transform(translate(3, 4)).append(unit).build();
			expect(Array.from(placed.points)).toEqual([3, 4, 4, 4, 4, 5, 3, 5]);
			expect(Array.from(placed.commands)).toEqual(Array.from(unit.commands));
		});

		it('refuses a matrix that is not six finite numbers', () => {
			expect(() => new PathBuilder().transform([1, 0, 0, 1, 0] as never)).toThrow(TypeError);
			expect(() => new PathBuilder().transform([1, 0, 0, 1, 0, Infinity])).toThrow(TypeError);
		});

		it('refuses a point that overflows through the matrix, and keeps what it had', () => {
			const builder = new PathBuilder().moveTo(0, 0).lineTo(1, 1);
			builder.transform([1e308, 0, 0, 1e308, 0, 0]);
			expect(() => builder.lineTo(10, 10)).toThrow(TypeError);
			expect(() => builder.moveTo(10, 10)).toThrow(TypeError);
			expect(() => builder.cubicTo(0, 0, 0, 0, 10, 10)).toThrow(TypeError);
			expect(shape(builder.build())).toEqual({ commands: [M, L], points: [0, 0, 1, 1] });
		});
	});

	it('refuses NaN and infinities in every method', () => {
		const bad = Number.NaN;
		const calls: ((b: PathBuilder) => unknown)[] = [
			(b) => b.moveTo(bad, 0),
			(b) => b.moveTo(0, Infinity),
			(b) => b.lineTo(bad, 0),
			(b) => b.lineTo(0, -Infinity),
			(b) => b.quadTo(bad, 0, 0, 0),
			(b) => b.quadTo(0, bad, 0, 0),
			(b) => b.quadTo(0, 0, bad, 0),
			(b) => b.quadTo(0, 0, 0, bad),
			(b) => b.cubicTo(bad, 0, 0, 0, 0, 0),
			(b) => b.cubicTo(0, bad, 0, 0, 0, 0),
			(b) => b.cubicTo(0, 0, bad, 0, 0, 0),
			(b) => b.cubicTo(0, 0, 0, bad, 0, 0),
			(b) => b.cubicTo(0, 0, 0, 0, bad, 0),
			(b) => b.cubicTo(0, 0, 0, 0, 0, bad),
			(b) => b.rect(bad, 0, 1, 1),
			(b) => b.rect(0, bad, 1, 1),
			(b) => b.rect(0, 0, bad, 1),
			(b) => b.rect(0, 0, 1, bad),
			(b) => b.roundedRect(bad, 0, 1, 1, 0),
			(b) => b.roundedRect(0, bad, 1, 1, 0),
			(b) => b.roundedRect(0, 0, bad, 1, 0),
			(b) => b.roundedRect(0, 0, 1, bad, 0),
			(b) => b.roundedRect(0, 0, 1, 1, bad),
			(b) => b.circle(bad, 0, 1),
			(b) => b.circle(0, bad, 1),
			(b) => b.circle(0, 0, bad),
		];
		for (const call of calls) {
			expect(() => call(new PathBuilder().moveTo(0, 0))).toThrow(TypeError);
		}
	});

	it('builds a fresh copy each time and carries on afterwards', () => {
		const builder = new PathBuilder().moveTo(0, 0).lineTo(1, 0);
		const first = builder.build();
		builder.lineTo(1, 1);
		const second = builder.build();
		expect(first.commands.length).toBe(2);
		expect(second.commands.length).toBe(3);
		expect(first.points).not.toBe(second.points);
	});
});

describe('walkPath', () => {
	it('reports a builder path as it was built', () => {
		const path = new PathBuilder().moveTo(0, 0).lineTo(1, 0).quadTo(1, 1, 0, 1).close().build();
		expect(walked(path)).toBe('M0,0 L1,0 Q1,1,0,1 Z');
	});

	it('normalises a path built by hand', () => {
		// A line with no current point is a move, a close with nothing drawn is
		// dropped, a run of moves keeps the last, and a curve with no current
		// point starts at its first control point.
		expect(walked(raw([L, L], [1, 1, 2, 2]))).toBe('M1,1 L2,2');
		expect(walked(raw([Z, M, Z, M, M, L], [0, 0, 5, 5, 6, 6, 7, 7]))).toBe('M6,6 L7,7');
		expect(walked(raw([Q], [1, 1, 2, 2]))).toBe('M1,1 Q1,1,2,2');
		expect(walked(raw([C], [1, 1, 2, 2, 3, 3]))).toBe('M1,1 C1,1,2,2,3,3');
		expect(walked(raw([M, L, Z, L, Z, Z], [0, 0, 1, 0, 0, 1]))).toBe('M0,0 L1,0 Z M0,0 L0,1 Z');
		expect(walked(raw([M], [3, 3]))).toBe('');
	});

	it('accepts any typed array or plain array for commands and points', () => {
		const path = { commands: [M, L], points: new Float32Array([0, 0, 1, 1]) } as unknown as Path;
		expect(walked(path)).toBe('M0,0 L1,1');
	});

	it('refuses a malformed path with a TypeError before reporting anything', () => {
		const seen: string[] = [];
		const visitor: PathVisitor = {
			move: () => seen.push('move'),
			line: () => seen.push('line'),
			quad: () => seen.push('quad'),
			cubic: () => seen.push('cubic'),
			close: () => seen.push('close'),
		};
		const cases: unknown[] = [
			null,
			7,
			{ commands: 'ML', points: [] },
			{ commands: [M], points: new DataView(new ArrayBuffer(16)) },
			raw([5], []),
			{ commands: [0.5], points: [0, 0] },
			raw([M, L], [0, 0, 1]),
			raw([M, L], [0, 0, 1, Number.NaN]),
			raw([M, L], [0, 0, 1, Infinity]),
		];
		for (const value of cases) {
			expect(() => walkPath(value as Path, visitor)).toThrow(TypeError);
			expect(() => checkPath(value as Path, 'test')).toThrow(TypeError);
		}
		expect(seen).toEqual([]);
	});
});
