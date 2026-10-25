/**
 * The pixel container every layer shares.
 *
 * Structurally an `ImageData`, so a canvas read-back passes straight in and a
 * result can be handed to `putImageData` without copying. It lives here rather
 * than in render or decode because each of those needs it and neither may
 * import the other.
 *
 * Rows run top to bottom, four bytes a pixel, red first, and the alpha is
 * straight rather than premultiplied, which is what both `ImageData` and PNG
 * use.
 */
export interface RgbaImage {
	readonly width: number;
	readonly height: number;
	readonly data: Uint8ClampedArray;
}
