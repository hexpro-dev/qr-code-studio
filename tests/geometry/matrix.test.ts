import { describe, expect, it } from 'vitest';
import {
	aboutCentre,
	checkMatrix,
	identity,
	isIdentity,
	multiply,
	rotateQuarter,
	scale,
	transformPoint,
	translate,
} from '../../src/geometry/matrix.js';
import type { Matrix } from '../../src/geometry/matrix.js';

describe('matrices', () => {
	it('starts from the identity', () => {
		expect(identity()).toEqual([1, 0, 0, 1, 0, 0]);
		expect(isIdentity(identity())).toBe(true);
		expect(isIdentity(translate(0, 1))).toBe(false);
		expect(isIdentity([1, 1, 0, 1, 0, 0])).toBe(false);
		expect(isIdentity([1, 0, 1, 1, 0, 0])).toBe(false);
		expect(isIdentity([1, 0, 0, 2, 0, 0])).toBe(false);
		expect(isIdentity([1, 0, 0, 1, 1, 0])).toBe(false);
		expect(isIdentity([2, 0, 0, 1, 0, 0])).toBe(false);
	});

	it('translates and scales', () => {
		expect(transformPoint(translate(3, -2), 1, 1)).toEqual([4, -1]);
		expect(transformPoint(scale(2), 3, 4)).toEqual([6, 8]);
		expect(transformPoint(scale(2, 3), 3, 4)).toEqual([6, 12]);
	});

	it('multiplies in the order SVG reads a transform list', () => {
		// translate(5 0) scale(2): scale first, then move.
		const m = multiply(translate(5, 0), scale(2));
		expect(transformPoint(m, 1, 1)).toEqual([7, 2]);
		const n = multiply(scale(2), translate(5, 0));
		expect(transformPoint(n, 1, 1)).toEqual([12, 2]);
	});

	it('turns by exact quarter turns, clockwise as seen with y down', () => {
		expect(transformPoint(rotateQuarter(1), 1, 0)).toEqual([0, 1]);
		expect(transformPoint(rotateQuarter(2), 1, 0)).toEqual([-1, 0]);
		expect(transformPoint(rotateQuarter(3), 1, 0)).toEqual([0, -1]);
		expect(transformPoint(rotateQuarter(4), 1, 0)).toEqual([1, 0]);
		expect(transformPoint(rotateQuarter(-1), 1, 0)).toEqual([0, -1]);
		// About the centre of a 7 by 7 finder, the corners trade places exactly.
		const m = rotateQuarter(1, 3.5, 3.5);
		expect(transformPoint(m, 0, 0)).toEqual([7, 0]);
		expect(transformPoint(m, 7, 0)).toEqual([7, 7]);
		expect(aboutCentre(1, 0, 3, 4)).toEqual([1, 0, -0, 1, 0, 0]);
	});

	it('refuses anything that is not six finite numbers', () => {
		expect(() => checkMatrix([1, 0, 0, 1, 0] as unknown as Matrix, 'test')).toThrow(TypeError);
		expect(() => checkMatrix('abcdef' as unknown as Matrix, 'test')).toThrow(TypeError);
		expect(() => multiply([1, 0, 0, 1, 0, Number.NaN], identity())).toThrow(TypeError);
		expect(() => multiply(identity(), [1, 0, 0, Infinity, 0, 0])).toThrow(TypeError);
		expect(() => translate(Number.NaN, 0)).toThrow(TypeError);
		expect(() => translate(0, Infinity)).toThrow(TypeError);
		expect(() => scale(Number.NaN)).toThrow(TypeError);
		expect(() => scale(1, Number.NaN)).toThrow(TypeError);
		expect(() => rotateQuarter(0.5)).toThrow(TypeError);
		expect(() => rotateQuarter(1, Number.NaN)).toThrow(TypeError);
		expect(() => rotateQuarter(1, 0, Infinity)).toThrow(TypeError);
	});
});
