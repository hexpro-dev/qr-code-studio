import { describe, expect, it } from 'vitest';
import { createPrng } from '../../src/core/prng.js';
import { direction, inkColour, paintSpace, resolvePaint } from '../../src/design/paint.js';
import { paramProblem, resolveParams } from '../../src/design/params.js';
import { neighbourMasks } from '../../src/design/neighbours.js';
import { createDesignRegistries } from '../../src/design/registries.js';
import type { DesignPaint, ParamSchema } from '../../src/design/types.js';

const { fills } = createDesignRegistries();
const box = { x: 4, y: 4, width: 21, height: 21 };
const prng = createPrng(1);
const stops = [
	{ offset: 0, ink: '#000000' },
	{ offset: 1, ink: '#ffffff' },
];

describe('inks', () => {
	it('carry a print value through to the colour', () => {
		expect(inkColour('#0b76d9')).toEqual({ r: 11, g: 118, b: 217, a: 1 });
		expect(inkColour({ srgb: '#000000', cmyk: [0, 0, 0, 1] })).toEqual({
			r: 0,
			g: 0,
			b: 0,
			a: 1,
			cmyk: [0, 0, 0, 1],
		});
	});
});

describe('resolvePaint', () => {
	it('runs a linear gradient through the box centre, corner to corner, clockwise from left to right', () => {
		expect(
			resolvePaint({ kind: 'linear', angle: 0, stops, space: 'symbol' }, box, fills, prng),
		).toMatchObject({
			x1: 4,
			y1: 14.5,
			x2: 25,
			y2: 14.5,
		});
		// 90 degrees is downwards, with y down: exact, with no rounding off the edge.
		expect(
			resolvePaint({ kind: 'linear', angle: 90, stops, space: 'symbol' }, box, fills, prng),
		).toMatchObject({
			x1: 14.5,
			y1: 4,
			x2: 14.5,
			y2: 25,
		});
		expect(
			resolvePaint({ kind: 'linear', angle: 180, stops, space: 'symbol' }, box, fills, prng),
		).toMatchObject({
			x1: 25,
			x2: 4,
		});
		expect(
			resolvePaint({ kind: 'linear', angle: 270, stops, space: 'symbol' }, box, fills, prng),
		).toMatchObject({
			y1: 25,
			y2: 4,
		});
		// At 45 degrees the corners land on the ends.
		const diagonal = resolvePaint(
			{ kind: 'linear', angle: 45, stops, space: 'symbol' },
			box,
			fills,
			prng,
		);
		if (diagonal.kind !== 'linear') throw new Error('linear expected');
		expect(diagonal.x1).toBeCloseTo(4, 12);
		expect(diagonal.y1).toBeCloseTo(4, 12);
		expect(diagonal.x2).toBeCloseTo(25, 12);
		expect(diagonal.y2).toBeCloseTo(25, 12);
		expect(direction(-90)).toEqual([0, -1]);
		expect(direction(720)).toEqual([1, 0]);
	});

	it('places radial and conic centres and the radius as fractions of the box', () => {
		const wide = { x: 0, y: 0, width: 40, height: 10 };
		expect(
			resolvePaint(
				{ kind: 'radial', cx: 0.25, cy: 0.5, radius: 0.5, stops, space: 'symbol' },
				wide,
				fills,
				prng,
			),
		).toMatchObject({ kind: 'radial', cx: 10, cy: 5, r: 20 });
		expect(
			resolvePaint(
				{ kind: 'conic', cx: 0.5, cy: 0, angle: 30, stops, space: 'symbol' },
				wide,
				fills,
				prng,
			),
		).toMatchObject({ kind: 'conic', cx: 20, cy: 0, angle: 30 });
	});

	it('resolves entry fills with their parameters and seeded stream', () => {
		const scatter: DesignPaint = {
			kind: 'entry',
			ref: {
				id: 'palette-scatter',
				params: { 'colour-1': '#112233', 'colour-2': '#445566', count: 2 },
			},
		};
		const picks = new Set<string>();
		for (let i = 0; i < 40; i += 1) {
			const paint = resolvePaint(scatter, box, fills, createPrng(7).fork(i));
			if (paint.kind !== 'solid') throw new Error('solid expected');
			picks.add(`${paint.colour.r}`);
		}
		expect([...picks].sort()).toEqual(['17', '68']);
		expect(resolvePaint(scatter, box, fills, createPrng(7).fork(3))).toEqual(
			resolvePaint(scatter, box, fills, createPrng(7).fork(3)),
		);
		const split = resolvePaint(
			{ kind: 'entry', ref: { id: 'two-tone-diagonal', params: { split: 0.3, angle: 0 } } },
			box,
			fills,
			prng,
		);
		expect(split).toMatchObject({ kind: 'linear', x1: 4, x2: 25 });
		if (split.kind !== 'linear') throw new Error('linear expected');
		expect(split.stops.map((stop) => stop.offset)).toEqual([0, 0.3, 0.3, 1]);
	});

	it('says which paints are worked out once and which per module', () => {
		expect(paintSpace({ kind: 'solid', ink: '#000' }, fills)).toBe('symbol');
		expect(paintSpace({ kind: 'linear', angle: 0, stops, space: 'module' }, fills)).toBe('module');
		expect(paintSpace({ kind: 'entry', ref: { id: 'palette-scatter' } }, fills)).toBe('module');
		expect(paintSpace({ kind: 'entry', ref: { id: 'two-tone-diagonal' } }, fills)).toBe('symbol');
		expect(paintSpace({ kind: 'entry', ref: { id: 'missing' } }, fills)).toBe('symbol');
	});
});

describe('parameters', () => {
	const schema: ParamSchema[] = [
		{ key: 'n', kind: 'number', labelKey: 'x', default: 0.5, min: 0, max: 1 },
		{ key: 'low', kind: 'number', labelKey: 'x', default: 1, min: 0 },
		{ key: 'free', kind: 'number', labelKey: 'x', default: 1 },
		{ key: 'i', kind: 'integer', labelKey: 'x', default: 2, max: 5 },
		{ key: 'a', kind: 'angle', labelKey: 'x', default: 0, min: 0, max: 360 },
		{ key: 'b', kind: 'boolean', labelKey: 'x', default: false },
		{
			key: 's',
			kind: 'select',
			labelKey: 'x',
			default: 'one',
			options: [{ value: 'one', labelKey: 'x' }],
		},
		{ key: 'bare', kind: 'select', labelKey: 'x', default: 'one' },
		{ key: 'c', kind: 'colour', labelKey: 'x', default: '#000' },
	];
	const find = (key: string): ParamSchema =>
		schema.find((entry) => entry.key === key) as ParamSchema;

	it('checks each kind and reports ranges, never values', () => {
		expect(paramProblem(find('n'), 2)).toEqual({
			code: 'design.issue.out-of-range',
			params: { min: 0, max: 1 },
		});
		expect(paramProblem(find('low'), -1)).toEqual({
			code: 'design.issue.out-of-range',
			params: { min: 0 },
		});
		expect(paramProblem(find('i'), 9)).toEqual({
			code: 'design.issue.out-of-range',
			params: { max: 5 },
		});
		expect(paramProblem(find('free'), 1e9)).toBeNull();
		expect(paramProblem(find('n'), 'x')).toEqual({ code: 'design.issue.not-a-number' });
		expect(paramProblem(find('i'), 1.5)).toEqual({ code: 'design.issue.not-an-integer' });
		expect(paramProblem(find('b'), 1)).toEqual({ code: 'design.issue.not-a-boolean' });
		expect(paramProblem(find('b'), true)).toBeNull();
		expect(paramProblem(find('s'), 'two')).toEqual({ code: 'design.issue.invalid-option' });
		expect(paramProblem(find('bare'), 'one')).toEqual({ code: 'design.issue.invalid-option' });
		expect(paramProblem(find('c'), 'black')).toEqual({ code: 'design.issue.invalid-colour' });
		expect(paramProblem(find('c'), 0)).toEqual({ code: 'design.issue.invalid-colour' });
		expect(paramProblem(find('c'), '#abc')).toBeNull();
		const unbounded: ParamSchema = { key: 'u', kind: 'number', labelKey: 'x', default: 0 };
		expect(paramProblem(unbounded, Number.NaN)).toEqual({ code: 'design.issue.not-a-number' });
	});

	it('fills in defaults for what is missing or does not fit, and leaves out what the schema does not name', () => {
		const resolved = resolveParams(schema, { n: 0.25, i: 99, extra: 1, b: true });
		expect(resolved).toEqual({
			n: 0.25,
			low: 1,
			free: 1,
			i: 2,
			a: 0,
			b: true,
			s: 'one',
			bare: 'one',
			c: '#000',
		});
		expect(Object.isFrozen(resolved)).toBe(true);
		expect(resolveParams(schema, undefined).n).toBe(0.5);
	});
});

describe('neighbour masks', () => {
	it('set bit 0 for north and go round clockwise, counting the edge as light', () => {
		// A plus shape in a 3 by 3 grid.
		const drawn = Uint8Array.from([0, 1, 0, 1, 1, 1, 0, 1, 0]);
		const masks = neighbourMasks(3, 3, drawn);
		expect(masks[4]).toBe(0b01010101);
		expect(masks[0]).toBe(0b00011100);
		expect(masks[8]).toBe(0b11000001);
	});
});
