/**
 * Every message key the symbology layer uses has an English sentence, every
 * sentence is reached, and the sentences keep the house register.
 *
 * Keys are provoked rather than listed: each way a read can fail is made to
 * happen, the error mapped to its key by the rule in
 * `src/messages/en/symbology.ts`, and the key looked up.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { BitMatrix } from '../../../src/core/bit-matrix.js';
import { BitBuffer } from '../../../src/core/bits.js';
import { encode } from '../../../src/encode/encode.js';
import { MICRO_MESSAGES } from '../../../src/messages/en/micro.js';
import { RMQR_MESSAGES } from '../../../src/messages/en/rmqr.js';
import { SYMBOLOGY_MESSAGES } from '../../../src/messages/en/symbology.js';
import { qrProfile } from '../../../src/segment/profile.js';
import { createSymbologyRegistry } from '../../../src/symbology/registry.js';
import { buildQr } from '../../../src/symbology/qr/build.js';
import { qrBlocks } from '../../../src/symbology/qr/blocks.js';
import { readQr } from '../../../src/symbology/qr/read.js';
import { checkRegister } from '../../encode/register.js';

function keyOf(error: unknown): string {
	const { code, params } = error as { code: string; params: Record<string, unknown> };
	if (code === 'decode/unreadable') return `symbology.read.${String(params.stage)}`;
	if (code === 'decode/unsupported') return `symbology.read.unsupported.${String(params.feature)}`;
	throw new Error(`unexpected ${code}`);
}

function provoke(run: () => unknown): string {
	try {
		run();
	} catch (error) {
		return keyOf(error);
	}
	throw new Error('expected a failure');
}

/** A symbol at 1-M whose bitstream is these fields, then the terminator. */
function symbolWith(fields: [number, number][]): BitMatrix {
	const out = new BitBuffer();
	for (const [value, bits] of fields) out.append(value, bits);
	out.append(0, 4);
	out.append(0, (8 - (out.length % 8)) % 8);
	while (out.length < qrBlocks(1, 'M').dataBits) out.append(0xec, 8);
	return buildQr(out.toBytes(), 1, 'M', 0).matrix;
}

afterEach(() => {
	vi.unstubAllGlobals();
	vi.resetModules();
});

describe('the symbology messages', () => {
	it('cover every label and every way a read fails, and nothing else', async () => {
		const used = new Set<string>();
		// Micro QR and rMQR keep their labels in catalogues of their own, which
		// tests/symbology/{micro,rmqr}/messages.test.ts hold to the same rules.
		for (const entry of createSymbologyRegistry().list()) {
			const own = { ...MICRO_MESSAGES, ...RMQR_MESSAGES };
			if (entry.labelKey in own) continue;
			used.add(entry.labelKey);
		}
		const good = encode('HELLO', { ecLevel: 'M', mask: 0 }).matrix;
		used.add(provoke(() => readQr(new BitMatrix(22, 22), { strict: true })));
		const blank = new BitMatrix(21, 21);
		used.add(provoke(() => readQr(blank, { strict: false })));
		const scrambled = good.clone();
		for (let y = 9; y < 21; y += 1) for (let x = 9; x < 21; x += 1) scrambled.xor(x, y);
		used.add(provoke(() => readQr(scrambled, { strict: false })));
		used.add(provoke(() => readQr(symbolWith([[0b0110, 4]]), { strict: false })));
		used.add(
			provoke(() =>
				readQr(
					symbolWith([
						[0b0111, 4],
						[99, 8],
						[0b0100, 4],
						[1, 8],
						[0x41, 8],
					]),
					{ strict: false },
				),
			),
		);

		const real = globalThis.TextDecoder;
		vi.stubGlobal(
			'TextDecoder',
			class extends real {
				constructor(label?: string, options?: TextDecoderOptions) {
					if (String(label) === 'shift_jis') throw new RangeError('not in this build');
					super(label, options);
				}
			},
		);
		const fresh = await import('../../../src/symbology/qr/read.js');
		used.add(
			provoke(() =>
				fresh.readQr(
					symbolWith([
						[0b1000, 4],
						[1, 8],
						[0xd9f, 13],
					]),
					{ strict: true },
				),
			),
		);
		expect(qrProfile(1).modes).toContain('kanji');

		for (const key of used) expect(SYMBOLOGY_MESSAGES[key], key).toBeDefined();
		expect([...used].sort()).toEqual(Object.keys(SYMBOLOGY_MESSAGES).sort());
		checkRegister(SYMBOLOGY_MESSAGES);
		expect(Object.isFrozen(SYMBOLOGY_MESSAGES)).toBe(true);
	});
});
