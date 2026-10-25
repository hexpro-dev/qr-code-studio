/**
 * What the print writers' tests share: a PDF reader that checks the file's
 * structure as it reads it, the two external renderers (Poppler's pdftoppm
 * and Ghostscript) driven over pipes, a picture comparison, and codes to put
 * in the files.
 *
 * The renderers are system tools, not packages. When one is missing the tests
 * that need it skip and say which tool they wanted; CI installs both. Their
 * output goes to a temporary directory that is removed straight after:
 * `QRS_PRINT_TMP` names where, when the system's is not the place for it.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { expect } from 'vitest';
import type { RgbaImage } from '../../src/core/image.js';
import { encode } from '../../src/encode/encode.js';
import { PathBuilder } from '../../src/geometry/path.js';
import { traceGrid } from '../../src/geometry/trace.js';
import type { Scene } from '../../src/render/types.js';
import { zxingRead } from '../symbology/qr/oracles.js';

/**
 * The first of these that runs, or null. `QRS_NO_PRINT_TOOLS=1` pretends
 * neither is installed, to check the tests skip cleanly without them.
 */
function find(candidates: readonly string[]): string | null {
	if (process.env.QRS_NO_PRINT_TOOLS === '1') return null;
	for (const candidate of candidates) {
		const run = spawnSync(candidate, ['--version'], { encoding: 'utf8' });
		if (run.status === 0 || (run.error === undefined && run.status !== null)) return candidate;
	}
	return null;
}

export const GS = find(['gs', '/opt/homebrew/bin/gs', '/usr/local/bin/gs', '/usr/bin/gs']);
export const PDFTOPPM = find([
	'pdftoppm',
	'/opt/homebrew/bin/pdftoppm',
	'/usr/local/bin/pdftoppm',
	'/usr/bin/pdftoppm',
]);

/** Why a test that needs a tool is skipped, for the test's name. */
export const NEEDS_GS = GS === null ? ' (skipped: Ghostscript (gs) is not installed)' : '';
export const NEEDS_PDFTOPPM =
	PDFTOPPM === null ? ' (skipped: Poppler pdftoppm is not installed)' : '';

/** A binary PPM (P6) as RGBA. */
export function readPpm(bytes: Uint8Array): RgbaImage {
	let at = 0;
	const token = (): string => {
		for (;;) {
			while (at < bytes.length && /\s/.test(String.fromCharCode(bytes[at] as number))) at += 1;
			if (bytes[at] !== 0x23) break;
			while (at < bytes.length && bytes[at] !== 0x0a) at += 1;
		}
		let text = '';
		while (at < bytes.length && !/\s/.test(String.fromCharCode(bytes[at] as number))) {
			text += String.fromCharCode(bytes[at] as number);
			at += 1;
		}
		return text;
	};
	expect(token()).toBe('P6');
	const width = Number(token());
	const height = Number(token());
	expect(token()).toBe('255');
	at += 1;
	const data = new Uint8ClampedArray(width * height * 4);
	for (let i = 0; i < width * height; i += 1) {
		data[i * 4] = bytes[at + i * 3] as number;
		data[i * 4 + 1] = bytes[at + i * 3 + 1] as number;
		data[i * 4 + 2] = bytes[at + i * 3 + 2] as number;
		data[i * 4 + 3] = 255;
	}
	return { width, height, data };
}

export interface Rendered {
	readonly image: RgbaImage;
	readonly stderr: string;
}

/** Page `page` of a PDF through pdftoppm at `dpi`. */
export function popplerRender(pdf: Uint8Array, dpi: number, page = 1): Rendered {
	const dir = mkdtempSync(join(process.env.QRS_PRINT_TMP ?? tmpdir(), 'qrs-print-'));
	try {
		const out = join(dir, 'page');
		const run = spawnSync(
			PDFTOPPM as string,
			['-r', String(dpi), '-f', String(page), '-l', String(page), '-singlefile', 'fd://0', out],
			{ input: pdf, encoding: 'buffer' },
		);
		expect(run.status, run.stderr.toString()).toBe(0);
		return {
			image: readPpm(new Uint8Array(readFileSync(`${out}.ppm`))),
			stderr: run.stderr.toString(),
		};
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

/** A PDF page or an EPS file through Ghostscript at `dpi`, anti-aliased. */
export function ghostscriptRender(
	input: Uint8Array | string,
	dpi: number,
	options: { eps?: boolean; trimBox?: boolean; page?: number } = {},
): Rendered {
	const args = [
		'-q',
		'-dNOPAUSE',
		'-dBATCH',
		'-dSAFER',
		'-sDEVICE=ppmraw',
		`-r${dpi}`,
		'-dGraphicsAlphaBits=4',
		'-dTextAlphaBits=4',
		...(options.eps ? ['-dEPSCrop'] : []),
		...(options.trimBox ? ['-dUseTrimBox'] : []),
		...(options.page ? [`-dFirstPage=${options.page}`, `-dLastPage=${options.page}`] : []),
		'-sOutputFile=-',
		'-',
	];
	const run = spawnSync(GS as string, args, {
		input: typeof input === 'string' ? Buffer.from(input, 'latin1') : input,
		encoding: 'buffer',
		maxBuffer: 1 << 28,
	});
	expect(run.status, run.stderr.toString()).toBe(0);
	return { image: readPpm(new Uint8Array(run.stdout)), stderr: run.stderr.toString() };
}

export interface Difference {
	readonly mean: number;
	readonly max: number;
	/** Share of pixels more than 32 levels out. */
	readonly over32: number;
	/** Share of pixels flat in our render (3 by 3, within 3 levels) and more than `flat` levels out. */
	readonly interior: number;
}

/** Compare two opaque pictures channel by channel; `flat` is the interior tolerance. */
export function compare(ours: RgbaImage, theirs: RgbaImage, flat = 6): Difference {
	expect([theirs.width, theirs.height]).toEqual([ours.width, ours.height]);
	const { width, height } = ours;
	let sum = 0;
	let max = 0;
	let over = 0;
	let interior = 0;
	for (let y = 0; y < height; y += 1) {
		for (let x = 0; x < width; x += 1) {
			const at = (y * width + x) * 4;
			let worst = 0;
			for (let c = 0; c < 3; c += 1) {
				const d = Math.abs((ours.data[at + c] as number) - (theirs.data[at + c] as number));
				sum += d;
				worst = Math.max(worst, d);
			}
			max = Math.max(max, worst);
			if (worst > 32) over += 1;
			if (worst <= flat || x === 0 || y === 0 || x === width - 1 || y === height - 1) continue;
			let isFlat = true;
			for (let dy = -1; dy <= 1 && isFlat; dy += 1) {
				for (let dx = -1; dx <= 1 && isFlat; dx += 1) {
					const near = ((y + dy) * width + x + dx) * 4;
					for (let c = 0; c < 3; c += 1) {
						if (Math.abs((ours.data[near + c] as number) - (ours.data[at + c] as number)) > 3)
							isFlat = false;
					}
				}
			}
			if (isFlat) interior += 1;
		}
	}
	const pixels = width * height;
	return { mean: sum / (pixels * 3), max, over32: over / pixels, interior: interior / pixels };
}

/** A part of a picture. */
export function crop(
	image: RgbaImage,
	x: number,
	y: number,
	width: number,
	height: number,
): RgbaImage {
	const data = new Uint8ClampedArray(width * height * 4);
	for (let row = 0; row < height; row += 1) {
		const from = ((y + row) * image.width + x) * 4;
		data.set(image.data.subarray(from, from + width * 4), row * width * 4);
	}
	return { width, height, data };
}

/** A QR code as a scene, `modules` units a module with a four module quiet zone. */
export function codeScene(
	text: string,
	options: {
		colour?: { r: number; g: number; b: number };
		unitsPerMm?: number;
		background?: boolean;
	} = {},
): Scene {
	const symbol = encode(text, { ecLevel: 'M' });
	const matrix = symbol.matrix;
	const quiet = 4;
	const size = matrix.width + 2 * quiet;
	const grid = traceGrid(matrix.width, matrix.height, (x, y) => matrix.get(x, y) === 1);
	const placed = new PathBuilder().transform([1, 0, 0, 1, quiet, quiet]).append(grid).build();
	const colour = options.colour ?? { r: 0, g: 0, b: 0 };
	return {
		width: size,
		height: size,
		...(options.unitsPerMm === undefined ? {} : { unitsPerMm: options.unitsPerMm }),
		background:
			options.background === false
				? null
				: { kind: 'solid', colour: { r: 255, g: 255, b: 255, a: 1 } },
		layers: [{ kind: 'path', path: placed, paint: { kind: 'solid', colour: { ...colour, a: 1 } } }],
	};
}

/** Every QR code zxing-cpp finds in a picture. */
export async function readCodes(image: RgbaImage): Promise<string[]> {
	const results = await zxingRead(image);
	return results.map((result) => result.text);
}

// The PDF reader.

export interface PdfObject {
	readonly id: number;
	/** The object's text up to `stream`, or all of it. */
	readonly text: string;
	/** The stream's bytes, inflated, when it has one. */
	readonly stream: Uint8Array | null;
}

export interface ParsedPdf {
	readonly version: string;
	readonly objects: ReadonlyMap<number, PdfObject>;
	readonly trailer: string;
	readonly root: number;
	readonly info: number;
	readonly id: readonly [string, string];
}

const latin1 = (bytes: Uint8Array): string => Buffer.from(bytes).toString('latin1');

/**
 * Read a PDF this package wrote, checking as it goes: the header, a
 * cross-reference table whose every offset lands on the object it names,
 * `startxref` pointing at the table, the stream lengths, and every reference
 * pointing at an object that exists.
 */
export function readPdf(bytes: Uint8Array): ParsedPdf {
	const text = latin1(bytes);
	const version = /^%PDF-(\d\.\d)\n%[\xe2][\xe3][\xcf][\xd3]\n/.exec(text);
	expect(version, 'the header').not.toBeNull();
	expect(text.endsWith('%%EOF\n')).toBe(true);
	const start = /startxref\n(\d+)\n%%EOF\n$/.exec(text);
	expect(start, 'startxref').not.toBeNull();
	const xrefAt = Number(start?.[1]);
	expect(text.slice(xrefAt, xrefAt + 5)).toBe('xref\n');
	const header = /^xref\n0 (\d+)\n/.exec(text.slice(xrefAt));
	expect(header).not.toBeNull();
	const count = Number(header?.[1]);
	let at = xrefAt + (header?.[0].length ?? 0);
	expect(text.slice(at, at + 20)).toBe('0000000000 65535 f\r\n');
	at += 20;
	const objects = new Map<number, PdfObject>();
	for (let id = 1; id < count; id += 1) {
		const entry = text.slice(at, at + 20);
		expect(entry, `xref entry ${id}`).toMatch(/^\d{10} 00000 n\r\n$/);
		const offset = Number(entry.slice(0, 10));
		at += 20;
		const head = `${id} 0 obj\n`;
		expect(text.slice(offset, offset + head.length), `object ${id} is where the table says`).toBe(
			head,
		);
		const bodyAt = offset + head.length;
		const end = text.indexOf('\nendobj\n', bodyAt);
		let body = text.slice(bodyAt, end);
		let stream: Uint8Array | null = null;
		const streamAt = body.indexOf('\nstream\n');
		if (streamAt >= 0) {
			const length = Number(/\/Length (\d+)/.exec(body.slice(0, streamAt))?.[1]);
			const dataAt = bodyAt + streamAt + 8;
			expect(text.slice(dataAt + length, dataAt + length + 10), `object ${id}'s length`).toBe(
				'\nendstream',
			);
			const raw = bytes.subarray(dataAt, dataAt + length);
			stream = body.includes('/FlateDecode') ? new Uint8Array(inflateSync(raw)) : raw;
			body = body.slice(0, streamAt);
		}
		objects.set(id, { id, text: body, stream });
	}
	const trailer = text.slice(at, text.lastIndexOf('startxref'));
	expect(trailer.startsWith('trailer\n')).toBe(true);
	expect(Number(/\/Size (\d+)/.exec(trailer)?.[1])).toBe(count);
	const ids = /\/ID \[<([0-9A-F]{32})> <([0-9A-F]{32})>\]/.exec(trailer);
	expect(ids, 'two 16 byte identifiers').not.toBeNull();
	const references = (body: string): number[] =>
		[...body.matchAll(/(\d+) 0 R/g)].map((m) => Number(m[1]));
	for (const object of objects.values()) {
		for (const ref of references(object.text))
			expect(objects.has(ref), `a reference to ${ref}`).toBe(true);
	}
	for (const ref of references(trailer)) expect(objects.has(ref)).toBe(true);
	return {
		version: version?.[1] as string,
		objects,
		trailer,
		root: Number(/\/Root (\d+) 0 R/.exec(trailer)?.[1]),
		info: Number(/\/Info (\d+) 0 R/.exec(trailer)?.[1]),
		id: [ids?.[1] as string, ids?.[2] as string],
	};
}

/** The objects of a parsed PDF whose dictionary matches. */
export function objectsWhere(pdf: ParsedPdf, pattern: RegExp): PdfObject[] {
	return [...pdf.objects.values()].filter((object) => pattern.test(object.text));
}

/** The numbers in a `/Name [a b c d]` array. */
export function boxOf(text: string, name: string): number[] {
	const match = new RegExp(`/${name} \\[([^\\]]*)\\]`).exec(text);
	expect(match, name).not.toBeNull();
	return (match?.[1] as string).trim().split(/\s+/).map(Number);
}

/** Every content stream's operators: pages and forms. */
export function contentStreams(pdf: ParsedPdf): string[] {
	const out: string[] = [];
	for (const object of pdf.objects.values()) {
		if (object.stream === null) continue;
		if (/\/Subtype \/Image/.test(object.text)) continue;
		out.push(latin1(object.stream));
	}
	return out;
}
