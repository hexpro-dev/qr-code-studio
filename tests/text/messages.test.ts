/**
 * Every message key the text layer uses has an English sentence, and every
 * sentence is reached. Keys are found by provoking each failure and reading
 * each label the layer hands out, not by listing them here.
 */

import { describe, expect, it } from 'vitest';
import { QrStudioError } from '../../src/core/errors.js';
import { PathBuilder } from '../../src/geometry/path.js';
import { TEXT_MESSAGES } from '../../src/messages/en/text.js';
import { epsIssues, sceneToEps } from '../../src/render/eps.js';
import { imposeSheet, printSheetTemplate } from '../../src/render/impose.js';
import { MAX_PAGE_MM, sceneToPdf } from '../../src/render/pdf.js';
import { builtInSheets } from '../../src/render/sheets.js';
import type { Scene } from '../../src/render/types.js';
import { layoutText, textToPaths } from '../../src/text/layout.js';
import { createFontRegistry } from '../../src/text/registry.js';
import { parseTrueType } from '../../src/text/truetype.js';
import { checkRegister } from '../encode/register.js';
import { buildFont, square } from './ttf.js';

/** The key a text error is shown with. */
function keyOf(error: unknown): string {
	const { code, params } = error as QrStudioError;
	if (code === 'font/malformed') return 'text.font.malformed';
	if (code === 'font/missing-glyphs') return 'text.font.missing-glyphs';
	if (code === 'render/surface-too-large' && params.maxMm !== undefined)
		return 'render.print.too-large';
	if (code === 'render/format-unavailable' && params.format === 'eps')
		return `render.eps.${String(params.reason)}`;
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

/** The keys this layer uses, gathered from what it does. */
function textKeys(): string[] {
	const fonts = createFontRegistry();
	const custom = parseTrueType(buildFont({ glyphs: [{ contours: [square(0, 0, 9)] }, null] }), {
		id: 'custom',
	});
	fonts.register(custom);
	const labels = fonts.list().map((font) => font.labelKey);
	const errors = [
		provoke(() => parseTrueType(new Uint8Array(4), { id: 'broken' })),
		provoke(() =>
			textToPaths('中', {
				fontId: 'plex-sans-bold',
				size: 1,
				box: { x: 0, y: 0, width: 9, height: 9 },
			}),
		),
	];
	expect(
		layoutText('a', {
			fontId: 'plex-sans-regular',
			size: 1,
			box: { x: 0, y: 0, width: 9, height: 9 },
		}).lines,
	).toHaveLength(1);
	return [...labels, ...errors];
}

/** The keys the print writers and the sheets use. */
function printKeys(): string[] {
	const scene: Scene = {
		width: 10,
		height: 10,
		unitsPerMm: 0.1,
		background: null,
		layers: [
			{
				kind: 'path',
				path: new PathBuilder().rect(0, 0, 5, 5).build(),
				paint: { kind: 'solid', colour: { r: 0, g: 0, b: 0, a: 0.5 } },
			},
		],
	};
	const sheets = [
		...builtInSheets(),
		printSheetTemplate({ paper: 'a4', widthMm: 20 }),
		printSheetTemplate({ paper: 'letter', widthMm: 20 }),
	];
	return [
		...sheets.map((sheet) => sheet.labelKey),
		...imposeSheet([scene], builtInSheets()[0]!).issues.map((found) => found.code),
		...epsIssues(scene).map((found) => found.code),
		provoke(() => sceneToEps(scene, { colour: 'srgb', widthMm: 10 })),
		provoke(() => sceneToPdf(scene, { colour: 'srgb', widthMm: MAX_PAGE_MM + 1 })),
		provoke(() =>
			sceneToEps({ ...scene, layers: [] }, { colour: 'srgb', widthMm: MAX_PAGE_MM + 1 }),
		),
	];
}

describe('the text messages', () => {
	it('cover every key the layer and the print writers use, and nothing else', () => {
		const used = new Set([...textKeys(), ...printKeys()]);
		for (const key of used) expect(TEXT_MESSAGES[key], key).toBeDefined();
		expect([...used].sort()).toEqual(Object.keys(TEXT_MESSAGES).sort());
		const labels = Object.fromEntries(
			Object.entries(TEXT_MESSAGES).filter(([key]) => key.startsWith('sheet.template.')),
		);
		const rest = Object.fromEntries(
			Object.entries(TEXT_MESSAGES).filter(([key]) => !key.startsWith('sheet.template.')),
		);
		checkRegister(rest);
		// Template labels carry sizes, so they have digits, commas and
		// fractions, and no full stop; the rest of the register still holds.
		for (const [key, label] of Object.entries(labels)) {
			expect(label, key).toMatch(/^(A4|US Letter), [a-z0-9 ./]+$/);
			expect(label, key).not.toMatch(/[\u2013\u2014\u2018\u2019\u201c\u201d]/);
		}
	});

	it('match the English the errors carry', () => {
		try {
			parseTrueType(new Uint8Array(4), { id: 'broken' });
		} catch (error) {
			expect((error as QrStudioError).message).toBe(TEXT_MESSAGES['text.font.malformed']);
		}
		try {
			textToPaths('中', {
				fontId: 'plex-sans-bold',
				size: 1,
				box: { x: 0, y: 0, width: 9, height: 9 },
			});
		} catch (error) {
			expect((error as QrStudioError).message).toBe(TEXT_MESSAGES['text.font.missing-glyphs']);
		}
	});
});
