/**
 * Hand-written stand-ins for the slices of the browser the dom layer uses.
 *
 * No jsdom: each fake has only the members the adapters call, as
 * google-auth-secret-retriever's dom tests do it, so a test reads as the
 * exact browser behaviour it pins.
 */

import type { RgbaImage } from '../../src/core/image.js';
import type { CanvasLike, ImageDecodeDeps, ImageLike } from '../../src/dom/types.js';

/** A picture of `width` by `height`: an opaque gradient, so averages are checkable. */
export function pattern(width: number, height: number): RgbaImage {
	const data = new Uint8ClampedArray(width * height * 4);
	for (let y = 0; y < height; y += 1) {
		for (let x = 0; x < width; x += 1) {
			const at = (y * width + x) * 4;
			data[at] = (x * 7) % 256;
			data[at + 1] = (y * 5) % 256;
			data[at + 2] = 128;
			data[at + 3] = 255;
		}
	}
	return { width, height, data };
}

export interface CanvasLog {
	/** Every canvas made, by size. */
	readonly made: [number, number][];
	/** Every draw, by the size drawn to. */
	readonly draws: [number, number][];
	/** Every context asked for, with its options. */
	readonly contexts: ({ readonly willReadFrequently?: boolean } | undefined)[];
}

/** A canvas factory whose canvases draw nothing and read back a pattern of their own size. */
export function fakeCanvas(
	options: {
		readonly picture?: (width: number, height: number) => RgbaImage;
		readonly noContext?: boolean;
	} = {},
): { createCanvas: (width: number, height: number) => CanvasLike; log: CanvasLog } {
	const log: CanvasLog = { made: [], draws: [], contexts: [] };
	const picture = options.picture ?? pattern;
	return {
		log,
		createCanvas(width, height) {
			log.made.push([width, height]);
			const canvas: CanvasLike = {
				width,
				height,
				getContext(_type, contextOptions) {
					log.contexts.push(contextOptions);
					if (options.noContext === true) return null;
					return {
						drawImage(_source: never, _x: number, _y: number, w?: number, h?: number) {
							log.draws.push([w ?? 0, h ?? 0]);
						},
						getImageData(_x: number, _y: number, w: number, h: number) {
							return picture(w, h);
						},
					};
				},
			};
			return canvas;
		},
	};
}

/** A blob of `type` holding `bytes`, which is all the adapters read of one. */
export function blobOf(bytes: Uint8Array | string, type: string, name?: string): Blob {
	const blob = new Blob([typeof bytes === 'string' ? bytes : (bytes as BlobPart)], { type });
	if (name !== undefined) Object.defineProperty(blob, 'name', { value: name });
	return blob;
}

/** Decoding deps for a picture of `width` by `height`, that count what they did. */
export function fakeDecoding(
	width: number,
	height: number,
	options: {
		readonly fail?: boolean;
		readonly noContext?: boolean;
		readonly picture?: (width: number, height: number) => RgbaImage;
	} = {},
): { deps: ImageDecodeDeps; log: CanvasLog; closed: () => number; requested: () => unknown[] } {
	const canvas = fakeCanvas(options);
	let closed = 0;
	const requested: unknown[] = [];
	return {
		log: canvas.log,
		closed: () => closed,
		requested: () => requested,
		deps: {
			createCanvas: canvas.createCanvas,
			createImageBitmap: async (_blob, bitmapOptions): Promise<ImageLike> => {
				requested.push(bitmapOptions);
				if (options.fail === true) throw new Error('This browser cannot decode HEIC');
				return { width, height, close: () => (closed += 1) };
			},
		},
	};
}
