/**
 * The malformed-input contract for the inflater, which reads bytes nobody
 * vouched for (a PNG a person dropped in, a library export from another
 * machine).
 *
 * Three properties, the same ones `tests/fuzz/` holds every parser to:
 *
 *   1. Only `QrStudioError` escapes, and only 'archive/malformed' or
 *      'archive/too-large'. A RangeError from a typed array is a reader that
 *      walked off the end of its buffer.
 *   2. Every call finishes, quickly. A loop with no exit cannot be interrupted
 *      from the thread it is on, so the watchdog in `tests/fuzz/watchdog.ts`
 *      watches from another one and names the input if it ever stalls.
 *   3. It agrees with zlib. Where zlib inflates a whole stream, this does too,
 *      to the same bytes; where this inflates a stream, zlib does too, to the
 *      same bytes, using all of it. Strict in the same places, not stricter
 *      in surprising ones and never looser.
 *
 * The corpus is grown from valid streams by seeded mutation (bit flips, byte
 * overwrites, cuts, insertions, spliced tails) plus streams of pure noise, so
 * it reaches far past the first header check. The seed is in every label.
 */

import { deflateRawSync, deflateSync } from 'node:zlib';
import { inflateRawSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deflateRaw, inflateRaw, zlibUnwrap, zlibWrap } from '../../src/core/deflate.js';
import { isQrStudioError } from '../../src/core/errors.js';
import type { Watchdog } from '../fuzz/watchdog.js';
import { startWatchdog } from '../fuzz/watchdog.js';
import type { Seeded } from './helpers.js';
import { qrLikeRaster, seeded, textLike } from './helpers.js';

const MAX_OUTPUT = 1 << 20;
/** A smoke alarm, not a stopwatch: inputs are a few kilobytes and take well under a millisecond. */
const BUDGET_MS = 500;
const ALLOWED = new Set(['archive/malformed', 'archive/too-large']);

interface Input {
	readonly label: string;
	readonly bytes: Uint8Array;
}

function mutate(random: Seeded, source: Uint8Array): Uint8Array {
	const bytes = Uint8Array.from(source);
	switch (random.int(6)) {
		case 0: {
			const flips = 1 + random.int(8);
			for (let i = 0; i < flips && bytes.length > 0; i += 1) {
				const at = random.int(bytes.length);
				bytes[at] = (bytes[at] as number) ^ (1 << random.int(8));
			}
			return bytes;
		}
		case 1: {
			const writes = 1 + random.int(4);
			for (let i = 0; i < writes && bytes.length > 0; i += 1)
				bytes[random.int(bytes.length)] = random.int(256);
			return bytes;
		}
		case 2:
			return bytes.subarray(0, random.int(bytes.length + 1));
		case 3: {
			const at = random.int(bytes.length + 1);
			const extra = random.bytes(1 + random.int(16));
			return Uint8Array.from([...bytes.subarray(0, at), ...extra, ...bytes.subarray(at)]);
		}
		case 4: {
			// A header from one place and a body from another.
			const cut = random.int(bytes.length + 1);
			return Uint8Array.from([...bytes.subarray(0, cut), ...random.bytes(random.int(64))]);
		}
		default: {
			// Flip one bit early, where the block headers are.
			if (bytes.length > 0) {
				const at = random.int(Math.min(bytes.length, 24));
				bytes[at] = (bytes[at] as number) ^ (1 << random.int(8));
			}
			return bytes;
		}
	}
}

function buildCorpus(): Input[] {
	const sources: Input[] = [];
	const plain = [
		textLike(2000, 21),
		qrLikeRaster({ modules: 21, scale: 2, channels: 1, filter: 0, seed: 21 }),
		seeded(21).bytes(700),
		new Uint8Array(1500),
		new Uint8Array([1, 2, 3, 1, 2, 3, 1, 2, 3, 4]),
	];
	for (const bytes of plain) {
		for (const level of [0, 1, 6, 9] as const) {
			sources.push({ label: `ours ${level}`, bytes: deflateRaw(bytes, { level }) });
			sources.push({ label: `zlib ${level}`, bytes: deflateRawSync(bytes, { level }) });
		}
		sources.push({ label: 'zlib fixed', bytes: deflateRawSync(bytes, { strategy: 4 }) });
		sources.push({ label: 'zlib huffman', bytes: deflateRawSync(bytes, { strategy: 2 }) });
	}
	const random = seeded(0xdef1a7e);
	const corpus: Input[] = [...sources];
	sources.forEach((source, index) => {
		for (let i = 0; i < 120; i += 1) {
			corpus.push({
				label: `${source.label} #${index} mutation ${i}`,
				bytes: mutate(random, source.bytes),
			});
		}
	});
	for (let i = 0; i < 600; i += 1) {
		corpus.push({ label: `noise ${i}`, bytes: random.bytes(random.int(200)) });
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

interface Outcome {
	readonly output?: Uint8Array;
	readonly caught?: { readonly value: unknown };
	readonly ms: number;
}

function run(label: string, call: () => Uint8Array): Outcome {
	watchdog.beat(label);
	const started = performance.now();
	try {
		const output = call();
		return { output, ms: performance.now() - started };
	} catch (error) {
		return { caught: { value: error }, ms: performance.now() - started };
	}
}

function complaint(label: string, outcome: Outcome): string | undefined {
	if (outcome.ms > BUDGET_MS) return `${label} took ${Math.round(outcome.ms)}ms`;
	if (!outcome.caught) return undefined;
	const thrown = outcome.caught.value;
	if (!isQrStudioError(thrown)) {
		return `${label} threw ${thrown instanceof Error ? `${thrown.name}: ${thrown.message}` : String(thrown)}`;
	}
	return ALLOWED.has(thrown.code) ? undefined : `${label} threw code ${thrown.code}`;
}

/** zlib's reading of a raw stream: the output and whether it used every byte. */
function zlibReads(bytes: Uint8Array): { output: Buffer; whole: boolean } | undefined {
	try {
		const { buffer, engine } = inflateRawSync(bytes, {
			info: true,
			maxOutputLength: MAX_OUTPUT,
		} as object) as unknown as { buffer: Buffer; engine: { bytesWritten: number } };
		return { output: buffer, whole: engine.bytesWritten === bytes.length };
	} catch {
		return undefined;
	}
}

describe('the inflater on malformed input', () => {
	it('has a corpus worth running', () => {
		expect(corpus.length).toBeGreaterThan(5000);
	});

	it('lets nothing but its two codes escape, and finishes every call', () => {
		const problems: string[] = [];
		let refused = 0;
		for (const input of corpus) {
			const outcome = run(input.label, () => inflateRaw(input.bytes, { maxOutput: MAX_OUTPUT }));
			const problem = complaint(input.label, outcome);
			if (problem) problems.push(problem);
			if (outcome.caught) refused += 1;
		}
		expect(problems).toEqual([]);
		// A corpus the reader accepted wholesale would be testing nothing.
		expect(refused).toBeGreaterThan(corpus.length / 2);
	});

	it('agrees with zlib on what is a stream and what it holds', () => {
		const disagreements: string[] = [];
		let bothRead = 0;
		for (const input of corpus) {
			const ours = run(input.label, () => inflateRaw(input.bytes, { maxOutput: MAX_OUTPUT }));
			const theirs = zlibReads(input.bytes);
			if (ours.output) {
				if (
					!theirs ||
					!theirs.whole ||
					Buffer.compare(theirs.output, Buffer.from(ours.output)) !== 0
				) {
					disagreements.push(`${input.label}: read here, not the same way by zlib`);
				}
				bothRead += 1;
			} else if (theirs?.whole) {
				disagreements.push(`${input.label}: zlib reads the whole stream, this refused it`);
			}
		}
		expect(disagreements).toEqual([]);
		expect(bothRead).toBeGreaterThan(100);
	});

	it('holds the zlib wrapper to the same contract', () => {
		const random = seeded(1950);
		const sources = [
			zlibWrap(textLike(1500, 22)),
			deflateSync(textLike(1500, 23)),
			zlibWrap(new Uint8Array(0)),
		];
		const problems: string[] = [];
		for (let i = 0; i < 1500; i += 1) {
			const source = sources[i % sources.length] as Uint8Array;
			const label = `zlib wrapper mutation ${i}`;
			const outcome = run(label, () =>
				zlibUnwrap(mutate(random, source), { maxOutput: MAX_OUTPUT }),
			);
			const problem = complaint(label, outcome);
			if (problem) problems.push(problem);
		}
		expect(problems).toEqual([]);
	});
});
