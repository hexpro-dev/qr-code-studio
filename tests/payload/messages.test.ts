/**
 * Every message key the payload and own-link layers can emit has an English
 * sentence, every sentence is used, and every sentence keeps the house style.
 *
 * Keys are collected three ways. The registry gives labels, descriptions,
 * actions, fields, hints, options and compatibility notes. Running every
 * validator over the issue table, the property generators and the vectors
 * gives the issue codes as they are actually emitted, with their params, so a
 * sentence's placeholders can be checked against what fills them. And the
 * source is searched for key literals, so a rule whose issue no test reaches
 * still fails here rather than reaching a person as raw text.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Issue } from '../../src/core/issue.js';
import { OWN_LINK_MESSAGES } from '../../src/messages/en/own-link.js';
import { PAYLOAD_MESSAGES } from '../../src/messages/en/payload.js';
import { redirectRules } from '../../src/own-link/redirects.js';
import { utmLink } from '../../src/own-link/utm.js';
import { FIELD_ISSUES } from '../../src/payload/fields.js';
import { BUILT_IN_PAYLOAD_TYPES, createPayloadRegistry } from '../../src/payload/registry.js';
import { BUILT_IN_VECTORS } from '../../src/payload/vectors/index.js';
import { SAFETY_CODES, safetyMessageKey } from '../../src/payload/safety.js';
import type { SafetyCode } from '../../src/payload/types.js';
import { ISSUE_CASES, VALID } from './cases.js';
import { valueArbitrary } from './support.js';
import { messageArguments } from '../../src/messages/format.js';

const root = resolve(import.meta.dirname, '../..');
const registry = createPayloadRegistry();

function sourceFiles(dir: string): string[] {
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		return statSync(path).isDirectory() ? sourceFiles(path) : path.endsWith('.ts') ? [path] : [];
	});
}

/** Every issue emitted by every validator over everything the suite knows how to make. */
function emittedIssues(): Issue[] {
	const issues: Issue[] = [];
	for (const [id, change] of ISSUE_CASES)
		issues.push(...registry.require(id).validate({ ...VALID[id], ...change } as never));
	for (const type of BUILT_IN_PAYLOAD_TYPES) {
		for (const vector of BUILT_IN_VECTORS[type.id]) issues.push(...type.validate(vector.value));
		for (const value of fc.sample(valueArbitrary(type), { numRuns: 60, seed: 1 }))
			issues.push(...type.validate(value));
	}
	for (const input of [
		{ from: 'nope', to: 'nope' },
		{ from: 'https://example.com/a?b', to: 'http://example.org/', status: 301 },
		{ from: 'https://example.com/a:b', to: 'https://example.org/', status: 999, targets: ['x'] },
		{ from: 'https://example.com/a', to: 'https://example.com/a' },
		{ from: 'https://example.com/a', to: 'https://user@example.org/' },
	]) {
		issues.push(...redirectRules(input as never).issues);
	}
	issues.push(...utmLink('not a link', { source: '', medium: 'm\n', campaign: 'c' }).issues);
	return issues;
}

function registryKeys(): string[] {
	const keys: string[] = [];
	for (const type of BUILT_IN_PAYLOAD_TYPES) {
		keys.push(type.labelKey, type.descriptionKey, type.actionKey);
		for (const field of type.fields) {
			keys.push(field.labelKey);
			if (field.hintKey) keys.push(field.hintKey);
			for (const option of field.options ?? []) keys.push(option.labelKey);
		}
		for (const note of type.compatibility ?? []) keys.push(note.noteKey);
	}
	return keys;
}

const ALL_MESSAGES: Readonly<Record<string, string>> = {
	...PAYLOAD_MESSAGES,
	...OWN_LINK_MESSAGES,
};
const emitted = emittedIssues();
const ownLinkNotes = redirectRules({
	from: 'https://example.com/a',
	to: 'https://example.org/',
	status: 307,
})
	.rules.concat(redirectRules({ from: 'https://example.com/a', to: 'https://example.org/' }).rules)
	.map((rule) => rule.noteKey);

describe('the message catalogues', () => {
	it('have a sentence for every key the registry names', () => {
		const missing = registryKeys().filter((key) => !(key in ALL_MESSAGES));
		expect(missing).toEqual([]);
	});

	it('have a sentence for every issue code a validator emits', () => {
		const missing = [...new Set(emitted.map((found) => found.code))].filter(
			(code) => !(code in ALL_MESSAGES),
		);
		expect(missing).toEqual([]);
	});

	it('have a sentence for every safety code and every redirect note', () => {
		const keys = [...SAFETY_CODES.map(safetyMessageKey), ...ownLinkNotes];
		expect(keys.filter((key) => !(key in ALL_MESSAGES))).toEqual([]);
	});

	it('list every safety code in the union, once', () => {
		const all: Record<SafetyCode, true> = {
			'scheme/dangerous': true,
			'scheme/unusual': true,
			'host/ip-literal': true,
			'host/mixed-script': true,
			'host/punycode': true,
			'host/lookalike': true,
			'url/userinfo': true,
			'host/shortener': true,
			'host/dynamic-qr': true,
			'url/tracking-params': true,
			'url/insecure': true,
			'url/very-long': true,
			'payload/open-wifi': true,
			'payload/payment': true,
			'payload/sends-message': true,
			'payload/service-code': true,
		};
		expect([...SAFETY_CODES].sort()).toEqual(Object.keys(all).sort());
	});

	it('cover every key literal in the source, and the suite emits each issue literal', () => {
		const literals = new Set<string>();
		for (const file of [
			...sourceFiles(join(root, 'src/payload')),
			...sourceFiles(join(root, 'src/own-link')),
		]) {
			for (const match of readFileSync(file, 'utf8').matchAll(
				/'((?:payload|own-link)\.[a-z0-9.-]+)'/g,
			)) {
				literals.add(match[1] as string);
			}
		}
		for (const problem of ['format', 'checksum', 'prefix', 'amount', 'testnet']) {
			literals.add(`payload.lightning.issue.${problem}`);
		}
		const emittedCodes = new Set(emitted.map((found) => found.code));
		const keyed = [...literals].filter((key) => !key.endsWith('.'));
		expect(keyed.filter((key) => !(key in ALL_MESSAGES))).toEqual([]);
		// The generic field issues are emitted by the schema check, which
		// fields.test.ts drives with a schema of every kind.
		const issueLiterals = keyed.filter(
			(key) => /\.issue\./.test(key) && !key.startsWith('payload.issue.'),
		);
		expect(issueLiterals.filter((key) => !emittedCodes.has(key))).toEqual([]);
		expect(Object.values(FIELD_ISSUES).filter((key) => !(key in ALL_MESSAGES))).toEqual([]);
	});

	it('have no sentence nothing uses', () => {
		const used = new Set([
			...registryKeys(),
			...emitted.map((found) => found.code),
			...SAFETY_CODES.map(safetyMessageKey),
			...ownLinkNotes,
			...Object.values(FIELD_ISSUES),
		]);
		expect(Object.keys(ALL_MESSAGES).filter((key) => !used.has(key))).toEqual([]);
	});

	it('fill every placeholder from the params the issue carries', () => {
		for (const found of emitted) {
			const sentence = ALL_MESSAGES[found.code] as string;
			for (const name of messageArguments(sentence)) {
				expect(found.params ?? {}, `${found.code} uses {${name}}`).toHaveProperty(name);
			}
		}
	});
});

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
	'simply',
	'just ',
];

/** American spellings this catalogue would otherwise be tempted into. */
const AMERICAN = [
	'color',
	'organization',
	'organize',
	'center',
	'license ',
	'analyze',
	'favor',
	'behavior',
	'zip code',
];

describe('house style', () => {
	for (const [key, sentence] of Object.entries(ALL_MESSAGES)) {
		it(key, () => {
			expect(key).toMatch(/^(?:payload|own-link)(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)+$/);
			expect(sentence.trim()).toBe(sentence);
			expect(sentence.length).toBeGreaterThan(0);
			expect(sentence).not.toMatch(/\s{2,}/);
			for (const [char, name] of FORBIDDEN)
				expect(sentence.includes(char), `${key} has ${name}`).toBe(false);
			const lower = sentence.toLowerCase();
			for (const word of [...MARKETING, ...AMERICAN])
				expect(lower.includes(word), `${key}: ${word}`).toBe(false);
			// Sentences end with a full stop; labels (a few words, no verb needed) do not.
			if (
				/\.(?:issue|hint|note|compat|safety)\.|^payload\.[a-z0-9-]+\.(?:action|description)$/.test(
					key,
				)
			) {
				expect(sentence, key).toMatch(/[.]$/);
				expect(sentence, key).toMatch(/^[A-Z0-9]/);
			} else {
				expect(sentence, key).not.toMatch(/\.$/);
			}
		});
	}
});
