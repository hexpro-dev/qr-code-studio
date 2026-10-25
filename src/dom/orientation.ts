/**
 * Which way up a JPEG is meant to be shown, from its Exif data.
 *
 * A phone stores a photograph the way the sensor saw it and writes the
 * rotation into the Exif Orientation tag (CIPA DC-008, tag 0x0112). Current
 * browsers apply it when they decode (`imageOrientation: 'from-image'` is
 * createImageBitmap's default), and some older ones do not. The ones that do
 * not are found by the picture's size: a quarter turn swaps width and height,
 * so a bitmap that comes back the size the JPEG's frame header gives, when
 * the tag says a quarter turn, was not turned, and `applyOrientation` turns
 * it. The flips and the half turn keep the size and cannot be told apart that
 * way; every engine that decodes them ignoring the tag is past its support.
 *
 * Read only from the first 64 KiB, where the Exif segment has to be.
 */

import type { RgbaImage } from '../core/image.js';

export interface JpegFacts {
	/** 1 to 8; 1 is as stored. */
	readonly orientation: number;
	/** The frame header's size, as stored, before any rotation. */
	readonly width: number;
	readonly height: number;
}

/** How much of a file the Exif segment and the frame header are looked for in. */
export const ORIENTATION_BYTES = 65536;

function u16(bytes: Uint8Array, at: number, little: boolean): number {
	const a = bytes[at] as number;
	const b = bytes[at + 1] as number;
	return little ? a | (b << 8) : (a << 8) | b;
}

function u32(bytes: Uint8Array, at: number, little: boolean): number {
	return little
		? (u16(bytes, at, true) | (u16(bytes, at + 2, true) << 16)) >>> 0
		: ((u16(bytes, at, false) << 16) | u16(bytes, at + 2, false)) >>> 0;
}

/** The Orientation tag in a TIFF block (the body of an Exif segment), or 1. */
function tiffOrientation(bytes: Uint8Array, start: number, end: number): number {
	if (end - start < 8) return 1;
	const order = u16(bytes, start, false);
	if (order !== 0x4949 && order !== 0x4d4d) return 1;
	const little = order === 0x4949;
	if (u16(bytes, start + 2, little) !== 42) return 1;
	const ifd = start + u32(bytes, start + 4, little);
	if (ifd + 2 > end) return 1;
	const count = u16(bytes, ifd, little);
	for (let i = 0; i < count; i += 1) {
		const entry = ifd + 2 + i * 12;
		if (entry + 12 > end) return 1;
		if (u16(bytes, entry, little) === 0x0112) {
			const value = u16(bytes, entry + 8, little);
			return value >= 1 && value <= 8 ? value : 1;
		}
	}
	return 1;
}

/** A start-of-frame marker: C0 to CF, less DHT (C4), JPG (C8) and DAC (CC). */
function isFrame(marker: number): boolean {
	return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
}

/** The orientation and stored size of a JPEG, or null when the bytes are not one this reads. */
export function jpegFacts(bytes: Uint8Array): JpegFacts | null {
	if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
	let orientation = 1;
	let at = 2;
	const end = Math.min(bytes.length, ORIENTATION_BYTES);
	while (at + 4 <= end) {
		if (bytes[at] !== 0xff) return null;
		const marker = bytes[at + 1] as number;
		// Fill bytes before a marker.
		if (marker === 0xff) {
			at += 1;
			continue;
		}
		const length = u16(bytes, at + 2, false);
		if (length < 2) return null;
		const body = at + 4;
		if (marker === 0xe1 && body + 6 <= end) {
			const exif =
				bytes[body] === 0x45 &&
				bytes[body + 1] === 0x78 &&
				bytes[body + 2] === 0x69 &&
				bytes[body + 3] === 0x66 &&
				bytes[body + 4] === 0 &&
				bytes[body + 5] === 0;
			if (exif) orientation = tiffOrientation(bytes, body + 6, Math.min(end, at + 2 + length));
		}
		if (isFrame(marker)) {
			if (body + 5 > end) return null;
			return {
				orientation,
				height: u16(bytes, body + 1, false),
				width: u16(bytes, body + 3, false),
			};
		}
		// Start of scan: the frame header comes before it in any valid file.
		if (marker === 0xda) return null;
		at += 2 + length;
	}
	return null;
}

/** True for the orientations that are a quarter turn, which swap width and height. */
export function swapsSides(orientation: number): boolean {
	return orientation >= 5 && orientation <= 8;
}

/** `image` turned and flipped the way Exif `orientation` says it should be shown. */
export function applyOrientation(image: RgbaImage, orientation: number): RgbaImage {
	if (!Number.isInteger(orientation) || orientation < 2 || orientation > 8) return image;
	const { width: w, height: h, data } = image;
	const swap = swapsSides(orientation);
	const width = swap ? h : w;
	const height = swap ? w : h;
	const out = new Uint8ClampedArray(width * height * 4);
	for (let y = 0; y < height; y += 1) {
		for (let x = 0; x < width; x += 1) {
			let sx: number;
			let sy: number;
			switch (orientation) {
				case 2:
					[sx, sy] = [w - 1 - x, y];
					break;
				case 3:
					[sx, sy] = [w - 1 - x, h - 1 - y];
					break;
				case 4:
					[sx, sy] = [x, h - 1 - y];
					break;
				case 5:
					[sx, sy] = [y, x];
					break;
				case 6:
					[sx, sy] = [y, h - 1 - x];
					break;
				case 7:
					[sx, sy] = [w - 1 - y, h - 1 - x];
					break;
				default:
					[sx, sy] = [w - 1 - y, x];
			}
			const from = (sy * w + sx) * 4;
			const to = (y * width + x) * 4;
			out[to] = data[from] as number;
			out[to + 1] = data[from + 1] as number;
			out[to + 2] = data[from + 2] as number;
			out[to + 3] = data[from + 3] as number;
		}
	}
	return { width, height, data: out };
}
