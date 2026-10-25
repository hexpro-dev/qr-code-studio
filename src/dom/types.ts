/**
 * The slices of the browser the adapters use, written as interfaces so a
 * test can hand in a fake with no more than these members.
 *
 * Every adapter takes its browser objects as an injected dependency bag and
 * falls back to the real globals only when a member is missing, and only at
 * the moment it is called. Nothing here reads a global at import, which is
 * what lets hex-web render the studio on a server, and lets this whole layer
 * be exercised in Node with hand-written fakes (the pattern
 * google-auth-secret-retriever's src/dom set).
 */

import type { RgbaImage } from '../core/image.js';

/** The part of a canvas this code uses. */
export interface CanvasLike {
	width: number;
	height: number;
	getContext(
		type: '2d',
		options?: { readonly willReadFrequently?: boolean },
	): CanvasContextLike | null;
}

/** The part of a 2D context this code uses. */
export interface CanvasContextLike {
	drawImage(source: never, x: number, y: number, width?: number, height?: number): void;
	getImageData(x: number, y: number, width: number, height: number): RgbaImage;
	putImageData?(data: never, x: number, y: number): void;
	/**
	 * Set on every context these adapters draw through. Optional so a fake
	 * need not carry them. A real browser's default is 'low', which in Chrome
	 * is one bilinear tap a pixel whatever the ratio, and aliases a module
	 * grid when a photograph is reduced.
	 */
	imageSmoothingEnabled?: boolean;
	imageSmoothingQuality?: 'low' | 'medium' | 'high';
}

/** Anything with a size that `drawImage` takes: a bitmap, an image element, a canvas. */
export interface ImageLike {
	readonly width: number;
	readonly height: number;
	close?(): void;
}

export interface ImageDecodeDeps {
	readonly createImageBitmap?: (
		source: Blob,
		options?: { readonly imageOrientation?: 'from-image' | 'none' | 'flipY' },
	) => Promise<ImageLike>;
	readonly createCanvas?: (width: number, height: number) => CanvasLike;
	/** For a browser with no createImageBitmap: an image element loaded from the blob. */
	readonly loadImageElement?: (blob: Blob) => Promise<ImageLike>;
}

/** What `imageFromVideo` reads a frame from. */
export interface VideoFrameSource {
	readonly videoWidth: number;
	readonly videoHeight: number;
}
