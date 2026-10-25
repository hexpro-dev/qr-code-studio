/**
 * The design document's defaults and limits.
 *
 * A design is plain JSON so it can be saved, put in a link and read by a
 * person, and it never holds the content of the code: one design is reused
 * across many codes, and a link to it must be safe to share. The limits below
 * are what the validator and the link codec enforce; each is far past any
 * design a person would make, and each keeps a hostile file from costing more
 * than a moment to refuse.
 */

import type { QrDesignV1 } from './types.js';

/** The design schema version this build writes and reads. */
export const DESIGN_VERSION = 1;

/** The quiet zone each built-in symbology needs at the least, in modules. */
export const MIN_QUIET_ZONE: Readonly<Record<string, number>> = Object.freeze({
	qr: 4,
	micro: 2,
	rmqr: 2,
});

export const LIMITS = Object.freeze({
	/** The widest quiet zone a design may ask for, in modules. */
	quietZone: 20,
	/** Stops in one gradient. */
	stops: 16,
	/** Embedded images in one design. */
	assets: 4,
	/** Bytes of PNG per embedded image, decoded from its base64. */
	assetBytes: 512 * 1024,
	/** Pixels on either side of an embedded image. */
	assetSide: 1024,
	/** Characters in a design's name. */
	name: 80,
	/** Characters in a frame caption, whatever the frame allows. */
	caption: 200,
	/** Printed size, in millimetres. */
	sizeMm: { min: 5, max: 2000 },
	dpi: { min: 72, max: 2400 },
	/** The logo's width as a fraction of the symbol's. */
	logoSize: { min: 0.05, max: 0.4 },
	/** Clear space round the logo, in modules. */
	logoPadding: { min: 0, max: 4 },
	/** Gradient centres, as fractions of the box, and the radial radius. */
	centre: { min: -1, max: 2 },
	radius: { min: 0.01, max: 4 },
	/** How deep a design file may nest before it is refused unread. */
	depth: 32,
});

/** Classic black on white: square modules, square finders, quiet zone 4, error correction M. */
export function defaultDesign(): QrDesignV1 {
	return {
		schema: 'qr-design',
		version: 1,
		symbol: { symbology: 'qr', ecLevel: 'M' },
		quietZone: 4,
		background: { kind: 'solid', ink: '#ffffff' },
		modules: {
			shape: { id: 'square' },
			paint: { kind: 'solid', ink: '#000000' },
			light: null,
		},
		regions: {},
		logo: null,
		frame: null,
		output: { colourSpace: 'srgb' },
	};
}
