/**
 * The Swiss cross a Swiss QR-bill prints over the middle of its code.
 *
 * SIX, "Swiss Implementation Guidelines for the QR-bill", version 2.4 of 24
 * February 2026:
 *
 * - section 6.4: the Swiss QR Code is printed 46 by 46 mm, without its quiet
 *   space, whatever its version;
 * - section 6.4.2, "Recognition symbol": the code is "overlaid with a cross
 *   logo in black and white, measuring 7 x 7 mm", from the file SIX
 *   publishes in its Download Centre.
 *
 * That file is CH-Kreuz_7mm.svg, in swiss-cross-graphic-en.zip
 * (https://www.six-group.com/dam/download/banking-services/standardization/qr-bill/swiss-cross-graphic-en.zip).
 * Its view box is 19.8 by 19.8 units, the 7 mm logo, and it draws:
 *
 * - a black square from 0.7 to 19.1 on each axis;
 * - white bars at x 8.3, y 4, 3.3 by 11 and at x 4.4, y 7.9, 11 by 3.3;
 * - a white stroke 1.4357 wide on the square's edge, which with the view box
 *   makes a white border from the logo's edge to 1.41785 (0.5 mm), leaving
 *   the black from 1.41785 to 18.38215 (6 mm).
 *
 * Those numbers are drawn here exactly, as filled shapes (this package has
 * no strokes), scaled so the logo is 7/46 of the symbol's width: 7 mm when
 * the symbol is printed at the 46 mm the guidelines fix. The logo is centred
 * on the symbol. The cross inside it is placed as SIX's artwork places it,
 * 0.4 units (0.14 mm) above the square's centre and 0.05 units right of it on
 * its upright bar; the PNG in the same archive has the same offset, so it is
 * the published graphic and is kept rather than tidied.
 *
 * The logo is opaque and is not snapped to the module grid: modules under any
 * part of it, border included, are hidden from a reader, so every one of them
 * is marked obscured for the scan check's codeword budget. At level M that
 * budget holds with room to spare from version 2 to version 25, the largest a
 * bill can be (tests/design/swiss-cross.test.ts counts it, as errors and not
 * erasures).
 */

import { PathBuilder } from '../geometry/path.js';
import type { SceneNode } from '../render/types.js';

/** SIX's artwork, in the units of its 19.8 unit view box. */
const ARTWORK = 19.8;
const BLACK_FROM = 0.7 + 1.4357 / 2;
const BLACK_TO = 19.1 - 1.4357 / 2;
/** The two bars as one outline, clockwise as seen with y down. */
const CROSS = [
	8.3, 4, 11.6, 4, 11.6, 7.9, 15.4, 7.9, 15.4, 11.2, 11.6, 11.2, 11.6, 15, 8.3, 15, 8.3, 11.2, 4.4,
	11.2, 4.4, 7.9, 8.3, 7.9,
] as const;

/** The logo's side as a fraction of the symbol's: 7 mm on 46 mm. */
export const SWISS_CROSS_FRACTION = 7 / 46;

export interface SwissCross {
	/** The white logo square, then the black square with the cross cut from it. */
	readonly nodes: readonly SceneNode[];
	/** 1 under any part of the logo, row major over the symbol. */
	readonly obscured: Uint8Array;
}

/**
 * The cross over a `width` by `height` symbol whose first module is at
 * (sx, sy) in the scene.
 */
export function swissCross(width: number, height: number, sx: number, sy: number): SwissCross {
	const side = width * SWISS_CROSS_FRACTION;
	const x = (width - side) / 2;
	const y = (height - side) / 2;
	const k = side / ARTWORK;
	const ox = sx + x;
	const oy = sy + y;

	const black = new PathBuilder().rect(
		ox + BLACK_FROM * k,
		oy + BLACK_FROM * k,
		(BLACK_TO - BLACK_FROM) * k,
		(BLACK_TO - BLACK_FROM) * k,
	);
	// The cross is wound the other way, so it is a hole in the black square
	// and the white square beneath shows through it.
	const hole: number[] = [];
	for (let i = CROSS.length - 2; i >= 0; i -= 2) {
		hole.push(ox + (CROSS[i] as number) * k, oy + (CROSS[i + 1] as number) * k);
	}
	black.polygon(hole);

	const obscured = new Uint8Array(width * height);
	for (let row = Math.floor(y); row < Math.ceil(y + side); row += 1) {
		for (let column = Math.floor(x); column < Math.ceil(x + side); column += 1) {
			obscured[row * width + column] = 1;
		}
	}
	return {
		nodes: [
			{
				kind: 'path',
				path: new PathBuilder().rect(ox, oy, side, side).build(),
				paint: { kind: 'solid', colour: { r: 255, g: 255, b: 255, a: 1 } },
				role: 'swiss-cross',
			},
			{
				kind: 'path',
				path: black.build(),
				paint: { kind: 'solid', colour: { r: 0, g: 0, b: 0, a: 1 } },
				role: 'swiss-cross',
			},
		],
		obscured,
	};
}
