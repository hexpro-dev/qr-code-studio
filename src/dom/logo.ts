/**
 * A person's picture, made into a logo a design can hold.
 *
 * Whatever comes in (a JPEG photograph, a PNG with transparency, a WebP), what
 * goes into the design is a PNG this package encoded, at most 1024 pixels a
 * side and 512 KiB, so any build of the studio in any browser decodes the
 * same pixels from it. The reduction to that size is this package's own area
 * averaging, not the canvas's, so the same file gives the same design
 * everywhere.
 *
 * SVG files are refused for now: drawing one means running it through the
 * browser, which draws it at whatever size it likes and lets it carry script,
 * and a design never passes a person's SVG through to an export. A later
 * milestone reads SVG paths itself.
 *
 * A refusal is an Issue, as everything a view shows beside a control is.
 */

import { issue } from '../core/issue.js';
import type { Issue } from '../core/issue.js';
import type { RgbaImage } from '../core/image.js';
import { err, ok } from '../core/result.js';
import type { Result } from '../core/result.js';
import { base64 } from '../render/base64.js';
import { encodePng } from '../render/png.js';
import { errorKey } from '../studio/keys.js';
import { LOGO_MAX_BYTES, LOGO_MAX_SIDE } from '../studio/logo.js';
import type { DesignAsset } from '../studio/index.js';
import { imageFromBlob } from './image.js';
import { areaAverage, fitWithin } from './resample.js';
import type { ImageDecodeDeps } from './types.js';

/** The issue an SVG logo gets. */
export const SVG_LOGO_LATER = 'design.issue.svg-logo-later';
/** The note when a picture was made smaller to fit. */
export const LOGO_DOWNSCALED = 'dom.issue.logo-downscaled';

/**
 * How large a picture is read before this package's own reduction: four
 * times the logo's area, so the canvas does at most the coarse steps and the
 * last one, which decides the pixels, is the area average.
 */
const READ_PIXELS = 4 * LOGO_MAX_SIDE * LOGO_MAX_SIDE;
/** The smallest a logo is made to fit the byte limit. */
const MIN_SIDE = 16;

export interface LogoImport {
	readonly asset: DesignAsset;
	/** The pixels the asset's PNG decodes to. */
	readonly image: RgbaImage;
	readonly issues: readonly Issue[];
}

/** True when the first bytes look like markup rather than a picture: an SVG with no type on it. */
function looksLikeMarkup(bytes: Uint8Array): boolean {
	let at = 0;
	// A UTF-8 byte order mark, then white space.
	if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) at = 3;
	while (
		at < bytes.length &&
		(bytes[at] === 0x20 || bytes[at] === 0x09 || bytes[at] === 0x0a || bytes[at] === 0x0d)
	) {
		at += 1;
	}
	return bytes[at] === 0x3c;
}

async function isSvg(blob: Blob): Promise<boolean> {
	if (blob.type === 'image/svg+xml') return true;
	const name = (blob as Blob & { readonly name?: unknown }).name;
	if (typeof name === 'string' && /\.svgz?$/i.test(name)) return true;
	try {
		return looksLikeMarkup(new Uint8Array(await blob.slice(0, 64).arrayBuffer()));
	} catch {
		return false;
	}
}

export async function importLogo(
	blob: Blob,
	options: { readonly deps?: ImageDecodeDeps } = {},
): Promise<Result<LogoImport, Issue>> {
	if (await isSvg(blob)) return err(issue(SVG_LOGO_LATER, ['logo'], 'error'));
	const read = await imageFromBlob(blob, {
		maxPixels: READ_PIXELS,
		...(options.deps === undefined ? {} : { deps: options.deps }),
	});
	if (!read.ok) return err(issue(errorKey(read.error), ['logo'], 'error', read.error.params));
	const source = read.value;
	let [width, height] = fitWithin(source.width, source.height, LOGO_MAX_SIDE);
	let image = areaAverage(source, width, height);
	let png = encodePng(image, { level: 9 });
	// A photograph at 1024 pixels can be more than the design allows. A PNG's
	// size goes about with its area, so the next try is the side that should
	// fit with a little to spare, rather than a walk down in small steps that
	// would encode a megapixel picture over and over. Each try starts from the
	// source, so nothing is averaged twice.
	while (png.length > LOGO_MAX_BYTES && Math.max(width, height) > MIN_SIDE) {
		const longest = Math.max(width, height);
		const scale = Math.sqrt(LOGO_MAX_BYTES / png.length) * 0.95;
		const side = Math.max(MIN_SIDE, Math.min(longest - 1, Math.floor(longest * scale)));
		[width, height] = fitWithin(width, height, side);
		image = areaAverage(source, width, height);
		png = encodePng(image, { level: 9 });
	}
	const issues: Issue[] = [];
	if (width !== source.width || height !== source.height) {
		issues.push(issue(LOGO_DOWNSCALED, ['logo'], 'info', { width, height }));
	}
	return ok(
		Object.freeze({
			asset: Object.freeze({ png: base64(png), width, height }),
			image,
			issues: Object.freeze(issues),
		}),
	);
}
