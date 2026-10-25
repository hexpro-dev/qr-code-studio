/**
 * A ring and a centre put to the strict reader's own finder tests.
 *
 * The design layer judges a finder by a model of the strict reader (runs at
 * 4 pixels a module with sub-pixel edges, see design/finder.ts), because it
 * runs wherever a design is validated or drawn and the root of the package
 * must not pull in the decoder. This file asks the decoder itself, so that
 * conformance can hold the model and the catalogue to it:
 *
 * - `ringKind`, the strict profile's test of whether a reader that traces a
 *   finder ring's sides can follow it, through the grid the pair was drawn
 *   on. It must come out the same at every density and phase drawn here, and
 *   be what the ring says it is (`RegionShape.ringKind`), because that
 *   declaration is all the validator has to go on.
 * - `strictFindsFinder`, the strict profile's finder search, which must find
 *   the pair at every density and phase drawn here.
 *
 * The pair is drawn at 6 and 8 pixels a module, the densities the scan check
 * reads most of its captures at, each at four sub-pixel phases, in 13
 * modules of white: `ringKind` looks 5.6 modules out from the centre along
 * the diagonals, so the box of 7 needs 3 to spare on each side.
 *
 * Only the 7 by 7 finder is asked. The decoder's search is for 1:1:3:1:1,
 * and the other kinds (an alignment pattern, rMQR's sub-finder) are found by
 * sampling where they are known to be, which the model already covers.
 */

import { toGrey } from '../decode/grey.js';
import type { GreyImage } from '../decode/grey.js';
import { ringKind, strictFindsFinder } from '../decode/strict.js';
import { regionPath, ringKindOf } from '../design/finder.js';
import type { RegionShape, ResolvedParams, RingKind } from '../design/types.js';
import { rotate } from '../geometry/matrix.js';
import { PathBuilder } from '../geometry/path.js';
import { rasterise } from '../render/raster.js';

/** Pixels a module the pair is drawn at. */
export const STRICT_DENSITIES: readonly number[] = Object.freeze([6, 8]);
/** Sub-pixel offsets of the pair's box, in pixels. */
export const STRICT_PHASES: readonly number[] = Object.freeze([0, 0.25, 0.5, 0.75]);
/** Modules of white on each side of the 7 module box. */
const MARGIN = 3;
const SPAN = 7 + 2 * MARGIN;
/** How a ring the strict reader cannot measure is named in a problem. */
const UNMEASURED = 'nothing it can measure';

export interface StrictFinderOptions {
	readonly densities?: readonly number[];
	readonly phases?: readonly number[];
	/** Rolls in degrees about the centre; only an unrolled picture is measured for its ring. Default [0]. */
	readonly rolls?: readonly number[];
}

export interface StrictFinderProblem {
	/** `ring-kind`: the ring traces as something other than it says, or unsteadily. `strict-finder`: the strict search misses the pair. */
	readonly rule: 'ring-kind' | 'strict-finder';
	readonly detail: string;
}

export interface FinderPicture {
	readonly grey: GreyImage;
	/** The pair's centre in pixels, on both axes. */
	readonly centre: number;
	/** The box's top left corner in modules, on both axes. */
	readonly offset: number;
}

/** A ring and a centre as the 7 by 7 finder, black on white, `phase` pixels off the grid and turned by `roll` degrees. */
export function finderPicture(
	outer: RegionShape,
	outerParams: ResolvedParams,
	inner: RegionShape,
	innerParams: ResolvedParams,
	modulePixels: number,
	phase = 0,
	roll = 0,
): FinderPicture {
	const offset = MARGIN + phase / modulePixels;
	const both = new PathBuilder()
		.append(regionPath(outer, 'concentric-7', outerParams, offset, offset))
		.append(regionPath(inner, 'concentric-7', innerParams, offset, offset))
		.build();
	const centre = offset + 3.5;
	const path =
		roll === 0
			? both
			: new PathBuilder()
					.transform(rotate(roll, centre, centre))
					.append(both)
					.build();
	const image = rasterise(
		{
			width: SPAN,
			height: SPAN,
			background: { kind: 'solid', colour: { r: 255, g: 255, b: 255, a: 1 } },
			layers: [
				{ kind: 'path', path, paint: { kind: 'solid', colour: { r: 0, g: 0, b: 0, a: 1 } } },
			],
		},
		{ width: SPAN * modulePixels },
	);
	return { grey: toGrey(image), centre: centre * modulePixels, offset };
}

/** What the strict profile makes of the ring in this picture, through the grid it was drawn on. */
export function pictureRingKind(picture: FinderPicture, modulePixels: number): RingKind | null {
	const m = modulePixels;
	const at = picture.offset * m;
	return ringKind(picture.grey, [m, 0, at, 0, m, at, 0, 0, 1], 3.5, 3.5);
}

/**
 * The ring's kind as the strict profile measures it round this centre: the
 * kind, `unsteady` when the densities and phases disagree, or null when it
 * cannot be measured at all.
 */
export function measureRingKind(
	outer: RegionShape,
	outerParams: ResolvedParams,
	inner: RegionShape,
	innerParams: ResolvedParams,
	options: StrictFinderOptions = {},
): RingKind | 'unsteady' | null {
	const kinds = new Set<RingKind | null>();
	for (const m of options.densities ?? STRICT_DENSITIES) {
		for (const phase of options.phases ?? STRICT_PHASES) {
			kinds.add(
				pictureRingKind(finderPicture(outer, outerParams, inner, innerParams, m, phase), m),
			);
		}
	}
	if (kinds.has(null)) return null;
	return kinds.size === 1 ? ([...kinds][0] as RingKind) : 'unsteady';
}

/**
 * Everything the strict reader's own tests find wrong with a ring and a
 * centre as a QR finder. Empty when the ring traces as it says it does and
 * the strict search finds the pair at every density, phase and roll.
 */
export function strictFinderProblems(
	outer: RegionShape,
	outerParams: ResolvedParams,
	inner: RegionShape,
	innerParams: ResolvedParams,
	options: StrictFinderOptions = {},
): StrictFinderProblem[] {
	const problems: StrictFinderProblem[] = [];
	const kinds = new Set<string>();
	const missed: string[] = [];
	for (const m of options.densities ?? STRICT_DENSITIES) {
		for (const phase of options.phases ?? STRICT_PHASES) {
			for (const roll of options.rolls ?? [0]) {
				const picture = finderPicture(outer, outerParams, inner, innerParams, m, phase, roll);
				if (roll === 0) kinds.add(pictureRingKind(picture, m) ?? UNMEASURED);
				const centre = { x: picture.centre, y: picture.centre };
				if (!strictFindsFinder(picture.grey, centre, m)) {
					missed.push(`${m} px phase ${phase}${roll === 0 ? '' : ` roll ${roll}`}`);
				}
			}
		}
	}
	const said = ringKindOf(outer);
	if (kinds.size > 0 && (kinds.size > 1 || !kinds.has(said))) {
		problems.push({
			rule: 'ring-kind',
			detail: `the ring says it is ${said} and the strict reader traces it as ${[...kinds].sort().join(', ')}`,
		});
	}
	if (missed.length > 0) {
		problems.push({
			rule: 'strict-finder',
			detail: `the strict reader's finder search misses the pair at ${missed.join(', ')}`,
		});
	}
	return problems;
}
