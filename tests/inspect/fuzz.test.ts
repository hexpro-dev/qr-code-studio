/**
 * The malformed-input contract for the inspector (tests/fuzz): whatever text
 * or picture it is handed, only a QrStudioError ever escapes, and every call
 * finishes, watched from another thread.
 */

import fc from 'fast-check';
import { afterAll, describe, expect, it } from 'vitest';
import { QrStudioError } from '../../src/core/errors.js';
import type { RgbaImage } from '../../src/core/image.js';
import { encode } from '../../src/encode/encode.js';
import { inspectImage, inspectText } from '../../src/inspect/inspect.js';
import { guardUnhandledRejections } from '../fuzz/setup.js';
import { startWatchdog } from '../fuzz/watchdog.js';
import { draw, registries } from './helpers.js';

guardUnhandledRejections();
const watchdog = startWatchdog();
afterAll(() => watchdog.stop());

const PREFIXES = [
	'',
	'http://',
	'https://',
	'javascript:',
	'WIFI:',
	'BEGIN:VCARD\n',
	'BEGIN:VEVENT\n',
	'MECARD:',
	'mailto:',
	'tel:',
	'SMSTO:',
	'geo:',
	'bitcoin:',
	'lightning:',
	'upi://pay?',
	'BCD\n',
	'SPC\n',
	'000201',
	'https://id.gs1.org/01/',
	'\u0000',
];

describe('inspectText', () => {
	it('explains any text without throwing', () => {
		fc.assert(
			fc.property(
				fc.constantFrom(...PREFIXES),
				fc.string({ unit: 'binary', maxLength: 300 }),
				(prefix, rest) => {
					const text = prefix + rest;
					watchdog.beat(`text ${text.length}`);
					const report = inspectText(text, registries);
					expect(report.payload).not.toBeNull();
					expect(report.safety).not.toBeNull();
				},
			),
			{ numRuns: 1500, seed: 21 },
		);
	});
});

function noise(width: number, height: number, seed: number): RgbaImage {
	const data = new Uint8ClampedArray(width * height * 4);
	let state = seed >>> 0;
	for (let i = 0; i < data.length; i += 1) {
		state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
		data[i] = state >>> 24;
	}
	return { width, height, data };
}

describe('inspectImage', () => {
	it('returns a result, failing only with a QrStudioError', () => {
		const code = draw(encode('https://example.com/fuzz'), 3);
		fc.assert(
			fc.property(
				fc.integer({ min: 1, max: 120 }),
				fc.integer({ min: 1, max: 120 }),
				fc.integer({ min: 0, max: 0xffffffff }),
				fc.boolean(),
				(width, height, seed, damaged) => {
					let image = noise(width, height, seed);
					if (damaged) {
						// A real code with a seeded band overwritten.
						const data = new Uint8ClampedArray(code.data);
						const row = seed % code.height;
						data.fill(
							seed & 0xff,
							row * code.width * 4,
							Math.min(data.length, (row + 6) * code.width * 4),
						);
						image = { width: code.width, height: code.height, data };
					}
					watchdog.beat(`image ${image.width}x${image.height} ${seed}`);
					const result = inspectImage(image, registries);
					if (!result.ok) expect(result.error).toBeInstanceOf(QrStudioError);
				},
			),
			{ numRuns: 120, seed: 22 },
		);
	});
});
