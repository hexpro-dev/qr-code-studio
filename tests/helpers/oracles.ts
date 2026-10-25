/**
 * Independent encoders and readers, so the reader is never checked against
 * itself.
 *
 * Three encoders make the matrices (`qrcode`, `qrcode-generator`, bwip-js),
 * and two readers judge the pictures: zxing-cpp through zxing-wasm, loaded
 * from node_modules and never a CDN, and jsQR. Between them they stand for the
 * phone readers the strict profile has to be at least as hard as.
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import bwipjs from 'bwip-js';
import jsqrModule from 'jsqr';
import QRCode from 'qrcode';
import qrcodeGenerator from 'qrcode-generator';
import { prepareZXingModule, readBarcodes } from 'zxing-wasm/reader';
import { BitMatrix } from '../../src/core/bit-matrix.js';
import type { RgbaImage } from '../../src/core/image.js';

export type EcLevel = 'L' | 'M' | 'Q' | 'H';

/* Encoders. */

/** A QR symbol from the `qrcode` package, the most used JavaScript encoder. */
export function qrcodeMatrix(
	text: string,
	options: { ecLevel?: EcLevel; version?: number; mask?: number } = {},
): BitMatrix {
	const symbol = QRCode.create(text, {
		errorCorrectionLevel: options.ecLevel ?? 'M',
		...(options.version === undefined ? {} : { version: options.version }),
		...(options.mask === undefined
			? {}
			: { maskPattern: options.mask as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 }),
	});
	const { size, data } = symbol.modules;
	// `data` is row major, row * size + column, one byte a module, as ours is.
	return new BitMatrix(
		size,
		size,
		Uint8Array.from(data, (value) => (value ? 1 : 0)),
	);
}

/** A QR symbol from Kazuhiko Arase's `qrcode-generator`. */
export function generatorMatrix(text: string, ecLevel: EcLevel = 'M', version = 0): BitMatrix {
	const qr = qrcodeGenerator(version as 0, ecLevel);
	qr.addData(text, 'Byte');
	qr.make();
	const size = qr.getModuleCount();
	const out = new BitMatrix(size, size);
	for (let y = 0; y < size; y += 1) {
		for (let x = 0; x < size; x += 1) if (qr.isDark(y, x)) out.set(x, y, true);
	}
	return out;
}

/** A QR symbol from bwip-js (BWIPP underneath). */
export function bwipMatrix(text: string, ecLevel: EcLevel = 'M'): BitMatrix {
	const raw = bwipjs.raw({ bcid: 'qrcode', text, eclevel: ecLevel } as unknown as Parameters<
		typeof bwipjs.raw
	>[0]) as unknown as { pixs: number[]; pixx: number; pixy: number }[];
	const symbol = raw[0] as { pixs: number[]; pixx: number; pixy: number };
	return new BitMatrix(symbol.pixx, symbol.pixy, Uint8Array.from(symbol.pixs));
}

/* Readers. */

/**
 * jsQR is CommonJS with an ES default export compiled in, so under NodeNext the
 * default import is the module object and the function is its `default`;
 * vitest's interop hands over the function itself. Either way, this is it.
 */
const jsQR = ((jsqrModule as unknown as { default?: unknown }).default ??
	jsqrModule) as typeof jsqrModule.default;

let prepared = false;

function prepareZxing(): void {
	if (prepared) return;
	const require = createRequire(import.meta.url);
	const bytes = readFileSync(require.resolve('zxing-wasm/reader/zxing_reader.wasm'));
	prepareZXingModule({
		overrides: {
			wasmBinary: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
		},
	});
	prepared = true;
}

function imageData(image: RgbaImage) {
	return {
		width: image.width,
		height: image.height,
		data: image.data as Uint8ClampedArray<ArrayBuffer>,
		colorSpace: 'srgb' as const,
	};
}

/**
 * Every QR text zxing-cpp reads from a picture, in its default effort: try
 * harder, rotations, inversion and downscaling all on, as a phone app that is
 * trying would have them.
 */
export async function zxingTexts(image: RgbaImage): Promise<string[]> {
	prepareZxing();
	const results = await readBarcodes(imageData(image), {
		formats: ['QRCode'],
		maxNumberOfSymbols: 8,
	});
	return results.filter((result) => result.isValid).map((result) => result.text);
}

/**
 * jsQR's reading, both polarities as its default tries them. The option is
 * passed every time: jsQR merges options into its shared defaults object, so
 * one call with another value would change every later call.
 */
export function jsqrText(image: RgbaImage): string | undefined {
	const found = jsQR(image.data, image.width, image.height, { inversionAttempts: 'attemptBoth' });
	return found === null ? undefined : found.data;
}
