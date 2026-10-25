/**
 * The independent readers designs are checked against: zxing-cpp through
 * zxing-wasm, loaded from node_modules and never a CDN, and jsQR. Neither
 * knows anything about this package, so a design they both read is one a
 * phone camera has a fair chance with.
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import jsqrModule from 'jsqr';
import { prepareZXingModule, readBarcodes } from 'zxing-wasm/reader';
import type { RgbaImage } from '../../src/core/image.js';

/**
 * jsQR is a CommonJS bundle whose types declare an ES default export.
 * Depending on the loader the default import is the function itself or the
 * module object holding it, so take whichever is callable.
 */
type JsQr = typeof import('jsqr').default;
const jsQR: JsQr =
	typeof jsqrModule === 'function'
		? (jsqrModule as unknown as JsQr)
		: (jsqrModule as unknown as { default: JsQr }).default;

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

export type ZxingFormat = 'QRCode' | 'MicroQRCode' | 'rMQRCode';

/** Every text zxing-cpp reads, valid results only. */
export async function zxingTexts(
	image: RgbaImage,
	format: ZxingFormat = 'QRCode',
): Promise<string[]> {
	prepareZxing();
	const results = await readBarcodes(
		{
			width: image.width,
			height: image.height,
			data: image.data as Uint8ClampedArray<ArrayBuffer>,
			colorSpace: 'srgb',
		},
		{ formats: [format], maxNumberOfSymbols: 4 },
	);
	return results.filter((result) => result.isValid).map((result) => result.text);
}

/**
 * jsQR's reading in the design's own polarity only. The option is passed
 * every time: jsQR merges options into a shared defaults object, so one call
 * with another value would change every later call.
 */
export function jsqrText(image: RgbaImage): string | undefined {
	const found = jsQR(image.data, image.width, image.height, { inversionAttempts: 'dontInvert' });
	return found === null ? undefined : found.data;
}
