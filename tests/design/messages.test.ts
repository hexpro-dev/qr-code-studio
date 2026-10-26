/**
 * Every message key the design layer can emit has an English sentence, every
 * sentence is used, and every sentence keeps the house style.
 *
 * Keys come from three places: the registries (labels, parameter labels,
 * option labels), the issues actually emitted by running validation,
 * constraints, links and scene building over a wide set of designs, and a
 * search of the source for key literals, so a rule no test reaches still
 * fails here rather than reaching a person as raw text.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Issue } from '../../src/core/issue.js';
import { DESIGN_MESSAGES } from '../../src/messages/en/design.js';
import { createDesignRegistries } from '../../src/design/registries.js';
import { messageArguments } from '../../src/messages/format.js';

const root = resolve(import.meta.dirname, '../..');
const registries = createDesignRegistries();

function sourceFiles(dir: string): string[] {
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		return statSync(path).isDirectory() ? sourceFiles(path) : path.endsWith('.ts') ? [path] : [];
	});
}

/** Every key the registries name. */
function registryKeys(): string[] {
	const keys: string[] = [];
	const entries = [
		...registries.moduleShapes.list(),
		...registries.regionShapes.list(),
		...registries.fills.list(),
		...registries.frames.list(),
	];
	for (const entry of entries) {
		keys.push(entry.labelKey);
		for (const param of entry.params) {
			keys.push(param.labelKey);
			for (const option of param.options ?? []) keys.push(option.labelKey);
		}
	}
	for (const icon of registries.icons.list()) keys.push(icon.labelKey);
	for (const preset of registries.presets.list()) keys.push(preset.labelKey);
	return keys;
}

/** Every `design.` key literal in the design source. */
function sourceKeys(): string[] {
	const keys = new Set<string>();
	for (const file of sourceFiles(join(root, 'src/design'))) {
		for (const match of readFileSync(file, 'utf8').matchAll(/'(design\.[a-z0-9.-]+)'/g)) {
			keys.add(match[1] as string);
		}
	}
	return [...keys].filter((key) => !key.endsWith('.'));
}

/** Issues gathered from the other suites' scenarios, for the placeholder check. */
async function emittedIssues(): Promise<Issue[]> {
	const issues: Issue[] = [];
	const { validateDesign } = await import('../../src/design/validate.js');
	const { applyConstraints } = await import('../../src/design/constraints.js');
	const { designLink } = await import('../../src/design/link.js');
	const { defaultDesign } = await import('../../src/design/document.js');
	const { buildScene } = await import('../../src/design/scene.js');
	const { encode } = await import('../../src/encode/encode.js');
	const design = defaultDesign();
	const symbol = encode('https://example.com/messages');
	const captioned = (content: string) => ({
		...design,
		frame: { ref: { id: 'banner-bottom' }, text: { content, fontId: 'plex-sans-bold' } },
	});
	issues.push(
		// A caption in characters the font lacks, one too long for its frame and
		// one too wide for it, and a Swiss cross on a symbol that cannot carry it.
		...buildScene(symbol, captioned('\u83dc\u5355 Menu'), { registries }).issues,
		...buildScene(symbol, captioned('x'.repeat(30)), { registries }).issues,
		...buildScene(symbol, captioned('M'.repeat(24)), { registries }).issues,
		...buildScene(
			encode('12345', { symbology: 'micro', ecLevel: 'L' }),
			{ ...design, quietZone: 2 },
			{ registries, overlay: 'swiss-cross' },
		).issues,
		...validateDesign({ ...design, quietZone: 2 }, registries).issues,
		...validateDesign({ ...design, assets: { a: 1, b: 2, c: 3, d: 4, e: 5 } }, registries).issues,
		...validateDesign(
			{ ...design, assets: { a: { png: 'A'.repeat(800_000), width: 1, height: 1 } } },
			registries,
		).issues,
		...validateDesign({ ...design, schema: 'qr-design', version: 9 }, registries).issues,
		...validateDesign({ ...design, symbol: { symbology: 'qr', mask: 12 } }, registries).issues,
		...validateDesign({ ...design, name: 'x'.repeat(200) }, registries).issues,
		...validateDesign({ ...design, name: 'a\u0001' }, registries).issues,
		...validateDesign({ ...design, quietZone: 99 }, registries).issues,
		...validateDesign(
			{
				...design,
				background: { kind: 'linear', angle: 0, space: 'symbol', stops: [] },
				frame: { ref: { id: 'banner-bottom' }, text: { content: 'a\nb', fontId: 'x' } },
			},
			registries,
		).issues,
		...validateDesign(
			{
				...design,
				frame: { ref: { id: 'banner-bottom' }, text: { content: 'x'.repeat(40), fontId: 'x' } },
			},
			registries,
		).issues,
		...applyConstraints(
			{
				...design,
				symbol: { symbology: 'qr', ecLevel: 'H', maxVersion: '30' },
				output: { sizeMm: 10, colourSpace: 'srgb' },
			},
			{
				ecLevels: ['M'],
				maxVersion: '13',
				sizeMm: 46,
			},
		).issues,
		...designLink({ ...design, assets: { a: { png: '', width: 1, height: 1 } } }).issues,
	);
	return issues;
}

describe('the design message catalogue', () => {
	it('has a sentence for every key the registries name', () => {
		expect(registryKeys().filter((key) => !(key in DESIGN_MESSAGES))).toEqual([]);
	});

	it('has a sentence for every key literal in the source', () => {
		expect(sourceKeys().filter((key) => !(key in DESIGN_MESSAGES))).toEqual([]);
	});

	it('has no sentence nothing uses', () => {
		const used = new Set([...registryKeys(), ...sourceKeys()]);
		expect(Object.keys(DESIGN_MESSAGES).filter((key) => !used.has(key))).toEqual([]);
	});

	it('fills every placeholder from the params its issues carry', async () => {
		const issues = await emittedIssues();
		const placeholders = new Set<string>();
		for (const found of issues) {
			const sentence = DESIGN_MESSAGES[found.code] as string;
			expect(sentence, found.code).toBeDefined();
			for (const name of messageArguments(sentence)) {
				placeholders.add(found.code);
				expect(found.params ?? {}, `${found.code} uses {${name}}`).toHaveProperty(name);
			}
		}
		// Every sentence with a placeholder was reached at least once above.
		const withPlaceholders = Object.entries(DESIGN_MESSAGES)
			.filter(([, sentence]) => messageArguments(sentence).length > 0)
			.map(([key]) => key);
		expect(withPlaceholders.filter((key) => !placeholders.has(key))).toEqual([]);
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
	'stunning',
	'beautiful',
	'premium',
	'simply',
	'just ',
];

const AMERICAN = ['color', 'center', 'gray', 'organize', 'favor', 'behavior'];

describe('house style', () => {
	for (const [key, sentence] of Object.entries(DESIGN_MESSAGES)) {
		it(key, () => {
			expect(key).toMatch(/^design(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)+$/);
			expect(sentence.trim()).toBe(sentence);
			expect(sentence.length).toBeGreaterThan(0);
			expect(sentence).not.toMatch(/\s{2,}/);
			for (const [char, name] of FORBIDDEN)
				expect(sentence.includes(char), `${key} has ${name}`).toBe(false);
			const lower = sentence.toLowerCase();
			for (const word of [...MARKETING, ...AMERICAN])
				expect(lower.includes(word), `${key}: ${word}`).toBe(false);
			// Issues are sentences; labels are not.
			if (key.startsWith('design.issue.')) {
				expect(sentence, key).toMatch(/^[A-Z].*[.]$/);
			} else {
				expect(sentence, key).not.toMatch(/\.$/);
				expect(sentence, key).toMatch(/^[A-Z]/);
			}
		});
	}
});
