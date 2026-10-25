/**
 * What the Micro QR and rMQR tests share: an independent bitstream writer for
 * single-mode content, the two oracles, and drawing a matrix for a reader.
 *
 * The bitstream writer is written out here, from the specification's field
 * widths, rather than taken from src/segment. Until that layer is merged
 * there is nothing to take; after it is, the oracle tests still want content
 * whose codewords do not depend on the code under test, so a disagreement
 * with bwip-js points at the symbology and nothing else. It handles one mode
 * per symbol, which is also what keeps BWIPP's own mode optimisation from
 * choosing differently: a run of digits is numeric to every encoder.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import bwipjs from 'bwip-js';
import { prepareZXingModule, readBarcodes, writeBarcode } from 'zxing-wasm/full';
import type { ReadResult } from 'zxing-wasm/full';
import { BitBuffer, BitMatrix } from '../../../src/core/index.js';
import type { BuiltSymbol, Mode } from '../../../src/symbology/micro/contract-types.js';
import type { Seeded } from '../../core/helpers.js';

export { seeded } from '../../core/helpers.js';
export type { Seeded } from '../../core/helpers.js';

const ALPHANUMERIC = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';
/** The alphanumeric characters that are not digits, so a run of them is never numeric. */
const ALPHA_ONLY = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';
/** Lowercase letters: bytes no encoder puts in numeric, alphanumeric or kanji mode. */
const BYTE_ONLY = 'abcdefghijklmnopqrstuvwxyz';

/** Field widths for one version: what the test writer needs from a profile, and nothing else. */
export interface TestProfile {
	readonly modeBits: number;
	readonly modeIndicator: Readonly<Partial<Record<Mode, number>>>;
	readonly charCountBits: Readonly<Partial<Record<Mode, number>>>;
	readonly terminatorBits: number;
}

/**
 * Content for a mode: the characters as a binary string (one char per byte,
 * for bwip-js with `binarytext`) and as a count of characters the bitstream
 * records.
 */
export interface Payload {
	readonly mode: Mode;
	readonly text: string;
	readonly chars: number;
}

/** Shift_JIS double-byte kanji in the two ranges QR's kanji mode compacts. */
function kanjiPair(random: Seeded): [number, number] {
	// 0x889f to 0x9872 is level 1 kanji, assigned in every Shift_JIS table, and
	// stays well inside the first compaction range; avoid the low bytes 0x7f
	// and past 0xfc, which are not second bytes.
	const lead = 0x89 + random.int(0x97 - 0x89 + 1);
	let trail = 0x40 + random.int(0xfc - 0x40 + 1);
	if (trail === 0x7f) trail = 0x80;
	return [lead, trail];
}

export function randomPayload(random: Seeded, mode: Mode, chars: number): Payload {
	let text = '';
	for (let i = 0; i < chars; i += 1) {
		if (mode === 'numeric') text += String(random.int(10));
		else if (mode === 'alphanumeric') text += ALPHA_ONLY[random.int(ALPHA_ONLY.length)];
		else if (mode === 'byte') text += BYTE_ONLY[random.int(BYTE_ONLY.length)];
		else {
			const [lead, trail] = kanjiPair(random);
			text += String.fromCharCode(lead, trail);
		}
	}
	return { mode, text, chars };
}

/** Bits the payload's segment needs: mode indicator, count and data. */
export function payloadBits(payload: Payload, profile: TestProfile): number {
	const count = profile.charCountBits[payload.mode] as number;
	const n = payload.chars;
	let data: number;
	if (payload.mode === 'numeric') data = Math.floor(n / 3) * 10 + [0, 4, 7][n % 3]!;
	else if (payload.mode === 'alphanumeric') data = Math.floor(n / 2) * 11 + (n % 2) * 6;
	else if (payload.mode === 'byte') data = n * 8;
	else data = n * 13;
	return profile.modeBits + count + data;
}

/** The most characters of a mode that fit in `capacity` bits, within the count field's reach. */
export function maxChars(mode: Mode, profile: TestProfile, capacity: number): number {
	const countLimit = (1 << (profile.charCountBits[mode] as number)) - 1;
	let n = 0;
	while (n < countLimit && payloadBits({ mode, text: '', chars: n + 1 }, profile) <= capacity) {
		n += 1;
	}
	return n;
}

function writePayload(payload: Payload, profile: TestProfile, out: BitBuffer): void {
	out.append(profile.modeIndicator[payload.mode] as number, profile.modeBits);
	out.append(payload.chars, profile.charCountBits[payload.mode] as number);
	const { text } = payload;
	if (payload.mode === 'numeric') {
		for (let i = 0; i < text.length; i += 3) {
			const group = text.slice(i, i + 3);
			out.append(Number(group), [0, 4, 7, 10][group.length]!);
		}
	} else if (payload.mode === 'alphanumeric') {
		for (let i = 0; i < text.length; i += 2) {
			const a = ALPHANUMERIC.indexOf(text[i]!);
			if (i + 1 < text.length) out.append(a * 45 + ALPHANUMERIC.indexOf(text[i + 1]!), 11);
			else out.append(a, 6);
		}
	} else if (payload.mode === 'byte') {
		for (let i = 0; i < text.length; i += 1) out.append(text.charCodeAt(i), 8);
	} else {
		for (let i = 0; i < text.length; i += 2) {
			const code = (text.charCodeAt(i) << 8) | text.charCodeAt(i + 1);
			const offset = code - (code < 0xe040 ? 0x8140 : 0xc140);
			out.append((offset >>> 8) * 0xc0 + (offset & 0xff), 13);
		}
	}
}

/**
 * Data codewords for one segment: terminator (cut short if the symbol is
 * nearly full), zero bits to a byte boundary, then the pad bytes 0xEC and
 * 0x11 in turn. A symbol whose data ends on a 4 bit codeword gets no pad byte
 * there; it stays zero, as ISO/IEC 18004 and BWIPP leave it.
 */
export function dataCodewords(
	payload: Payload,
	profile: TestProfile,
	dataCount: number,
	lastBits: 8 | 4,
): Uint8Array {
	const capacity = dataCount * 8 - (lastBits === 4 ? 4 : 0);
	const out = new BitBuffer();
	writePayload(payload, profile, out);
	if (out.length > capacity) throw new Error('the test payload does not fit');
	out.append(0, Math.min(profile.terminatorBits, capacity - out.length));
	// toBytes pads to a byte boundary with zero bits, which is the next step.
	const bytes = new Uint8Array(dataCount);
	bytes.set(out.toBytes());
	const fullBytes = lastBits === 4 ? dataCount - 1 : dataCount;
	let pad = 0;
	for (let i = Math.ceil(out.length / 8); i < fullBytes; i += 1) {
		bytes[i] = pad % 2 === 0 ? 0xec : 0x11;
		pad += 1;
	}
	return bytes;
}

/* ── bwip-js ─────────────────────────────────────────────────────────────── */

export interface BwipOptions {
	readonly bcid: 'microqrcode' | 'rectangularmicroqrcode';
	readonly text: string;
	readonly version: string;
	readonly eclevel: string;
	/** Ours, 0 based. BWIPP numbers Micro QR masks from 1. */
	readonly mask?: number;
}

export function bwipMatrix(options: BwipOptions): BitMatrix {
	const raw = bwipjs.raw({
		bcid: options.bcid,
		text: options.text,
		version: options.version,
		eclevel: options.eclevel,
		fixedeclevel: true,
		binarytext: true,
		// bwip-js ships BWIPP with kanji mode suppressed by default (its copy of
		// barcode.ps does not), which would turn every kanji test into a byte one.
		suppresskanjimode: false,
		...(options.mask === undefined ? {} : { mask: options.mask + 1 }),
	} as unknown as Parameters<typeof bwipjs.raw>[0]) as unknown as {
		pixs: number[];
		pixx: number;
		pixy: number;
	}[];
	const symbol = raw[0]!;
	return new BitMatrix(symbol.pixx, symbol.pixy, Uint8Array.from(symbol.pixs));
}

/* ── zxing-wasm ──────────────────────────────────────────────────────────── */

let prepared = false;

/** Load zxing-cpp from node_modules, never a CDN. */
export function prepareZxing(): void {
	if (prepared) return;
	const require = createRequire(import.meta.url);
	const wasmPath = require.resolve('zxing-wasm/full/zxing_full.wasm');
	const wasmBinary = readFileSync(wasmPath);
	prepareZXingModule({
		overrides: {
			wasmBinary: wasmBinary.buffer.slice(
				wasmBinary.byteOffset,
				wasmBinary.byteOffset + wasmBinary.byteLength,
			),
		},
	});
	prepared = true;
}

/** Structurally an ImageData, which zxing-wasm takes; Node has no ImageData of its own. */
export interface Rgba {
	readonly width: number;
	readonly height: number;
	readonly data: Uint8ClampedArray<ArrayBuffer>;
	readonly colorSpace: 'srgb';
}

/** Dark modules black on white, `scale` pixels each, inside a `quiet` module margin. */
export function drawRgba(matrix: BitMatrix, scale = 4, quiet = 2): Rgba {
	const width = (matrix.width + 2 * quiet) * scale;
	const height = (matrix.height + 2 * quiet) * scale;
	const data = new Uint8ClampedArray(width * height * 4).fill(255);
	for (let y = 0; y < matrix.height; y += 1) {
		for (let x = 0; x < matrix.width; x += 1) {
			if (matrix.get(x, y) === 0) continue;
			for (let dy = 0; dy < scale; dy += 1) {
				for (let dx = 0; dx < scale; dx += 1) {
					const at = (((y + quiet) * scale + dy) * width + (x + quiet) * scale + dx) * 4;
					data[at] = 0;
					data[at + 1] = 0;
					data[at + 2] = 0;
				}
			}
		}
	}
	return { width, height, data, colorSpace: 'srgb' };
}

/**
 * zxing-cpp's reading of a drawn symbol, or undefined.
 *
 * Its detector is tried first, as a camera frame would be read. When that
 * finds nothing, the image is read again as a pure symbol (`isPure`), which
 * skips localisation and samples the grid directly: zxing-cpp's Micro QR
 * locator misses a few valid symbols outright (M2 at mask 01 with some
 * content, zint's own output included), and these images are pure renders,
 * so that is a fair second reading rather than a lowered bar.
 */
export async function zxingRead(
	matrix: BitMatrix,
	format: 'MicroQRCode' | 'RMQRCode',
): Promise<ReadResult | undefined> {
	prepareZxing();
	const image = drawRgba(matrix);
	for (const isPure of [false, true]) {
		const results = await readBarcodes(image, {
			formats: [format],
			tryHarder: true,
			isPure,
			maxNumberOfSymbols: 1,
		});
		const found = results.find((result) => result.isValid);
		if (found !== undefined) return found;
	}
	return undefined;
}

/** A symbol written by zxing-wasm (zint underneath), as a matrix. */
export async function zxingWrite(
	text: string,
	format: 'MicroQRCode' | 'RMQRCode',
	options: string,
): Promise<BitMatrix> {
	prepareZxing();
	const written = await writeBarcode(text, {
		format,
		options,
		scale: 1,
		addQuietZones: false,
	});
	if (!written.symbol || written.error) throw new Error('zxing-wasm wrote nothing');
	const { width, height, data } = written.symbol;
	// One byte per module, 0 for dark.
	return new BitMatrix(
		width,
		height,
		Uint8Array.from(data, (value) => (value === 0 ? 1 : 0)),
	);
}

/** The matrix as rows of 0 and 1, for a readable diff when two disagree. */
export function rows(matrix: BitMatrix): string[] {
	const out: string[] = [];
	for (let y = 0; y < matrix.height; y += 1) {
		let row = '';
		for (let x = 0; x < matrix.width; x += 1) row += matrix.get(x, y);
		out.push(row);
	}
	return out;
}

/** XOR `delta.get(c)` into codeword c of a built symbol, through the modules that carry it. */
export function corrupt(built: BuiltSymbol, delta: ReadonlyMap<number, number>): BitMatrix {
	const out = built.matrix.clone();
	built.layout.dataBits.forEach((bit, module) => {
		if (bit < 0) return;
		const change = delta.get(bit >>> 3);
		if (change !== undefined && ((change >>> (bit & 7)) & 1) === 1) {
			out.data[module] = (out.data[module] as number) ^ 1;
		}
	});
	return out;
}

/* ── messages ────────────────────────────────────────────────────────────── */

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

/** Every string literal under `directory` that starts with `prefix`: the message keys written inline. */
export function keysInSource(directory: string, prefix: string): string[] {
	const found = new Set<string>();
	const pattern = new RegExp(`'(${prefix.replace(/\./g, '\\.')}[a-z0-9.-]+)'`, 'g');
	for (const name of readdirSync(resolve(root, directory))) {
		if (!name.endsWith('.ts')) continue;
		const source = readFileSync(resolve(root, directory, name), 'utf8');
		for (const match of source.matchAll(pattern)) found.add(match[1] as string);
	}
	return [...found].sort();
}

/** Dashes, curly quotes, the marketing register and stray whitespace, by key. */
export function checkRegister(sentences: Readonly<Record<string, string>>): string[] {
	const problems: string[] = [];
	for (const [key, sentence] of Object.entries(sentences)) {
		if (/[\u2013\u2014\u2018\u2019\u201c\u201d]/.test(sentence))
			problems.push(`${key}: a dash or curly quote`);
		if (/\b(unlock|seamless|robust|empower|effortless|leverage)/i.test(sentence)) {
			problems.push(`${key}: marketing register`);
		}
		if (sentence.trim() !== sentence || sentence.length === 0) problems.push(`${key}: whitespace`);
	}
	return problems;
}
