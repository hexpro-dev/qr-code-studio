/**
 * Putting a picture in the middle of the code.
 *
 * A picture logo is two changes to a design, the embedded image and the logo
 * that names it, and they have to land together: the validator drops an
 * image nothing uses, and refuses a logo that names an image the design does
 * not hold. So the studio takes them as one `design/patch` with both, and
 * this builds it. The dom layer's `importLogo` makes the asset.
 */

import { LIMITS } from '../design/document.js';
import type { DesignAsset, DesignLogo, QrDesignV1 } from '../design/types.js';
import type { DesignPatch } from './seams.js';

/** The id a picture logo is stored under. One logo per design, so one id. */
export const LOGO_ASSET_ID = 'logo';

/** The largest logo picture a design holds, in pixels a side, as the validator allows. */
export const LOGO_MAX_SIDE = LIMITS.assetSide;
/** The most bytes of PNG a logo picture may be, as the validator allows. */
export const LOGO_MAX_BYTES = LIMITS.assetBytes;

/** Where a new logo starts: a fifth of the symbol across, a module of clear space round it. */
const DEFAULT_LOGO: Omit<DesignLogo, 'source'> = Object.freeze({
	size: 0.2,
	clear: 'box',
	padding: 1,
	plate: null,
});

/**
 * The patches that put `asset` in as the design's logo, keeping the size,
 * clearing and plate of a logo it already has.
 */
export function logoPatches(design: QrDesignV1, asset: DesignAsset): readonly DesignPatch[] {
	const current = design.logo;
	const logo: DesignLogo = {
		size: current?.size ?? DEFAULT_LOGO.size,
		clear: current?.clear ?? DEFAULT_LOGO.clear,
		padding: current?.padding ?? DEFAULT_LOGO.padding,
		plate: current?.plate ?? DEFAULT_LOGO.plate,
		source: { kind: 'asset', id: LOGO_ASSET_ID },
	};
	return Object.freeze([
		{ path: ['assets', LOGO_ASSET_ID], value: asset },
		{ path: ['logo'], value: logo },
	]);
}

/** The patches that take the logo out, picture and all. */
export function removeLogoPatches(design: QrDesignV1): readonly DesignPatch[] {
	const patches: DesignPatch[] = [{ path: ['logo'], value: null }];
	if (design.assets !== undefined) patches.push({ path: ['assets'], value: undefined });
	return Object.freeze(patches);
}
