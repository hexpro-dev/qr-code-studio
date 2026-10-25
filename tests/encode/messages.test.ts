/**
 * Every message key the encode layer uses has an English sentence, every
 * sentence is reached, and the sentences keep the house register.
 */

import { describe, expect, it } from 'vitest';
import { encode } from '../../src/encode/encode.js';
import { encodeStructuredAppend } from '../../src/encode/structured-append.js';
import { ENCODE_MESSAGES } from '../../src/messages/en/encode.js';
import type { BitstreamProfile } from '../../src/segment/types.js';
import { checkRegister } from './register.js';
import { cached, fakeRegistry } from './helpers.js';

function keyOf(error: unknown): string {
	const { code, params } = error as { code: string; params: Record<string, unknown> };
	if (code === 'encode/too-much-data') return 'encode.too-much-data';
	if (code === 'encode/unsupported-feature')
		return `encode.unsupported-feature.${String(params.feature)}`;
	if (code === 'encode/unsupported-content')
		return `encode.unsupported-content.${String(params.reason)}`;
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

describe('the encode messages', () => {
	it('cover every way encoding fails, and nothing else', () => {
		const bare = cached((profile: BitstreamProfile) => ({
			...profile,
			eci: false,
			fnc1: false,
			structuredAppend: false,
			modes: ['numeric'] as const,
		}));
		const registry = fakeRegistry([
			{ name: 'only', qr: '1', width: 21, height: 21, profile: bare },
		]);
		const used = new Set([
			provoke(() => encode('a'.repeat(3000))),
			provoke(() => encode('\ud800')),
			provoke(() => encode('abc', { symbology: 'fake' }, registry)),
			provoke(() => encode('1', { symbology: 'fake', segmentation: { eci: 'utf-8' } }, registry)),
			provoke(() => encode('1', { symbology: 'fake', fnc1: 'gs1' }, registry)),
			provoke(() => encodeStructuredAppend('1', { symbology: 'fake' }, registry)),
		]);
		for (const key of used) expect(ENCODE_MESSAGES[key], key).toBeDefined();
		expect([...used].sort()).toEqual(Object.keys(ENCODE_MESSAGES).sort());
		checkRegister(ENCODE_MESSAGES);
	});
});
