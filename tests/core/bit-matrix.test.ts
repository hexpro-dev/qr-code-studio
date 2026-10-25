import { describe, expect, it } from 'vitest';
import { BitMatrix } from '../../src/core/bit-matrix.js';

/** Rows of '#' and '.', the form a failing assertion is easiest to read in. */
function draw(matrix: BitMatrix): string[] {
	const rows: string[] = [];
	for (let y = 0; y < matrix.height; y += 1) {
		let row = '';
		for (let x = 0; x < matrix.width; x += 1) row += matrix.get(x, y) ? '#' : '.';
		rows.push(row);
	}
	return rows;
}

function parse(rows: readonly string[]): BitMatrix {
	const height = rows.length;
	const width = (rows[0] as string).length;
	const data = new Uint8Array(width * height);
	rows.forEach((row, y) => {
		for (let x = 0; x < width; x += 1) data[y * width + x] = row[x] === '#' ? 1 : 0;
	});
	return new BitMatrix(width, height, data);
}

describe('BitMatrix', () => {
	it('stores modules row major, one byte each', () => {
		const matrix = new BitMatrix(5, 3);
		matrix.set(4, 2, true);
		matrix.set(1, 0, true);
		matrix.set(1, 0, false);
		matrix.set(0, 1, true);
		expect(matrix.get(4, 2)).toBe(1);
		expect(matrix.get(1, 0)).toBe(0);
		expect([...matrix.data]).toEqual([0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1]);
	});

	it('copies the data it is given rather than writing into it', () => {
		const data = new Uint8Array([1, 0, 0, 1]);
		const matrix = new BitMatrix(2, 2, data);
		matrix.set(0, 0, false);
		expect(data[0]).toBe(1);
		// A Node Buffer's slice is a view, which is the trap this guards.
		const buffer = Buffer.from([1, 0, 0, 1]);
		new BitMatrix(2, 2, buffer).set(0, 0, false);
		expect(buffer[0]).toBe(1);
	});

	it('refuses data of the wrong length or with values other than 0 and 1', () => {
		expect(() => new BitMatrix(2, 2, new Uint8Array(3))).toThrow(RangeError);
		expect(() => new BitMatrix(2, 1, new Uint8Array([0, 2]))).toThrow(RangeError);
		expect(() => new BitMatrix(0, 2)).toThrow(RangeError);
		expect(() => new BitMatrix(2, 0)).toThrow(RangeError);
		expect(() => new BitMatrix(1.5, 2)).toThrow(RangeError);
		expect(() => new BitMatrix(2, Number.NaN)).toThrow(RangeError);
	});

	it('refuses coordinates off the grid rather than wrapping into the next row', () => {
		const matrix = new BitMatrix(4, 3);
		for (const [x, y] of [
			[4, 0],
			[-1, 0],
			[0, 3],
			[0, -1],
			[0.5, 0],
			[0, Number.NaN],
			[2 ** 32, 0],
		] as const) {
			expect(() => matrix.get(x, y), `${x}, ${y}`).toThrow(RangeError);
			expect(() => matrix.set(x, y, true), `${x}, ${y}`).toThrow(RangeError);
			expect(() => matrix.xor(x, y), `${x}, ${y}`).toThrow(RangeError);
		}
	});

	it('flips one module with xor', () => {
		const matrix = new BitMatrix(2, 2);
		matrix.xor(1, 0);
		expect(matrix.get(1, 0)).toBe(1);
		matrix.xor(1, 0);
		expect(matrix.get(1, 0)).toBe(0);
		expect(matrix.countDark()).toBe(0);
	});

	it('fills a region, and refuses one that does not fit', () => {
		const matrix = new BitMatrix(6, 4);
		matrix.setRegion(1, 1, 3, 2, true);
		expect(draw(matrix)).toEqual(['......', '.###..', '.###..', '......']);
		matrix.setRegion(2, 1, 1, 2, false);
		expect(draw(matrix)).toEqual(['......', '.#.#..', '.#.#..', '......']);
		matrix.setRegion(0, 0, 0, 0, true);
		expect(matrix.countDark()).toBe(4);
		for (const [x, y, w, h] of [
			[5, 0, 2, 1],
			[0, 3, 1, 2],
			[-1, 0, 1, 1],
			[0, -1, 1, 1],
			[0, 0, -1, 1],
			[0, 0, 1, -1],
			[0.5, 0, 1, 1],
			[0, 0.5, 1, 1],
			[0, 0, 1.5, 1],
			[0, 0, 1, 1.5],
		] as const) {
			expect(() => matrix.setRegion(x, y, w, h, true), `${x} ${y} ${w} ${h}`).toThrow(RangeError);
		}
	});

	it('clones and inverts without touching the original', () => {
		const matrix = parse(['#..', '.#.']);
		const copy = matrix.clone();
		copy.set(2, 0, true);
		expect(draw(matrix)).toEqual(['#..', '.#.']);
		expect(draw(copy)).toEqual(['#.#', '.#.']);
		const inverted = matrix.inverted();
		expect(draw(inverted)).toEqual(['.##', '#.#']);
		expect(inverted.countDark()).toBe(4);
		expect(matrix.countDark()).toBe(2);
	});

	it('mirrors a square matrix by transposing it', () => {
		// A reflected QR code has its finders in the same L, so a mirror image
		// samples as the transpose of the readable symbol.
		const matrix = parse(['##.', '...', '#..']);
		expect(draw(matrix.mirrored())).toEqual(['#.#', '#..', '...']);
		expect(matrix.mirrored().mirrored().equals(matrix)).toBe(true);
	});

	it('mirrors a rectangular matrix by flipping x', () => {
		// rMQR cannot be transposed into its own shape.
		const matrix = parse(['##...', '#...#']);
		const mirrored = matrix.mirrored();
		expect(mirrored.width).toBe(5);
		expect(mirrored.height).toBe(2);
		expect(draw(mirrored)).toEqual(['...##', '#...#']);
		expect(mirrored.mirrored().equals(matrix)).toBe(true);
	});

	it('compares by size and content', () => {
		const a = parse(['#.', '.#']);
		expect(a.equals(parse(['#.', '.#']))).toBe(true);
		expect(a.equals(parse(['#.', '##']))).toBe(false);
		expect(a.equals(parse(['#.#.']))).toBe(false);
		expect(a.equals(new BitMatrix(2, 3))).toBe(false);
		expect(parse(['#..', '..#']).equals(parse(['#.', '.#', '..']))).toBe(false);
	});
});
