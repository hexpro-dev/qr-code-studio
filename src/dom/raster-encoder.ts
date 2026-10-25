/**
 * JPEG and WebP, through the browser's own encoders.
 *
 * This package writes PNG itself and does not carry a JPEG or WebP encoder,
 * so those two go through a canvas. The trap, lifted with the rest of this
 * from private-image-converter (src/raster/canvas.ts and
 * src/codecs/native/encode.ts): a canvas asked for a type it cannot write
 * does not throw and does not return null, it returns a PNG. Safari has
 * never written WebP and does exactly this, so a person would save
 * `qr-code.webp` that is really a PNG. Every encode here checks the bytes that
 * came back and refuses with 'render/format-unavailable' when they are not
 * what was asked for.
 */

import { QrStudioError } from '../core/errors.js';
import type { RgbaImage } from '../core/image.js';
import { err, ok } from '../core/result.js';
import type { Result } from '../core/result.js';
import type { RasterEncoder } from '../studio/index.js';
import { platformCanvas } from './image.js';

/** A canvas that can be filled with pixels and encoded. */
export interface EncodingCanvas {
	width: number;
	height: number;
	getContext(type: '2d'): { putImageData(data: never, x: number, y: number): void } | null;
	convertToBlob?(options: { type: string; quality?: number }): Promise<Blob>;
	toBlob?(callback: (blob: Blob | null) => void, type: string, quality?: number): void;
}

export interface RasterEncoderDeps {
	readonly createCanvas?: (width: number, height: number) => EncodingCanvas | null;
	/** An ImageData from pixels. Default: the ImageData constructor. */
	readonly createImageData?: (image: RgbaImage) => unknown;
}

const MIME = { jpeg: 'image/jpeg', webp: 'image/webp' } as const;

/** Whether `bytes` begin the way a file of `format` does. */
export function looksLike(bytes: Uint8Array, format: 'jpeg' | 'webp' | 'png'): boolean {
	const starts = (signature: readonly number[], at = 0): boolean =>
		signature.every((byte, i) => bytes[at + i] === byte);
	switch (format) {
		case 'png':
			return starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
		case 'jpeg':
			return starts([0xff, 0xd8, 0xff]);
		case 'webp':
			// RIFF, a length, then WEBP.
			return starts([0x52, 0x49, 0x46, 0x46]) && starts([0x57, 0x45, 0x42, 0x50], 8);
	}
}

/**
 * The image composited onto white. JPEG has no alpha, and a canvas encoder
 * composites onto black without saying so, which turns a transparent ground
 * into a black square round the code.
 */
export function flattenOnWhite(image: RgbaImage): RgbaImage {
	const { data } = image;
	let opaque = true;
	for (let i = 3; i < data.length; i += 4) {
		if (data[i] !== 255) {
			opaque = false;
			break;
		}
	}
	if (opaque) return image;
	const out = new Uint8ClampedArray(data.length);
	for (let i = 0; i < data.length; i += 4) {
		const a = (data[i + 3] as number) / 255;
		out[i] = Math.round((data[i] as number) * a + 255 * (1 - a));
		out[i + 1] = Math.round((data[i + 1] as number) * a + 255 * (1 - a));
		out[i + 2] = Math.round((data[i + 2] as number) * a + 255 * (1 - a));
		out[i + 3] = 255;
	}
	return { width: image.width, height: image.height, data: out };
}

function refused(format: 'jpeg' | 'webp', reason: string): QrStudioError {
	return new QrStudioError(
		'render/format-unavailable',
		'This browser cannot save in that format. Choose PNG or SVG.',
		{ format, reason },
	);
}

function toBlob(
	canvas: EncodingCanvas,
	type: string,
	quality: number | undefined,
): Promise<Blob | null> {
	if (typeof canvas.convertToBlob === 'function') {
		return canvas
			.convertToBlob(quality === undefined ? { type } : { type, quality })
			.catch(() => null);
	}
	if (typeof canvas.toBlob === 'function') {
		const encode = canvas.toBlob.bind(canvas);
		return new Promise((resolve) => encode((blob) => resolve(blob), type, quality));
	}
	return Promise.resolve(null);
}

/* v8 ignore start: the ImageData constructor exists only in a browser; tests pass createImageData. */
function platformImageData(image: RgbaImage): unknown {
	return new ImageData(image.data as Uint8ClampedArray<ArrayBuffer>, image.width, image.height);
}
/* v8 ignore stop */

export function canvasRasterEncoder(deps: RasterEncoderDeps = {}): RasterEncoder {
	const create =
		deps.createCanvas ??
		((width: number, height: number) =>
			platformCanvas(width, height) as unknown as EncodingCanvas | null);
	const imageData = deps.createImageData ?? platformImageData;
	return Object.freeze({
		async encode(
			image: RgbaImage,
			format: 'jpeg' | 'webp',
			options: { readonly quality?: number } = {},
		): Promise<Result<Uint8Array>> {
			const canvas = create(image.width, image.height);
			const context = canvas?.getContext('2d') ?? null;
			if (canvas === null || context === null) return err(refused(format, 'canvas'));
			canvas.width = image.width;
			canvas.height = image.height;
			const pixels = format === 'jpeg' ? flattenOnWhite(image) : image;
			context.putImageData(imageData(pixels) as never, 0, 0);
			const blob = await toBlob(canvas, MIME[format], options.quality);
			if (blob === null) return err(refused(format, 'nothing'));
			const bytes = new Uint8Array(await blob.arrayBuffer());
			// The browser handed back something else, almost always a PNG.
			if (!looksLike(bytes, format)) return err(refused(format, 'substituted'));
			return ok(bytes);
		},
	});
}
