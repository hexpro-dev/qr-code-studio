/**
 * Shared set-up for the inspect tests: registries, and codes drawn by this
 * package's own renderer, since there are no binary fixtures.
 */

import type { RgbaImage } from '../../src/core/image.js';
import { defaultDesign } from '../../src/design/document.js';
import { createDesignRegistries } from '../../src/design/registries.js';
import { buildScene } from '../../src/design/scene.js';
import type { QrDesignV1 } from '../../src/design/types.js';
import type { InspectRegistries } from '../../src/inspect/types.js';
import { createPayloadRegistry } from '../../src/payload/registry.js';
import { rasterise } from '../../src/render/raster.js';
import { createSymbologyRegistry } from '../../src/symbology/registry.js';
import type { BuiltSymbol } from '../../src/symbology/types.js';

export const registries: InspectRegistries = {
	symbologies: createSymbologyRegistry(),
	payloads: createPayloadRegistry(),
};

const designs = createDesignRegistries();

/** A symbol drawn plainly at `perModule` pixels a module. */
export function draw(
	symbol: BuiltSymbol,
	perModule = 4,
	design: QrDesignV1 = defaultDesign(),
): RgbaImage {
	const quiet = symbol.symbology === 'qr' ? 4 : 2;
	const scene = buildScene(symbol, { ...design, quietZone: quiet }, { registries: designs }).scene;
	return rasterise(scene, { width: Math.round(scene.width * perModule) });
}

/** Pictures side by side on white, in the order given. */
export function sideBySide(images: readonly RgbaImage[]): RgbaImage {
	const width = images.reduce((sum, image) => sum + image.width, 0);
	const height = Math.max(...images.map((image) => image.height));
	const data = new Uint8ClampedArray(width * height * 4).fill(255);
	let left = 0;
	for (const image of images) {
		for (let y = 0; y < image.height; y += 1) {
			data.set(
				image.data.subarray(y * image.width * 4, (y + 1) * image.width * 4),
				(y * width + left) * 4,
			);
		}
		left += image.width;
	}
	return { width, height, data };
}
