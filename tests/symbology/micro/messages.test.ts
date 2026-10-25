/**
 * Every message key Micro QR hands to a view has an English sentence, and
 * every sentence is in the house register.
 *
 * The keys are found two ways: the exported `MICRO_MESSAGE_KEYS`, and every
 * string literal in src/symbology/micro that looks like one of its keys, so a
 * key written inline somewhere new cannot slip past the catalogue.
 */

import { describe, expect, it } from 'vitest';
import { MICRO_MESSAGES } from '../../../src/messages/en/micro.js';
import { MICRO_MESSAGE_KEYS, MICRO_QR } from '../../../src/symbology/micro/entry.js';
import { checkRegister, keysInSource } from './helpers.js';

describe('Micro QR messages', () => {
	it('has a sentence for every key the symbology uses', () => {
		const used = new Set([
			...Object.values(MICRO_MESSAGE_KEYS),
			MICRO_QR.labelKey,
			...keysInSource('src/symbology/micro', 'symbology.micro.'),
		]);
		expect([...used].filter((key) => !(key in MICRO_MESSAGES))).toEqual([]);
		// And nothing in the catalogue that nothing uses.
		expect(Object.keys(MICRO_MESSAGES).filter((key) => !used.has(key))).toEqual([]);
	});

	it('says that most phone cameras cannot read it', () => {
		expect(MICRO_MESSAGES[MICRO_MESSAGE_KEYS.notPhoneReadable]).toMatch(
			/phone cameras cannot read/,
		);
		expect(MICRO_QR.phoneReadable).toBe(false);
	});

	it('is written in the house register and frozen', () => {
		expect(checkRegister(MICRO_MESSAGES)).toEqual([]);
		expect(Object.isFrozen(MICRO_MESSAGES)).toBe(true);
	});
});
