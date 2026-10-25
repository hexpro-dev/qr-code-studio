/**
 * The EPS writer: a scene as Encapsulated PostScript 3.0 at its true size.
 *
 * EPS is for the print and sign workflows that still ask for it. It shares
 * the PDF writer's colour handling (`pdf-colour.ts`, the same black rule in
 * CMYK) and its gradient functions (`pdf-syntax.ts`), drawn here with
 * PostScript Level 3 `shfill`; conic gradients are the same wedges; clips are
 * clipping paths; images go through the `image` operator from Flate data in
 * ASCII85 strings, so the file is seven bit text throughout.
 *
 * PostScript has no transparency. A translucent colour, a gradient stop that
 * is not opaque, a group with an opacity, or an image with soft edges cannot
 * be written without changing the picture, and compositing it over white
 * would be wrong wherever it lies over anything else. So the writer refuses
 * such a scene: `epsIssues` lists every translucent part, and `sceneToEps`
 * throws 'render/format-unavailable' (params.format 'eps', params.reason
 * 'transparency') rather than write a different picture. An image whose
 * pixels are each fully opaque or fully transparent is exact as a masked
 * image (ImageType 3), and is written as one.
 *
 * `%%HiResBoundingBox` is the page exactly; `%%BoundingBox`, which DSC
 * requires in whole points, is the same box rounded outwards. Nothing in the
 * file depends on the time, so the same scene gives the same text.
 */

import { QrStudioError } from '../core/errors.js';
import { zlibWrap } from '../core/deflate.js';
import { issue } from '../core/issue.js';
import type { Issue } from '../core/issue.js';
import type { Box } from '../geometry/measure.js';
import { bounds } from '../geometry/measure.js';
import { PathBuilder, walkPath } from '../geometry/path.js';
import type { Path } from '../geometry/path.js';
import { conicWedges } from './conic.js';
import type { PrintSpace } from './pdf-colour.js';
import { checkSpace, components, rgbToCmyk } from './pdf-colour.js';
import { within } from './pdf-content.js';
import { PRODUCER } from './pdf-document.js';
import { MAX_PAGE_MM, PT_PER_MM, normalisePrintScene } from './pdf.js';
import { num, nums, stopsFunction } from './pdf-syntax.js';
import type { DrawnPaint, NormalNode, NormalPaint } from './scene.js';
import type { Colour, RgbaImage, Scene } from './types.js';

export interface EpsOptions {
	readonly colour: 'srgb' | 'cmyk';
	readonly widthMm: number;
}

/** Bytes of image data in each ASCII85 string, well inside PostScript's 65,535 byte limit. */
const CHUNK = 32768;
/** Characters on a line of ASCII85, under the 255 DSC asks for. */
const LINE = 76;
/** Where a line of operators is broken. */
const WRAP = 200;

function opaque(paint: NormalPaint): boolean {
	if (paint.kind === 'none') return true;
	if (paint.kind === 'solid') return paint.colour.a === 1;
	return paint.stops.every((stop) => stop.colour.a === 1);
}

/** Whether every pixel is fully opaque or fully transparent. */
function binaryAlpha(image: RgbaImage): boolean {
	for (let i = 3; i < image.data.length; i += 4) {
		const a = image.data[i] as number;
		if (a !== 0 && a !== 255) return false;
	}
	return true;
}

function nodeIssues(node: NormalNode, path: (string | number)[], out: Issue[]): void {
	if (node.kind === 'path') {
		if (!opaque(node.paint)) out.push(issue('render.eps.transparency', path));
		return;
	}
	if (node.kind === 'image') {
		if (!binaryAlpha(node.image)) out.push(issue('render.eps.transparency', path));
		return;
	}
	if (node.opacity !== 1) out.push(issue('render.eps.transparency', path));
	node.children.forEach((child, i) => nodeIssues(child, [...path, 'children', i], out));
}

/**
 * Every part of a scene EPS cannot draw, as 'render.eps.transparency' issues
 * with the path to each part. Empty when the scene can be written. Throws a
 * TypeError for a malformed scene, as the writers do.
 */
export function epsIssues(scene: Scene): readonly Issue[] {
	const normal = normalisePrintScene(scene, 'epsIssues');
	const out: Issue[] = [];
	if (!opaque(normal.background)) out.push(issue('render.eps.transparency', ['background']));
	normal.layers.forEach((layer, i) => nodeIssues(layer, ['layers', i], out));
	return out;
}

/** ASCII85 (Adobe's variant, `z` for four zeros), as a PostScript string literal. */
export function ascii85(bytes: Uint8Array): string {
	let out = '<~';
	let line = 2;
	const emit = (text: string): void => {
		if (line + text.length > LINE) {
			out += '\n';
			line = 0;
		}
		out += text;
		line += text.length;
	};
	for (let i = 0; i < bytes.length; i += 4) {
		const n = Math.min(4, bytes.length - i);
		let value = 0;
		for (let j = 0; j < 4; j += 1) value = value * 256 + (j < n ? (bytes[i + j] as number) : 0);
		if (n === 4 && value === 0) {
			emit('z');
			continue;
		}
		let group = '';
		for (let j = 0; j < 5; j += 1) {
			group = String.fromCharCode(33 + (value % 85)) + group;
			value = Math.floor(value / 85);
		}
		emit(group.slice(0, n + 1));
	}
	emit('~>');
	return out;
}

/** Compressed data as a procedure that hands it out a string at a time, then an empty one. */
function dataSource(name: string, bytes: Uint8Array): { define: string; source: string } {
	const packed = zlibWrap(bytes, { level: 6 });
	const strings: string[] = [];
	for (let i = 0; i < packed.length; i += CHUNK)
		strings.push(ascii85(packed.subarray(i, i + CHUNK)));
	return {
		define: `/${name}D [\n${strings.join('\n')}\n] def /${name}I 0 def`,
		source: `{ ${name}I ${name}D length lt { ${name}D ${name}I get /${name}I ${name}I 1 add def } { () } ifelse } /FlateDecode filter`,
	};
}

class Writer {
	readonly lines: string[] = [];
	private images = 0;

	constructor(readonly space: PrintSpace) {}

	/**
	 * Add operators, broken at spaces so no line passes the 255 characters
	 * DSC allows. PostScript reads any run of white space as one, and nothing
	 * written here has a space inside a token (strings are ASCII85 or empty).
	 */
	op(text: string): void {
		for (const line of text.split('\n')) {
			if (line.length <= WRAP) {
				this.lines.push(line);
				continue;
			}
			let current = '';
			for (const word of line.split(' ')) {
				if (current.length > 0 && current.length + 1 + word.length > WRAP) {
					this.lines.push(current);
					current = word;
				} else {
					current = current.length === 0 ? word : `${current} ${word}`;
				}
			}
			this.lines.push(current);
		}
	}

	colour(colour: Colour): string {
		return `${nums(components(colour, this.space))} ${this.space === 'srgb' ? 'rg' : 'k'}`;
	}

	path(path: Path): void {
		let x = 0;
		let y = 0;
		let startX = 0;
		let startY = 0;
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
					const c = [
						x + ((cx - x) * 2) / 3,
						y + ((cy - y) * 2) / 3,
						px + ((cx - px) * 2) / 3,
						py + ((cy - py) * 2) / 3,
					];
					parts.push(`${nums([...c, px, py])} c`);
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
			'sceneToEps',
		);
		this.op(parts.join(' '));
	}

	fill(shape: Path, paint: DrawnPaint, area: Box): void {
		if (paint.kind === 'solid') {
			this.op(this.colour(paint.colour));
			this.path(shape);
			this.op('f');
			return;
		}
		this.op('q');
		this.path(shape);
		this.op('W');
		if (paint.kind === 'conic') {
			// Every stop is opaque here, so the wedges are too, and each is drawn
			// on beneath the next with no seams to leak.
			for (const fan of conicWedges(paint, area).fans) {
				const colour =
					this.space === 'srgb'
						? `${nums([fan.r / 255, fan.g / 255, fan.b / 255])} rg`
						: `${nums(rgbToCmyk(fan.r, fan.g, fan.b))} k`;
				const p = fan.points;
				let d = `${num(p[0] as number)} ${num(p[1] as number)} m`;
				for (let i = 2; i < p.length; i += 2)
					d += ` ${num(p[i] as number)} ${num(p[i + 1] as number)} l`;
				this.op(`${colour} ${d} h f`);
			}
		} else {
			const colourSpace = this.space === 'srgb' ? '/DeviceRGB' : '/DeviceCMYK';
			const coords =
				paint.kind === 'linear'
					? `/ShadingType 2 /Coords [${nums([paint.x1, paint.y1, paint.x2, paint.y2])}]`
					: `/ShadingType 3 /Coords [${nums([paint.cx, paint.cy, 0, paint.cx, paint.cy, paint.r])}]`;
			this.op(
				`<< ${coords} /ColorSpace ${colourSpace} /Function ${stopsFunction(paint.stops, this.space)} /Extend [true true] >> shfill`,
			);
		}
		this.op('Q');
	}

	image(node: Extract<NormalNode, { kind: 'image' }>): void {
		const { image } = node;
		const { width, height, data } = image;
		const pixels = width * height;
		const channels = this.space === 'srgb' ? 3 : 4;
		const samples = new Uint8Array(pixels * channels);
		const rowBytes = Math.ceil(width / 8);
		const mask = new Uint8Array(rowBytes * height);
		let masked = false;
		for (let i = 0; i < pixels; i += 1) {
			const r = data[i * 4] as number;
			const g = data[i * 4 + 1] as number;
			const b = data[i * 4 + 2] as number;
			if (this.space === 'srgb') samples.set([r, g, b], i * 3);
			else
				samples.set(
					rgbToCmyk(r, g, b).map((v) => Math.round(v * 255)),
					i * 4,
				);
			if (data[i * 4 + 3] === 0) {
				masked = true;
				const x = i % width;
				const y = (i - x) / width;
				// A set bit is a pixel left unpainted.
				mask[y * rowBytes + (x >> 3)] =
					(mask[y * rowBytes + (x >> 3)] as number) | (0x80 >> (x & 7));
			}
		}
		const id = `qrs${this.images}`;
		this.images += 1;
		const colour = dataSource(id, samples);
		this.op('q');
		if (node.clip !== null) {
			this.path(node.clip);
			this.op('W');
		}
		this.op(`${nums([node.x, node.y])} translate ${nums([node.width, node.height])} scale`);
		this.op(colour.define);
		const decode = this.space === 'srgb' ? '[0 1 0 1 0 1]' : '[0 1 0 1 0 1 0 1]';
		const colourSpace = this.space === 'srgb' ? '/DeviceRGB' : '/DeviceCMYK';
		// The unit square, its first row at the top: scene y already runs down.
		const placement = `/Width ${width} /Height ${height} /ImageMatrix [${width} 0 0 ${height} 0 0]`;
		const dataDict = `<< /ImageType 1 ${placement} /BitsPerComponent 8 /Decode ${decode} /Interpolate true /DataSource ${colour.source} >>`;
		this.op(`${colourSpace} setcolorspace`);
		if (!masked) {
			this.op(`${dataDict} image`);
		} else {
			const bits = dataSource(`${id}m`, mask);
			this.op(bits.define);
			this.op(
				`<< /ImageType 3 /InterleaveType 3 /DataDict ${dataDict} /MaskDict << /ImageType 1 ${placement} /BitsPerComponent 1 /Decode [0 1] /DataSource ${bits.source} >> >> image`,
			);
		}
		this.op('Q');
	}

	node(node: NormalNode, visible: Box): void {
		if (node.kind === 'path') {
			this.fill(node.path, node.paint, within(bounds(node.path) as Box, visible));
			return;
		}
		if (node.kind === 'image') {
			this.image(node);
			return;
		}
		// Opacity is always 1 here: anything else was refused.
		if (node.clip === null) {
			for (const child of node.children) this.node(child, visible);
			return;
		}
		this.op('q');
		this.path(node.clip);
		this.op('W');
		for (const child of node.children) this.node(child, visible);
		this.op('Q');
	}
}

/** Text for a DSC comment: printable ASCII, other characters as `?`, in parentheses. */
function dscText(text: string): string {
	return `(${text.replace(/[^\x20-\x7e]/g, '?').replace(/[\\()]/g, (c) => `\\${c}`)})`;
}

/** A scene as an EPS file at `widthMm` wide, its height from the scene's aspect ratio. */
export function sceneToEps(scene: Scene, options: EpsOptions): string {
	const where = 'sceneToEps';
	if (typeof options !== 'object' || options === null) {
		throw new TypeError(`${where}: options gives the colour and the width.`);
	}
	const space = checkSpace(options.colour, where);
	const normal = normalisePrintScene(scene, where);
	const widthMm = options.widthMm;
	if (typeof widthMm !== 'number' || !Number.isFinite(widthMm) || widthMm <= 0) {
		throw new TypeError(`${where}: widthMm is a finite number more than zero.`);
	}
	const heightMm = (widthMm * normal.height) / normal.width;
	if (widthMm > MAX_PAGE_MM || heightMm > MAX_PAGE_MM) {
		throw new QrStudioError(
			'render/surface-too-large',
			'That page is larger than a PDF can be. Choose a smaller size.',
			{
				maxMm: MAX_PAGE_MM,
				where,
			},
		);
	}
	const issues = epsIssues(scene);
	if (issues.length > 0) {
		throw new QrStudioError(
			'render/format-unavailable',
			'EPS cannot carry transparency. Save this design as a PDF, or make every colour in it opaque.',
			{ format: 'eps', reason: 'transparency', count: issues.length },
		);
	}
	const width = widthMm * PT_PER_MM;
	const height = heightMm * PT_PER_MM;
	const writer = new Writer(space);
	const visible: Box = { x: 0, y: 0, width: normal.width, height: normal.height };
	writer.op('qrs begin');
	writer.op('q');
	writer.op(
		`[${nums([width / normal.width, 0, 0, -height / normal.height], 8)} 0 ${num(height)}] concat`,
	);
	writer.path(new PathBuilder().rect(0, 0, normal.width, normal.height).build());
	writer.op('W');
	if (normal.background.kind !== 'none') {
		writer.fill(
			new PathBuilder().rect(0, 0, normal.width, normal.height).build(),
			normal.background,
			visible,
		);
	}
	for (const layer of normal.layers) writer.node(layer, visible);
	writer.op('Q');
	writer.op('end');

	const header = [
		'%!PS-Adobe-3.0 EPSF-3.0',
		`%%BoundingBox: 0 0 ${Math.ceil(width - 1e-9)} ${Math.ceil(height - 1e-9)}`,
		`%%HiResBoundingBox: 0 0 ${num(width)} ${num(height)}`,
		...(normal.title === null ? [] : [`%%Title: ${dscText(normal.title)}`]),
		`%%Creator: ${dscText(PRODUCER)}`,
		'%%LanguageLevel: 3',
		'%%DocumentData: Clean7Bit',
		'%%Pages: 1',
		'%%EndComments',
		'%%BeginProlog',
		'/qrs 32 dict def qrs begin',
		'/q /gsave load def /Q /grestore load def',
		'/m /moveto load def /l /lineto load def /c /curveto load def /h /closepath load def',
		'/f /fill load def /W { clip newpath } bind def',
		'/rg /setrgbcolor load def /k /setcmykcolor load def',
		'end',
		'%%EndProlog',
		'%%Page: 1 1',
	];
	const footer = ['showpage', '%%Trailer', '%%EOF', ''];
	return [...header, ...writer.lines, ...footer].join('\n');
}
