/**
 * Mask choice: ours follows our scorer, and agrees with `qrcode` wherever the
 * two scorers read the rules the same way.
 *
 * Every mask gives a valid symbol and the reader is told which was used, so
 * the choice is an optimisation, not a correctness property; correctness at
 * each mask is `matrix.test.ts`. What is checked here is that the choice is
 * the minimum of our own score, and that the cases where `qrcode` chooses
 * differently are explained, rule by rule, by the two places the packages
 * read ISO/IEC 18004 7.8.3.1 differently:
 *
 *   - Rule 3. A finder-like run with four light modules on both sides counts
 *     once here and twice in qrcode (it slides an 11-module window and both
 *     windows match).
 *   - Rule 4. Here k is floor(|percent dark - 50| / 5), as the text reads and
 *     zxing computes it. qrcode computes |ceil(percent / 5) - 10|, which is
 *     one step higher for anything above 50% that is not a multiple of 5.
 *
 * Rules 1 and 2 must agree exactly. Every disagreement in rules 3 and 4 must
 * be exactly the size those readings predict. With both corrected for, the
 * two scorers must give identical totals, and then identical choices.
 */

import { describe, expect, it } from 'vitest';
import type { EcLevel, Mode } from '../../../src/segment/types.js';
import { buildQr } from '../../../src/symbology/qr/build.js';
import { qrGeometry } from '../../../src/symbology/qr/layout.js';
import { penalty } from '../../../src/symbology/qr/mask.js';
import { EC_LEVELS } from '../../../src/symbology/qr/tables.js';
import { seeded } from '../../core/helpers.js';
import {
	capacity,
	ourData,
	payload,
	qrcodeMatrix,
	qrcodePenalty,
	qrcodeShaped,
} from './oracles.js';

/** Finder-like runs with four light modules inside the symbol on both sides, rows and columns. */
function bothSidesClear(data: Uint8Array, size: number): number {
	const pattern = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
	let count = 0;
	for (let line = 0; line < size; line += 1) {
		for (let start = 0; start + 15 <= size; start += 1) {
			let row = true;
			let column = true;
			for (let k = 0; k < 15; k += 1) {
				row &&= data[line * size + start + k] === pattern[k];
				column &&= data[(start + k) * size + line] === pattern[k];
			}
			count += (row ? 1 : 0) + (column ? 1 : 0);
		}
	}
	return count;
}

describe('mask choice', () => {
	it('is the lowest of our scores, lowest mask on a tie, and qrcode differs only by the two readings', () => {
		const random = seeded(0x3a5c);
		const MODES: readonly Mode[] = ['numeric', 'alphanumeric', 'byte', 'kanji'];
		let sameChoice = 0;
		const causes = { rule3: 0, rule4: 0 };
		for (let sample = 0; sample < 240; sample += 1) {
			const version = 1 + random.int(sample < 120 ? 10 : 40);
			const level = EC_LEVELS[random.int(4)] as EcLevel;
			const mode = MODES[random.int(4)]!;
			const p = payload(random, mode, 1 + random.int(capacity(mode, version, level)));
			const data = ourData(p, version, level);
			const size = qrGeometry(version).size;

			const ours: number[] = [];
			const theirs: number[] = [];
			const rule3: number[] = [];
			const rule4: number[] = [];
			for (let mask = 0; mask < 8; mask += 1) {
				const matrix = buildQr(data, version, level, mask).matrix.data;
				const mine = penalty(matrix, size);
				const shaped = qrcodeShaped(matrix, size);
				const n1 = qrcodePenalty.getPenaltyN1(shaped);
				const n2 = qrcodePenalty.getPenaltyN2(shaped);
				const n3 = qrcodePenalty.getPenaltyN3(shaped);
				const n4 = qrcodePenalty.getPenaltyN4(shaped);
				expect(mine.rule1, `${version}-${level} mask ${mask}`).toBe(n1);
				expect(mine.rule2).toBe(n2);
				expect(n3 - mine.rule3).toBe(40 * bothSidesClear(matrix, size));
				let dark = 0;
				for (const module of matrix) dark += module;
				const percent = (dark * 100) / matrix.length;
				expect(mine.rule4).toBe(Math.floor(Math.abs(percent - 50) / 5) * 10);
				expect(n4).toBe(Math.abs(Math.ceil(percent / 5) - 10) * 10);
				expect(mine.total).toBe(mine.rule1 + mine.rule2 + mine.rule3 + mine.rule4);
				ours.push(mine.total);
				theirs.push(n1 + n2 + n3 + n4);
				rule3.push(n3 - mine.rule3);
				rule4.push(n4 - mine.rule4);
			}
			const argmin = (scores: number[]) => scores.indexOf(Math.min(...scores));
			const chosen = buildQr(data, version, level, 'auto');
			expect(chosen.mask).toBe(argmin(ours));
			expect(chosen.matrix.equals(buildQr(data, version, level, argmin(ours)).matrix)).toBe(true);
			const qrcodeChoice = qrcodeMatrix(p, version, level).mask;
			expect(qrcodeChoice).toBe(argmin(theirs));
			if (chosen.mask === qrcodeChoice) {
				sameChoice += 1;
				continue;
			}
			// A different pick: the readings must be what separates the two masks.
			// Taking either reading's correction away from qrcode's totals for the
			// two masks in question must close the gap that made it choose its own.
			const a = chosen.mask;
			const b = qrcodeChoice;
			expect(theirs[b]! - theirs[a]!).toBeLessThanOrEqual(0);
			expect(ours[a]! - ours[b]!).toBeLessThanOrEqual(0);
			if (rule3[a] !== rule3[b]) causes.rule3 += 1;
			if (rule4[a] !== rule4[b]) causes.rule4 += 1;
			expect(rule3[a] !== rule3[b] || rule4[a] !== rule4[b]).toBe(true);
		}
		// Measured on this seed: 233 of 240 picks agree. Of the 7 that do not,
		// rule 3's double count separates the two masks in 5 and the rule 4
		// rounding in 3 (one has both). Pinned, so a change to the scorer shows
		// up here.
		expect(sameChoice).toBe(233);
		expect(causes).toEqual({ rule3: 5, rule4: 3 });
	});
});
