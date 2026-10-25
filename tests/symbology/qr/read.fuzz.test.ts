/**
 * The malformed-input contract for the QR matrix reader: whatever a sampler
 * hands it, only QrStudioError comes out, and every call finishes.
 *
 * The corpus is valid symbols damaged by seeded mutation (module flips from a
 * few to a third of the symbol, whole rows, format and version regions
 * scrambled), matrices of pure noise at QR sizes and at sizes that are not,
 * and random erasure maps, read in both profiles.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BitMatrix } from '../../../src/core/bit-matrix.js';
import { isQrStudioError } from '../../../src/core/errors.js';
import { encode } from '../../../src/encode/encode.js';
import { qrGeometry } from '../../../src/symbology/qr/layout.js';
import { readQr } from '../../../src/symbology/qr/read.js';
import { EC_LEVELS } from '../../../src/symbology/qr/tables.js';
import type { Seeded } from '../../core/helpers.js';
import { seeded } from '../../core/helpers.js';
import type { Watchdog } from '../../fuzz/watchdog.js';
import { startWatchdog } from '../../fuzz/watchdog.js';

const BUDGET_MS = 500;
const ALLOWED = new Set(['decode/unreadable', 'decode/unsupported']);
const STAGES = new Set(['version', 'format', 'reed-solomon', 'segments']);

function mutate(random: Seeded, matrix: BitMatrix): BitMatrix {
	const data = Uint8Array.from(matrix.data);
	const size = matrix.width;
	switch (random.int(4)) {
		case 0: {
			const flips = 1 + random.int(Math.max(1, Math.floor(data.length / (1 + random.int(40)))));
			for (let i = 0; i < flips; i += 1)
				data[random.int(data.length)] = data[random.int(data.length)]! ^ 1;
			break;
		}
		case 1: {
			const row = random.int(size);
			data.fill(random.int(2), row * size, row * size + size);
			break;
		}
		case 2: {
			const geometry = qrGeometry((size - 17) / 4);
			for (const index of [...geometry.formatFirst, ...geometry.versionFirst]) {
				if (random.int(2)) data[index] = random.int(2);
			}
			break;
		}
		default: {
			for (let i = 0; i < data.length; i += 1) if (random.int(10) === 0) data[i] = random.int(2);
		}
	}
	return new BitMatrix(size, size, data);
}

let watchdog: Watchdog;
beforeAll(() => {
	watchdog = startWatchdog();
});
afterAll(async () => {
	await watchdog.stop();
});

describe('readQr on malformed matrices', () => {
	it('only ever throws its own errors, and finishes', () => {
		const random = seeded(0xf022);
		let read = 0;
		let refused = 0;
		for (let round = 0; round < 700; round += 1) {
			let matrix: BitMatrix;
			if (round % 7 === 0) {
				const side = random.int(3) === 0 ? 5 + random.int(60) : 21 + 4 * random.int(40);
				const data = new Uint8Array(side * side);
				for (let i = 0; i < data.length; i += 1) data[i] = random.int(2);
				matrix = new BitMatrix(side, side, data);
			} else {
				const text = 'Example '.repeat(1 + random.int(round < 600 ? 20 : 200));
				const symbol = encode(text, { ecLevel: EC_LEVELS[random.int(4)]!, mask: random.int(8) });
				matrix = mutate(random, symbol.matrix);
			}
			const erasures =
				random.int(3) === 0
					? Uint8Array.from({ length: matrix.data.length }, () => (random.int(8) === 0 ? 1 : 0))
					: undefined;
			for (const strict of [false, true]) {
				watchdog.beat(`readQr round ${round} ${strict ? 'strict' : 'lenient'}`);
				const started = performance.now();
				try {
					const result = readQr(matrix, { strict, ...(erasures ? { erasures } : {}) });
					expect(typeof result.bitstream.text).toBe('string');
					read += 1;
				} catch (error) {
					if (!isQrStudioError(error)) throw error;
					expect(ALLOWED.has(error.code), error.code).toBe(true);
					expect(STAGES.has(String(error.params.stage)), String(error.params.stage)).toBe(true);
					refused += 1;
				}
				expect(performance.now() - started, `round ${round}`).toBeLessThan(BUDGET_MS);
			}
		}
		expect(read).toBeGreaterThan(100);
		expect(refused).toBeGreaterThan(100);
	});
});
