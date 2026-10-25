/**
 * The malformed-input contract for the Micro QR reader, which reads grids a
 * sampler made from somebody's photograph.
 *
 *   1. Only QrStudioError escapes, and only 'decode/unreadable' or, for a
 *      bitstream in a character set this runtime lacks, 'decode/unsupported'.
 *      A RangeError is a reader that walked off its matrix; a TypeError is a
 *      reader that blamed its caller for the picture.
 *   2. Every call finishes, quickly. The watchdog in tests/fuzz/watchdog.ts
 *      names the input if one ever stalls.
 *
 * The corpus grows from valid symbols of every version, level and mask by
 * seeded damage (scattered flips, bursts, whole rows and columns, polarity,
 * reflections, format damage, random erasure maps) plus grids of pure noise at
 * every Micro QR size and at sizes that are none. The seed is in every label.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BitMatrix, isQrStudioError } from '../../../src/core/index.js';
import { encode } from '../../../src/encode/index.js';
import { buildMicro, readMicro } from '../../../src/symbology/micro/entry.js';
import { MICRO_VERSIONS, microBlocks, microSpec } from '../../../src/symbology/micro/tables.js';
import type { Watchdog } from '../../fuzz/watchdog.js';
import { startWatchdog } from '../../fuzz/watchdog.js';
import { seeded } from './helpers.js';
import type { Seeded } from './helpers.js';

/**
 * A smoke alarm, not a stopwatch. A read takes well under a millisecond on
 * its own, and the whole suite under coverage on a loaded machine has been
 * seen to stall one for a quarter of a second, which is not what this is
 * looking for: a loop with no exit never comes back at all.
 */
const BUDGET_MS = 1000;
/** Damage past repair, or a bitstream in a character set this runtime cannot decode. */
const ALLOWED = new Set(['decode/unreadable', 'decode/unsupported']);

interface Input {
	readonly label: string;
	readonly matrix: BitMatrix;
	readonly erasures?: Uint8Array;
}

function damage(random: Seeded, source: BitMatrix): { matrix: BitMatrix; erasures?: Uint8Array } {
	const matrix = source.clone();
	const { width, height } = matrix;
	switch (random.int(7)) {
		case 0: {
			const flips = 1 + random.int(40);
			for (let i = 0; i < flips; i += 1) matrix.xor(random.int(width), random.int(height));
			return { matrix };
		}
		case 1: {
			const x = random.int(width);
			const y = random.int(height);
			const w = 1 + random.int(width - x);
			const h = 1 + random.int(height - y);
			matrix.setRegion(x, y, w, h, random.int(2) === 1);
			return { matrix };
		}
		case 2: {
			const row = random.int(height);
			for (let x = 0; x < width; x += 1) matrix.xor(x, row);
			return { matrix };
		}
		case 3:
			return { matrix: random.int(2) === 0 ? matrix.inverted() : matrix.mirrored() };
		case 4: {
			// The format region, and the timing either side of it.
			for (let i = 0; i < 1 + random.int(6); i += 1) matrix.xor(1 + random.int(8), 8);
			for (let i = 0; i < random.int(6); i += 1) matrix.xor(8, 1 + random.int(8));
			return { matrix };
		}
		case 5: {
			const erasures = new Uint8Array(width * height);
			for (let i = 0; i < erasures.length; i += 1)
				erasures[i] = random.int(4) === 0 ? 1 + random.int(255) : 0;
			for (let i = 0; i < 1 + random.int(20); i += 1)
				matrix.xor(random.int(width), random.int(height));
			return { matrix, erasures };
		}
		default: {
			const flips = 1 + random.int(8);
			for (let i = 0; i < flips; i += 1) matrix.xor(random.int(width), random.int(height));
			return { matrix, erasures: new Uint8Array(width * height).fill(1) };
		}
	}
}

function noise(random: Seeded, width: number, height: number): BitMatrix {
	const data = new Uint8Array(width * height);
	for (let i = 0; i < data.length; i += 1) data[i] = random.int(2);
	return new BitMatrix(width, height, data);
}

function buildCorpus(): Input[] {
	const random = seeded(0xf022);
	const corpus: Input[] = [];
	for (const version of MICRO_VERSIONS) {
		for (const level of microSpec(version).levels) {
			for (const mask of [0, 1, 2, 3]) {
				// Half the sources are real content, so damage within reach reads
				// through to text; half are random codewords, so the bitstream
				// reader sees every kind of nonsense Reed-Solomon lets through.
				const blocks = microBlocks(version, level.ecLevel);
				const data = random.bytes(blocks.blocks[0]!.dataCount);
				if (blocks.lastDataCodewordBits === 4) data[data.length - 1]! &= 0xf0;
				const built =
					mask % 2 === 1
						? encode(version === 'M1' ? '9' : 'A1', {
								symbology: 'micro',
								ecLevel: level.ecLevel,
								minVersion: version,
								maxVersion: version,
								mask,
							}).matrix
						: buildMicro(data, version, level.ecLevel, mask).matrix;
				corpus.push({ label: `${version}-${level.ecLevel}/${mask} clean`, matrix: built });
				for (let i = 0; i < 60; i += 1) {
					corpus.push({
						label: `${version}-${level.ecLevel}/${mask} damage ${i}`,
						...damage(random, built),
					});
				}
			}
		}
		const { size } = microSpec(version);
		for (let i = 0; i < 100; i += 1) {
			corpus.push({ label: `${version} noise ${i}`, matrix: noise(random, size, size) });
		}
	}
	for (let i = 0; i < 100; i += 1) {
		const width = 1 + random.int(30);
		const height = 1 + random.int(30);
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

describe('the Micro QR reader on malformed input', () => {
	it('has a corpus worth running', () => {
		expect(corpus.length).toBeGreaterThan(2000);
	});

	it('lets nothing but decode/unreadable and decode/unsupported escape, and finishes every call', () => {
		const problems: string[] = [];
		let refused = 0;
		let read = 0;
		let pastReedSolomon = 0;
		for (const input of corpus) {
			for (const strict of [false, true]) {
				const label = `${input.label} ${strict ? 'strict' : 'lenient'}`;
				watchdog.beat(label);
				const started = performance.now();
				try {
					readMicro(input.matrix, { strict, erasures: input.erasures });
					read += 1;
					pastReedSolomon += 1;
				} catch (error) {
					refused += 1;
					if (isQrStudioError(error) && error.params.stage === 'segments') pastReedSolomon += 1;
					if (!isQrStudioError(error)) {
						problems.push(
							`${label} threw ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`,
						);
					} else if (!ALLOWED.has(error.code)) {
						problems.push(`${label} threw code ${error.code}`);
					}
				}
				const ms = performance.now() - started;
				if (ms > BUDGET_MS) problems.push(`${label} took ${Math.round(ms)}ms`);
			}
		}
		expect(problems).toEqual([]);
		// Both outcomes happen: a corpus read wholesale, or refused wholesale,
		// would be testing nothing.
		expect(read).toBeGreaterThan(corpus.length / 10);
		expect(pastReedSolomon).toBeGreaterThan(corpus.length / 4);
		expect(refused).toBeGreaterThan(corpus.length / 2);
	});
});
