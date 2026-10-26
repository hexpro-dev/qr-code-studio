/**
 * The phone camera the scan check assumes, and what it implies about
 * distance.
 *
 * Every number here is a calibration target, not a measurement of one phone.
 * The owner's scan session (printed test sheets read by the phones people
 * carry, at measured distances) is what moves them, and each says what it
 * stands for so that session knows what it is checking.
 *
 * The model: a phone in its scanning mode analyses a frame about 1920 pixels
 * across from its main camera, whose horizontal field of view is about 65
 * degrees. At a distance D the frame spans 2 D tan(32.5 deg) of the page, so
 * a module m millimetres wide covers m * 1920 / (2 D tan(32.5 deg)) pixels.
 * A reader needs at least four pixels a module, so the furthest the code
 * scans from is m * 1920 / (4 * 2 * tan(32.5 deg)), about 377 module widths.
 *
 * And it cannot be held closer than its lens focuses, about 10 cm for the
 * main camera of most phones, so a module is too small to scan at all when
 * the phone would have to be closer than that to see it at the pixels a
 * module the design needs.
 */

import { PI, cos, sin } from '../core/math.js';

export const CAMERA = Object.freeze({
	/**
	 * Horizontal field of view of a phone's main camera, in degrees. 65 is
	 * near the middle of the 26 mm equivalent lenses phones ship (about 63 to
	 * 70 degrees across the long edge).
	 */
	fieldOfViewDegrees: 65,
	/** Pixels across the frame a scanner analyses: a 1080p stream, long edge. */
	frameWidthPx: 1920,
	/**
	 * Pixels a module a phone reader needs, at the least. ZXing and the
	 * platform readers sample one pixel per module once the grid is found;
	 * below about four the finder's 1:1:3:1:1 runs blur into each other and
	 * the grid is not found at all.
	 */
	minPxPerModule: 4,
	/** The closest a phone's main camera focuses, in millimetres. */
	minFocusMm: 100,
	/**
	 * Within this a person has to hold the phone uncomfortably close, in
	 * millimetres: the module size check warns, and printing larger is offered.
	 */
	comfortMm: 150,
});

let tangent: number | undefined;

/** tan of half the field of view, from core's sine and cosine. */
export function halfFieldTangent(): number {
	if (tangent === undefined) {
		const half = (CAMERA.fieldOfViewDegrees / 2) * (PI / 180);
		tangent = sin(half) / cos(half);
	}
	return tangent;
}

/** Pixels a module covers at `distanceMm`. */
export function pxPerModuleAt(moduleMm: number, distanceMm: number): number {
	return (moduleMm * CAMERA.frameWidthPx) / (2 * distanceMm * halfFieldTangent());
}

/** The distance at which a module covers `pxPerModule` pixels. */
export function distanceFor(moduleMm: number, pxPerModule: number): number {
	return (moduleMm * CAMERA.frameWidthPx) / (pxPerModule * 2 * halfFieldTangent());
}

/**
 * The furthest the code scans from: where a module covers the pixels a
 * reader needs, or more when the design needs more (a thin dot, say).
 */
export function maxDistanceMm(
	moduleMm: number,
	pxPerModule: number = CAMERA.minPxPerModule,
): number {
	return distanceFor(moduleMm, Math.max(pxPerModule, CAMERA.minPxPerModule));
}

/** The smallest module a phone can resolve at its closest focus, for a design that needs `pxPerModule`. */
export function minModuleMm(pxPerModule: number = CAMERA.minPxPerModule): number {
	const needed = Math.max(pxPerModule, CAMERA.minPxPerModule);
	return (needed * 2 * CAMERA.minFocusMm * halfFieldTangent()) / CAMERA.frameWidthPx;
}
