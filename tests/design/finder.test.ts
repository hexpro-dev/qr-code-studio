import { describe, expect, it } from 'vitest';
import {
	finderProblems,
	outlineGap,
	regionPairConforms,
	ringKindOf,
} from '../../src/design/finder.js';
import { createDesignRegistries } from '../../src/design/registries.js';
import type { RegionShape } from '../../src/design/types.js';
import { PathBuilder } from '../../src/geometry/path.js';

const registries = createDesignRegistries();
const ring = registries.regionShapes.require('square');
const centre = registries.regionShapes.require('square-centre');

describe('finderProblems', () => {
	it('passes the plain finder and sub-finder', () => {
		expect(finderProblems(ring, {}, centre, {}, 'concentric-7')).toEqual([]);
		expect(finderProblems(ring, {}, centre, {}, 'concentric-5')).toEqual([]);
	});

	it('finds a solid block, which has one run where five are needed, and no light ring', () => {
		const solid: RegionShape = {
			...centre,
			id: 'solid',
			path: (_ctx, out) => void out.rect(1, 1, 5, 5),
		};
		const problems = finderProblems(ring, {}, solid, {}, 'concentric-7');
		expect(problems.map((problem) => problem.rule)).toContain('finder-runs');
		expect(problems.map((problem) => problem.detail).join(' ')).toContain(
			'runs where 5 are needed',
		);
		expect(problems.at(-1)).toEqual({
			rule: 'light-ring',
			detail: 'concentric-7: the light ring narrows to 0.000 modules',
		});
	});

	it('finds a ring with nothing drawn on a line', () => {
		const nothing: RegionShape = { ...ring, id: 'nothing', path: () => undefined };
		const empty: RegionShape = { ...centre, id: 'empty', path: () => undefined };
		const problems = finderProblems(nothing, {}, empty, {}, 'concentric-7');
		expect(problems[0]?.detail).toContain('0 runs');
	});

	it('measures a line that starts and ends dark', () => {
		const flood: RegionShape = {
			...ring,
			id: 'flood',
			path: (_ctx, out) => void out.rect(-1, -1, 9, 9),
		};
		const empty: RegionShape = { ...centre, id: 'empty', path: () => undefined };
		const problems = finderProblems(flood, {}, empty, {}, 'concentric-7');
		expect(problems[0]?.detail).toContain('1 runs');
	});

	it('finds runs the right ratio but the wrong size on the axes', () => {
		const shrunk: RegionShape = {
			...ring,
			id: 'shrunk',
			path: (_ctx, out) => void out.rect(0.5, 0.5, 6, 6).rect(5.5, 1.5, -4, 4),
		};
		const problems = finderProblems(shrunk, {}, centre, {}, 'concentric-7');
		expect(problems.map((problem) => problem.detail).join(' ')).toContain('modules where');
	});

	it('measures the gap between outlines, zero where they cross', () => {
		const a = new PathBuilder().rect(0, 0, 2, 2).build();
		expect(outlineGap(a, new PathBuilder().rect(3, 0, 1, 1).build())).toBe(1);
		expect(outlineGap(a, new PathBuilder().rect(1, 1, 2, 2).build())).toBe(0);
		expect(
			outlineGap(a, new PathBuilder().moveTo(5, 5).lineTo(5, 5).lineTo(5, 6).build()),
		).toBeGreaterThan(0);
	});

	it('never pairs a ring of dots as the QR finder, and takes a ring as cornered unless it says', () => {
		const dots = registries.regionShapes.require('dot-ring');
		const problems = finderProblems(dots, { size: 0.94 }, centre, {}, 'concentric-7');
		expect(problems.map((problem) => problem.rule)).toEqual(['ring-not-traceable']);
		expect(regionPairConforms(dots, { size: 0.94 }, centre, {}, 'concentric-7')).toBe(false);
		// Its sub-finder is measured by its runs alone, as any other ring's.
		expect(finderProblems(dots, { size: 0.94 }, centre, {}, 'concentric-5')).toEqual([]);
		expect(ringKindOf(dots)).toBe('dotted');
		expect(ringKindOf(registries.regionShapes.require('circle'))).toBe('round');
		expect(ringKindOf(ring)).toBe('cornered');
	});

	it('remembers a pair it has measured', () => {
		const first = regionPairConforms(ring, {}, centre, {}, 'concentric-7');
		expect(regionPairConforms(ring, {}, centre, {}, 'concentric-7')).toBe(first);
		expect(
			regionPairConforms(registries.regionShapes.require('circle'), {}, centre, {}, 'concentric-7'),
		).toBe(false);
	});
});
