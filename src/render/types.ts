/**
 * The scene: what a design becomes before it is written in any format.
 *
 * Every writer reads the same description, so an SVG, a PNG and (later) a PDF
 * of one design are the same picture. The scene knows nothing about QR codes:
 * a module is a path with a paint like any other.
 */

import type { RgbaImage } from '../core/image.js';
import type { Path } from '../geometry/path.js';

/**
 * An sRGB colour.
 *
 * `r`, `g` and `b` are whole numbers from 0 to 255, which is exactly what a hex
 * colour can say, so every colour has one spelling in an SVG and the picture
 * the rasteriser draws matches it. `a` is opacity from 0 to 1. `cmyk`, when
 * present, is the print value the PDF writer uses instead (each 0 to 1); the
 * screen writers ignore it.
 */
export interface Colour {
	readonly r: number;
	readonly g: number;
	readonly b: number;
	readonly a: number;
	readonly cmyk?: readonly [number, number, number, number];
}

/** A gradient stop. Offsets are clamped to 0 to 1 and made non-decreasing, as SVG does. */
export interface Stop {
	readonly offset: number;
	readonly colour: Colour;
}

/**
 * What fills a shape, in user units.
 *
 * Gradients pad beyond their ends and interpolate unpremultiplied sRGB, which
 * is what SVG renderers do with the equivalent markup. A conic gradient's
 * `angle` is in degrees, clockwise from the positive x axis (y down), and is
 * where offset 0 lies; offsets run clockwise once round.
 */
export type ScenePaint =
	| { readonly kind: 'solid'; readonly colour: Colour }
	| {
			readonly kind: 'linear';
			readonly x1: number;
			readonly y1: number;
			readonly x2: number;
			readonly y2: number;
			readonly stops: readonly Stop[];
	  }
	| {
			readonly kind: 'radial';
			readonly cx: number;
			readonly cy: number;
			readonly r: number;
			readonly stops: readonly Stop[];
	  }
	| {
			readonly kind: 'conic';
			readonly cx: number;
			readonly cy: number;
			readonly angle: number;
			readonly stops: readonly Stop[];
	  };

export type { RgbaImage };

export type SceneNode =
	| {
			readonly kind: 'path';
			readonly path: Path;
			readonly paint: ScenePaint;
			/** What the shape is for (a finder, a data module). Kept for the checks; no writer emits it. */
			readonly role?: string;
	  }
	| {
			readonly kind: 'image';
			readonly image: RgbaImage;
			readonly x: number;
			readonly y: number;
			readonly width: number;
			readonly height: number;
			readonly clip?: Path;
	  }
	| {
			readonly kind: 'group';
			readonly children: readonly SceneNode[];
			readonly clip?: Path;
			readonly opacity?: number;
	  };

/** A layer is composited as a whole: shapes within one layer never overlap, so coverage never double counts. */
export interface Scene {
	/** User units. */
	readonly width: number;
	readonly height: number;
	/** Set when the design has a physical size. */
	readonly unitsPerMm?: number;
	readonly background: ScenePaint | null;
	readonly layers: readonly SceneNode[];
	/** The accessible name in SVG. Never the payload. */
	readonly title?: string;
}
