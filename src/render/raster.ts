/**
 * The rasteriser: a scene to RGBA pixels, identical in every engine.
 *
 * The scan check draws a design with this and reads it back, and a PNG export
 * is this output encoded, so both must give the same bytes in Node, Chromium,
 * WebKit and Firefox. That rules out a canvas, whose anti-aliasing and
 * blending differ by engine and by GPU, and it is the reason for every choice
 * below: coverage is exact (see `coverage.ts`), curves are cut by a formula
 * that needs only a square root, all arithmetic is float64 with no function
 * IEEE 754 leaves loose, and there is exactly one rounding to bytes, at the
 * end of each row.
 *
 * Compositing is source over in sRGB gamma space, which is how browsers draw
 * SVG, so a rasterised scene and the same scene's SVG in a browser agree to
 * within anti-aliasing. Each layer's coverage is computed for the layer as a
 * whole, so two shapes that touch inside one layer are one region and their
 * shared edge is not blended twice into a seam. A group with an opacity or a
 * clip is drawn into a row of its own and then laid over its parent, as SVG
 * isolates it.
 *
 * The image is produced a row at a time, top to bottom, so beyond the output
 * itself the memory is the geometry and a few rows of float64.
 */

import { QrStudioError } from '../core/errors.js';
import { PathBuilder } from '../geometry/path.js';
import type { Path } from '../geometry/path.js';
import { checkColour } from './colour.js';
import { CoverageScratch, EdgeSet } from './coverage.js';
import { PreparedPaint, over } from './paint.js';
import { normaliseScene } from './scene.js';
import type { NormalNode } from './scene.js';
import type { Colour, RgbaImage, Scene } from './types.js';

export interface RasteriseOptions {
	/** Output width in pixels, a whole number from 1. */
	readonly width: number;
	/** Output height in pixels. Defaults to the width times the scene's aspect ratio, rounded. */
	readonly height?: number;
	/** Laid under everything, for formats or checks that need an opaque picture. */
	readonly background?: Colour;
}

/**
 * The most pixels one call will allocate: a gibibyte of RGBA.
 *
 * 8000 by 8000, the largest export the studio offers, is a quarter of it.
 */
export const MAX_PIXELS = 268435456;

type Prepared =
	| { readonly kind: 'path'; readonly edges: EdgeSet; readonly paint: PreparedPaint }
	| {
			readonly kind: 'image';
			readonly box: EdgeSet;
			readonly clip: EdgeSet | null;
			readonly node: Extract<NormalNode, { kind: 'image' }>;
	  }
	| {
			readonly kind: 'group';
			readonly children: readonly Prepared[];
			readonly clip: EdgeSet | null;
			readonly opacity: number;
	  };

/** Per nesting depth: a row of pixels for an isolated group, and two rows of coverage. */
interface Scratch {
	readonly row: Float64Array;
	readonly cover: Float64Array;
	readonly clip: Float64Array;
}

function size(value: unknown, name: string): number {
	if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
		throw new TypeError(`rasterise: ${name} is a whole number of pixels, 1 or more.`);
	}
	return value;
}

export function rasterise(scene: Scene, options: RasteriseOptions): RgbaImage {
	if (typeof options !== 'object' || options === null) {
		throw new TypeError('rasterise: options gives at least the width in pixels.');
	}
	const normal = normaliseScene(scene, 'rasterise');
	const width = size(options.width, 'width');
	const height =
		options.height === undefined
			? Math.max(1, Math.round((width * normal.height) / normal.width))
			: size(options.height, 'height');
	if (options.background !== undefined) checkColour(options.background, 'rasterise: background');
	if (width * height > MAX_PIXELS) {
		throw new QrStudioError(
			'render/surface-too-large',
			'That picture is too large to draw here. Choose a smaller size.',
			{ width, height, maxPixels: MAX_PIXELS },
		);
	}

	const sx = width / normal.width;
	const sy = height / normal.height;
	const unitsX = normal.width / width;
	const unitsY = normal.height / height;

	const shared = new CoverageScratch(width);
	const edgesOf = (path: Path): EdgeSet => EdgeSet.fromPath(path, shared, height, sx, sy);
	let depth = 0;
	const prepare = (node: NormalNode, level: number): Prepared => {
		if (level > depth) depth = level;
		if (node.kind === 'path') {
			return {
				kind: 'path',
				edges: edgesOf(node.path),
				paint: new PreparedPaint(node.paint),
			};
		}
		const clip = node.clip === null ? null : edgesOf(node.clip);
		if (node.kind === 'image') {
			const box = new PathBuilder().rect(node.x, node.y, node.width, node.height).build();
			return { kind: 'image', box: edgesOf(box), clip, node };
		}
		return {
			kind: 'group',
			children: node.children.map((child) => prepare(child, level + 1)),
			clip,
			opacity: node.opacity,
		};
	};
	const layers = normal.layers.map((layer) => prepare(layer, 0));
	const background =
		normal.background.kind === 'none' ? null : new PreparedPaint(normal.background);

	const scratch: Scratch[] = [];
	for (let level = 0; level <= depth + 1; level += 1) {
		scratch.push({
			row: new Float64Array(width * 4),
			cover: new Float64Array(width),
			clip: new Float64Array(width),
		});
	}
	const full = new Float64Array(width).fill(1);
	const matte = new Float64Array(4);
	if (options.background !== undefined) {
		const { r, g, b, a } = options.background;
		matte[0] = (r / 255) * a;
		matte[1] = (g / 255) * a;
		matte[2] = (b / 255) * a;
		matte[3] = a;
	}

	const data = new Uint8ClampedArray(width * height * 4);
	const texel = new Float64Array(4);

	const drawImage = (
		item: Extract<Prepared, { kind: 'image' }>,
		level: number,
		y: number,
		dst: Float64Array,
	): void => {
		const own = scratch[level] as Scratch;
		if (!item.box.coverage(y, own.cover)) return;
		let start = item.box.start;
		let end = item.box.end;
		if (item.clip !== null) {
			if (!item.clip.coverage(y, own.clip)) return;
			start = Math.max(start, item.clip.start);
			end = Math.min(end, item.clip.end);
		}
		const { node } = item;
		const { image } = node;
		const pixels = image.data;
		const iw = image.width;
		const ih = image.height;
		const v = texelCoordinate((((y + 0.5) * unitsY - node.y) / node.height) * ih - 0.5, ih);
		const row0 = Math.min(Math.max(Math.floor(v), 0), ih - 1);
		const row1 = Math.min(Math.max(Math.floor(v) + 1, 0), ih - 1);
		const fy = Math.min(Math.max(v - Math.floor(v), 0), 1);
		for (let x = start; x < end; x += 1) {
			let c = own.cover[x] as number;
			if (item.clip !== null) c *= own.clip[x] as number;
			if (c === 0) continue;
			const u = texelCoordinate((((x + 0.5) * unitsX - node.x) / node.width) * iw - 0.5, iw);
			const col0 = Math.min(Math.max(Math.floor(u), 0), iw - 1);
			const col1 = Math.min(Math.max(Math.floor(u) + 1, 0), iw - 1);
			const fx = Math.min(Math.max(u - Math.floor(u), 0), 1);
			texel.fill(0);
			sampleInto(texel, pixels, (row0 * iw + col0) * 4, (1 - fx) * (1 - fy));
			sampleInto(texel, pixels, (row0 * iw + col1) * 4, fx * (1 - fy));
			sampleInto(texel, pixels, (row1 * iw + col0) * 4, (1 - fx) * fy);
			sampleInto(texel, pixels, (row1 * iw + col1) * 4, fx * fy);
			over(
				dst,
				x * 4,
				(texel[0] as number) * c,
				(texel[1] as number) * c,
				(texel[2] as number) * c,
				(texel[3] as number) * c,
			);
		}
	};

	const draw = (item: Prepared, level: number, y: number, dst: Float64Array): void => {
		const own = scratch[level] as Scratch;
		if (item.kind === 'path') {
			if (!item.edges.coverage(y, own.cover)) return;
			item.paint.composite(
				dst,
				own.cover,
				item.edges.start,
				item.edges.end,
				(y + 0.5) * unitsY,
				unitsX,
			);
			return;
		}
		if (item.kind === 'image') {
			drawImage(item, level, y, dst);
			return;
		}
		if (item.clip === null && item.opacity === 1) {
			// Nothing to isolate: drawing the children straight onto the parent
			// is the same picture, source over being associative.
			for (const child of item.children) draw(child, level + 1, y, dst);
			return;
		}
		let start = 0;
		let end = width;
		if (item.clip !== null) {
			if (!item.clip.coverage(y, own.clip)) return;
			start = item.clip.start;
			end = item.clip.end;
		}
		const inner = (scratch[level + 1] as Scratch).row;
		inner.fill(0);
		for (const child of item.children) draw(child, level + 1, y, inner);
		for (let x = start; x < end; x += 1) {
			const k = item.opacity * (item.clip === null ? 1 : (own.clip[x] as number));
			if (k === 0) continue;
			const i = x * 4;
			over(
				dst,
				i,
				(inner[i] as number) * k,
				(inner[i + 1] as number) * k,
				(inner[i + 2] as number) * k,
				(inner[i + 3] as number) * k,
			);
		}
	};

	const main = new Float64Array(width * 4);
	for (let y = 0; y < height; y += 1) {
		for (let x = 0; x < width; x += 1) main.set(matte, x * 4);
		if (background !== null) background.composite(main, full, 0, width, (y + 0.5) * unitsY, unitsX);
		for (const layer of layers) draw(layer, 0, y, main);
		writeRow(main, data, y * width * 4, width);
	}
	return { width, height, data };
}

/**
 * A texel coordinate held to the image and its border.
 *
 * An image box a hair wide or a long way out can overflow the mapping to an
 * infinity or a NaN, and a NaN in the row would poison every layer drawn over
 * that pixel afterwards (NaN times zero is NaN). Beyond the edge texels the
 * sampling clamps anyway, so nothing that could be seen changes.
 */
function texelCoordinate(value: number, size: number): number {
	if (!(value >= -1)) return -1;
	return value > size ? size : value;
}

/** Add a straight texel, premultiplied and weighted, to a running sample. */
function sampleInto(
	out: Float64Array,
	pixels: ArrayLike<number>,
	at: number,
	weight: number,
): void {
	if (weight === 0) return;
	const a = ((pixels[at + 3] as number) / 255) * weight;
	out[0] = (out[0] as number) + ((pixels[at] as number) / 255) * a;
	out[1] = (out[1] as number) + ((pixels[at + 1] as number) / 255) * a;
	out[2] = (out[2] as number) + ((pixels[at + 2] as number) / 255) * a;
	out[3] = (out[3] as number) + a;
}

function toByte(value: number): number {
	const scaled = value * 255 + 0.5;
	if (!(scaled > 0)) return 0;
	return scaled >= 255 ? 255 : Math.floor(scaled);
}

/**
 * The one place a colour becomes bytes: unpremultiply and round half up.
 *
 * A pixel whose alpha rounds to zero is written as all zeros, so a picture has
 * one spelling of "nothing here" whatever was faintly drawn there.
 */
function writeRow(row: Float64Array, out: Uint8ClampedArray, offset: number, width: number): void {
	for (let x = 0; x < width; x += 1) {
		const i = x * 4;
		const a = row[i + 3] as number;
		const alpha = toByte(a);
		if (alpha === 0) continue;
		const o = offset + i;
		out[o] = toByte((row[i] as number) / a);
		out[o + 1] = toByte((row[i + 1] as number) / a);
		out[o + 2] = toByte((row[i + 2] as number) / a);
		out[o + 3] = alpha;
	}
}
