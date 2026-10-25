/**
 * The house register over a message catalogue, shared by the verify and
 * inspect catalogue tests: no en or em dashes, no curly quotes, no arrows,
 * bullets or exclamation marks, none of the marketing words, Australian
 * spelling, dotted lowercase keys, and labels that are not sentences.
 */

import { expect } from 'vitest';

/** As escapes, so a search of this repository for one finds none in the file that bans them. */
const FORBIDDEN = [
	['\u2014', 'an em dash'],
	['\u2013', 'an en dash'],
	['\u2018', 'a curly quote'],
	['\u2019', 'a curly apostrophe'],
	['\u201c', 'a curly double quote'],
	['\u201d', 'a curly double quote'],
	['\u2192', 'an arrow'],
	['\u2022', 'a bullet'],
	['!', 'an exclamation mark'],
] as const;

const MARKETING = [
	'unlock',
	'unleash',
	'empower',
	'elevate',
	'supercharge',
	'seamless',
	'effortless',
	'robust',
	'cutting-edge',
	'best-in-class',
	'world-class',
	'game-changer',
	'leverage',
	'delve',
	'stunning',
	'beautiful',
	'premium',
	'simply',
	'just ',
];

const AMERICAN = ['color', 'center', 'gray', 'organize', 'favor', 'behavior', 'recognize'];

export function checkHouseStyle(
	catalogue: Readonly<Record<string, string>>,
	prefix: string,
	kind: (key: string) => 'label' | 'sentence',
): void {
	for (const [key, sentence] of Object.entries(catalogue)) {
		expect(key).toMatch(new RegExp(`^${prefix}(?:\\.[a-z0-9]+(?:-[a-z0-9]+)*)+$`));
		expect(sentence.trim(), key).toBe(sentence);
		expect(sentence.length, key).toBeGreaterThan(0);
		expect(sentence, key).not.toMatch(/\s{2,}/);
		for (const [char, name] of FORBIDDEN)
			expect(sentence.includes(char), `${key} has ${name}`).toBe(false);
		const lower = sentence.toLowerCase();
		for (const word of [...MARKETING, ...AMERICAN])
			expect(lower.includes(word), `${key}: ${word}`).toBe(false);
		if (kind(key) === 'sentence') expect(sentence, key).toMatch(/^[A-Z].*[.]$/);
		else {
			expect(sentence, key).not.toMatch(/\.$/);
			expect(sentence, key).toMatch(/^[A-Z0-9]/);
		}
	}
}
