/**
 * A design's embedded pictures, decoded once.
 *
 * A design carries its logo as base64 PNG so it can be saved and opened
 * anywhere, and the scene builder wants pixels. Decoding a 1024 pixel logo on
 * every keystroke would be most of the cost of a preview, so each picture is
 * decoded the first time it is drawn and kept, keyed by its own text: the
 * same picture in two designs, or in a design and its undo step, is decoded
 * once. The cache holds a few pictures, since a design holds at most four.
 */

import type { RgbaImage } from '../core/image.js';
import { base64Decode } from '../design/base64.js';
import { LIMITS } from '../design/document.js';
import type { QrDesignV1 } from '../design/types.js';
import { decodePng } from '../render/png-decode.js';

const KEEP = 8;

export class AssetCache {
	private readonly decoded = new Map<string, RgbaImage | null>();

	/** The picture behind `png`, or null when it will not decode. */
	image(png: string): RgbaImage | null {
		if (this.decoded.has(png)) {
			const found = this.decoded.get(png) as RgbaImage | null;
			// Moved to the end, so the cache forgets the least recently drawn.
			this.decoded.delete(png);
			this.decoded.set(png, found);
			return found;
		}
		let image: RgbaImage | null = null;
		const bytes = base64Decode(png);
		if (bytes !== null) {
			try {
				image = decodePng(bytes, { maxPixels: LIMITS.assetSide * LIMITS.assetSide });
			} catch {
				// The validator checked the signature and the size; a picture
				// damaged past that is drawn as missing, and the scene says so.
				image = null;
			}
		}
		this.decoded.set(png, image);
		while (this.decoded.size > KEEP) {
			const oldest = this.decoded.keys().next().value as string;
			this.decoded.delete(oldest);
		}
		return image;
	}

	/** The lookup buildScene takes, for one design. */
	lookup(design: QrDesignV1): (id: string) => RgbaImage | undefined {
		return (id) => {
			const asset = design.assets?.[id];
			return asset === undefined ? undefined : (this.image(asset.png) ?? undefined);
		};
	}

	/** Every picture a design embeds, decoded, for a verify job a worker can rebuild from. */
	all(design: QrDesignV1): Readonly<Record<string, RgbaImage>> | undefined {
		const assets = design.assets;
		if (assets === undefined) return undefined;
		const out: Record<string, RgbaImage> = {};
		for (const [id, asset] of Object.entries(assets)) {
			const image = this.image(asset.png);
			if (image !== null) out[id] = image;
		}
		return out;
	}
}
