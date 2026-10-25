/**
 * Micro QR against zxing-cpp, both ways.
 *
 * zxing-cpp (through zxing-wasm, loaded from node_modules) reads what this
 * package builds, drawn at 4 pixels a module inside the 2 module quiet zone
 * Micro QR asks for. And this package reads what zxing-wasm writes (zint
 * underneath, a third encoder), down to the codewords: rebuilding from what
 * was read gives zint's matrix back module for module, which means the
 * version, level, mask and every codeword were read exactly.
 */

import { describe, expect, it } from 'vitest';
import { buildMicro, readMicroCodewords } from '../../../src/symbology/micro/entry.js';
import { MICRO_VERSIONS, microBlocks, microSpec } from '../../../src/symbology/micro/tables.js';
import { MICRO_FIELDS } from './fields.js';
import {
	dataCodewords,
	maxChars,
	randomPayload,
	seeded,
	zxingRead,
	zxingWrite,
} from './helpers.js';

/** zxing reports text; for kanji content it decodes Shift_JIS, which this test does not model. */
const TEXT_MODES = ['numeric', 'alphanumeric', 'byte'] as const;

describe('zxing-cpp reading Micro QR built here', () => {
	it('reads a seeded sample of every version, level and mode', async () => {
		const random = seeded(0x2c);
		const failures: string[] = [];
		let read = 0;
		for (const version of MICRO_VERSIONS) {
			const spec = microSpec(version);
			for (const level of spec.levels) {
				const blocks = microBlocks(version, level.ecLevel);
				for (const mode of TEXT_MODES.filter((m) => spec.modes.includes(m))) {
					for (let sample = 0; sample < 3; sample += 1) {
						const most = maxChars(mode, MICRO_FIELDS[version], blocks.dataBits);
						const payload = randomPayload(random, mode, 1 + random.int(most));
						const data = dataCodewords(
							payload,
							MICRO_FIELDS[version],
							level.dataCodewords,
							spec.lastDataCodewordBits,
						);
						const built = buildMicro(data, version, level.ecLevel, 'auto');
						const result = await zxingRead(built.matrix, 'MicroQRCode');
						read += 1;
						const label = `${version}-${level.ecLevel} ${mode} mask ${built.mask}`;
						if (result === undefined) failures.push(`${label}: not read`);
						else if (result.text !== payload.text || result.version !== version) {
							failures.push(`${label}: read as ${result.version}`);
						} else if (version !== 'M1' && result.ecLevel !== level.ecLevel) {
							failures.push(`${label}: level ${result.ecLevel}`);
						}
					}
				}
			}
		}
		expect(failures).toEqual([]);
		expect(read).toBe(3 * (1 + 2 * 2 + 2 * 3 + 3 * 3));
	});
});

describe('reading Micro QR written by zxing-wasm', () => {
	it('recovers every version, level and mask exactly', async () => {
		const failures: string[] = [];
		for (const version of MICRO_VERSIONS) {
			const spec = microSpec(version);
			const text = version === 'M1' ? '407' : version === 'M2' ? 'AB12' : 'example';
			for (const level of spec.levels) {
				for (const mask of [0, 1, 2, 3]) {
					const zint = await zxingWrite(
						text,
						'MicroQRCode',
						`version=${spec.number},ecLevel=${level.ecLevel},dataMask=${mask}`,
					);
					const read = readMicroCodewords(zint, { strict: true });
					const again = buildMicro(read.data, read.version, read.ecLevel, read.mask).matrix;
					if (!again.equals(zint) || read.mask !== mask || read.ecLevel !== level.ecLevel) {
						failures.push(`${version}-${level.ecLevel} mask ${mask}`);
					}
				}
			}
		}
		expect(failures).toEqual([]);
	});
});
