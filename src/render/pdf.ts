/**
 * The PDF writer: a scene as a one page PDF 1.7 at its true size, and a sheet
 * of scenes as a PDF of as many pages as it needs.
 *
 * The page is the size asked for in millimetres, plus the bleed, plus room
 * for crop marks when they are asked for. The boxes say which is which, so a
 * print workflow trims where it should: the TrimBox is the finished piece,
 * the BleedBox is the trim with the bleed around it (the background is drawn
 * out to it), and the MediaBox holds the crop marks as well, which stand off
 * the trim by the bleed or 3 mm, whichever is more, so they never print on
 * the piece.
 *
 * Colour is sRGB (DeviceRGB) or CMYK (DeviceCMYK); see `pdf-colour.ts` for
 * the conversion and its black rule, and `pdf-content.ts` for how each kind
 * of paint, clip, group and image is written. Crop marks are 0.25 pt lines in
 * registration colour (all four inks) in CMYK, so they print on every plate,
 * and in black in sRGB.
 *
 * The same scene gives the same bytes: every number is formatted here, every
 * object is numbered in the order it is made, the Info dictionary has a title
 * and a producer and no dates, the file identifier is a hash of the file, and
 * streams are compressed with this package's own deflate.
 */

import { QrStudioError } from '../core/errors.js';
import type { Box } from '../geometry/measure.js';
import { PathBuilder } from '../geometry/path.js';
import type { SheetDocument, SheetPage } from './impose.js';
import { MARK_LENGTH_MM, MARK_OFFSET_MM, checkTemplate } from './impose.js';
import { checkCmyk, checkSpace } from './pdf-colour.js';
import type { PrintSpace } from './pdf-colour.js';
import { ContentStream, fillPaint, writeNode } from './pdf-content.js';
import type { PrintContext } from './pdf-content.js';
import { PRODUCER, PdfDocument } from './pdf-document.js';
import { num, nums, textString } from './pdf-syntax.js';
import { normaliseScene } from './scene.js';
import type { NormalNode, NormalPaint, NormalScene } from './scene.js';
import type { Scene } from './types.js';

export interface PdfOptions {
	readonly colour: 'srgb' | 'cmyk';
	/** The trimmed width. */
	readonly widthMm: number;
	/** The trimmed height. Defaults to the width times the scene's aspect ratio. */
	readonly heightMm?: number;
	/** Background drawn this far past the trim on every side. Default 0. */
	readonly bleedMm?: number;
	readonly cropMarks?: boolean;
	/** The document title. Defaults to the scene's title, if it has one. */
	readonly title?: string;
}

export interface SheetPdfOptions {
	readonly colour: 'srgb' | 'cmyk';
	readonly title?: string;
}

/** Points to the millimetre. */
export const PT_PER_MM = 72 / 25.4;

/** The largest page PDF allows, 200 inches (14,400 units) a side, in millimetres. */
export const MAX_PAGE_MM = 5080;

/** The most bleed this writer will draw. Printers ask for 3 mm, sometimes 5. */
export const MAX_BLEED_MM = 50;

/** A crop mark's line weight in points: a hairline a press holds. */
const MARK_WEIGHT_PT = 0.25;

/** Where one scene goes on a page, in points with y up, as PDF measures. */
interface Placement {
	readonly scene: NormalScene;
	readonly left: number;
	readonly top: number;
	readonly width: number;
	readonly height: number;
	readonly bleed: number;
}

interface PageSpec {
	readonly width: number;
	readonly height: number;
	readonly trim: Box;
	readonly bleed: Box;
	readonly placements: readonly Placement[];
	/** Crop marks, in points with y up. */
	readonly marks: readonly Line[];
}

interface Line {
	readonly x1: number;
	readonly y1: number;
	readonly x2: number;
	readonly y2: number;
}

function paintColours(paint: NormalPaint, where: string): void {
	if (paint.kind === 'none') return;
	if (paint.kind === 'solid') checkCmyk(paint.colour, where);
	else for (const stop of paint.stops) checkCmyk(stop.colour, where);
}

function nodeColours(node: NormalNode, where: string): void {
	if (node.kind === 'path') paintColours(node.paint, where);
	else if (node.kind === 'group') for (const child of node.children) nodeColours(child, where);
}

/** Check a scene for the print writers: normalised, with every print value well formed. */
export function normalisePrintScene(scene: Scene, where: string): NormalScene {
	const normal = normaliseScene(scene, where);
	paintColours(normal.background, `${where}: background`);
	normal.layers.forEach((layer, i) => nodeColours(layer, `${where}: layer ${i}`));
	return normal;
}

/** Draw a scene into a page's content. */
function place(stream: ContentStream, placement: Placement): void {
	const { scene } = placement;
	const sx = placement.width / scene.width;
	const sy = placement.height / scene.height;
	// What can be seen: the scene and its bleed, in scene units.
	const bx = placement.bleed / sx;
	const by = placement.bleed / sy;
	const visible: Box = {
		x: -bx,
		y: -by,
		width: scene.width + 2 * bx,
		height: scene.height + 2 * by,
	};
	stream.op('q');
	stream.op(`${nums([sx, 0, 0, -sy], 8)} ${nums([placement.left, placement.top])} cm`);
	stream.rect(visible);
	stream.op('W n');
	if (scene.background.kind !== 'none') {
		const rect = new PathBuilder()
			.rect(visible.x, visible.y, visible.width, visible.height)
			.build();
		fillPaint(stream, rect, scene.background, visible);
	}
	for (const layer of scene.layers) writeNode(stream, layer, visible);
	stream.op('Q');
}

function box(b: Box): string {
	return `[${nums([b.x, b.y, b.x + b.width, b.y + b.height])}]`;
}

function writePdf(pages: readonly PageSpec[], space: PrintSpace, title: string | null): Uint8Array {
	const doc = new PdfDocument();
	const catalog = doc.reserve();
	const tree = doc.reserve();
	const info = doc.reserve();
	const kids: number[] = [];
	for (const page of pages) {
		const context: PrintContext = { doc, space, transparency: false, images: new Map() };
		const stream = new ContentStream(context);
		for (const placement of page.placements) place(stream, placement);
		if (page.marks.length > 0) {
			stream.op('q');
			stream.op(`${num(MARK_WEIGHT_PT)} w 0 J [] 0 d`);
			stream.op(space === 'srgb' ? '0 0 0 RG' : '1 1 1 1 K');
			for (const mark of page.marks) {
				stream.op(`${nums([mark.x1, mark.y1])} m ${nums([mark.x2, mark.y2])} l S`);
			}
			stream.op('Q');
		}
		const content = doc.addStream('', stream.bytes());
		const group = context.transparency
			? ` /Group << /Type /Group /S /Transparency /CS ${space === 'srgb' ? '/DeviceRGB' : '/DeviceCMYK'} >>`
			: '';
		kids.push(
			doc.add(
				`<< /Type /Page /Parent ${tree} 0 R /MediaBox [0 0 ${nums([page.width, page.height])}] /TrimBox ${box(page.trim)} /BleedBox ${box(page.bleed)} /Resources ${stream.resources()} /Contents ${content} 0 R${group} >>`,
			),
		);
	}
	doc.set(catalog, `<< /Type /Catalog /Pages ${tree} 0 R >>`);
	doc.set(
		tree,
		`<< /Type /Pages /Kids [${kids.map((id) => `${id} 0 R`).join(' ')}] /Count ${kids.length} >>`,
	);
	doc.set(
		info,
		`<< ${title === null ? '' : `/Title ${textString(title)} `}/Producer ${textString(PRODUCER)} >>`,
	);
	return doc.finish(catalog, info);
}

function length(value: unknown, name: string, where: string, zero: boolean): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || (!zero && value === 0)) {
		throw new TypeError(
			`${where}: ${name} is a finite number${zero ? ', zero or more' : ' more than zero'}.`,
		);
	}
	return value;
}

function coordinate(value: unknown, name: string, where: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		throw new TypeError(`${where}: ${name} is a finite number.`);
	}
	return value;
}

function tooLarge(where: string): never {
	throw new QrStudioError(
		'render/surface-too-large',
		'That page is larger than a PDF can be. Choose a smaller size.',
		{ maxMm: MAX_PAGE_MM, where },
	);
}

function titleOf(value: unknown, fallback: string | null, where: string): string | null {
	if (value === undefined) return fallback;
	if (typeof value !== 'string') throw new TypeError(`${where}: title is a string.`);
	return value;
}

/** A scene as a one page PDF at the size asked for. */
export function sceneToPdf(scene: Scene, options: PdfOptions): Uint8Array {
	const where = 'sceneToPdf';
	if (typeof options !== 'object' || options === null) {
		throw new TypeError(`${where}: options gives at least the colour and the width.`);
	}
	const space = checkSpace(options.colour, where);
	const normal = normalisePrintScene(scene, where);
	const widthMm = length(options.widthMm, 'widthMm', where, false);
	const heightMm =
		options.heightMm === undefined
			? (widthMm * normal.height) / normal.width
			: length(options.heightMm, 'heightMm', where, false);
	const bleedMm = length(options.bleedMm ?? 0, 'bleedMm', where, true);
	if (bleedMm > MAX_BLEED_MM) throw new TypeError(`${where}: bleedMm is at most ${MAX_BLEED_MM}.`);
	const marks = options.cropMarks ?? false;
	if (typeof marks !== 'boolean') throw new TypeError(`${where}: cropMarks is true or false.`);
	const title = titleOf(options.title, normal.title, where);

	const offset = Math.max(MARK_OFFSET_MM, bleedMm);
	const margin = marks ? offset + MARK_LENGTH_MM : bleedMm;
	if (widthMm + 2 * margin > MAX_PAGE_MM || heightMm + 2 * margin > MAX_PAGE_MM) tooLarge(where);
	const pt = (mm: number): number => mm * PT_PER_MM;
	const trim: Box = { x: pt(margin), y: pt(margin), width: pt(widthMm), height: pt(heightMm) };
	const page = { width: pt(widthMm + 2 * margin), height: pt(heightMm + 2 * margin) };
	const bleed: Box = {
		x: pt(margin - bleedMm),
		y: pt(margin - bleedMm),
		width: pt(widthMm + 2 * bleedMm),
		height: pt(heightMm + 2 * bleedMm),
	};
	const lines: Line[] = [];
	if (marks) {
		// Two marks at each corner of the trim, in the slug outside the bleed.
		const left = trim.x;
		const right = trim.x + trim.width;
		const bottom = trim.y;
		const top = trim.y + trim.height;
		const near = pt(offset);
		const far = pt(offset + MARK_LENGTH_MM);
		for (const x of [left, right]) {
			for (const y of [bottom, top]) {
				const outX = x === left ? -1 : 1;
				const outY = y === bottom ? -1 : 1;
				lines.push({ x1: x + outX * near, y1: y, x2: x + outX * far, y2: y });
				lines.push({ x1: x, y1: y + outY * near, x2: x, y2: y + outY * far });
			}
		}
	}
	return writePdf(
		[
			{
				...page,
				trim,
				bleed,
				placements: [
					{
						scene: normal,
						left: trim.x,
						top: trim.y + trim.height,
						width: trim.width,
						height: trim.height,
						bleed: pt(bleedMm),
					},
				],
				marks: lines,
			},
		],
		space,
		title,
	);
}

/** A sheet from `imposeSheet` as a PDF, a page per sheet. */
export function sheetToPdf(sheet: SheetDocument, options: SheetPdfOptions): Uint8Array {
	const where = 'sheetToPdf';
	if (typeof sheet !== 'object' || sheet === null || !Array.isArray(sheet.pages)) {
		throw new TypeError(`${where}: sheet is what imposeSheet returns.`);
	}
	if (typeof options !== 'object' || options === null) {
		throw new TypeError(`${where}: options gives at least the colour.`);
	}
	const space = checkSpace(options.colour, where);
	const title = titleOf(options.title, null, where);
	checkTemplate(sheet.template);
	const { widthMm, heightMm } = sheet.template.page;
	if (widthMm > MAX_PAGE_MM || heightMm > MAX_PAGE_MM) tooLarge(where);
	const pt = (mm: number): number => mm * PT_PER_MM;
	const whole: Box = { x: 0, y: 0, width: pt(widthMm), height: pt(heightMm) };
	// An empty sheet is still a page, so the file is a document a reader opens.
	const pages: readonly SheetPage[] =
		sheet.pages.length === 0 ? [{ cells: [], marks: [] }] : sheet.pages;
	const specs: PageSpec[] = pages.map((page, p) => ({
		width: whole.width,
		height: whole.height,
		trim: whole,
		bleed: whole,
		placements: page.cells.map((cell, i) => {
			const at = `${where}: page ${p} cell ${i}`;
			const bleed = length(cell.bleedMm, 'bleedMm', at, true);
			if (bleed > MAX_BLEED_MM) throw new TypeError(`${at}: bleedMm is at most ${MAX_BLEED_MM}.`);
			return {
				scene: normalisePrintScene(cell.scene, at),
				left: pt(coordinate(cell.xMm, 'xMm', at)),
				top: pt(heightMm - coordinate(cell.yMm, 'yMm', at)),
				width: pt(length(cell.widthMm, 'widthMm', at, false)),
				height: pt(length(cell.heightMm, 'heightMm', at, false)),
				bleed: pt(bleed),
			};
		}),
		marks: page.marks.map((mark, i) => {
			const at = `${where}: page ${p} mark ${i}`;
			return {
				x1: pt(coordinate(mark.x1Mm, 'x1Mm', at)),
				y1: pt(heightMm - coordinate(mark.y1Mm, 'y1Mm', at)),
				x2: pt(coordinate(mark.x2Mm, 'x2Mm', at)),
				y2: pt(heightMm - coordinate(mark.y2Mm, 'y2Mm', at)),
			};
		}),
	}));
	return writePdf(specs, space, title);
}
