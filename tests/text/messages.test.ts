/**
 * Every message key the text layer uses has an English sentence, and every
 * sentence is reached. Keys are found by provoking each failure and reading
 * each label the layer hands out, not by listing them here.
 */

import { describe, expect, it } from 'vitest';
import { QrStudioError } from '../../src/core/errors.js';
import { TEXT_MESSAGES } from '../../src/messages/en/text.js';
import { layoutText, textToPaths } from '../../src/text/layout.js';
import { createFontRegistry } from '../../src/text/registry.js';
import { parseTrueType } from '../../src/text/truetype.js';
import { checkRegister } from '../encode/register.js';
import { buildFont, square } from './ttf.js';

/** The key a text error is shown with. */
function keyOf(error: unknown): string {
	const { code } = error as QrStudioError;
	if (code === 'font/malformed') return 'text.font.malformed';
	if (code === 'font/missing-glyphs') return 'text.font.missing-glyphs';
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

describe('the text messages', () => {
	it('cover every key the layer uses, and nothing else', () => {
		const used = new Set(textKeys());
		for (const key of used) expect(TEXT_MESSAGES[key], key).toBeDefined();
		const own = Object.keys(TEXT_MESSAGES).filter((key) => key.startsWith('text.'));
		expect([...used].sort()).toEqual(own.sort());
		checkRegister(TEXT_MESSAGES);
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
