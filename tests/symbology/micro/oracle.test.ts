/**
 * Micro QR against BWIPP, module for module.
 *
 * Every version, every level, every mask, with seeded content in each mode the
 * version carries: the shortest, the longest that fits, and lengths between.
 * The data codewords come from the test's own bitstream writer (helpers.ts),
 * so what is compared is the symbology alone: blocks, Reed-Solomon,
 * placement, masking and format information. BWIPP is told the version and
 * level outright (`fixedeclevel`, or it raises the level when there is room)
 * and, in the first group, the mask.
 *
 * The second group leaves the mask to both encoders: the evaluation score has
 * to pick what BWIPP picks on every symbol.
 */

import { describe, expect, it } from 'vitest';
import { buildMicro } from '../../../src/symbology/micro/entry.js';
import { MICRO_VERSIONS, microBlocks, microSpec } from '../../../src/symbology/micro/tables.js';
import type { EcLevel, Mode } from '../../../src/segment/types.js';
import { MICRO_FIELDS } from './fields.js';
import { bwipMatrix, dataCodewords, maxChars, randomPayload, rows, seeded } from './helpers.js';
import type { Payload } from './helpers.js';

interface Case {
	readonly label: string;
	readonly version: 'M1' | 'M2' | 'M3' | 'M4';
	readonly ec: EcLevel;
	readonly payload: Payload;
	readonly data: Uint8Array;
}

function cases(seed: number, perMode: number): Case[] {
	const random = seeded(seed);
	const out: Case[] = [];
	for (const version of MICRO_VERSIONS) {
		const spec = microSpec(version);
		const fields = MICRO_FIELDS[version];
		for (const level of spec.levels) {
			const blocks = microBlocks(version, level.ecLevel);
			for (const mode of spec.modes as readonly Mode[]) {
				const most = maxChars(mode, fields, blocks.dataBits);
				const lengths = [1, most];
				for (let i = 2; i < perMode; i += 1) lengths.push(1 + random.int(most));
				for (const chars of lengths) {
					const payload = randomPayload(random, mode, chars);
					out.push({
						label: `${version}-${level.ecLevel} ${mode} x${chars}`,
						version,
						ec: level.ecLevel,
						payload,
						data: dataCodewords(payload, fields, level.dataCodewords, spec.lastDataCodewordBits),
					});
				}
			}
		}
	}
	return out;
}

describe('Micro QR against bwip-js', () => {
	const forced = cases(0x3c0de, 4);

	it('covers every version, level and mode', () => {
		const seen = new Set(forced.map((c) => `${c.version}-${c.ec} ${c.payload.mode}`));
		// M1: 1, M2: 2 levels x 2 modes, M3: 2 x 4, M4: 3 x 4.
		expect(seen.size).toBe(1 + 4 + 8 + 12);
	});

	it('matches with every mask forced', () => {
		const mismatches: string[] = [];
		for (const c of forced) {
			for (const mask of [0, 1, 2, 3]) {
				const ours = buildMicro(c.data, c.version, c.ec, mask).matrix;
				const theirs = bwipMatrix({
					bcid: 'microqrcode',
					text: c.payload.text,
					version: c.version,
					eclevel: c.ec,
					mask,
				});
				if (!ours.equals(theirs)) {
					mismatches.push(
						`${c.label} mask ${mask}\n${rows(ours).join('\n')}\n--\n${rows(theirs).join('\n')}`,
					);
				}
			}
		}
		expect(mismatches).toEqual([]);
	});

	it('chooses the mask BWIPP chooses', () => {
		const automatic = cases(0xa070, 12);
		const mismatches: string[] = [];
		const chosen = new Set<number>();
		for (const c of automatic) {
			const built = buildMicro(c.data, c.version, c.ec, 'auto');
			chosen.add(built.mask);
			const theirs = bwipMatrix({
				bcid: 'microqrcode',
				text: c.payload.text,
				version: c.version,
				eclevel: c.ec,
			});
			if (!built.matrix.equals(theirs)) mismatches.push(`${c.label}: ours chose ${built.mask}`);
		}
		expect(mismatches).toEqual([]);
		// A test where one mask always wins would not be testing the choice.
		expect(chosen.size).toBe(4);
	});
});
