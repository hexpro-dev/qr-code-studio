/**
 * Every message key rMQR hands to a view has an English sentence, and every
 * sentence is in the house register.
 */

import { describe, expect, it } from 'vitest';
import { RMQR_MESSAGES } from '../../../src/messages/en/rmqr.js';
import { createRmqrSymbology, RMQR_MESSAGE_KEYS } from '../../../src/symbology/rmqr/entry.js';
import { checkRegister } from '../../encode/register.js';
import { keysInSource } from '../micro/helpers.js';

const RMQR = createRmqrSymbology();

describe('rMQR messages', () => {
	it('has a sentence for every key the symbology uses', () => {
		const used = new Set([
			...Object.values(RMQR_MESSAGE_KEYS),
			RMQR.labelKey,
			...keysInSource('src/symbology/rmqr', 'symbology.rmqr.'),
		]);
		expect([...used].filter((key) => !(key in RMQR_MESSAGES))).toEqual([]);
		expect(Object.keys(RMQR_MESSAGES).filter((key) => !used.has(key))).toEqual([]);
	});

	it('says that most phone cameras cannot read it', () => {
		expect(RMQR_MESSAGES[RMQR_MESSAGE_KEYS.notPhoneReadable]).toMatch(/phone cameras cannot read/);
		expect(RMQR.phoneReadable).toBe(false);
	});

	it('is written in the house register and frozen', () => {
		checkRegister(RMQR_MESSAGES);
		expect(Object.isFrozen(RMQR_MESSAGES)).toBe(true);
	});
});
