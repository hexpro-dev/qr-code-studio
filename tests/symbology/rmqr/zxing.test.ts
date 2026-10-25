/**
 * rMQR against zxing-cpp, both ways: zxing-cpp reads what this package builds
 * (every size, both levels, drawn at 4 pixels a module in a 2 module quiet
 * zone), and this package reads what zxing-wasm writes (zint underneath)
 * exactly enough to rebuild it module for module.
 */

import { describe, expect, it } from 'vitest';
import { dataCodewordCount } from '../../../src/symbology/micro/blocks.js';
import { buildRmqr, readRmqrCodewords } from '../../../src/symbology/rmqr/entry.js';
import { rmqrSpecs } from '../../../src/symbology/rmqr/tables.js';
import {
	dataCodewords,
	maxChars,
	randomPayload,
	seeded,
	zxingRead,
	zxingWrite,
} from '../micro/helpers.js';
import { rmqrFields } from './fields.js';

describe('zxing-cpp reading rMQR built here', () => {
	it('reads a seeded sample of every size and level', async () => {
		const random = seeded(0x4c);
		const failures: string[] = [];
		for (const spec of rmqrSpecs()) {
			const fields = rmqrFields(spec.indicator);
			for (const level of spec.levels) {
				for (const mode of ['numeric', 'alphanumeric', 'byte'] as const) {
					const most = maxChars(mode, fields, level.blocks.dataBits);
					const payload = randomPayload(random, mode, 1 + random.int(most));
					const data = dataCodewords(payload, fields, dataCodewordCount(level.blocks), 8);
					const built = buildRmqr(data, spec.version, level.ecLevel, 'auto');
					const result = await zxingRead(built.matrix, 'RMQRCode');
					const label = `${spec.version}-${level.ecLevel} ${mode}`;
					if (result === undefined) failures.push(`${label}: not read`);
					else if (
						result.text !== payload.text ||
						result.version !== spec.version ||
						result.ecLevel !== level.ecLevel
					) {
						failures.push(`${label}: read as ${result.version}-${result.ecLevel}`);
					}
				}
			}
		}
		expect(failures).toEqual([]);
	});
});

describe('reading rMQR written by zxing-wasm', () => {
	it('recovers every size and level exactly', async () => {
		const failures: string[] = [];
		for (const spec of rmqrSpecs()) {
			for (const level of spec.levels) {
				// Four digits fit even R7x43-H's three data codewords.
				const zint = await zxingWrite(
					'2468',
					'RMQRCode',
					`version=${spec.indicator + 1},ecLevel=${level.ecLevel}`,
				);
				const read = readRmqrCodewords(zint, { strict: true });
				const again = buildRmqr(read.data, read.version, read.ecLevel, read.mask).matrix;
				if (
					!again.equals(zint) ||
					read.version !== spec.version ||
					read.ecLevel !== level.ecLevel
				) {
					failures.push(`${spec.version}-${level.ecLevel}`);
				}
			}
		}
		expect(failures).toEqual([]);
	});
});
