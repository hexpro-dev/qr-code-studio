/**
 * The malformed-input contract for the rMQR reader: only 'decode/unreadable'
 * escapes and every call finishes, over valid symbols of every size damaged
 * by seeded functions, noise at every size, and grids of no rMQR size at all.
 * The seed is in every label.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BitMatrix, isQrStudioError } from '../../../src/core/index.js';
import { dataCodewordCount } from '../../../src/symbology/micro/blocks.js';
import { buildRmqr, readRmqrCodewords } from '../../../src/symbology/rmqr/entry.js';
import { rmqrSpecs } from '../../../src/symbology/rmqr/tables.js';
import type { Watchdog } from '../../fuzz/watchdog.js';
import { startWatchdog } from '../../fuzz/watchdog.js';
import { seeded } from '../micro/helpers.js';
import type { Seeded } from '../micro/helpers.js';

const BUDGET_MS = 200;

interface Input {
	readonly label: string;
	readonly matrix: BitMatrix;
	readonly erasures?: Uint8Array;
}

function damage(random: Seeded, source: BitMatrix): { matrix: BitMatrix; erasures?: Uint8Array } {
	const matrix = source.clone();
	const { width, height } = matrix;
	switch (random.int(6)) {
		case 0: {
			for (let i = 0; i < 1 + random.int(80); i += 1)
				matrix.xor(random.int(width), random.int(height));
			return { matrix };
		}
		case 1: {
			const x = random.int(width);
			const w = 1 + random.int(Math.min(20, width - x));
			matrix.setRegion(x, 0, w, height, random.int(2) === 1);
			return { matrix };
		}
		case 2:
			return { matrix: random.int(2) === 0 ? matrix.inverted() : matrix.mirrored() };
		case 3: {
			// Both format copies.
			for (let i = 0; i < 1 + random.int(8); i += 1)
				matrix.xor(8 + random.int(4), 1 + random.int(5));
			for (let i = 0; i < random.int(8); i += 1) {
				matrix.xor(width - 8 + random.int(6), height - 6 + random.int(5));
			}
			return { matrix };
		}
		case 4: {
			const erasures = new Uint8Array(width * height);
			for (let i = 0; i < erasures.length; i += 1) erasures[i] = random.int(3) === 0 ? 1 : 0;
			for (let i = 0; i < 1 + random.int(40); i += 1)
				matrix.xor(random.int(width), random.int(height));
			return { matrix, erasures };
		}
		default: {
			// A row swap, as a sampler that lost its place would make.
			const a = random.int(height);
			const b = random.int(height);
			for (let x = 0; x < width; x += 1) {
				const top = matrix.get(x, a);
				matrix.set(x, a, matrix.get(x, b) === 1);
				matrix.set(x, b, top === 1);
			}
			return { matrix };
		}
	}
}

function noise(random: Seeded, width: number, height: number): BitMatrix {
	const data = new Uint8Array(width * height);
	for (let i = 0; i < data.length; i += 1) data[i] = random.int(2);
	return new BitMatrix(width, height, data);
}

function buildCorpus(): Input[] {
	const random = seeded(0xf033);
	const corpus: Input[] = [];
	for (const spec of rmqrSpecs()) {
		for (const level of spec.levels) {
			const data = random.bytes(dataCodewordCount(level.blocks));
			const built = buildRmqr(data, spec.version, level.ecLevel, 0).matrix;
			corpus.push({ label: `${spec.version}-${level.ecLevel} clean`, matrix: built });
			for (let i = 0; i < 25; i += 1) {
				corpus.push({
					label: `${spec.version}-${level.ecLevel} damage ${i}`,
					...damage(random, built),
				});
			}
		}
		for (let i = 0; i < 10; i += 1) {
			corpus.push({
				label: `${spec.version} noise ${i}`,
				matrix: noise(random, spec.width, spec.height),
			});
		}
	}
	for (let i = 0; i < 100; i += 1) {
		const width = 1 + random.int(150);
		const height = 1 + random.int(20);
		corpus.push({ label: `noise ${width}x${height} ${i}`, matrix: noise(random, width, height) });
	}
	return corpus;
}

const corpus = buildCorpus();
let watchdog: Watchdog;

beforeAll(() => {
	watchdog = startWatchdog();
});

afterAll(async () => {
	await watchdog.stop();
});

describe('the rMQR reader on malformed input', () => {
	it('has a corpus worth running', () => {
		expect(corpus.length).toBeGreaterThan(2000);
	});

	it('lets nothing but decode/unreadable escape, and finishes every call', () => {
		const problems: string[] = [];
		let refused = 0;
		let read = 0;
		for (const input of corpus) {
			for (const strict of [false, true]) {
				const label = `${input.label} ${strict ? 'strict' : 'lenient'}`;
				watchdog.beat(label);
				const started = performance.now();
				try {
					readRmqrCodewords(input.matrix, { strict, erasures: input.erasures });
					read += 1;
				} catch (error) {
					refused += 1;
					if (!isQrStudioError(error)) {
						problems.push(
							`${label} threw ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`,
						);
					} else if (error.code !== 'decode/unreadable') {
						problems.push(`${label} threw code ${error.code}`);
					}
				}
				const ms = performance.now() - started;
				if (ms > BUDGET_MS) problems.push(`${label} took ${Math.round(ms)}ms`);
			}
		}
		expect(problems).toEqual([]);
		expect(read).toBeGreaterThan(corpus.length / 4);
		expect(refused).toBeGreaterThan(corpus.length / 2);
	});
});
