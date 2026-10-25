/**
 * Compile the built-in font family into `src/fonts/latin.ts`.
 *
 * The source files are IBM Plex Sans Regular and Bold, committed under
 * `fonts/` with their licence and a README saying where they came from. Each
 * is read with the text layer's own TrueType parser (so the built-in family
 * and a font somebody adds at runtime go through the same code), cut down to
 * the subset of Unicode below, and written as the compiled table
 * `src/text/compiled.ts` describes: outlines as integer font units, advances,
 * the character map, and the kerning flattened to a pair table and stored as
 * the classes it falls into.
 *
 * The build is deterministic. It checks each source's SHA-256 before using
 * it, compresses with this package's own deflate (zlib's output differs
 * between versions), and formats the result with the repository's Prettier,
 * so `tests/text/build-fonts.test.ts` can run it again and require the
 * committed file byte for byte.
 *
 * Exported as a function as well as run as a script, so the test can build in
 * memory without writing anything.
 */

import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as prettier from 'prettier';
import { deflateRaw } from '../src/core/deflate.js';
import { COMPILED_VERSION } from '../src/text/compiled.js';
import type { Glyphs } from '../src/text/glyf.js';
import { parseTrueTypeTables } from '../src/text/truetype.js';
import type { Font } from '../src/text/types.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

export const OUTPUT = 'src/fonts/latin.ts';

/** Inclusive code point ranges, by the Unicode block they are. */
export const BLOCKS = {
	'Basic Latin': [0x20, 0x7e],
	'Latin-1 Supplement': [0xa0, 0xff],
	'Latin Extended-A': [0x100, 0x17f],
	'Greek and Coptic': [0x370, 0x3ff],
	Cyrillic: [0x400, 0x4ff],
} as const satisfies Record<string, readonly [number, number]>;

export type Block = keyof typeof BLOCKS;

/**
 * Characters from outside those blocks that people type into a caption
 * without meaning to: the quotes and dashes a phone's keyboard substitutes,
 * the ellipsis, bullets, the narrow no-break space French puts before a colon,
 * arrows, the numero sign, the trade mark sign, and currency signs a payment
 * code's caption might name. Both weights carry them.
 */
export const EXTRAS: readonly number[] = [
	0x2013, 0x2014, 0x2018, 0x2019, 0x201a, 0x201c, 0x201d, 0x201e, 0x2022, 0x2026, 0x202f, 0x2039,
	0x203a, 0x20ac, 0x20b4, 0x20b9, 0x20ba, 0x20bd, 0x20bf, 0x2116, 0x2122, 0x2190, 0x2191, 0x2192,
	0x2193,
];

const LATIN: readonly Block[] = ['Basic Latin', 'Latin-1 Supplement', 'Latin Extended-A'];

export interface FontSourceFile {
	readonly id: string;
	readonly labelKey: string;
	/** The constant it is exported as. */
	readonly name: string;
	/** From the repository root. */
	readonly file: string;
	readonly sha256: string;
	readonly blocks: readonly Block[];
}

/**
 * Both weights. Regular is Latin only: with Greek and Cyrillic in both weights
 * the compiled tables came to more than 70 kB in a minified bundle, over their
 * 60 kB budget (`tests/text/build-fonts.test.ts` holds them to it), and the
 * plan for this layer was to drop them from Regular first. Captions are
 * usually set bold, and Bold keeps every block.
 */
export const SOURCES: readonly FontSourceFile[] = [
	{
		id: 'plex-sans-regular',
		labelKey: 'text.font.plex-sans-regular',
		name: 'PLEX_SANS_REGULAR',
		file: 'fonts/IBMPlexSans-Regular.ttf',
		sha256: '975dcda37d80f038dcd143c22e33ca2d97a0cc5a929aace1c749153b0fe1afa5',
		blocks: LATIN,
	},
	{
		id: 'plex-sans-bold',
		labelKey: 'text.font.plex-sans-bold',
		name: 'PLEX_SANS_BOLD',
		file: 'fonts/IBMPlexSans-Bold.ttf',
		sha256: '9e6c74a889a700d707613d24548fe4ffa6bc59559a0689d2cf9e133bdcdafb2f',
		blocks: [...LATIN, 'Greek and Coptic', 'Cyrillic'],
	},
];

export const LICENCE_FILE = 'fonts/OFL.txt';
export const LICENCE_SHA256 = '7e6b2818edbd8f6a01ae80641cc8f16a51080d08fb4e532be3a0b6f74adb07da';

class Writer {
	readonly bytes: number[] = [];

	u(value: number): void {
		if (!Number.isInteger(value) || value < 0) throw new Error('an unsigned number was negative');
		let rest = value;
		while (rest >= 0x80) {
			this.bytes.push((rest % 0x80) | 0x80);
			rest = Math.floor(rest / 0x80);
		}
		this.bytes.push(rest);
	}

	s(value: number): void {
		this.u(value >= 0 ? value * 2 : -value * 2 - 1);
	}
}

function sha256(bytes: Uint8Array | string): string {
	return createHash('sha256').update(bytes).digest('hex');
}

/** The glyphs to keep, in the order they are written, with old numbers mapped to new. */
function subset(
	font: Font,
	glyphs: Glyphs,
	codePoints: readonly number[],
): { order: number[]; renumber: Map<number, number> } {
	const order: number[] = [0];
	const renumber = new Map<number, number>([[0, 0]]);
	const add = (glyph: number): void => {
		if (renumber.has(glyph)) return;
		const record = glyphs.raw(glyph);
		if (record.kind === 'composite' && keepsComposite(record)) {
			for (const component of record.components) add(component.glyph);
		}
		renumber.set(glyph, order.length);
		order.push(glyph);
	};
	for (const codePoint of codePoints) add(font.glyphIndex(codePoint));
	return { order, renumber };
}

/** A composite whose components are only moved can stay one; anything else is drawn out. */
function keepsComposite(
	record: Extract<ReturnType<Glyphs['raw']>, { kind: 'composite' }>,
): boolean {
	return record.components.every(
		(c) =>
			c.match === null &&
			c.a === 1 &&
			c.b === 0 &&
			c.c === 0 &&
			c.d === 1 &&
			Number.isInteger(c.dx) &&
			Number.isInteger(c.dy),
	);
}

/** Factor a pair table into the classes it falls into: equal rows share a class, equal columns too. */
function classes(values: readonly (readonly number[])[]): {
	left: number[];
	right: number[];
	leftCount: number;
	rightCount: number;
	matrix: (l: number, r: number) => number;
} {
	const n = values.length;
	const rowIds = new Map<string, number>();
	const left = values.map((row) => {
		const key = row.join(',');
		let id = rowIds.get(key);
		if (id === undefined) {
			id = rowIds.size;
			rowIds.set(key, id);
		}
		return id;
	});
	const colIds = new Map<string, number>();
	const right: number[] = [];
	for (let j = 0; j < n; j += 1) {
		const key = values.map((row) => row[j]).join(',');
		let id = colIds.get(key);
		if (id === undefined) {
			id = colIds.size;
			colIds.set(key, id);
		}
		right.push(id);
	}
	const rowOf: number[] = [];
	left.forEach((id, i) => {
		rowOf[id] ??= i;
	});
	const colOf: number[] = [];
	right.forEach((id, j) => {
		colOf[id] ??= j;
	});
	return {
		left,
		right,
		leftCount: rowIds.size,
		rightCount: colIds.size,
		matrix: (l, r) =>
			(values[rowOf[l] as number] as readonly number[])[colOf[r] as number] as number,
	};
}

export interface CompiledWeight {
	readonly source: FontSourceFile;
	readonly codePoints: number;
	readonly glyphs: number;
	readonly kerningPairs: number;
	readonly leftClasses: number;
	readonly rightClasses: number;
	readonly inflated: number;
	readonly deflated: number;
	readonly base64: string;
	readonly font: Font;
}

async function compile(source: FontSourceFile): Promise<CompiledWeight> {
	const bytes = new Uint8Array(await readFile(resolve(root, source.file)));
	const digest = sha256(bytes);
	if (digest !== source.sha256) {
		throw new Error(`${source.file} is not the file the build was written for (sha256 ${digest})`);
	}
	const { font, glyphs } = parseTrueTypeTables(bytes, { id: source.id, labelKey: source.labelKey });

	const codePoints: number[] = [];
	for (const block of source.blocks) {
		const [first, last] = BLOCKS[block];
		for (let c = first; c <= last; c += 1) if (font.glyphIndex(c) !== 0) codePoints.push(c);
	}
	for (const c of EXTRAS) {
		if (font.glyphIndex(c) === 0)
			throw new Error(`${source.file} has no glyph for an extra character`);
		codePoints.push(c);
	}
	// The map is written in code point order, which the blocks and extras
	// already are; this keeps it so if either list is edited out of order.
	codePoints.sort((a, b) => a - b);
	const { order, renumber } = subset(font, glyphs, codePoints);

	const out = new Writer();
	out.u(COMPILED_VERSION);
	out.u(order.length);
	out.u(codePoints.length);
	let previousCode = -1;
	let previousGlyph = -1;
	for (const codePoint of codePoints) {
		const glyph = renumber.get(font.glyphIndex(codePoint)) as number;
		out.u(codePoint - previousCode - 1);
		out.s(glyph - previousGlyph - 1);
		previousCode = codePoint;
		previousGlyph = glyph;
	}
	for (const glyph of order) out.u(font.advance(glyph));
	for (const glyph of order) {
		const record = glyph === 0 ? null : glyphs.raw(glyph);
		if (record !== null && record.kind === 'composite' && keepsComposite(record)) {
			out.u(record.components.length * 2 + 1);
			for (const component of record.components) {
				out.u(renumber.get(component.glyph) as number);
				out.s(component.dx);
				out.s(component.dy);
			}
			continue;
		}
		// Glyph 0 is never drawn, so it is written empty. Everything else is
		// its outline, rounded to whole font units (a no-op for a simple glyph,
		// and the quantisation for a composite that had to be drawn out).
		const outline = glyph === 0 ? { points: [], onCurve: [], ends: [] } : font.outline(glyph);
		out.u(outline.ends.length * 2);
		let start = 0;
		for (const end of outline.ends) {
			out.u(end - start);
			start = end;
		}
		let x = 0;
		let y = 0;
		for (let i = 0; i < outline.onCurve.length; i += 1) {
			const px = Math.round(outline.points[i * 2] as number);
			const py = Math.round(outline.points[i * 2 + 1] as number);
			const dx = px - x;
			out.u((dx >= 0 ? dx * 2 : -dx * 2 - 1) * 2 + (outline.onCurve[i] as number));
			out.s(py - y);
			x = px;
			y = py;
		}
	}

	const values = order.map((l) => order.map((r) => font.kerning(l, r)));
	const factored = classes(values);
	out.u(factored.leftCount);
	out.u(factored.rightCount);
	for (const id of factored.left) out.u(id);
	for (const id of factored.right) out.u(id);
	for (let r = 0; r < factored.rightCount; r += 1) {
		for (let l = 0; l < factored.leftCount; l += 1) out.s(factored.matrix(l, r));
	}

	const inflated = Uint8Array.from(out.bytes);
	const deflated = deflateRaw(inflated, { level: 9 });
	let kerningPairs = 0;
	for (const row of values) for (const value of row) if (value !== 0) kerningPairs += 1;
	return {
		source,
		codePoints: codePoints.length,
		glyphs: order.length,
		kerningPairs,
		leftClasses: factored.leftCount,
		rightClasses: factored.rightCount,
		inflated: inflated.length,
		deflated: deflated.length,
		base64: Buffer.from(deflated).toString('base64'),
		font,
	};
}

/** The licence as one string, line endings made LF. */
async function licence(): Promise<string> {
	const bytes = await readFile(resolve(root, LICENCE_FILE));
	const digest = sha256(bytes);
	if (digest !== LICENCE_SHA256) {
		throw new Error(
			`${LICENCE_FILE} is not the licence the build was written for (sha256 ${digest})`,
		);
	}
	return bytes.toString('utf8').replace(/\r\n/g, '\n').trimEnd();
}

/** Blocks as a list in a sentence, with a comma before the last when there are three or more. */
function blockList(blocks: readonly Block[]): string {
	if (blocks.length < 3) return blocks.join(' and ');
	return `${blocks.slice(0, -1).join(', ')}, and ${blocks[blocks.length - 1] as string}`;
}

export interface BuiltFonts {
	readonly text: string;
	readonly weights: readonly CompiledWeight[];
}

/** The generated module's text, formatted. Writes nothing. */
export async function buildFonts(): Promise<BuiltFonts> {
	const weights: CompiledWeight[] = [];
	for (const source of SOURCES) weights.push(await compile(source));
	const licenceText = await licence();

	const lines: string[] = [];
	lines.push('/**');
	lines.push(' * GENERATED by scripts/build-fonts.ts from the files in fonts/. Do not edit it:');
	lines.push(' * change the script or the sources and run `pnpm build:fonts`.');
	lines.push(' *');
	lines.push(
		' * IBM Plex Sans 3.005, from the @ibm/plex-sans 1.1.0 release (see fonts/README.md),',
	);
	lines.push(' * compiled to the table format described in src/text/compiled.ts.');
	for (const weight of weights) {
		lines.push(` * ${weight.source.name}:`);
		lines.push(` *   ${blockList(weight.source.blocks)}, and the ${EXTRAS.length} extras`);
		lines.push(' *   listed in scripts/build-fonts.ts.');
	}
	lines.push(' *');
	lines.push(' * This is a Modified Version of the Font Software under the SIL Open Font');
	lines.push(' * Licence, so it is not presented under the Reserved Font Name: its labels say');
	lines.push(' * Sans. The licence follows, and is also exported as FONT_LICENCE so a page');
	lines.push(' * that bundles these tables can show it.');
	lines.push(' *');
	for (const line of licenceText.split('\n')) {
		lines.push(line.length === 0 ? ' *' : ` * ${line.replace(/\*\//g, '* /').trimEnd()}`);
	}
	lines.push(' */');
	lines.push('');
	lines.push("import type { CompiledFontData } from '../text/compiled.js';");
	lines.push('');
	for (const weight of weights) {
		const { font } = weight;
		lines.push(`export const ${weight.source.name}: CompiledFontData = {`);
		lines.push(`\tid: '${weight.source.id}',`);
		lines.push(`\tlabelKey: '${weight.source.labelKey}',`);
		lines.push(`\tunitsPerEm: ${font.unitsPerEm},`);
		lines.push(`\tascender: ${font.ascender},`);
		lines.push(`\tdescender: ${font.descender},`);
		lines.push(`\tlineGap: ${font.lineGap},`);
		lines.push(`\tglyphCount: ${weight.glyphs},`);
		lines.push(`\tlength: ${weight.inflated},`);
		lines.push(`\tdata: '${weight.base64}',`);
		lines.push('};');
		lines.push('');
	}
	lines.push('/** The copyright notice and licence the tables above are distributed under. */');
	lines.push(`export const FONT_LICENCE = ${JSON.stringify(licenceText)};`);
	lines.push('');

	const config = (await prettier.resolveConfig(resolve(root, OUTPUT))) ?? {};
	const text = await prettier.format(lines.join('\n'), {
		...config,
		filepath: resolve(root, OUTPUT),
	});
	return { text, weights };
}

async function main(): Promise<void> {
	const { text, weights } = await buildFonts();
	await writeFile(resolve(root, OUTPUT), text, 'utf8');
	for (const weight of weights) {
		process.stdout.write(
			`${weight.source.id}: ${weight.codePoints} code points, ${weight.glyphs} glyphs, ` +
				`${weight.kerningPairs} kerning pairs in ${weight.leftClasses} by ${weight.rightClasses} classes, ` +
				`${weight.inflated} bytes, ${weight.deflated} deflated, ${weight.base64.length} base64\n`,
		);
	}
	process.stdout.write(`${OUTPUT}: ${Buffer.byteLength(text, 'utf8')} bytes\n`);
}

// Only writes a file when run as a script. Importing it from a test builds in
// memory and touches nothing.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
	await main();
}
