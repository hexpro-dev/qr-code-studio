/**
 * rMQR against BWIPP, module for module: all 32 sizes at both levels, with
 * seeded content in every mode (the shortest, the longest that fits, and
 * lengths between). rMQR has one fixed mask, so there is nothing to force.
 * The data codewords come from the test's own bitstream writer, with field
 * widths transcribed from zxing-cpp rather than read from the source.
 */

import { describe, expect, it } from 'vitest';
import { buildRmqr } from '../../../src/symbology/rmqr/entry.js';
import { rmqrSpecs } from '../../../src/symbology/rmqr/tables.js';
import type { Mode } from '../../../src/segment/types.js';
import { dataCodewordCount } from '../../../src/symbology/micro/blocks.js';
import {
	bwipMatrix,
	dataCodewords,
	maxChars,
	randomPayload,
	rows,
	seeded,
} from '../micro/helpers.js';
import { rmqrFields } from './fields.js';

const MODES: readonly Mode[] = ['numeric', 'alphanumeric', 'byte', 'kanji'];

describe('rMQR against bwip-js', () => {
	it('matches every size, level and mode', () => {
		const random = seeded(0x7ec7);
		const mismatches: string[] = [];
		let compared = 0;
		for (const spec of rmqrSpecs()) {
			const fields = rmqrFields(spec.indicator);
			for (const level of spec.levels) {
				for (const mode of MODES) {
					const most = maxChars(mode, fields, level.blocks.dataBits);
					for (const chars of [1, most, 1 + random.int(most)]) {
						const payload = randomPayload(random, mode, chars);
						const data = dataCodewords(payload, fields, dataCodewordCount(level.blocks), 8);
						const ours = buildRmqr(data, spec.version, level.ecLevel, 'auto').matrix;
						const theirs = bwipMatrix({
							bcid: 'rectangularmicroqrcode',
							text: payload.text,
							version: spec.version,
							eclevel: level.ecLevel,
						});
						compared += 1;
						if (!ours.equals(theirs)) {
							mismatches.push(
								`${spec.version}-${level.ecLevel} ${mode} x${chars}\n${rows(ours).join('\n')}\n--\n${rows(theirs).join('\n')}`,
							);
						}
					}
				}
			}
		}
		expect(mismatches).toEqual([]);
		expect(compared).toBe(32 * 2 * 4 * 3);
	});
});
