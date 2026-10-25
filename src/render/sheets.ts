/**
 * Built-in label and card sheet templates.
 *
 * Each is named by its paper, count and label size, and its message key is
 * `sheet.template.<id>`. The manufacturer's product code is given beside each
 * as a compatibility note, with the page its layout comes from. Label stock
 * is made in inches in the US and in millimetres elsewhere, and the figures
 * below are the manufacturer's own in each case: the A4 sheets' pitches are
 * the inch values their makers publish (66.04 mm is 2.6 inches, 101.6 mm is
 * 4), which is why their margins are not round millimetres.
 *
 * Every template's margins are symmetric, and `tests/render/impose.test.ts`
 * checks each one closes on its page to a hundredth of a millimetre: left
 * margin, columns and gaps, right margin, and the same down the page.
 *
 * The round and square layouts (`letter-12-round-51`, `letter-12-square-51`
 * and `a4-12-round-64`) give the label size and count as the manufacturers
 * list them, but their pitch and margins are a symmetric layout that was not
 * checked against the published template or a printed sheet while this was
 * written. Print a test page on plain paper and hold it against the stock
 * before running a batch on these three.
 */

import type { SheetTemplate } from './impose.js';
import { PAPER } from './impose.js';

const INCH = 25.4;

function template(
	id: string,
	paper: keyof typeof PAPER,
	columns: number,
	rows: number,
	cell: readonly [number, number],
	origin: readonly [number, number],
	gap: readonly [number, number],
	cornerRadiusMm?: number,
): SheetTemplate {
	return Object.freeze({
		id,
		labelKey: `sheet.template.${id}`,
		page: PAPER[paper],
		columns,
		rows,
		cell: Object.freeze({ widthMm: cell[0], heightMm: cell[1] }),
		origin: Object.freeze({ xMm: origin[0], yMm: origin[1] }),
		gap: Object.freeze({ xMm: gap[0], yMm: gap[1] }),
		...(cornerRadiusMm === undefined ? {} : { cornerRadiusMm }),
	});
}

/** The built-in templates, A4 first, each in a fresh frozen list. */
export function builtInSheets(): readonly SheetTemplate[] {
	return Object.freeze([
		// Avery L7160 / J8160, address labels: the template specification on
		// avery.co.uk for L7160 (label 63.5 x 38.1, pitch 66.04 x 38.1, top
		// margin 15.15).
		template('a4-21-63x38', 'a4', 3, 7, [63.5, 38.1], [7.21, 15.15], [2.54, 0]),
		// Avery L7159 / J8159, address labels: avery.co.uk, L7159 (label
		// 63.5 x 33.9, pitch 66.04 x 33.9, top margin 12.9).
		template('a4-24-63x34', 'a4', 3, 8, [63.5, 33.9], [7.21, 12.9], [2.54, 0]),
		// Avery L7163 / J8163, address labels: avery.co.uk, L7163 (label
		// 99.1 x 38.1, pitch 101.6 x 38.1, top margin 15.15).
		template('a4-14-99x38', 'a4', 2, 7, [99.1, 38.1], [4.65, 15.15], [2.5, 0]),
		// Avery L7165 / J8165, parcel labels: avery.co.uk, L7165 (label
		// 99.1 x 67.7, pitch 101.6 x 67.7, top margin 13.1).
		template('a4-8-99x68', 'a4', 2, 4, [99.1, 67.7], [4.65, 13.1], [2.5, 0]),
		// Avery L7651 / J8651, mini labels: avery.co.uk, L7651 (label
		// 38.1 x 21.2, pitch 40.64 x 21.2, top margin 10.7).
		template('a4-65-38x21', 'a4', 5, 13, [38.1, 21.2], [4.67, 10.7], [2.54, 0]),
		// Avery L7670, round labels 63.5 mm, 12 a sheet: avery.co.uk, L7670.
		// Margins as described above.
		template('a4-12-round-64', 'a4', 3, 4, [63.5, 63.5], [7.21, 17.69], [2.54, 2.54], 31.75),
		// Avery C32011, business cards 85 x 54 mm: avery.co.uk, C32011 (two
		// columns 10 apart, side margin 15, top margin 13.5).
		template('a4-10-cards-85x54', 'a4', 2, 5, [85, 54], [15, 13.5], [10, 0]),
		// Avery 5160 / 8160, address labels 2 5/8 x 1 inch.
		// https://www.avery.com/templates/5160
		template(
			'letter-30-67x25',
			'letter',
			3,
			10,
			[2.625 * INCH, INCH],
			[0.1875 * INCH, 0.5 * INCH],
			[0.125 * INCH, 0],
		),
		// Avery 5163 / 8163, shipping labels 4 x 2 inches.
		// https://www.avery.com/templates/5163
		template(
			'letter-10-102x51',
			'letter',
			2,
			5,
			[4 * INCH, 2 * INCH],
			[0.15625 * INCH, 0.5 * INCH],
			[0.1875 * INCH, 0],
		),
		// Avery 5167 / 8167, return address labels 1 3/4 x 1/2 inch.
		// https://www.avery.com/templates/5167
		template(
			'letter-80-44x13',
			'letter',
			4,
			20,
			[1.75 * INCH, 0.5 * INCH],
			[0.3 * INCH, 0.5 * INCH],
			[0.3 * INCH, 0],
		),
		// Avery 22807, round labels 2 inches. Margins as described above.
		// https://www.avery.com/templates/22807
		template(
			'letter-12-round-51',
			'letter',
			3,
			4,
			[2 * INCH, 2 * INCH],
			[0.75 * INCH, 0.75 * INCH],
			[0.5 * INCH, 0.5 * INCH],
			INCH,
		),
		// Avery 22806, square labels 2 inches. Margins as described above.
		// https://www.avery.com/templates/22806
		template(
			'letter-12-square-51',
			'letter',
			3,
			4,
			[2 * INCH, 2 * INCH],
			[0.75 * INCH, 0.75 * INCH],
			[0.5 * INCH, 0.5 * INCH],
		),
		// Avery 5371 / 8371, business cards 3 1/2 x 2 inches.
		// https://www.avery.com/templates/5371
		template(
			'letter-10-cards-89x51',
			'letter',
			2,
			5,
			[3.5 * INCH, 2 * INCH],
			[0.75 * INCH, 0.5 * INCH],
			[0, 0],
		),
	]);
}
