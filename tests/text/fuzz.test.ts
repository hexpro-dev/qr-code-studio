/**
 * The malformed-input contract for the TrueType parser, which reads font files
 * a person chose on the website.
 *
 *   1. Only `FontMalformedError` ('font/malformed') escapes the parser. A
 *      RangeError from a typed array, or a stack overflow from a composite
 *      that contains itself, would be a reader that trusted the file.
 *   2. A font that parses can be used without anything failing afterwards:
 *      every glyph's outline and path, kerning between any glyphs, and a
 *      caption laid out in it. The parser's checking is all up front.
 *   3. Every call finishes. The watchdog in `tests/fuzz/` sits on another
 *      thread and names the input if one ever stalls.
 *
 * The corpus is the real Regular face mutated table by table (so the damage
 * lands in the glyphs, the map and the kerning, not just the directory), and
 * small fonts from `ttf.ts` holding every structure the parser reads,
 * mutated byte by byte.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { isQrStudioError } from '../../src/core/errors.js';
import { layoutText } from '../../src/text/layout.js';
import { createFontRegistry } from '../../src/text/registry.js';
import { parseTrueType } from '../../src/text/truetype.js';
import type { Font } from '../../src/text/types.js';
import { seeded } from '../core/helpers.js';
import type { Seeded } from '../core/helpers.js';
import { startWatchdog } from '../fuzz/watchdog.js';
import {
	buildFont,
	classDefTable,
	cmap12,
	cmap4,
	cmapTable,
	extension,
	kernApple,
	kernGpos,
	kernMicrosoft,
	pairSubtable,
	square,
} from './ttf.js';
import type { TestGlyph } from './ttf.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const watchdog = startWatchdog();
afterAll(async () => {
	await watchdog.stop();
});

/** Use every part of a font that parsed. None of it may throw. */
function exercise(font: Font, random: Seeded): void {
	const glyphs = font.glyphCount;
	const limit = Math.min(glyphs, 64);
	for (let i = 0; i < limit; i += 1) {
		const glyph = glyphs <= 64 ? i : random.int(glyphs);
		font.outline(glyph);
		font.path(glyph);
		font.advance(glyph);
		font.kerning(glyph, random.int(glyphs));
	}
	for (let i = 0; i < 64; i += 1) font.glyphIndex(random.int(0x500));
	const fonts = createFontRegistry();
	fonts.register(font);
	layoutText('AVA Bé to\nΩ', {
		fonts,
		fontId: font.id,
		size: 10,
		box: { x: 0, y: 0, width: 40, height: 20 },
		maxLines: 3,
		shrinkToFit: true,
	});
}

/** Parse, and hold the result to the contract. Returns whether it parsed. */
function attempt(label: string, bytes: Uint8Array, random: Seeded): boolean {
	watchdog.beat(label);
	let font: Font;
	try {
		font = parseTrueType(bytes, { id: 'fuzzed' });
	} catch (error) {
		if (!isQrStudioError(error) || error.code !== 'font/malformed') {
			throw new Error(`${label}: ${String(error)}`, { cause: error });
		}
		return false;
	}
	try {
		exercise(font, random);
	} catch (error) {
		throw new Error(`${label} parsed and then failed: ${String(error)}`, { cause: error });
	}
	return true;
}

/** The table records of a font: tag, offset, length. */
function directory(bytes: Uint8Array): { tag: string; offset: number; length: number }[] {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const out: { tag: string; offset: number; length: number }[] = [];
	for (let i = 0; i < view.getUint16(4); i += 1) {
		const at = 12 + i * 16;
		out.push({
			tag: String.fromCharCode(...bytes.slice(at, at + 4)),
			offset: view.getUint32(at + 8),
			length: view.getUint32(at + 12),
		});
	}
	return out;
}

function mutate(random: Seeded, source: Uint8Array, from: number, to: number): Uint8Array {
	const bytes = source.slice();
	const edits = 1 + random.int(4);
	for (let i = 0; i < edits; i += 1) {
		const at = from + random.int(Math.max(1, to - from));
		const kind = random.int(4);
		if (kind === 0) bytes[at] = random.int(256);
		else if (kind === 1) bytes[at] = (bytes[at] as number) ^ (1 << random.int(8));
		else if (kind === 2) bytes[at] = 0xff;
		else bytes[at] = 0;
	}
	return bytes;
}

const box: TestGlyph = { contours: [square(0, 0, 500)] };
const tri: TestGlyph = {
	contours: [
		[
			[0, 0, true],
			[50, 100, false],
			[100, 0, true],
		],
	],
};

/** Small fonts with every structure the parser reads. */
function smallFonts(): Uint8Array[] {
	const glyphs: TestGlyph[] = [
		box,
		box,
		tri,
		{
			components: [
				{ glyph: 2, dx: 10 },
				{ glyph: 1, match: [2, 0] },
			],
		},
		{
			components: [
				{ glyph: 3, scale: 0.5, scaledOffset: true, dx: 4 },
				{ glyph: 2, twoByTwo: [1, 0.5, 0, 1], words: true, dx: 300 },
			],
		},
		{ components: [{ glyph: 4, xyScale: [0.5, 1.5] }] },
		null,
	];
	const format1 = pairSubtable({
		format: 1,
		coverage: { format: 1, glyphs: [1, 3] },
		sets: [
			[
				[2, -40],
				[5, 10],
			],
			[[1, 7]],
		],
	});
	const format2 = pairSubtable({
		format: 2,
		coverage: { format: 2, glyphs: [1, 2, 3, 4] },
		classDef1: classDefTable({ format: 1, start: 1, classes: [1, 0, 1, 1] }),
		classDef2: classDefTable({
			format: 2,
			ranges: [
				[1, 2, 1],
				[4, 6, 2],
			],
		}),
		class1Count: 2,
		class2Count: 3,
		values: [
			[0, -5, 5],
			[3, -30, 0],
		],
	});
	const cmap = cmapTable([
		[
			3,
			1,
			cmap4(
				new Map([
					[0x41, 1],
					[0x42, 2],
					[0x56, 3],
					[0xe9, 4],
				]),
				true,
			),
		],
		[
			3,
			10,
			cmap12([
				[0x41, 0x46, 1],
				[0x3a9, 0x3a9, 5],
			]),
		],
	]);
	return [
		buildFont({
			glyphs,
			cmap,
			gpos: kernGpos([
				{ type: 2, subtables: [format1, format2] },
				{ type: 9, subtables: [extension(format2)] },
			]),
		}),
		buildFont({
			glyphs,
			kern: kernMicrosoft([
				{
					pairs: [
						[1, 2, -9],
						[3, 1, 4],
					],
				},
				{ pairs: [[1, 2, 2]], coverage: 0x0009 },
			]),
			longLoca: true,
		}),
		buildFont({ glyphs, kern: kernApple([{ pairs: [[1, 1, -3]] }]), metrics: 3 }),
	];
}

describe('the TrueType parser on malformed input', () => {
	it('lets only font/malformed escape, table by table through a real face', () => {
		const random = seeded(0xf0a7);
		const plex = new Uint8Array(readFileSync(resolve(root, 'fonts/IBMPlexSans-Regular.ttf')));
		expect(attempt('plex unchanged', plex, random)).toBe(true);
		const tables = directory(plex).filter((t) =>
			['head', 'hhea', 'maxp', 'hmtx', 'loca', 'glyf', 'cmap', 'GPOS'].includes(t.tag),
		);
		let parsed = 0;
		let total = 0;
		for (const t of tables) {
			// The glyphs and the kerning are most of the file and most of the code.
			const rounds = t.tag === 'glyf' || t.tag === 'GPOS' ? 60 : 25;
			for (let i = 0; i < rounds; i += 1) {
				// The first bytes of a table hold its counts and offsets, where damage does the most.
				const near = random.int(3) === 0;
				const to = near ? t.offset + Math.min(t.length, 64) : t.offset + t.length;
				const bytes = mutate(random, plex, t.offset, to);
				if (attempt(`plex ${t.tag} ${i}`, bytes, random)) parsed += 1;
				total += 1;
			}
		}
		// Both outcomes happen: the corpus reaches past the first check.
		expect(parsed).toBeGreaterThan(0);
		expect(parsed).toBeLessThan(total);
	}, 60_000);

	it('lets only font/malformed escape from small fonts mutated byte by byte, or cut short', () => {
		const random = seeded(0x51);
		let parsed = 0;
		let total = 0;
		for (const [index, font] of smallFonts().entries()) {
			expect(attempt(`small ${index} unchanged`, font, random)).toBe(true);
			for (let i = 0; i < 700; i += 1) {
				const bytes = mutate(random, font, 0, font.length);
				if (attempt(`small ${index} mutation ${i}`, bytes, random)) parsed += 1;
				total += 1;
			}
			for (let cut = 0; cut < font.length; cut += 7) {
				attempt(`small ${index} cut at ${cut}`, font.slice(0, cut), random);
			}
		}
		expect(parsed).toBeGreaterThan(0);
		expect(parsed).toBeLessThan(total);
	}, 60_000);

	it('lets only font/malformed escape from noise behind a TrueType header', () => {
		const random = seeded(0x7e7e);
		for (let i = 0; i < 300; i += 1) {
			const bytes = random.bytes(12 + random.int(400));
			bytes.set([0, 1, 0, 0], 0);
			attempt(`noise ${i}`, bytes, random);
		}
	});
});
