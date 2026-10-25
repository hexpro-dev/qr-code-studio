/**
 * The malformed-input contract for the PNG decoder, which reads files nobody
 * vouched for (a logo a person dropped in, an asset inside a design link).
 *
 * The same properties `tests/core/deflate.fuzz.test.ts` holds the inflater
 * to:
 *
 *   1. Only `QrStudioError` escapes, and only 'image/unreadable' or
 *      'image/too-large'. A RangeError from a typed array would be a reader
 *      that walked off the end of its buffer.
 *   2. Every call finishes, quickly, with the watchdog in `tests/fuzz/` on
 *      another thread to name the input if one ever stalls.
 *   3. Where pngjs reads a mutated file whole and this decoder reads it too,
 *      they read the same pixels.
 *
 * Plain byte mutations mostly die at the first CRC check, which tests that
 * check thoroughly and nothing behind it. So half the corpus is mutated chunk
 * by chunk with the CRC put right afterwards, which carries the damage into
 * the header logic, the palette, the inflater and the unfiltering.
 */

import { PNG } from 'pngjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isQrStudioError } from '../../src/core/errors.js';
import { decodePng } from '../../src/render/png-decode.js';
import { encodePng } from '../../src/render/png.js';
import type { Watchdog } from '../fuzz/watchdog.js';
import { startWatchdog } from '../fuzz/watchdog.js';
import { chunk, writePng } from './png-writer.js';
import { seeded } from './scenes.js';

const BUDGET_MS = 500;
const ALLOWED = new Set(['image/unreadable', 'image/too-large']);
/** Small enough that a mutated header claiming a huge image is refused before anything is allocated. */
const MAX_PIXELS = 1 << 16;

interface Input {
	readonly label: string;
	readonly bytes: Uint8Array;
}

function sources(): Input[] {
	const out: Input[] = [];
	const random = seeded(77);
	const kinds: [number, number][] = [
		[0, 1],
		[0, 4],
		[0, 16],
		[2, 8],
		[3, 2],
		[3, 8],
		[4, 16],
		[6, 8],
	];
	for (const [colourType, depth] of kinds) {
		for (const interlaced of [false, true]) {
			const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colourType] as number;
			const max = colourType === 3 ? 3 : (1 << depth) - 1;
			out.push({
				label: `writer ${colourType}/${depth}${interlaced ? ' adam7' : ''}`,
				bytes: writePng({
					width: 11,
					height: 7,
					depth,
					colourType,
					interlaced,
					samples: () => Array.from({ length: channels }, () => Math.floor(random() * (max + 1))),
					...(colourType === 3
						? {
								palette: [
									[1, 2, 3],
									[4, 5, 6],
									[7, 8, 9],
									[10, 11, 12],
								],
								trns: [0, 128],
							}
						: {}),
					split: 9,
				}),
			});
		}
	}
	const data = new Uint8ClampedArray(9 * 9 * 4).map(() => Math.floor(random() * 256));
	out.push({ label: 'ours rgba', bytes: encodePng({ width: 9, height: 9, data }) });
	out.push({
		label: 'ours palette',
		bytes: encodePng({ width: 9, height: 9, data: data.map((v) => v & 0x80) }),
	});
	const image = new PNG({ width: 8, height: 6 });
	image.data.fill(90);
	out.push({ label: 'pngjs', bytes: new Uint8Array(PNG.sync.write(image)) });
	return out;
}

/** The chunks of a file, as offsets of their starts. */
function chunkStarts(bytes: Uint8Array): number[] {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const starts: number[] = [];
	for (let at = 8; at + 12 <= bytes.length; at += 12 + view.getUint32(at)) starts.push(at);
	return starts;
}

function mutateBytes(random: () => number, source: Uint8Array): Uint8Array {
	const int = (n: number): number => Math.floor(random() * n);
	const bytes = Uint8Array.from(source);
	switch (int(4)) {
		case 0:
			for (let i = 0; i < 1 + int(6); i += 1) bytes[int(bytes.length)] ^= 1 << int(8);
			return bytes;
		case 1:
			return bytes.subarray(0, int(bytes.length + 1));
		case 2: {
			const at = int(bytes.length + 1);
			const extra = Array.from({ length: 1 + int(16) }, () => int(256));
			return Uint8Array.from([...bytes.subarray(0, at), ...extra, ...bytes.subarray(at)]);
		}
		default:
			for (let i = 0; i < 1 + int(3); i += 1) bytes[int(bytes.length)] = int(256);
			return bytes;
	}
}

/** Damage one chunk's data, its length or its type, then make its CRC right again. */
function mutateChunk(random: () => number, source: Uint8Array): Uint8Array {
	const int = (n: number): number => Math.floor(random() * n);
	const starts = chunkStarts(source);
	const at = starts[int(starts.length)] as number;
	const view = new DataView(source.buffer, source.byteOffset, source.byteLength);
	const length = view.getUint32(at);
	let type = String.fromCharCode(...source.subarray(at + 4, at + 8));
	let data = Uint8Array.from(source.subarray(at + 8, at + 8 + length));
	switch (int(5)) {
		case 0:
			for (let i = 0; i < 1 + int(4) && data.length > 0; i += 1)
				data[int(data.length)] ^= 1 << int(8);
			break;
		case 1:
			data = data.subarray(0, int(data.length + 1));
			break;
		case 2:
			data = Uint8Array.from([...data, ...Array.from({ length: 1 + int(8) }, () => int(256))]);
			break;
		case 3:
			type = ['IHDR', 'PLTE', 'tRNS', 'IDAT', 'IEND', 'tEXt', 'abCD'][int(7)] as string;
			break;
		default:
			// Move the chunk somewhere else in the file.
			return Uint8Array.from([
				...source.subarray(0, 8),
				...chunk(type, data),
				...source.subarray(8, at),
				...source.subarray(at + 12 + length),
			]);
	}
	return Uint8Array.from([
		...source.subarray(0, at),
		...chunk(type, data),
		...source.subarray(at + 12 + length),
	]);
}

function buildCorpus(): Input[] {
	const random = seeded(0x9e3779b1);
	const corpus: Input[] = [];
	for (const source of sources()) {
		corpus.push(source);
		for (let i = 0; i < 150; i += 1) {
			corpus.push({
				label: `${source.label} bytes ${i}`,
				bytes: mutateBytes(random, source.bytes),
			});
			corpus.push({
				label: `${source.label} chunk ${i}`,
				bytes: mutateChunk(random, source.bytes),
			});
		}
	}
	const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
	for (let i = 0; i < 300; i += 1) {
		const noise = Array.from({ length: Math.floor(random() * 120) }, () =>
			Math.floor(random() * 256),
		);
		corpus.push({
			label: `noise ${i}`,
			bytes: Uint8Array.from(i % 2 === 0 ? [...signature, ...noise] : noise),
		});
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

describe('the PNG decoder on malformed input', () => {
	it('has a corpus worth running', () => {
		expect(corpus.length).toBeGreaterThan(5000);
	});

	it('lets nothing but its two codes escape, finishes every call, and agrees with pngjs', () => {
		const problems: string[] = [];
		let refused = 0;
		let read = 0;
		for (const input of corpus) {
			watchdog.beat(input.label);
			const started = performance.now();
			let decoded: Uint8ClampedArray | null = null;
			try {
				decoded = decodePng(input.bytes, { maxPixels: MAX_PIXELS }).data;
				read += 1;
			} catch (error) {
				refused += 1;
				if (!isQrStudioError(error)) {
					problems.push(
						`${input.label} threw ${error instanceof Error ? error.name : String(error)}`,
					);
				} else if (!ALLOWED.has(error.code)) {
					problems.push(`${input.label} threw code ${error.code}`);
				}
			}
			const ms = performance.now() - started;
			if (ms > BUDGET_MS) problems.push(`${input.label} took ${Math.round(ms)}ms`);
			if (decoded === null) continue;
			let theirs: Buffer | null = null;
			try {
				theirs = PNG.sync.read(Buffer.from(input.bytes)).data;
			} catch {
				// pngjs is stricter or looser in places; only agreement where both read counts.
			}
			if (theirs !== null && Buffer.compare(theirs, Buffer.from(decoded)) !== 0) {
				problems.push(`${input.label}: read differently by pngjs`);
			}
		}
		expect(problems).toEqual([]);
		// A corpus refused wholesale, or read wholesale, would be testing nothing.
		expect(refused).toBeGreaterThan(corpus.length / 2);
		expect(read).toBeGreaterThan(50);
	});
});
