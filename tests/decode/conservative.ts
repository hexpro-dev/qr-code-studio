/**
 * The conservativeness property, shared by the shards that run it.
 *
 * Over a seeded corpus of damaged captures (tests/helpers/corpus.ts), every
 * capture the strict profile reads must also be read, to the same text, by
 * both zxing-cpp (through zxing-wasm) and jsQR. If strict passes and a phone
 * fails, somebody prints a thousand menus that do not scan; this is the test
 * that stands between the scan check and that.
 *
 * The profile is strict-v1 as docs/CONTRACTS.md defines it: the reader's
 * strict reading, and then the reserve of ceil(0.25 t) corrections left
 * unused in every block, which the verify layer applies from
 * `errorsPerBlock` and `capacityPerBlock` and this applies the same way.
 * Without the reserve, the only captures that slip through are ones whose
 * blocks are corrected to within a codeword of their capacity: a reader
 * that samples a module differently is then one error past it.
 *
 * It also holds the other side loosely: strict must not drift into refusing
 * what every reader reads. Over the mildly damaged captures, it has to read
 * most of what both oracles read.
 *
 * Each shard runs `SHARD_SIZE` captures, 500 by default and 5000 with
 * QR_DECODE_NIGHTLY=1 set, which makes the four shards 20,000 between them.
 */

import { expect, it } from 'vitest';
import { decodeImage } from '../../src/decode/decoder.js';
import type { MatrixRead } from '../../src/symbology/types.js';
import type { DamageKind } from '../helpers/corpus.js';
import { capture } from '../helpers/corpus.js';
import { jsqrText, zxingTexts } from '../helpers/oracles.js';

export const SHARD_SIZE = process.env.QR_DECODE_NIGHTLY === '1' ? 5000 : 500;

export interface KindTally {
	captures: number;
	strict: number;
	zxing: number;
	jsqr: number;
	both: number;
}

export interface ShardResult {
	readonly violations: readonly string[];
	readonly byKind: Readonly<Record<string, KindTally>>;
	/** Captures below severity 0.25 that both oracles read, and how many of them strict read. */
	readonly mild: { readonly both: number; readonly strict: number };
}

/** The strict profile's reserve: every block keeps ceil(0.25 t) of its t corrections unused. */
export function keepsReserve(read: MatrixRead): boolean {
	return read.errorsPerBlock.every((errors, block) => {
		const capacity = read.capacityPerBlock[block] as number;
		return errors <= capacity - Math.ceil(0.25 * capacity);
	});
}

/** Run captures `first` to `first + count - 1` through strict and both oracles. */
export async function runShard(first: number, count: number): Promise<ShardResult> {
	const violations: string[] = [];
	const byKind: Record<string, KindTally> = {};
	const mild = { both: 0, strict: 0 };
	for (let seed = first; seed < first + count; seed += 1) {
		const shot = capture(seed);
		const result = decodeImage(shot.image, { profile: 'strict-v1' });
		const strictTexts = result.ok
			? result.value
					.filter((found) => keepsReserve(found.read))
					.map((found) => found.read.bitstream.text)
			: [];
		const zxing = await zxingTexts(shot.image);
		const jsqr = jsqrText(shot.image);
		const tally = (byKind[shot.kind as DamageKind] ??= {
			captures: 0,
			strict: 0,
			zxing: 0,
			jsqr: 0,
			both: 0,
		});
		const strictRead = strictTexts.includes(shot.text);
		const zxingRead = zxing.includes(shot.text);
		const jsqrRead = jsqr === shot.text;
		tally.captures += 1;
		if (strictRead) tally.strict += 1;
		if (zxingRead) tally.zxing += 1;
		if (jsqrRead) tally.jsqr += 1;
		if (zxingRead && jsqrRead) tally.both += 1;
		if (shot.severity < 0.25 && zxingRead && jsqrRead) {
			mild.both += 1;
			if (strictRead) mild.strict += 1;
		}
		for (const text of strictTexts) {
			if (!zxing.includes(text) || jsqr !== text) {
				violations.push(
					`seed ${seed}: ${shot.kind} at ${shot.severity.toFixed(2)}, ${shot.encoder} level ${shot.ecLevel}: strict read it, zxing ${zxing.includes(text)}, jsQR ${jsqr === text}`,
				);
			}
		}
	}
	return { violations, byKind, mild };
}

/** Captures per test, so no one test holds its worker for long. */
const CHUNK = 250;

/**
 * Violations a nightly run tolerates per shard, listed when there are more.
 *
 * Zero at the default size. At 20,000 captures there is one known, seed
 * 17078: a version 1 symbol with glare blown across a finder pattern, which
 * the strict profile and jsQR read and zxing-cpp at its default effort does
 * not (with its denoising switched on, it does). Its finder thresholds the
 * same both ways and its grid reads clean, so nothing the strict profile can
 * see in the picture tells it apart from the captures zxing-cpp reads.
 */
const NIGHTLY_TOLERANCE = 1;

/** The tests for shard `index` (1 to 4): chunks of captures, then the shard's verdict. */
export function describeShard(index: number): void {
	const first = 1 + (index - 1) * SHARD_SIZE;
	const violations: string[] = [];
	const mild = { both: 0, strict: 0 };
	for (let start = first; start < first + SHARD_SIZE; start += CHUNK) {
		it(`captures ${start} to ${start + CHUNK - 1}`, async () => {
			const result = await runShard(start, CHUNK);
			violations.push(...result.violations);
			mild.both += result.mild.both;
			mild.strict += result.mild.strict;
		}, 300_000);
	}
	it('reads nothing either oracle cannot, and most of what both can', () => {
		if (SHARD_SIZE > 500) {
			expect(violations.length, violations.join('\n')).toBeLessThanOrEqual(NIGHTLY_TOLERANCE);
		} else {
			expect(violations).toEqual([]);
		}
		// Strict refuses some of what every reader manages; that is its job. Over
		// mild damage it must still read nearly all of it, or the scan check
		// fails designs that scan everywhere.
		expect(mild.strict).toBeGreaterThanOrEqual(Math.floor(mild.both * 0.85));
	});
}
