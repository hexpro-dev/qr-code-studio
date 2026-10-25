/**
 * The built-in entry fills, the paints a plain gradient cannot describe.
 *
 * Their default colours are all dark enough to read on white, since a fill
 * is chosen for modules far more often than for a ground.
 */

import { parseColour } from '../../render/colour.js';
import { num, str } from '../params.js';
import { linearPaint } from '../paint.js';
import type { FillEntry } from '../types.js';
import { angleParam, colourParam, integerParam, numberParam } from './schema.js';

function fill(entry: FillEntry): FillEntry {
	return Object.freeze({ ...entry, params: Object.freeze([...entry.params]) });
}

/**
 * Each module a colour picked from a palette, by the module's own seeded
 * stream, so the scatter is the same every time the design is drawn.
 */
const paletteScatter = fill({
	id: 'palette-scatter',
	labelKey: 'design.fill.palette-scatter',
	params: [
		colourParam('colour-1', '#14213d'),
		colourParam('colour-2', '#2b4c7e'),
		colourParam('colour-3', '#6a1b4d'),
		colourParam('colour-4', '#1d5c4a'),
		integerParam('count', 3, 2, 4),
	],
	space: 'module',
	resolve(params, _box, prng) {
		const pick = prng.int(num(params, 'count')) + 1;
		return { kind: 'solid', colour: parseColour(str(params, `colour-${pick}`)) };
	},
});

/**
 * Two colours meeting along a straight edge across the box, at `angle`
 * degrees and `split` of the way along: a gradient with a hard stop.
 */
const twoToneDiagonal = fill({
	id: 'two-tone-diagonal',
	labelKey: 'design.fill.two-tone-diagonal',
	params: [
		colourParam('colour-1', '#14213d'),
		colourParam('colour-2', '#7a1f3d'),
		angleParam('angle', 45),
		numberParam('split', 0.5, 0.2, 0.8, 0.05),
	],
	space: 'symbol',
	resolve(params, box) {
		const first = parseColour(str(params, 'colour-1'));
		const second = parseColour(str(params, 'colour-2'));
		const split = num(params, 'split');
		return linearPaint(
			num(params, 'angle'),
			[
				{ offset: 0, colour: first },
				{ offset: split, colour: first },
				{ offset: split, colour: second },
				{ offset: 1, colour: second },
			],
			box,
		);
	},
});

export const BUILT_IN_FILLS: readonly FillEntry[] = Object.freeze([
	paletteScatter,
	twoToneDiagonal,
]);
