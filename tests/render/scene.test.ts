import { describe, expect, it } from 'vitest';
import { parseColour } from '../../src/render/colour.js';
import { normalisePaint } from '../../src/render/scene.js';

const red = parseColour('#ff0000');
const blue = parseColour('#0000ff');

describe('normalisePaint', () => {
	it('keeps a conic gradient with two or more stops and reduces the rest', () => {
		const stops = [
			{ offset: 0, colour: red },
			{ offset: 1, colour: blue },
		];
		expect(normalisePaint({ kind: 'conic', cx: 1, cy: 2, angle: 90, stops }, 'test')).toEqual({
			kind: 'conic',
			cx: 1,
			cy: 2,
			angle: 90,
			stops,
		});
		expect(
			normalisePaint({ kind: 'conic', cx: 1, cy: 2, angle: 90, stops: [stops[0]!] }, 'test'),
		).toEqual({
			kind: 'solid',
			colour: red,
		});
		expect(normalisePaint({ kind: 'conic', cx: 1, cy: 2, angle: 90, stops: [] }, 'test')).toEqual({
			kind: 'none',
		});
		expect(() =>
			normalisePaint({ kind: 'conic', cx: 1, cy: 2, angle: Number.NaN, stops }, 'test'),
		).toThrow(TypeError);
	});

	it('treats a transparent solid as nothing to paint', () => {
		expect(normalisePaint({ kind: 'solid', colour: parseColour('#ff000000') }, 'test')).toEqual({
			kind: 'none',
		});
		const stops = [{ offset: 0.5, colour: parseColour('#00000000') }];
		expect(normalisePaint({ kind: 'radial', cx: 0, cy: 0, r: 1, stops }, 'test')).toEqual({
			kind: 'none',
		});
	});

	it('clamps stop offsets to 0 to 1 and never lets one go backwards', () => {
		const paint = normalisePaint(
			{
				kind: 'linear',
				x1: 0,
				y1: 0,
				x2: 1,
				y2: 0,
				stops: [
					{ offset: 0.7, colour: red },
					{ offset: -3, colour: blue },
					{ offset: 0.9, colour: red },
					{ offset: 5, colour: blue },
				],
			},
			'test',
		);
		expect(paint.kind === 'linear' ? paint.stops.map((stop) => stop.offset) : []).toEqual([
			0.7, 0.7, 0.9, 1,
		]);
	});
});
