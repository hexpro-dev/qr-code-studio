/**
 * Small things the design tests share.
 */

import type { RgbaImage } from '../../src/core/image.js';
import { base64Encode } from '../../src/design/base64.js';
import { defaultDesign } from '../../src/design/document.js';
import type { DesignAsset, QrDesignV1 } from '../../src/design/types.js';
import { encodePng } from '../../src/render/png.js';
import { rasterise } from '../../src/render/raster.js';
import type { Scene } from '../../src/render/types.js';

/** A design with some of its parts replaced. */
export function designWith(patch: Partial<QrDesignV1>): QrDesignV1 {
	return { ...defaultDesign(), ...patch };
}

/** A small picture: a dark disc on a transparent square, `size` pixels across. */
export function discImage(
	size = 16,
	colour: readonly [number, number, number] = [20, 40, 90],
): RgbaImage {
	const data = new Uint8ClampedArray(size * size * 4);
	const r = size / 2;
	for (let y = 0; y < size; y += 1) {
		for (let x = 0; x < size; x += 1) {
			const dx = x + 0.5 - r;
			const dy = y + 0.5 - r;
			if (dx * dx + dy * dy <= r * r * 0.81) {
				const at = (y * size + x) * 4;
				data[at] = colour[0];
				data[at + 1] = colour[1];
				data[at + 2] = colour[2];
				data[at + 3] = 255;
			}
		}
	}
	return { width: size, height: size, data };
}

/** A picture as a design asset. */
export function assetOf(image: RgbaImage): DesignAsset {
	return { png: base64Encode(encodePng(image)), width: image.width, height: image.height };
}

/** A scene drawn at `perModule` pixels a module. */
export function draw(scene: Scene, perModule = 8): RgbaImage {
	return rasterise(scene, { width: Math.round(scene.width * perModule) });
}
