/**
 * Every message key the inspector uses has an English sentence, every
 * sentence is used, and every sentence keeps the house register.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GS1_AIS } from '../../src/inspect/gs1.js';
import { INSPECT_MESSAGE_KEYS, gs1MessageKey } from '../../src/inspect/keys.js';
import { INSPECT_MESSAGES } from '../../src/messages/en/inspect.js';
import { checkHouseStyle } from '../verify/style.js';
import { messageArguments } from '../../src/messages/format.js';

const root = resolve(import.meta.dirname, '../..');

function used(): Set<string> {
	const keys = new Set<string>();
	for (const name of readdirSync(join(root, 'src/inspect'))) {
		const text = readFileSync(join(root, 'src/inspect', name), 'utf8');
		for (const match of text.matchAll(/'(inspect\.[a-z0-9.-]+)'/g)) keys.add(match[1] as string);
	}
	for (const ai of Object.keys(GS1_AIS)) keys.add(gs1MessageKey(ai));
	const walk = (value: unknown): void => {
		if (typeof value === 'string') keys.add(value);
		else if (typeof value === 'object' && value !== null) Object.values(value).forEach(walk);
	};
	walk(INSPECT_MESSAGE_KEYS);
	return keys;
}

describe('the inspect message catalogue', () => {
	const keys = used();

	it('has a sentence for every key the inspector uses', () => {
		expect([...keys].filter((key) => !(key in INSPECT_MESSAGES))).toEqual([]);
	});

	it('has no sentence nothing uses', () => {
		expect(Object.keys(INSPECT_MESSAGES).filter((key) => !keys.has(key))).toEqual([]);
	});

	it('keeps the house register', () => {
		checkHouseStyle(INSPECT_MESSAGES, 'inspect', (key) =>
			key.startsWith('inspect.label.') ||
			key.startsWith('inspect.gs1.') ||
			key.startsWith('inspect.text-source.')
				? 'label'
				: 'sentence',
		);
	});

	it('uses only the placeholders a set carries', () => {
		for (const key of Object.values(INSPECT_MESSAGE_KEYS.sets)) {
			for (const name of messageArguments(INSPECT_MESSAGES[key] as string)) {
				expect(['total', 'parity'], key).toContain(name);
			}
		}
	});
});
