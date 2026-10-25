/**
 * Checking a scene, and reducing it to the cases the writers handle.
 *
 * Both writers start here, so the decisions about edge cases are made once
 * and the SVG and the raster cannot disagree about them: a gradient with one
 * stop is that stop's colour, a linear gradient whose ends coincide or a radial
 * one with no radius is its last stop's colour (as SVG specifies), a gradient
 * with no stops paints nothing, and a group at zero opacity, an image with no
 * area or anything clipped by an empty clip is left out entirely.
 *
 * Every number must be finite, and a value of the wrong shape throws a
 * TypeError naming where it was found (a layer index, a field). Values are
 * never repeated in a message.
 */

import { checkPath, walkPath } from '../geometry/path.js';
import type { Path } from '../geometry/path.js';
import { checkColour } from './colour.js';
import type { Colour, RgbaImage, Scene, SceneNode, ScenePaint, Stop } from './types.js';

/** Groups nest at most this deep. Far past any design, and it stops a cycle. */
export const MAX_DEPTH = 32;

export interface NormalStop {
	readonly offset: number;
	readonly colour: Colour;
}

export type NormalPaint =
	| { readonly kind: 'none' }
	| { readonly kind: 'solid'; readonly colour: Colour }
	| {
			readonly kind: 'linear';
			readonly x1: number;
			readonly y1: number;
			readonly x2: number;
			readonly y2: number;
			readonly stops: readonly NormalStop[];
	  }
	| {
			readonly kind: 'radial';
			readonly cx: number;
			readonly cy: number;
			readonly r: number;
			readonly stops: readonly NormalStop[];
	  }
	| {
			readonly kind: 'conic';
			readonly cx: number;
			readonly cy: number;
			readonly angle: number;
			readonly stops: readonly NormalStop[];
	  };

/** A paint that puts something on the page. */
export type DrawnPaint = Exclude<NormalPaint, { readonly kind: 'none' }>;

export type NormalNode =
	| { readonly kind: 'path'; readonly path: Path; readonly paint: DrawnPaint }
	| {
			readonly kind: 'image';
			readonly image: RgbaImage;
			readonly x: number;
			readonly y: number;
			readonly width: number;
			readonly height: number;
			readonly clip: Path | null;
	  }
	| {
			readonly kind: 'group';
			readonly children: readonly NormalNode[];
			readonly clip: Path | null;
			readonly opacity: number;
	  };

export interface NormalScene {
	readonly width: number;
	readonly height: number;
	readonly unitsPerMm: number | null;
	readonly background: NormalPaint;
	readonly layers: readonly NormalNode[];
	readonly title: string | null;
}

function finite(value: unknown, where: string, name: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		throw new TypeError(`${where}: ${name} is not a finite number.`);
	}
	return value;
}

function solid(colour: Colour): NormalPaint {
	return colour.a === 0 ? { kind: 'none' } : { kind: 'solid', colour };
}

function normaliseStops(stops: readonly Stop[], where: string): NormalStop[] {
	if (!Array.isArray(stops)) throw new TypeError(`${where}: stops is a list.`);
	const out: NormalStop[] = [];
	let floor = 0;
	for (let i = 0; i < stops.length; i += 1) {
		const stop = stops[i] as Stop;
		if (typeof stop !== 'object' || stop === null) {
			throw new TypeError(`${where}: stop ${i} is not a stop.`);
		}
		const offset = finite(stop.offset, where, `stop ${i} offset`);
		checkColour(stop.colour, `${where}: stop ${i}`);
		// SVG clamps each offset to 0..1 and then to at least the one before.
		floor = Math.max(floor, Math.min(Math.max(offset, 0), 1));
		out.push({ offset: floor, colour: stop.colour });
	}
	return out;
}

/** Check a paint and reduce its degenerate forms. */
export function normalisePaint(paint: ScenePaint, where: string): NormalPaint {
	if (typeof paint !== 'object' || paint === null) {
		throw new TypeError(`${where}: a paint is an object with a kind.`);
	}
	if (paint.kind === 'solid') {
		checkColour(paint.colour, where);
		return solid(paint.colour);
	}
	if (paint.kind !== 'linear' && paint.kind !== 'radial' && paint.kind !== 'conic') {
		throw new TypeError(`${where}: the paint kind is not solid, linear, radial or conic.`);
	}
	const stops = normaliseStops(paint.stops, where);
	const last = stops[stops.length - 1];
	if (paint.kind === 'linear') {
		const x1 = finite(paint.x1, where, 'x1');
		const y1 = finite(paint.y1, where, 'y1');
		const x2 = finite(paint.x2, where, 'x2');
		const y2 = finite(paint.y2, where, 'y2');
		if (last === undefined) return { kind: 'none' };
		if (stops.length === 1 || (x1 === x2 && y1 === y2)) return solid(last.colour);
		return { kind: 'linear', x1, y1, x2, y2, stops };
	}
	if (paint.kind === 'radial') {
		const cx = finite(paint.cx, where, 'cx');
		const cy = finite(paint.cy, where, 'cy');
		const r = finite(paint.r, where, 'r');
		if (r < 0) throw new TypeError(`${where}: a radial gradient's r cannot be negative.`);
		if (last === undefined) return { kind: 'none' };
		if (stops.length === 1 || r === 0) return solid(last.colour);
		return { kind: 'radial', cx, cy, r, stops };
	}
	const cx = finite(paint.cx, where, 'cx');
	const cy = finite(paint.cy, where, 'cy');
	const angle = finite(paint.angle, where, 'angle');
	if (last === undefined) return { kind: 'none' };
	if (stops.length === 1) return solid(last.colour);
	return { kind: 'conic', cx, cy, angle, stops };
}

/** True when walking the path would draw at least one segment. */
function draws(path: Path): boolean {
	let any = false;
	walkPath(
		path,
		{
			move() {},
			line() {
				any = true;
			},
			quad() {
				any = true;
			},
			cubic() {
				any = true;
			},
			close() {},
		},
		'draws',
	);
	return any;
}

/** Throw a TypeError unless `image` is an RGBA image this package can read. */
export function checkImage(image: RgbaImage, where: string): void {
	if (typeof image !== 'object' || image === null) {
		throw new TypeError(`${where}: image is an object with width, height and data.`);
	}
	const { width, height } = image;
	const data: unknown = image.data;
	if (!Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 1) {
		throw new TypeError(`${where}: the image's width and height are whole numbers, 1 or more.`);
	}
	if (!(data instanceof Uint8ClampedArray) && !(data instanceof Uint8Array)) {
		throw new TypeError(`${where}: the image's data is a Uint8ClampedArray.`);
	}
	if (data.length !== width * height * 4) {
		throw new TypeError(`${where}: the image's data is not four bytes a pixel.`);
	}
}

/** A clip path, or null for none. Returns undefined when the clip removes everything. */
function normaliseClip(clip: Path | undefined, where: string): Path | null | undefined {
	if (clip === undefined) return null;
	checkPath(clip, `${where}: clip`);
	return draws(clip) ? clip : undefined;
}

function normaliseNode(node: SceneNode, where: string, depth: number): NormalNode | null {
	if (typeof node !== 'object' || node === null) {
		throw new TypeError(`${where}: a node is an object with a kind.`);
	}
	if (node.kind === 'path') {
		checkPath(node.path, where);
		const paint = normalisePaint(node.paint, `${where}: paint`);
		if (paint.kind === 'none' || !draws(node.path)) return null;
		return { kind: 'path', path: node.path, paint };
	}
	if (node.kind === 'image') {
		checkImage(node.image, where);
		const x = finite(node.x, where, 'x');
		const y = finite(node.y, where, 'y');
		const width = finite(node.width, where, 'width');
		const height = finite(node.height, where, 'height');
		if (width < 0 || height < 0) {
			throw new TypeError(`${where}: an image's width and height cannot be negative.`);
		}
		const clip = normaliseClip(node.clip, where);
		if (clip === undefined || width === 0 || height === 0) return null;
		return { kind: 'image', image: node.image, x, y, width, height, clip };
	}
	if (node.kind === 'group') {
		if (depth >= MAX_DEPTH) {
			throw new TypeError(`${where}: groups nest more than ${MAX_DEPTH} deep.`);
		}
		const opacity =
			node.opacity === undefined
				? 1
				: Math.min(Math.max(finite(node.opacity, where, 'opacity'), 0), 1);
		const clip = normaliseClip(node.clip, where);
		const children = normaliseNodes(node.children, where, depth + 1);
		if (clip === undefined || opacity === 0 || children.length === 0) return null;
		return { kind: 'group', children, clip, opacity };
	}
	throw new TypeError(`${where}: the node kind is not path, image or group.`);
}

function normaliseNodes(nodes: readonly SceneNode[], where: string, depth: number): NormalNode[] {
	if (!Array.isArray(nodes)) throw new TypeError(`${where}: children is a list of nodes.`);
	const out: NormalNode[] = [];
	for (let i = 0; i < nodes.length; i += 1) {
		const normal = normaliseNode(nodes[i] as SceneNode, `${where} > ${i}`, depth);
		if (normal !== null) out.push(normal);
	}
	return out;
}

/** Check a scene and reduce it. Throws a TypeError for anything malformed. */
export function normaliseScene(scene: Scene, where: string): NormalScene {
	if (typeof scene !== 'object' || scene === null) {
		throw new TypeError(`${where}: a scene is an object.`);
	}
	const width = finite(scene.width, where, 'scene width');
	const height = finite(scene.height, where, 'scene height');
	if (width <= 0 || height <= 0) {
		throw new TypeError(`${where}: the scene's width and height are more than zero.`);
	}
	let unitsPerMm: number | null = null;
	if (scene.unitsPerMm !== undefined) {
		unitsPerMm = finite(scene.unitsPerMm, where, 'unitsPerMm');
		if (unitsPerMm <= 0) throw new TypeError(`${where}: unitsPerMm is more than zero.`);
	}
	if (scene.title !== undefined && typeof scene.title !== 'string') {
		throw new TypeError(`${where}: title is a string.`);
	}
	const background: NormalPaint =
		scene.background === null || scene.background === undefined
			? { kind: 'none' }
			: normalisePaint(scene.background, `${where}: background`);
	return {
		width,
		height,
		unitsPerMm,
		background,
		layers: normaliseNodes(scene.layers, `${where}: layer`, 0),
		title: scene.title ?? null,
	};
}
