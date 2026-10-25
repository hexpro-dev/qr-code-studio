/**
 * Our symbols, module for module, against two independent encoders.
 *
 * Every version, every level and every mask appears: one seeded payload per
 * (version, level, mask), its class (digits, capitals, lower case, kanji) and
 * length drawn from the seed, each a class whose optimal segmentation is a
 * single segment, given to both sides as that single segment, so that a
 * difference in how two encoders optimise modes can never hide a real
 * difference in placement, masking or error correction. A difference
 * anywhere fails with the version, level, mask and the first differing
 * module.
 *
 * `qrcode` takes a forced mask and is compared at every one of those
 * triples. `qrcode-generator` chooses its own mask, so it is compared once
 * per version and level, at the mask it chose, read back from its format
 * information. bwip-js has its own file (`bwip.test.ts`), because it is the
 * slowest and runs alongside.
 */

import { describe, expect, it } from 'vitest';
import type { EcLevel, Mode } from '../../../src/segment/types.js';
import { buildQr } from '../../../src/symbology/qr/build.js';
import { readFormat } from '../../../src/symbology/qr/info.js';
import { qrGeometry } from '../../../src/symbology/qr/layout.js';
import { EC_LEVELS } from '../../../src/symbology/qr/tables.js';
import { seeded } from '../../core/helpers.js';
import { capacity, ourData, payload, qrcodeGeneratorMatrix, qrcodeMatrix } from './oracles.js';

const MODES: readonly Mode[] = ['numeric', 'alphanumeric', 'byte', 'kanji'];

function firstDifference(ours: Uint8Array, theirs: Uint8Array, size: number): string | null {
	for (let i = 0; i < ours.length; i += 1) {
		if (ours[i] !== theirs[i]) return `module ${i % size}, ${Math.floor(i / size)}`;
	}
	return ours.length === theirs.length ? null : 'size';
}

describe('QR matrices against qrcode', () => {
	for (const level of EC_LEVELS) {
		it(`match at every version and mask at level ${level}`, () => {
			const random = seeded(0x9e37 + level.charCodeAt(0));
			const seenModes = new Set<Mode>();
			for (let version = 1; version <= 40; version += 1) {
				for (let mask = 0; mask < 8; mask += 1) {
					const mode = MODES[random.int(MODES.length)]!;
					const chars = 1 + random.int(capacity(mode, version, level));
					const p = payload(random, mode, chars);
					const ours = buildQr(ourData(p, version, level), version, level, mask);
					const theirs = qrcodeMatrix(p, version, level, mask);
					const where = firstDifference(ours.matrix.data, theirs.modules, qrGeometry(version).size);
					expect(where, `${version}-${level} mask ${mask}, ${chars} ${mode}`).toBeNull();
					seenModes.add(mode);
				}
			}
			expect(seenModes.size).toBe(4);
		});
	}
});

describe('QR matrices against qrcode-generator', () => {
	it('match at every version and level, at the mask it chose', () => {
		const random = seeded(0xc0de);
		const masks = new Set<number>();
		for (let version = 1; version <= 40; version += 1) {
			for (const level of EC_LEVELS) {
				const mode = MODES[random.int(MODES.length)]!;
				const p = payload(random, mode, 1 + random.int(capacity(mode, version, level)));
				const theirs = qrcodeGeneratorMatrix(p, version, level);
				const geometry = qrGeometry(version);
				let word = 0;
				for (const index of geometry.formatFirst) word = word * 2 + theirs[index]!;
				const format = readFormat(word, 0);
				expect(format?.ecLevel).toBe(level as EcLevel);
				const mask = format!.mask;
				masks.add(mask);
				const ours = buildQr(ourData(p, version, level), version, level, mask);
				expect(
					firstDifference(ours.matrix.data, theirs, geometry.size),
					`${version}-${level} mask ${mask}, ${mode}`,
				).toBeNull();
			}
		}
		expect(masks.size).toBe(8);
	});
});
