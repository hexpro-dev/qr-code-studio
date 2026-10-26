/**
 * The damage functions: pure, deterministic, and each doing what it says,
 * measured on pictures simple enough to know the answer for.
 */

import { describe, expect, it } from 'vitest';
import { createPrng } from '../../src/core/prng.js';
import type { GreyPlane } from '../../src/verify/degrade.js';
import {
	PAPER,
	addNoise,
	boxBlur,
	copy,
	dim,
	fade,
	fromRgba,
	gaussianBlur,
	gaussianKernel,
	glare,
	gradient,
	greyPlane,
	invert,
	lightFalloff,
	mirror,
	motionBlur,
	pad,
	quantise,
	rotate,
	rotateQuarter,
	sampleBilinear,
	shrink,
	spreadInk,
	starveInk,
	tiltedQuad,
	toRgba,
	turnedQuad,
	warp,
	warpInto,
} from '../../src/verify/degrade.js';
import { applyHomography, quadToQuad } from '../../src/verify/homography.js';

/** A white plane with a black square in the middle. */
function square(size = 40, inset = 10): GreyPlane {
	const plane = greyPlane(size, size);
	for (let y = inset; y < size - inset; y += 1) {
		for (let x = inset; x < size - inset; x += 1) plane.data[y * size + x] = 0;
	}
	return plane;
}

function mean(plane: GreyPlane): number {
	let sum = 0;
	for (const v of plane.data) sum += v;
	return sum / plane.data.length;
}

function darkCount(plane: GreyPlane): number {
	let n = 0;
	for (const v of plane.data) if (v < 128) n += 1;
	return n;
}

function snapshot(plane: GreyPlane): number[] {
	return Array.from(plane.data);
}

describe('the grey plane', () => {
	it('converts to luma with alpha over paper and back to grey bytes', () => {
		const rgba = {
			width: 2,
			height: 1,
			data: new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 0, 0]),
		};
		const plane = fromRgba(rgba);
		expect(plane.data[0]).toBeCloseTo(0.299 * 255, 3);
		// A transparent pixel is the paper it is printed on.
		expect(plane.data[1]).toBe(PAPER);
		const back = toRgba({ width: 2, height: 1, data: new Float32Array([-5, 300.4]) });
		expect(Array.from(back.data)).toEqual([0, 0, 0, 255, 255, 255, 255, 255]);
		expect(
			Array.from(quantise({ width: 2, height: 1, data: new Float32Array([-1.2, 12.6]) }).data),
		).toEqual([0, 13]);
	});

	it('samples bilinearly with centres at half pixels and edges extended', () => {
		const plane = { width: 2, height: 1, data: new Float32Array([0, 100]) };
		expect(sampleBilinear(plane, 0.5, 0.5)).toBe(0);
		expect(sampleBilinear(plane, 1, 0.5)).toBe(50);
		expect(sampleBilinear(plane, -3, 9)).toBe(0);
		expect(sampleBilinear(plane, 9, -3)).toBe(100);
	});
});

describe('every function', () => {
	const prng = () => createPrng(3);
	const cases: [string, (p: GreyPlane) => GreyPlane][] = [
		['gaussian blur', (p) => gaussianBlur(p, 1.5)],
		['box blur', (p) => boxBlur(p, 2)],
		['motion blur', (p) => motionBlur(p, 5, 0.7)],
		['noise', (p) => addNoise(p, 10, prng())],
		['dim', (p) => dim(p, 0.5, 3)],
		['light falloff', (p) => lightFalloff(p, 0.9, 0.2, 1)],
		['gradient', (p) => gradient(p, 60)],
		['glare', (p) => glare(p, 1, { cx: 20, cy: 20, rx: 10, ry: 8 })],
		['spread ink', (p) => spreadInk(p, 1.5)],
		['starve ink', (p) => starveInk(p, 1.5)],
		['fade', (p) => fade(p, 0.5)],
		['invert', invert],
		['mirror', mirror],
		['rotate quarter', (p) => rotateQuarter(p, 1)],
		['rotate', (p) => rotate(p, 0.3)],
		['pad', (p) => pad(p, 3)],
		['shrink', (p) => shrink(p, 2)],
		['quantise', quantise],
	];
	for (const [name, fn] of cases) {
		it(`${name} leaves its input alone and gives the same output twice`, () => {
			const input = square();
			const before = snapshot(input);
			const first = fn(input);
			expect(snapshot(input)).toEqual(before);
			expect(snapshot(fn(input))).toEqual(snapshot(first));
			expect(first.data).not.toBe(input.data);
		});
	}
});

describe('what each one does', () => {
	it('blurs keep the mean and soften the edge', () => {
		const input = square();
		for (const blurred of [gaussianBlur(input, 2), boxBlur(input, 2), motionBlur(input, 6, 0)]) {
			expect(mean(blurred)).toBeCloseTo(mean(input), 0);
			// The edge pixel just outside the square picks up some dark.
			expect(blurred.data[20 * 40 + 9] as number).toBeLessThan(PAPER);
		}
		// Too little to matter is a copy.
		expect(snapshot(gaussianBlur(input, 0))).toEqual(snapshot(input));
		expect(snapshot(boxBlur(input, 0))).toEqual(snapshot(input));
		expect(snapshot(motionBlur(input, 0.1, 0))).toEqual(snapshot(input));
		const kernel = gaussianKernel(1.3);
		expect(kernel.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
		expect(kernel.length).toBe(2 * Math.ceil(3.9) + 1);
	});

	it('noise has about the deviation asked for, from the seed alone', () => {
		const flat = greyPlane(100, 100, 128);
		const noisy = addNoise(flat, 10, createPrng(5));
		let sum = 0;
		let squares = 0;
		for (const v of noisy.data) {
			sum += v - 128;
			squares += (v - 128) * (v - 128);
		}
		const n = noisy.data.length;
		expect(Math.sqrt(squares / n - (sum / n) * (sum / n))).toBeCloseTo(10, 0);
		expect(snapshot(addNoise(flat, 10, createPrng(5)))).toEqual(snapshot(noisy));
		expect(snapshot(addNoise(flat, 10, createPrng(6)))).not.toEqual(snapshot(noisy));
		expect(snapshot(addNoise(flat, 0, createPrng(5)))).toEqual(snapshot(flat));
	});

	it('dims, falls off and ramps as asked', () => {
		const flat = greyPlane(10, 10, 200);
		expect(dim(flat, 0.5, 10).data[0]).toBe(110);
		const fall = lightFalloff(flat, 1, 0, 0);
		expect(fall.data[0] as number).toBeGreaterThan(fall.data[9] as number);
		expect(lightFalloff(greyPlane(0, 0), 1, 0, 0).data.length).toBe(0);
		const ramp = gradient(flat, 100);
		expect(ramp.data[0] as number).toBeLessThan(ramp.data[99] as number);
	});

	it('glare pulls towards white, saturating at its centre', () => {
		const black = greyPlane(40, 40, 0);
		const spot = { cx: 20, cy: 20, rx: 10, ry: 10 };
		expect(glare(black, 2, spot).data[20 * 40 + 20]).toBe(PAPER);
		expect(glare(black, 0.5, spot).data[20 * 40 + 20] as number).toBeLessThan(PAPER);
		// Outside the spot, nothing.
		expect(glare(black, 2, spot).data[0]).toBe(0);
		expect(glare(black, 2, { cx: -50, cy: -50, rx: 5, ry: 5 }).data[0]).toBe(0);
	});

	it('spreads and starves ink by the radius, fractions blended', () => {
		const input = square();
		const dark = darkCount(input);
		expect(darkCount(spreadInk(input, 2))).toBe((20 + 4) * (20 + 4));
		expect(darkCount(starveInk(input, 2))).toBe((20 - 4) * (20 - 4));
		const half = spreadInk(input, 0.5);
		// The ring one pixel out is half covered.
		expect(half.data[20 * 40 + 9]).toBeCloseTo(PAPER / 2, 3);
		expect(darkCount(spreadInk(input, 0))).toBe(dark);
		expect(darkCount(starveInk(input, 0))).toBe(dark);
		expect(darkCount(spreadInk(input, 1))).toBe(22 * 22);
	});

	it('fades towards the paper', () => {
		const faded = fade(square(), 0.75);
		expect(faded.data[20 * 40 + 20]).toBeCloseTo(PAPER * 0.75, 3);
		expect(faded.data[0]).toBe(PAPER);
	});

	it('mirrors, inverts and turns back to where it started', () => {
		const input = square(12, 2);
		input.data[0] = 7;
		expect(snapshot(mirror(mirror(input)))).toEqual(snapshot(input));
		expect(snapshot(invert(invert(input)))).toEqual(snapshot(input));
		expect(snapshot(rotateQuarter(rotateQuarter(input, 2), 2))).toEqual(snapshot(input));
		expect(snapshot(rotateQuarter(input, 4))).toEqual(snapshot(input));
		expect(snapshot(rotateQuarter(input, -1))).toEqual(snapshot(rotateQuarter(input, 3)));
		// The top left corner goes to the top right on a quarter turn.
		expect(rotateQuarter(input, 1).data[11]).toBe(7);
		const wide = greyPlane(4, 2);
		expect(rotateQuarter(wide, 1)).toMatchObject({ width: 2, height: 4 });
	});

	it('rotates onto a canvas that holds it', () => {
		const turned = rotate(square(), Math.PI / 4);
		expect(turned.width).toBeGreaterThan(55);
		expect(darkCount(turned)).toBeGreaterThan(300);
	});

	it('pads and shrinks', () => {
		const padded = pad(square(), 5, 100);
		expect(padded.width).toBe(50);
		expect(padded.data[0]).toBe(100);
		expect(padded.data[25 * 50 + 25]).toBe(0);
		const small = shrink(square(), 4);
		expect(small.width).toBe(10);
		expect(small.data[5 * 10 + 5]).toBe(0);
		expect(shrink(square(), 0.5).width).toBe(40);
	});
});

describe('geometry', () => {
	it('maps each corner of a quad to the same corner of another', () => {
		const from = [
			{ x: 0, y: 0 },
			{ x: 10, y: 0 },
			{ x: 10, y: 10 },
			{ x: 0, y: 10 },
		] as const;
		const to = [
			{ x: 2, y: 3 },
			{ x: 30, y: 1 },
			{ x: 25, y: 22 },
			{ x: 4, y: 18 },
		] as const;
		const m = quadToQuad(from, to);
		from.forEach((p, i) => {
			const q = applyHomography(m, p.x, p.y);
			expect(q.x).toBeCloseTo((to[i] as { x: number }).x, 9);
			expect(q.y).toBeCloseTo((to[i] as { y: number }).y, 9);
		});
		// A parallelogram takes the affine path.
		const affine = quadToQuad(from, [
			{ x: 1, y: 1 },
			{ x: 11, y: 1 },
			{ x: 11, y: 11 },
			{ x: 1, y: 11 },
		]);
		expect(applyHomography(affine, 5, 5)).toEqual({ x: 6, y: 6 });
	});

	it('warps a picture into a quad and reads outside as paper', () => {
		const input = square();
		const same = warpInto(input, turnedQuad(40, 40, 0), 40, 40, 1);
		expect(snapshot(same)).toEqual(snapshot(input));
		const outside = warp(input, [1, 0, 1000, 0, 1, 1000, 0, 0, 1], 4, 4, 2, 77);
		expect(Array.from(outside.data)).toEqual(new Array(16).fill(77));
		const shifted = turnedQuad(10, 10, 0, 3, 4);
		expect(shifted[0]).toEqual({ x: 3, y: 4 });
	});

	it('tilts a plane so the far side shrinks, keeping the axis', () => {
		const quad = tiltedQuad(100, 100, (40 * Math.PI) / 180, 0, 5);
		// Tilted about the horizontal axis: the bottom edge recedes, the top comes nearer.
		const top = (quad[1] as { x: number }).x - (quad[0] as { x: number }).x;
		const bottom = (quad[2] as { x: number }).x - (quad[3] as { x: number }).x;
		expect(top).toBeGreaterThan(100);
		expect(bottom).toBeLessThan(100);
		// And it foreshortens across the axis as well as narrowing.
		const height = (quad[3] as { y: number }).y - (quad[0] as { y: number }).y;
		expect(height).toBeLessThan(80);
		const flat = tiltedQuad(100, 60, 0, 0.4, 5);
		expect((flat[0] as { x: number }).x).toBeCloseTo(-50, 9);
		expect((flat[2] as { y: number }).y).toBeCloseTo(30, 9);
	});

	it('copies', () => {
		const input = square();
		const out = copy(input);
		expect(out.data).not.toBe(input.data);
		expect(snapshot(out)).toEqual(snapshot(input));
	});
});
