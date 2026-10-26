/**
 * The whole English catalogue, as the offline app uses it: every message key
 * any registry or layer can emit has a sentence, no sentence is left that
 * nothing emits, no two areas claim one key, and every sentence keeps the
 * house style.
 *
 * This is the test the website mirrors in seven languages, so it collects
 * keys from what the package hands out rather than from the catalogue
 * itself:
 *
 * - labels, params, options, hints and notes, from fresh registries;
 * - every key literal in the source, so a rule no test reaches still counts;
 * - the keys built from codes: `error.<area>.<detail>` for every error code,
 *   each safety code's, each scan check's and capture axis's, each content
 *   and preset category's, and each field group's;
 * - the families a failure is explained by: the encode layer's by the reason
 *   it refused, the reader's by `decodeFailureKey` over every stage, and the
 *   symbology layer's by the stage of a matrix read;
 * - the issues the validators actually emit, from the payload suite's cases,
 *   and the notes the redirect writers give.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ERROR_CODES, QrStudioError } from '../../src/core/errors.js';
import type { Issue } from '../../src/core/issue.js';
import { BATCH_ISSUES } from '../../src/batch/issues.js';
import { decodeFailureKey } from '../../src/decode/failure.js';
import { GS1_AIS } from '../../src/inspect/gs1.js';
import { INSPECT_MESSAGE_KEYS, gs1MessageKey } from '../../src/inspect/keys.js';
import { createDesignRegistries } from '../../src/design/registries.js';
import { encode } from '../../src/encode/encode.js';
import { encodeStructuredAppend } from '../../src/encode/structured-append.js';
import { EN_MESSAGES, MESSAGE_AREAS, message } from '../../src/messages/en/index.js';
import { redirectRules } from '../../src/own-link/redirects.js';
import { FIELD_ISSUES } from '../../src/payload/fields.js';
import { createPayloadRegistry } from '../../src/payload/registry.js';
import { SAFETY_CODES, safetyMessageKey } from '../../src/payload/safety.js';
import { printSheetTemplate } from '../../src/render/impose.js';
import { builtInSheets } from '../../src/render/sheets.js';
import { createSymbologyRegistry } from '../../src/symbology/registry.js';
import { MICRO_MESSAGE_KEYS } from '../../src/symbology/micro/entry.js';
import { RMQR_MESSAGE_KEYS } from '../../src/symbology/rmqr/entry.js';
import { createFontRegistry } from '../../src/text/registry.js';
import { VERIFY_MESSAGE_KEYS } from '../../src/verify/keys.js';
import {
	axisKey,
	categoryKey,
	checkKey,
	errorKey,
	errorMessageKey,
	groupKey,
	presetCategoryKey,
} from '../../src/studio/keys.js';
import { CAPTURE_AXES, CHECK_IDS } from '../../src/studio/seams.js';
import { cached, fakeRegistry } from '../encode/helpers.js';
import { ISSUE_CASES, VALID } from '../payload/cases.js';
import type { BitstreamProfile } from '../../src/segment/types.js';
import { createStudio } from '../../src/studio/studio.js';
import { importLogo } from '../../src/dom/logo.js';
import { blobOf, fakeDecoding } from '../dom/fakes.js';
import { shownForms } from './forms.js';
import { messageArguments } from '../../src/messages/format.js';

const root = resolve(import.meta.dirname, '../..');

function sourceFiles(dir: string): string[] {
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		return statSync(path).isDirectory() ? sourceFiles(path) : path.endsWith('.ts') ? [path] : [];
	});
}

// 'app' is the offline file's own words: counted here like every other area,
// and left out of LIBRARY_AREAS, which is what the website mirrors.
const AREAS = [
	'app',
	'batch',
	'payload',
	'own-link',
	'design',
	'encode',
	'symbology',
	'decode',
	'text',
	'render',
	'sheet',
	'studio',
	'dom',
	'verify',
	'inspect',
	'error',
];

/** Every key literal in the source, in any area, less the prefixes keys are built from. */
function sourceKeys(): string[] {
	const pattern = new RegExp(`'((?:${AREAS.join('|')})\\.[a-z0-9.-]+)'`, 'g');
	const keys = new Set<string>();
	for (const file of sourceFiles(join(root, 'src'))) {
		if (file.includes('/messages/')) continue;
		for (const match of readFileSync(file, 'utf8').matchAll(pattern)) keys.add(match[1] as string);
	}
	return [...keys].filter((key) => !key.endsWith('.'));
}

function registryKeys(): string[] {
	const keys: string[] = [];
	for (const type of createPayloadRegistry().list()) {
		keys.push(type.labelKey, type.descriptionKey, type.actionKey);
		for (const field of type.fields) {
			keys.push(field.labelKey);
			if (field.hintKey !== undefined) keys.push(field.hintKey);
			if (field.group !== undefined) keys.push(groupKey(field.group));
			for (const option of field.options ?? []) keys.push(option.labelKey);
		}
		for (const note of type.compatibility ?? []) keys.push(note.noteKey);
		keys.push(categoryKey(type.category));
	}
	const design = createDesignRegistries();
	for (const entry of [
		...design.moduleShapes.list(),
		...design.regionShapes.list(),
		...design.fills.list(),
		...design.frames.list(),
	]) {
		keys.push(entry.labelKey);
		for (const param of entry.params) {
			keys.push(param.labelKey);
			for (const option of param.options ?? []) keys.push(option.labelKey);
		}
	}
	for (const icon of design.icons.list()) keys.push(icon.labelKey);
	for (const preset of design.presets.list())
		keys.push(preset.labelKey, presetCategoryKey(preset.category));
	for (const symbology of createSymbologyRegistry().list()) keys.push(symbology.labelKey);
	keys.push(...Object.values(MICRO_MESSAGE_KEYS), ...Object.values(RMQR_MESSAGE_KEYS));
	for (const font of createFontRegistry().list()) keys.push(font.labelKey);
	for (const sheet of builtInSheets()) keys.push(sheet.labelKey);
	for (const paper of ['a4', 'letter'] as const)
		keys.push(printSheetTemplate({ paper, widthMm: 20 }).labelKey);
	return keys;
}

/** The encode layer's failures, provoked as tests/encode/messages.test.ts provokes them. */
function encodeKeys(): string[] {
	const provoke = (run: () => unknown): string => {
		try {
			run();
		} catch (error) {
			return errorKey(error as QrStudioError);
		}
		throw new Error('expected a failure');
	};
	const bare = cached((profile: BitstreamProfile) => ({
		...profile,
		eci: false,
		fnc1: false,
		structuredAppend: false,
		modes: ['numeric'] as const,
	}));
	const registry = fakeRegistry([{ name: 'only', qr: '1', width: 21, height: 21, profile: bare }]);
	return [
		provoke(() => encode('a'.repeat(3000))),
		provoke(() => encode('\ud800')),
		provoke(() => encode('abc', { symbology: 'fake' }, registry)),
		provoke(() => encode('1', { symbology: 'fake', segmentation: { eci: 'utf-8' } }, registry)),
		provoke(() => encode('1', { symbology: 'fake', fnc1: 'gs1' }, registry)),
		provoke(() => encodeStructuredAppend('1', { symbology: 'fake' }, registry)),
	];
}

/** The union `DecodeStage`, read from the reader's own types so a new stage is counted here too. */
function decodeStages(): string[] {
	const source = readFileSync(join(root, 'src/decode/types.ts'), 'utf8');
	const union = /export type DecodeStage =([^;]+);/.exec(source)?.[1] ?? '';
	return [...union.matchAll(/'([a-z-]+)'/g)].map((match) => match[1] as string);
}

/** The features a reader can refuse, as the symbology and segment layers name them. */
const UNSUPPORTED = ['eci', 'kanji'];
/** The symbology's own stages of a matrix read: src/messages/en/symbology.ts. */
const MATRIX_STAGES = ['version', 'format', 'reed-solomon', 'segments'];

function failureKeys(): string[] {
	const keys: string[] = [];
	// Nothing is found before a grid lands (the finders and geometry stages);
	// every stage after is a code found and not read. src/decode/types.ts.
	const located = ['finders', 'geometry'];
	for (const stage of decodeStages()) {
		const code = located.includes(stage) ? 'decode/not-found' : 'decode/unreadable';
		keys.push(decodeFailureKey(new QrStudioError(code, '', { stage })));
	}
	keys.push(decodeFailureKey(new QrStudioError('decode/not-found', '')));
	keys.push(decodeFailureKey(new QrStudioError('decode/unreadable', '')));
	keys.push(decodeFailureKey(new QrStudioError('decode/unsupported', '')));
	for (const feature of UNSUPPORTED) {
		keys.push(decodeFailureKey(new QrStudioError('decode/unsupported', '', { feature })));
		keys.push(`symbology.read.unsupported.${feature}`);
	}
	for (const stage of MATRIX_STAGES) keys.push(`symbology.read.${stage}`);
	return keys;
}

/** Issues the validators emit over the payload suite's cases, with their params. */
function payloadIssues(): Issue[] {
	const payloads = createPayloadRegistry();
	const issues: Issue[] = [];
	for (const [id, change] of ISSUE_CASES)
		issues.push(...payloads.require(id).validate({ ...VALID[id], ...change } as never));
	return issues;
}

function ownLinkNotes(): string[] {
	return [
		...redirectRules({ from: 'https://example.com/a', to: 'https://example.org/', status: 307 })
			.rules,
		...redirectRules({ from: 'https://example.com/a', to: 'https://example.org/' }).rules,
	].map((rule) => rule.noteKey);
}

/** The batch layer's spreadsheet failures, by the reasons its own union names. */
function batchKeys(): string[] {
	const source = readFileSync(join(root, 'src/batch/errors.ts'), 'utf8');
	const union = /export type CsvFailure =([^;]+);/.exec(source)?.[1] ?? '';
	const reasons = [...union.matchAll(/'([a-z-]+)'/g)].map((match) => match[1] as string);
	expect(reasons.length).toBeGreaterThan(0);
	return [
		...reasons.map((reason) => errorKey(new QrStudioError('batch/malformed-csv', '', { reason }))),
		errorKey(new QrStudioError('batch/too-many-rows', '')),
		errorKey(new QrStudioError('batch/unknown-column', '')),
		errorKey(new QrStudioError('platform/unavailable', '', { feature: 'text-encoding' })),
		...Object.values(BATCH_ISSUES),
	];
}

function codeKeys(): string[] {
	return [
		...ERROR_CODES.map(errorMessageKey),
		...SAFETY_CODES.map(safetyMessageKey),
		...Object.values(FIELD_ISSUES),
		...CHECK_IDS.map((id) => checkKey(id)),
		checkKey('contrast', 'MOD'),
		...CAPTURE_AXES.map(axisKey),
		axisKey('static'),
	];
}

/** Lightning reports its invoice problems by a computed key; tests/payload/messages.test.ts lists them the same way. */
const LIGHTNING = ['format', 'checksum', 'prefix', 'amount', 'testnet'].map(
	(problem) => `payload.lightning.issue.${problem}`,
);

/** Every string in a nested table of keys, as the scan check and the inspector keep theirs. */
function tableKeys(value: unknown): string[] {
	if (typeof value === 'string') return [value];
	if (typeof value === 'object' && value !== null) return Object.values(value).flatMap(tableKeys);
	return [];
}

/** The scan check's and the inspector's keys: their tables, and each GS1 application identifier's. */
function verifyAndInspectKeys(): string[] {
	return [
		...tableKeys(VERIFY_MESSAGE_KEYS),
		...tableKeys(INSPECT_MESSAGE_KEYS),
		...Object.keys(GS1_AIS).map(gs1MessageKey),
	];
}

const emitted = payloadIssues();
const used = new Set([
	...registryKeys(),
	...sourceKeys(),
	...encodeKeys(),
	...failureKeys(),
	...codeKeys(),
	...batchKeys(),
	...emitted.map((found) => found.code),
	...ownLinkNotes(),
	...LIGHTNING,
	...verifyAndInspectKeys(),
]);

describe('the English catalogue', () => {
	it('has a sentence for every key the package can emit', () => {
		expect([...used].filter((key) => !(key in EN_MESSAGES)).sort()).toEqual([]);
	});

	it('has no sentence that nothing emits', () => {
		expect(
			Object.keys(EN_MESSAGES)
				.filter((key) => !used.has(key))
				.sort(),
		).toEqual([]);
	});

	it('gathers every area file in src/messages/en', () => {
		// An area file left out of MESSAGE_AREAS has no sentence in the offline
		// file, which shows its keys as they are, and the website never mirrors it.
		const files = readdirSync(join(root, 'src/messages/en'))
			.filter((name) => name.endsWith('.ts') && name !== 'index.ts')
			.map((name) => name.slice(0, -3))
			.sort();
		expect(Object.keys(MESSAGE_AREAS).sort()).toEqual(files);
	});

	it('lets no two areas claim one key', () => {
		const owner = new Map<string, string>();
		const clashes: string[] = [];
		for (const [area, catalogue] of Object.entries(MESSAGE_AREAS)) {
			for (const key of Object.keys(catalogue)) {
				const before = owner.get(key);
				if (before !== undefined) clashes.push(`${key} in ${before} and ${area}`);
				owner.set(key, area);
			}
		}
		expect(clashes).toEqual([]);
		const total = Object.values(MESSAGE_AREAS).reduce(
			(sum, catalogue) => sum + Object.keys(catalogue).length,
			0,
		);
		expect(Object.keys(EN_MESSAGES)).toHaveLength(total);
		expect(Object.isFrozen(EN_MESSAGES)).toBe(true);
	});

	it('fills placeholders from params, and hands back a key it has no sentence for', () => {
		expect(message('studio.issue.raw-too-long', { length: 20000, max: 16384 })).toBe(
			'This is 20000 characters, and no code holds more than 16384. Shorten it to make a code from it.',
		);
		expect(message('studio.issue.raw-too-long')).toContain('{length}');
		expect(message('no.such.key')).toBe('no.such.key');
		expect(message('toString')).toBe('toString');
		expect(message('error.cancelled')).toBe('That was stopped before it finished.');
	});

	it('fills every placeholder a studio or dom sentence uses from the params its issue carries', async () => {
		const issues: Issue[] = [...emitted];
		const studio = createStudio();
		studio.dispatch({ type: 'payload/raw', text: 'x'.repeat(20000) });
		issues.push(...(studio.getSnapshot().refusal?.issues ?? []));
		studio.dispatch({ type: 'payload/field', key: 'url', value: 'nope' });
		studio.dispatch({ type: 'payload/field', key: 'url', value: 'https://example.com/' });
		studio.dispatch({ type: 'payload/field', key: 'url', value: 'nope' });
		const stale = studio.getSnapshot().symbol;
		if (stale.status === 'stale') issues.push(stale.issue);
		const narrow = await studio.run({ type: 'export', format: 'svg', options: { quietZone: 1 } });
		studio.dispatch({ type: 'payload/field', key: 'url', value: 'https://example.com/' });
		const svg = await studio.run({
			type: 'export',
			format: 'svg',
			options: { quietZone: 1, widthPx: -1 },
		});
		if (svg.ok) issues.push(...svg.value.issues);
		expect(narrow.ok).toBe(false);
		studio.dispatch({ type: 'payload/type', typeId: 'swiss-qr-bill' });
		const vector = (await import('../../src/payload/vectors/swiss-qr-bill.js'))
			.swissQrBillVectors[0];
		studio.dispatch({ type: 'payload/raw', text: vector?.text as string });
		const pdf = await studio.run({ type: 'export', format: 'pdf', options: { sizeMm: 30 } });
		if (pdf.ok) issues.push(...pdf.value.issues);
		const logo = await importLogo(blobOf('x', 'image/png'), {
			deps: fakeDecoding(2048, 1024).deps,
		});
		if (logo.ok) issues.push(...logo.value.issues);
		const reached = new Set<string>();
		for (const found of issues) {
			const sentence = EN_MESSAGES[found.code];
			expect(sentence, found.code).toBeDefined();
			for (const name of messageArguments(sentence as string)) {
				reached.add(found.code);
				expect(found.params ?? {}, `${found.code} uses {${name}}`).toHaveProperty(name);
			}
		}
		const ours = Object.entries({ ...MESSAGE_AREAS.studio, ...MESSAGE_AREAS.dom })
			.filter(([, sentence]) => messageArguments(sentence).length > 0)
			.map(([key]) => key);
		expect(ours.filter((key) => !reached.has(key))).toEqual([]);
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

const AMERICAN = [
	'color',
	'center',
	'gray',
	'organize',
	'organization',
	'favor',
	'behavior',
	'analyze',
	'license ',
	'zip code',
];

describe('house style', () => {
	for (const [key, sentence] of Object.entries(EN_MESSAGES)) {
		it(key, () => {
			expect(key).toMatch(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)+$/);
			for (const [char, name] of FORBIDDEN)
				expect(sentence.includes(char), `${key} has ${name}`).toBe(false);
			const lower = sentence.toLowerCase();
			for (const word of [...MARKETING, ...AMERICAN])
				expect(lower.includes(word), `${key}: ${word}`).toBe(false);
			// The shape is checked as a person reads it: each plural branch is a
			// sentence of its own, and a block may start one.
			for (const shown of shownForms(sentence)) {
				expect(shown.trim(), key).toBe(shown);
				expect(shown.length, key).toBeGreaterThan(0);
				expect(shown, key).not.toMatch(/\s{2,}/);
				expect(shown, key).toMatch(/^[A-Z0-9]/);
				// An issue or an error is a sentence; a heading or a label is not.
				if (/\.issue\.|^error\./.test(key)) expect(shown, key).toMatch(/[.]$/);
			}
		});
	}
});
