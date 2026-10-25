/**
 * A scene as PDF content: the operators that draw it, and the objects they
 * use.
 *
 * Everything is drawn in the scene's own units, under one `cm` that the page
 * sets up, so a path's numbers in the PDF are the numbers in the scene, as
 * they are in the SVG. Paths are filled with the nonzero rule (`f`) and
 * clipped with it (`W n`). Quadratic segments become the cubic that traces
 * the same curve, since PDF has no quadratic.
 *
 * Paint:
 *
 * - A solid colour is an operator, `rg` in sRGB and `k` in CMYK. Below full
 *   opacity, an ExtGState sets the fill alpha (`ca`) for that shape.
 * - A linear or radial gradient is an axial (type 2) or radial (type 3)
 *   shading painted with `sh` inside the shape's clip, extended at both ends
 *   as the scene's gradients pad. Its colours are a function of the stops
 *   (see `pdf-syntax.ts`). If every stop has the one opacity, `ca` carries it;
 *   if they differ, a luminosity soft mask carries them, drawn from the same
 *   geometry with the stops' opacities as greys, so colour and opacity are
 *   interpolated separately as the rasteriser interpolates them.
 * - A conic gradient is the SVG writer's fan of wedges (`conic.ts`), clipped
 *   to the shape. When the wedges carry one opacity between them they are
 *   drawn opaque inside a transparency group that carries it, as the SVG
 *   writer's group does.
 *
 * A group with an opacity is a transparency group form XObject, isolated as
 * SVG isolates it, painted with that opacity. A clip is a clipping path. An
 * image is an Image XObject compressed with Flate, its alpha a soft mask
 * image beside it.
 *
 * In CMYK, colours go through `pdf-colour.ts`. A conic gradient's wedges are
 * the one place a stop's print value is not used: the wedges are made in sRGB
 * by the code the SVG writer shares, and each is converted.
 */

import type { Box } from '../geometry/measure.js';
import { bounds } from '../geometry/measure.js';
import { walkPath } from '../geometry/path.js';
import type { Path } from '../geometry/path.js';
import { conicWedges } from './conic.js';
import type { PrintSpace } from './pdf-colour.js';
import { components, rgbToCmyk } from './pdf-colour.js';
import type { PdfDocument } from './pdf-document.js';
import { num, nums, stopsFunction } from './pdf-syntax.js';
import type { DrawnPaint, NormalNode } from './scene.js';
import type { Colour, RgbaImage } from './types.js';

/** What every stream in one file shares. */
export interface PrintContext {
	readonly doc: PdfDocument;
	readonly space: PrintSpace;
	/** Set once anything drawn uses transparency, so the page can declare its blending space. */
	transparency: boolean;
	/** Image XObjects already written, by the pixels they hold. */
	readonly images: Map<RgbaImage, number>;
}

type ResourceKind = 'ExtGState' | 'Shading' | 'XObject';
const PREFIX: Record<ResourceKind, string> = { ExtGState: 'GS', Shading: 'Sh', XObject: 'X' };

const encoder = new TextEncoder();

/** One content stream: its operators, and the names it gave the objects it uses. */
export class ContentStream {
	private readonly lines: string[] = [];
	private readonly names: Record<ResourceKind, Map<number, string>> = {
		ExtGState: new Map(),
		Shading: new Map(),
		XObject: new Map(),
	};

	constructor(readonly context: PrintContext) {}

	op(text: string): void {
		this.lines.push(text);
	}

	/** The name this stream uses for object `id`. */
	use(kind: ResourceKind, id: number): string {
		const map = this.names[kind];
		let name = map.get(id);
		if (name === undefined) {
			name = `/${PREFIX[kind]}${map.size}`;
			map.set(id, name);
		}
		return name;
	}

	/** The stream's resource dictionary. */
	resources(): string {
		let text = '<<';
		for (const kind of ['ExtGState', 'Shading', 'XObject'] as const) {
			const map = this.names[kind];
			if (map.size === 0) continue;
			text += ` /${kind} <<`;
			for (const [id, name] of map) text += ` ${name} ${id} 0 R`;
			text += ' >>';
		}
		return `${text} >>`;
	}

	bytes(): Uint8Array {
		return encoder.encode(this.lines.join('\n'));
	}

	/** The fill colour operator. */
	fill(colour: Colour): void {
		const parts = components(colour, this.context.space);
		this.op(`${nums(parts)} ${this.context.space === 'srgb' ? 'rg' : 'k'}`);
	}

	/** Set the fill alpha, when it is not 1. */
	alpha(value: number): void {
		if (value === 1) return;
		this.context.transparency = true;
		const id = this.context.doc.addShared(`<< /Type /ExtGState /ca ${num(value)} >>`);
		this.op(`${this.use('ExtGState', id)} gs`);
	}

	/** Path construction operators, in the current user space. */
	path(path: Path): void {
		let startX = 0;
		let startY = 0;
		let x = 0;
		let y = 0;
		const parts: string[] = [];
		walkPath(
			path,
			{
				move(px, py) {
					parts.push(`${num(px)} ${num(py)} m`);
					startX = x = px;
					startY = y = py;
				},
				line(px, py) {
					parts.push(`${num(px)} ${num(py)} l`);
					x = px;
					y = py;
				},
				quad(cx, cy, px, py) {
					// The cubic with the same curve: each control point two thirds
					// of the way from an end to the quadratic's control point.
					const c1x = x + ((cx - x) * 2) / 3;
					const c1y = y + ((cy - y) * 2) / 3;
					const c2x = px + ((cx - px) * 2) / 3;
					const c2y = py + ((cy - py) * 2) / 3;
					parts.push(`${nums([c1x, c1y, c2x, c2y, px, py])} c`);
					x = px;
					y = py;
				},
				cubic(c1x, c1y, c2x, c2y, px, py) {
					parts.push(`${nums([c1x, c1y, c2x, c2y, px, py])} c`);
					x = px;
					y = py;
				},
				close() {
					parts.push('h');
					x = startX;
					y = startY;
				},
			},
			'sceneToPdf',
		);
		this.op(parts.join(' '));
	}

	/** A rectangle path. */
	rect(box: Box): void {
		this.op(`${nums([box.x, box.y, box.width, box.height])} re`);
	}
}

/** The part of a box inside another, or an empty box where there is none. */
export function within(box: Box, area: Box): Box {
	const x = Math.max(box.x, area.x);
	const y = Math.max(box.y, area.y);
	const right = Math.min(box.x + box.width, area.x + area.width);
	const bottom = Math.min(box.y + box.height, area.y + area.height);
	return { x, y, width: Math.max(0, right - x), height: Math.max(0, bottom - y) };
}

/** A transparency group holding whatever `draw` writes, as a form XObject. */
function group(
	context: PrintContext,
	area: Box,
	colourSpace: string,
	draw: (inner: ContentStream) => void,
): number {
	const inner = new ContentStream(context);
	draw(inner);
	context.transparency = true;
	return context.doc.addStream(
		`/Type /XObject /Subtype /Form /BBox [${nums([area.x, area.y, area.x + area.width, area.y + area.height])}] /Group << /Type /Group /S /Transparency /I true /CS ${colourSpace} >> /Resources ${inner.resources()}`,
		inner.bytes(),
	);
}

function deviceSpace(space: PrintSpace): string {
	return space === 'srgb' ? '/DeviceRGB' : '/DeviceCMYK';
}

/** The shading for a linear or radial paint, in the space given or as opacities for a mask. */
function shading(
	paint: Extract<DrawnPaint, { kind: 'linear' | 'radial' }>,
	space: PrintSpace,
	alpha: boolean,
): string {
	const colourSpace = alpha ? '/DeviceGray' : deviceSpace(space);
	const fn = stopsFunction(paint.stops, space, alpha);
	if (paint.kind === 'linear') {
		return `<< /ShadingType 2 /ColorSpace ${colourSpace} /Coords [${nums([paint.x1, paint.y1, paint.x2, paint.y2])}] /Function ${fn} /Extend [true true] >>`;
	}
	return `<< /ShadingType 3 /ColorSpace ${colourSpace} /Coords [${nums([paint.cx, paint.cy, 0, paint.cx, paint.cy, paint.r])}] /Function ${fn} /Extend [true true] >>`;
}

/**
 * Fill `shape` with `paint`. `area` is what can be seen of the shape (its
 * bounds within the visible region), which a conic's wedges and a mask need.
 */
export function fillPaint(stream: ContentStream, shape: Path, paint: DrawnPaint, area: Box): void {
	const { context } = stream;
	if (paint.kind === 'solid') {
		const restore = paint.colour.a !== 1;
		if (restore) stream.op('q');
		stream.alpha(paint.colour.a);
		stream.fill(paint.colour);
		stream.path(shape);
		stream.op('f');
		if (restore) stream.op('Q');
		return;
	}
	stream.op('q');
	stream.path(shape);
	stream.op('W n');
	if (paint.kind === 'conic') {
		const { opacity, fans } = conicWedges(paint, area);
		const drawFans = (target: ContentStream): void => {
			for (const fan of fans) {
				const restore = fan.a !== 1;
				if (restore) target.op('q');
				target.alpha(fan.a);
				const colour =
					context.space === 'srgb'
						? `${nums([fan.r / 255, fan.g / 255, fan.b / 255])} rg`
						: `${nums(rgbToCmyk(fan.r, fan.g, fan.b))} k`;
				const p = fan.points;
				let d = `${num(p[0] as number)} ${num(p[1] as number)} m`;
				for (let i = 2; i < p.length; i += 2)
					d += ` ${num(p[i] as number)} ${num(p[i + 1] as number)} l`;
				target.op(`${colour} ${d} h f`);
				if (restore) target.op('Q');
			}
		};
		if (opacity === 1) {
			drawFans(stream);
		} else {
			const form = group(context, area, deviceSpace(context.space), drawFans);
			stream.alpha(opacity);
			stream.op(`${stream.use('XObject', form)} Do`);
		}
		stream.op('Q');
		return;
	}
	const first = (paint.stops[0] as (typeof paint.stops)[number]).colour.a;
	const uniform = paint.stops.every((stop) => stop.colour.a === first);
	if (uniform) {
		stream.alpha(first);
	} else {
		// The opacities as a soft mask: the same geometry, greys for alpha.
		const maskShading = context.doc.add(shading(paint, context.space, true));
		const mask = new ContentStream(context);
		mask.op(`${mask.use('Shading', maskShading)} sh`);
		const form = context.doc.addStream(
			`/Type /XObject /Subtype /Form /BBox [${nums([area.x, area.y, area.x + area.width, area.y + area.height])}] /Group << /Type /Group /S /Transparency /CS /DeviceGray >> /Resources ${mask.resources()}`,
			mask.bytes(),
		);
		context.transparency = true;
		const state = context.doc.add(
			`<< /Type /ExtGState /SMask << /Type /Mask /S /Luminosity /G ${form} 0 R >> >>`,
		);
		stream.op(`${stream.use('ExtGState', state)} gs`);
	}
	const id = context.doc.add(shading(paint, context.space, false));
	stream.op(`${stream.use('Shading', id)} sh`);
	stream.op('Q');
}

/**
 * An image's pixels as Image XObjects: colour, and alpha as a soft mask when
 * any pixel is not opaque.
 *
 * A fully transparent pixel's colour is invisible, but a reader that smooths
 * the image interpolates colour and mask separately, so a transparent black
 * pixel beside a red one draws a dark fringe. Each transparent pixel takes
 * the colour of an opaque neighbour instead, which also means the export
 * holds nothing the picture does not show.
 */
function imageObject(context: PrintContext, image: RgbaImage): number {
	const known = context.images.get(image);
	if (known !== undefined) return known;
	const { width, height, data } = image;
	const pixels = width * height;
	const rgb = new Uint8Array(pixels * 3);
	const alpha = new Uint8Array(pixels);
	let translucent = false;
	for (let i = 0; i < pixels; i += 1) {
		const a = data[i * 4 + 3] as number;
		alpha[i] = a;
		if (a !== 255) translucent = true;
		if (a === 0) continue;
		rgb[i * 3] = data[i * 4] as number;
		rgb[i * 3 + 1] = data[i * 4 + 1] as number;
		rgb[i * 3 + 2] = data[i * 4 + 2] as number;
	}
	for (let i = 0; i < pixels; i += 1) {
		if (alpha[i] !== 0) continue;
		const x = i % width;
		const y = (i - x) / width;
		for (const [dx, dy] of NEIGHBOURS) {
			const nx = x + dx;
			const ny = y + dy;
			if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
			const j = ny * width + nx;
			if (alpha[j] === 0) continue;
			rgb.copyWithin(i * 3, j * 3, j * 3 + 3);
			break;
		}
	}
	let samples: Uint8Array = rgb;
	if (context.space === 'cmyk') {
		samples = new Uint8Array(pixels * 4);
		for (let i = 0; i < pixels; i += 1) {
			const cmyk = rgbToCmyk(
				rgb[i * 3] as number,
				rgb[i * 3 + 1] as number,
				rgb[i * 3 + 2] as number,
			);
			for (let c = 0; c < 4; c += 1) samples[i * 4 + c] = Math.round((cmyk[c] as number) * 255);
		}
	}
	const size = `/Type /XObject /Subtype /Image /Width ${width} /Height ${height} /BitsPerComponent 8`;
	let mask = '';
	if (translucent) {
		context.transparency = true;
		const id = context.doc.addStream(`${size} /ColorSpace /DeviceGray /Interpolate true`, alpha);
		mask = ` /SMask ${id} 0 R`;
	}
	const id = context.doc.addStream(
		`${size} /ColorSpace ${deviceSpace(context.space)} /Interpolate true${mask}`,
		samples,
	);
	context.images.set(image, id);
	return id;
}

/** The order an opaque neighbour is looked for in: the four sides, then the corners. */
const NEIGHBOURS: readonly (readonly [number, number])[] = [
	[-1, 0],
	[1, 0],
	[0, -1],
	[0, 1],
	[-1, -1],
	[1, -1],
	[-1, 1],
	[1, 1],
];

/** Draw a node. `visible` is the region of the scene that can be seen, in scene units. */
export function writeNode(stream: ContentStream, node: NormalNode, visible: Box): void {
	if (node.kind === 'path') {
		const area = within(bounds(node.path) as Box, visible);
		fillPaint(stream, node.path, node.paint, area);
		return;
	}
	if (node.kind === 'image') {
		const id = imageObject(stream.context, node.image);
		stream.op('q');
		if (node.clip !== null) {
			stream.path(node.clip);
			stream.op('W n');
		}
		// The image's unit square, its first row at the top: y runs down in
		// scene units, so the square is flipped back.
		stream.op(`${nums([node.width, 0, 0, -node.height, node.x, node.y + node.height])} cm`);
		stream.op(`${stream.use('XObject', id)} Do`);
		stream.op('Q');
		return;
	}
	const restore = node.clip !== null || node.opacity !== 1;
	if (restore) stream.op('q');
	if (node.clip !== null) {
		stream.path(node.clip);
		stream.op('W n');
	}
	if (node.opacity === 1) {
		for (const child of node.children) writeNode(stream, child, visible);
	} else {
		const form = group(stream.context, visible, deviceSpace(stream.context.space), (inner) => {
			for (const child of node.children) writeNode(inner, child, visible);
		});
		stream.alpha(node.opacity);
		stream.op(`${stream.use('XObject', form)} Do`);
	}
	if (restore) stream.op('Q');
}
