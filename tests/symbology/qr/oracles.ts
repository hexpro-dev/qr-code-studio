/**
 * The independent encoders and readers the QR tests compare against, behind
 * one shape each.
 *
 * - `qrcode` 1.5.4: segments given explicitly, mask forced. The broadest
 *   oracle, and fast enough to run at every version, level and mask.
 * - `qrcode-generator`: an older, separate implementation. It always picks
 *   its own mask, so its matrix is compared with ours at the mask it chose,
 *   read back from its format information.
 * - bwip-js (BWIPP, PostScript run in JavaScript): mask forced (BWIPP numbers
 *   masks 1 to 8). It optimises modes itself and offers no way to force one,
 *   so it is fed only content whose optimal segmentation is a single segment
 *   in an obvious mode. It does not choose kanji mode from Shift_JIS bytes,
 *   so kanji is compared with the other two only.
 * - zxing-wasm (zxing-cpp), loaded from node_modules, never a CDN: a reader,
 *   fed our matrices drawn as pixels.
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import bwipjs from 'bwip-js';
import QRCode from 'qrcode';
import qrcodeGenerator from 'qrcode-generator';
import type { ReadResult } from 'zxing-wasm/reader';
import { prepareZXingModule, readBarcodes } from 'zxing-wasm/reader';
import { BitMatrix } from '../../../src/core/bit-matrix.js';
import type { RgbaImage } from '../../../src/core/image.js';
import { dataCodewords } from '../../../src/encode/bitstream.js';
import { qrProfile } from '../../../src/segment/profile.js';
import type { EcLevel, Mode, Segment } from '../../../src/segment/types.js';
import { dataBitLength } from '../../../src/segment/write.js';
import { qrBlocks } from '../../../src/symbology/qr/blocks.js';
import type { Seeded } from '../../core/helpers.js';

const require = createRequire(import.meta.url);
export const iconv = require('iconv-lite') as {
	encode(text: string, encoding: string): Buffer;
	decode(bytes: Buffer, encoding: string): string;
};

/** A payload whose optimal segmentation is one segment in `mode`. */
export interface Payload {
	readonly mode: Mode;
	readonly text: string;
}

/** Kanji the eligible table holds, from rows 16 onwards (level 1 kanji). */
const KANJI =
	'亜唖娃阿哀愛挨姶逢葵茜穐悪握渥旭葦芦鯵梓圧斡扱宛姐虻飴絢綾鮎或粟袷安庵按暗案闇鞍杏以伊位依偉囲夷委威尉惟意';

/** Content that is one segment in its mode at its best: digits, capitals, lower case, kanji. */
export function payload(random: Seeded, mode: Mode, chars: number): Payload {
	let text = '';
	for (let i = 0; i < chars; i += 1) {
		if (mode === 'numeric') text += String.fromCharCode(0x30 + random.int(10));
		else if (mode === 'alphanumeric') text += String.fromCharCode(0x41 + random.int(26));
		else if (mode === 'byte') text += String.fromCharCode(0x61 + random.int(26));
		else text += KANJI[random.int(KANJI.length)];
	}
	return { mode, text };
}

/** The most characters a single `mode` segment can hold at a version and level. */
export function capacity(mode: Mode, version: number, level: EcLevel): number {
	const profile = qrProfile(version);
	const room = qrBlocks(version, level).dataBits - 4 - profile.charCountBits(mode);
	let chars = 0;
	while (dataBitLength(mode, chars + 1) <= room) chars += 1;
	return chars;
}

/** The single segment, built by hand so no optimiser is involved on our side either. */
export function segment(p: Payload): Segment {
	if (p.mode === 'kanji') {
		const data = Uint8Array.from(iconv.encode(p.text, 'shift_jis'));
		return { mode: 'kanji', chars: data.length / 2, data };
	}
	const data = Uint8Array.from([...p.text].map((c) => c.charCodeAt(0)));
	return { mode: p.mode, chars: data.length, data };
}

/** Our data codewords for a payload as one segment. */
export function ourData(p: Payload, version: number, level: EcLevel): Uint8Array {
	return dataCodewords([segment(p)], {}, qrProfile(version), qrBlocks(version, level));
}

const toSjis = (char: string): number => iconv.encode(char, 'shift_jis').readUInt16BE(0);

export function qrcodeMatrix(
	p: Payload,
	version: number,
	level: EcLevel,
	mask?: number,
): { modules: Uint8Array; mask: number } {
	const options = {
		version,
		errorCorrectionLevel: level,
		toSJISFunc: toSjis,
		...(mask === undefined ? {} : { maskPattern: mask as 0 }),
	};
	const segments =
		p.mode === 'numeric'
			? [{ data: p.text, mode: 'numeric' as const }]
			: p.mode === 'alphanumeric'
				? [{ data: p.text, mode: 'alphanumeric' as const }]
				: p.mode === 'byte'
					? [
							{
								data: Uint8Array.from([...p.text].map((c) => c.charCodeAt(0))),
								mode: 'byte' as const,
							},
						]
					: [{ data: p.text, mode: 'kanji' as const }];
	const symbol = QRCode.create(segments, options);
	return { modules: Uint8Array.from(symbol.modules.data), mask: symbol.maskPattern as number };
}

/** qrcode's own per-rule penalty scores, for comparing scorers. */
export const qrcodePenalty = require('qrcode/lib/core/mask-pattern') as {
	getPenaltyN1(data: unknown): number;
	getPenaltyN2(data: unknown): number;
	getPenaltyN3(data: unknown): number;
	getPenaltyN4(data: unknown): number;
};
const QrcodeBitMatrix = require('qrcode/lib/core/bit-matrix') as new (size: number) => {
	data: Uint8Array;
	size: number;
};

/** A matrix in the shape qrcode's penalty functions read. */
export function qrcodeShaped(modules: Uint8Array, size: number): unknown {
	const matrix = new QrcodeBitMatrix(size);
	matrix.data.set(modules);
	return matrix;
}

const MODE_NAMES: Record<Mode, 'Numeric' | 'Alphanumeric' | 'Byte' | 'Kanji'> = {
	numeric: 'Numeric',
	alphanumeric: 'Alphanumeric',
	byte: 'Byte',
	kanji: 'Kanji',
};

export function qrcodeGeneratorMatrix(p: Payload, version: number, level: EcLevel): Uint8Array {
	// Its ES build reads both byte and kanji data through this one function.
	qrcodeGenerator.stringToBytes =
		p.mode === 'kanji'
			? (s: string) => [...iconv.encode(s, 'shift_jis')]
			: (s: string) => [...s].map((c) => c.charCodeAt(0) & 0xff);
	const code = qrcodeGenerator(version as 1, level);
	code.addData(p.text, MODE_NAMES[p.mode]);
	code.make();
	const size = code.getModuleCount();
	const modules = new Uint8Array(size * size);
	for (let y = 0; y < size; y += 1) {
		for (let x = 0; x < size; x += 1) modules[y * size + x] = code.isDark(y, x) ? 1 : 0;
	}
	return modules;
}

export function bwipMatrix(
	text: string,
	version: number,
	level: EcLevel,
	mask: number,
	options: Record<string, unknown> = {},
): BitMatrix {
	const raw = bwipjs.raw('qrcode', text, {
		eclevel: level,
		version: String(version),
		mask: mask + 1,
		// BWIPP otherwise raises the level when the data leaves room.
		fixedeclevel: true,
		binarytext: true,
		...options,
	} as never) as { pixs: number[]; pixx: number; pixy: number }[];
	const [first] = raw;
	if (first === undefined) throw new Error('bwip-js drew nothing');
	return new BitMatrix(first.pixx, first.pixy, Uint8Array.from(first.pixs));
}

/** A bwip-js symbol at its own choice of version and mask. */
export function bwipAuto(text: string, options: Record<string, unknown> = {}): BitMatrix {
	const raw = bwipjs.raw('qrcode', text, {
		binarytext: true,
		fixedeclevel: true,
		...options,
	} as never) as {
		pixs: number[];
		pixx: number;
		pixy: number;
	}[];
	const [first] = raw;
	if (first === undefined) throw new Error('bwip-js drew nothing');
	return new BitMatrix(first.pixx, first.pixy, Uint8Array.from(first.pixs));
}

/** A matrix drawn as black and white RGBA, `scale` pixels a module, with a quiet zone. */
export function draw(matrix: BitMatrix, scale = 4, quiet = 4): RgbaImage {
	const width = (matrix.width + 2 * quiet) * scale;
	const height = (matrix.height + 2 * quiet) * scale;
	const data = new Uint8ClampedArray(width * height * 4).fill(255);
	for (let y = 0; y < matrix.height; y += 1) {
		for (let x = 0; x < matrix.width; x += 1) {
			if (!matrix.get(x, y)) continue;
			for (let dy = 0; dy < scale; dy += 1) {
				const row = ((y + quiet) * scale + dy) * width;
				for (let dx = 0; dx < scale; dx += 1) {
					const at = (row + (x + quiet) * scale + dx) * 4;
					data[at] = 0;
					data[at + 1] = 0;
					data[at + 2] = 0;
				}
			}
		}
	}
	return { width, height, data };
}

let prepared = false;

/** zxing-cpp's reader on an image, with the wasm loaded from node_modules. */
export async function zxingRead(image: RgbaImage): Promise<ReadResult[]> {
	if (!prepared) {
		const wasm = readFileSync(require.resolve('zxing-wasm/reader/zxing_reader.wasm'));
		prepareZXingModule({
			overrides: {
				wasmBinary: wasm.buffer.slice(
					wasm.byteOffset,
					wasm.byteOffset + wasm.byteLength,
				) as ArrayBuffer,
			},
			fireImmediately: true,
		});
		prepared = true;
	}
	return readBarcodes(image as unknown as ImageData, {
		formats: ['QRCode'],
		tryHarder: false,
		tryRotate: false,
		tryInvert: false,
		tryDownscale: false,
		isPure: true,
		textMode: 'Plain',
		characterSet: 'Unknown',
	});
}
