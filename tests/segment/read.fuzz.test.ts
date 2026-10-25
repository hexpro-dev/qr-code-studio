/**
 * The malformed-input contract for `readSegments`, which reads whatever a
 * damaged symbol's Reed-Solomon let through, or whatever an attacker built to
 * pass it.
 *
 * The properties `tests/fuzz/` holds every parser to:
 *
 *   1. Only QrStudioError escapes, and only 'decode/unreadable' or
 *      'decode/unsupported', both with params.stage 'segments'. A RangeError
 *      is a reader that walked off its buffer.
 *   2. Every call finishes, quickly, watched from another thread.
 *   3. Every stream this package writes reads back as what was written,
 *      which the mutations then start from.
 *
 * The corpus is grown from valid streams by seeded mutation (bit flips, byte
 * overwrites, cuts, a random bit length) plus noise, over the three QR
 * profiles and one shaped like Micro QR M4. The seed is in every label.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BitBuffer } from '../../src/core/bits.js';
import { isQrStudioError } from '../../src/core/errors.js';
import { qrProfile } from '../../src/segment/profile.js';
import { readSegments } from '../../src/segment/read.js';
import { segmentText } from '../../src/segment/segment-text.js';
import type { BitstreamProfile, Mode, SegmentHeader } from '../../src/segment/types.js';
import { writeSegments } from '../../src/segment/write.js';
import type { Seeded } from '../core/helpers.js';
import { seeded } from '../core/helpers.js';
import type { Watchdog } from '../fuzz/watchdog.js';
import { startWatchdog } from '../fuzz/watchdog.js';

const BUDGET_MS = 250;

const M4: BitstreamProfile = {
	modes: ['numeric', 'alphanumeric', 'byte', 'kanji'],
	modeIndicatorBits: 3,
	modeIndicator: (kind) => ({ numeric: 0, alphanumeric: 1, byte: 2, kanji: 3 })[kind as Mode],
	charCountBits: (mode) => ({ numeric: 6, alphanumeric: 5, byte: 5, kanji: 4 })[mode],
	terminatorBits: 9,
	eci: false,
	fnc1: false,
	structuredAppend: false,
};

const PROFILES: readonly [string, BitstreamProfile][] = [
	['v1', qrProfile(1)],
	['v10', qrProfile(10)],
	['v27', qrProfile(27)],
	['m4', M4],
];

const PIECES = ['0123', 'ABC', 'abc', ' ', '%', '\u001d', 'é', '日本', '😀', '\u0000'];

function content(random: Seeded): string {
	let text = '';
	const parts = random.int(12);
	for (let i = 0; i < parts; i += 1)
		text += PIECES[random.int(PIECES.length)]!.repeat(1 + random.int(4));
	return text;
}

function header(random: Seeded, profile: BitstreamProfile): SegmentHeader {
	if (!profile.structuredAppend) return {};
	const roll = random.int(4);
	if (roll === 0)
		return { structuredAppend: { index: 0, total: 1 + random.int(16), parity: random.int(256) } };
	if (roll === 1) return { fnc1: 'gs1' };
	if (roll === 2) return { fnc1: { applicationIndicator: random.int(100) } };
	return {};
}

function mutate(random: Seeded, bytes: Uint8Array): Uint8Array {
	const out = Uint8Array.from(bytes);
	switch (random.int(4)) {
		case 0:
			for (let i = 0; i < 1 + random.int(6) && out.length > 0; i += 1) {
				const at = random.int(out.length);
				out[at] = (out[at] as number) ^ (1 << random.int(8));
			}
			return out;
		case 1:
			for (let i = 0; i < 1 + random.int(3) && out.length > 0; i += 1)
				out[random.int(out.length)] = random.int(256);
			return out;
		case 2:
			return out.subarray(0, random.int(out.length + 1));
		default:
			return Uint8Array.from([...out, ...random.bytes(random.int(8))]);
	}
}

let watchdog: Watchdog;
beforeAll(() => {
	watchdog = startWatchdog();
});
afterAll(async () => {
	await watchdog.stop();
});

describe('readSegments on malformed input', () => {
	for (const [name, profile] of PROFILES) {
		it(`only ever throws its own errors, and finishes, over ${name}`, () => {
			const random = seeded(0x5e9 + name.length * 7919);
			let valid = 0;
			let refused = 0;
			for (let round = 0; round < 1500; round += 1) {
				let bytes: Uint8Array;
				let bits: number;
				if (round % 5 === 0) {
					bytes = random.bytes(random.int(40));
					bits = random.int(bytes.length * 8 + 1);
				} else {
					const text = content(random);
					const head = header(random, profile);
					let segments;
					try {
						segments = segmentText(
							text,
							profile,
							{
								kanji: random.int(2) ? 'always' : 'never',
								eci: random.int(3) ? 'auto' : profile.eci ? 'utf-8' : 'never',
							},
							{ fnc1: head.fnc1 !== undefined },
						);
					} catch {
						continue;
					}
					const out = new BitBuffer();
					writeSegments(segments, profile, out, head);
					if (round % 5 === 1) {
						const decoded = readSegments(out.toBytes(), out.length, profile);
						expect(decoded.text, `round ${round}`).toBe(text);
						valid += 1;
						continue;
					}
					bytes = mutate(random, out.toBytes());
					bits = random.int(2) ? bytes.length * 8 : random.int(bytes.length * 8 + 1);
				}
				watchdog.beat(`readSegments ${name} round ${round}`);
				const started = performance.now();
				try {
					const decoded = readSegments(bytes, bits, profile);
					expect(typeof decoded.text).toBe('string');
				} catch (error) {
					if (!isQrStudioError(error)) throw error;
					expect(['decode/unreadable', 'decode/unsupported']).toContain(error.code);
					expect(error.params.stage).toBe('segments');
					refused += 1;
				}
				expect(performance.now() - started, `round ${round}`).toBeLessThan(BUDGET_MS);
			}
			expect(valid).toBeGreaterThan(100);
			expect(refused).toBeGreaterThan(50);
		});
	}
});
