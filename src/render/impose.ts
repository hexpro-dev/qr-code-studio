/**
 * Putting codes on sheets: label stock, business card stock, and a sheet of
 * copies with crop marks for a guillotine.
 *
 * A template describes the stock in millimetres from the sheet's top left
 * corner: the page, a grid of cells, where the first cell starts and the gaps
 * between cells. `imposeSheet` fills the cells in reading order, page after
 * page, and returns where every scene goes, which `sheetToPdf` writes.
 *
 * Every scene is placed at its true size, from its `unitsPerMm`, centred in
 * its cell. A code is never scaled to fit a label unless the caller asks
 * (`fit: 'contain'`), because a code printed smaller than designed may not
 * scan from the distance it was designed for. One that is larger than its
 * cell is still placed, centred, and reported as an issue, so the studio can
 * say so rather than quietly print a code that runs off the label.
 *
 * Crop marks, when the template asks for them, are drawn in the margins only,
 * one pair at every cut: each column's left and right edges above and below
 * the grid, each row's top and bottom edges either side of it. Every mark
 * stops short of the grid, so a mark never prints on a code, and a cutter
 * lines the blade up with a pair across the sheet.
 */

import { issue } from '../core/issue.js';
import type { Issue } from '../core/issue.js';
import type { Scene } from './types.js';

export interface SheetTemplate {
	/** Kebab-case. */
	readonly id: string;
	readonly labelKey: string;
	readonly page: { readonly widthMm: number; readonly heightMm: number };
	readonly columns: number;
	readonly rows: number;
	readonly cell: { readonly widthMm: number; readonly heightMm: number };
	/** The top left corner of the first cell, from the top left of the page. */
	readonly origin: { readonly xMm: number; readonly yMm: number };
	readonly gap: { readonly xMm: number; readonly yMm: number };
	/** The label's corners, for a preview; half the width for a round label. */
	readonly cornerRadiusMm?: number;
	/** Draw crop marks in the margins. Default false. */
	readonly cropMarks?: boolean;
	/** How far each scene's background runs past its edge, for trimming. Default 0. */
	readonly bleedMm?: number;
}

export interface ImposeOptions {
	/** 'none' (the default) places every scene at its true size; 'contain' scales each to fit its cell. */
	readonly fit?: 'none' | 'contain';
	/** Cells on the first page to leave empty, for a sheet that has been used before. Default 0. */
	readonly skip?: number;
}

/** One scene on a page, in millimetres from the page's top left corner. */
export interface SheetCell {
	/** Which of the scenes passed in this is. */
	readonly index: number;
	readonly column: number;
	readonly row: number;
	readonly scene: Scene;
	/** Where the scene's own box goes. */
	readonly xMm: number;
	readonly yMm: number;
	readonly widthMm: number;
	readonly heightMm: number;
	readonly bleedMm: number;
}

/** A crop mark: a line in millimetres from the page's top left corner. */
export interface SheetMark {
	readonly x1Mm: number;
	readonly y1Mm: number;
	readonly x2Mm: number;
	readonly y2Mm: number;
}

export interface SheetPage {
	readonly cells: readonly SheetCell[];
	readonly marks: readonly SheetMark[];
}

export interface SheetDocument {
	readonly template: SheetTemplate;
	readonly pages: readonly SheetPage[];
	readonly issues: readonly Issue[];
}

/** How long a crop mark is, and how far it stays from the edge it marks. */
export const MARK_LENGTH_MM = 5;
export const MARK_OFFSET_MM = 3;

/** Room for rounding when checking that a grid fits its page. */
const SLACK_MM = 1e-6;

const KEBAB = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

function positive(value: unknown, name: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
		throw new TypeError(`imposeSheet: the template's ${name} is a finite number more than zero.`);
	}
	return value;
}

function nonNegative(value: unknown, name: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
		throw new TypeError(`imposeSheet: the template's ${name} is a finite number, zero or more.`);
	}
	return value;
}

function count(value: unknown, name: string): number {
	if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 1000) {
		throw new TypeError(`imposeSheet: the template's ${name} is a whole number from 1 to 1000.`);
	}
	return value as number;
}

/** Throw a TypeError unless the template describes a grid that fits its page. */
export function checkTemplate(template: SheetTemplate): void {
	if (typeof template !== 'object' || template === null) {
		throw new TypeError('imposeSheet: the template is an object.');
	}
	if (typeof template.id !== 'string' || !KEBAB.test(template.id)) {
		throw new TypeError("imposeSheet: the template's id is kebab-case.");
	}
	if (typeof template.labelKey !== 'string') {
		throw new TypeError("imposeSheet: the template's labelKey is a string.");
	}
	const page = template.page ?? {};
	const cell = template.cell ?? {};
	const origin = template.origin ?? {};
	const gap = template.gap ?? {};
	const pageWidth = positive(page.widthMm, 'page width');
	const pageHeight = positive(page.heightMm, 'page height');
	const columns = count(template.columns, 'column count');
	const rows = count(template.rows, 'row count');
	const width = positive(cell.widthMm, 'cell width');
	const height = positive(cell.heightMm, 'cell height');
	const x = nonNegative(origin.xMm, 'origin x');
	const y = nonNegative(origin.yMm, 'origin y');
	const gapX = nonNegative(gap.xMm, 'gap x');
	const gapY = nonNegative(gap.yMm, 'gap y');
	if (template.cornerRadiusMm !== undefined) nonNegative(template.cornerRadiusMm, 'corner radius');
	if (template.bleedMm !== undefined) nonNegative(template.bleedMm, 'bleed');
	if (template.cropMarks !== undefined && typeof template.cropMarks !== 'boolean') {
		throw new TypeError("imposeSheet: the template's cropMarks is true or false.");
	}
	const right = x + columns * width + (columns - 1) * gapX;
	const bottom = y + rows * height + (rows - 1) * gapY;
	if (right > pageWidth + SLACK_MM || bottom > pageHeight + SLACK_MM) {
		throw new TypeError("imposeSheet: the template's grid does not fit on its page.");
	}
}

/** The left edge of column `c` and the top edge of row `r`, in millimetres. */
function cellAt(template: SheetTemplate, c: number, r: number): { x: number; y: number } {
	return {
		x: template.origin.xMm + c * (template.cell.widthMm + template.gap.xMm),
		y: template.origin.yMm + r * (template.cell.heightMm + template.gap.yMm),
	};
}

/** The crop marks for a template: in the margins, at every cut. */
export function cropMarks(template: SheetTemplate): SheetMark[] {
	const marks: SheetMark[] = [];
	const bleed = template.bleedMm ?? 0;
	const offset = Math.max(MARK_OFFSET_MM, bleed);
	const first = cellAt(template, 0, 0);
	const last = cellAt(template, template.columns - 1, template.rows - 1);
	const top = first.y - offset;
	const bottom = last.y + template.cell.heightMm + offset;
	const left = first.x - offset;
	const right = last.x + template.cell.widthMm + offset;
	for (let c = 0; c < template.columns; c += 1) {
		const { x } = cellAt(template, c, 0);
		for (const edge of [x, x + template.cell.widthMm]) {
			marks.push({ x1Mm: edge, y1Mm: top - MARK_LENGTH_MM, x2Mm: edge, y2Mm: top });
			marks.push({ x1Mm: edge, y1Mm: bottom, x2Mm: edge, y2Mm: bottom + MARK_LENGTH_MM });
		}
	}
	for (let r = 0; r < template.rows; r += 1) {
		const { y } = cellAt(template, 0, r);
		for (const edge of [y, y + template.cell.heightMm]) {
			marks.push({ x1Mm: left - MARK_LENGTH_MM, y1Mm: edge, x2Mm: left, y2Mm: edge });
			marks.push({ x1Mm: right, y1Mm: edge, x2Mm: right + MARK_LENGTH_MM, y2Mm: edge });
		}
	}
	// Neighbouring cells with no gap share an edge, and its marks are drawn
	// once. The edge is reached two ways (the bottom of one row, the top of
	// the next), which can differ in the last place, so marks are compared to
	// a millionth of a millimetre.
	const seen = new Set<string>();
	return marks.filter((mark) => {
		const key = [mark.x1Mm, mark.y1Mm, mark.x2Mm, mark.y2Mm]
			.map((v) => Math.round(v * 1e6))
			.join(',');
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

/** A scene's size in millimetres at its true size, or null when it has none. */
function trueSize(scene: Scene): { width: number; height: number } | null {
	const units = scene.unitsPerMm;
	if (units === undefined) return null;
	if (typeof units !== 'number' || !Number.isFinite(units) || units <= 0) {
		throw new TypeError("imposeSheet: a scene's unitsPerMm is a finite number more than zero.");
	}
	return { width: scene.width / units, height: scene.height / units };
}

/** Lay `cells` out on sheets of `template`. */
export function imposeSheet(
	cells: readonly Scene[],
	template: SheetTemplate,
	options: ImposeOptions = {},
): SheetDocument {
	if (!Array.isArray(cells)) throw new TypeError('imposeSheet: cells is a list of scenes.');
	checkTemplate(template);
	if (typeof options !== 'object' || options === null) {
		throw new TypeError('imposeSheet: options is an object.');
	}
	const fit = options.fit ?? 'none';
	if (fit !== 'none' && fit !== 'contain')
		throw new TypeError("imposeSheet: fit is 'none' or 'contain'.");
	const perPage = template.columns * template.rows;
	const skip = options.skip ?? 0;
	if (!Number.isInteger(skip) || skip < 0 || skip >= perPage) {
		throw new TypeError('imposeSheet: skip is a whole number of cells, fewer than a page holds.');
	}
	const bleed = template.bleedMm ?? 0;
	const marks = template.cropMarks === true ? cropMarks(template) : [];
	const issues: Issue[] = [];
	const pages: { cells: SheetCell[]; marks: readonly SheetMark[] }[] = [];
	cells.forEach((scene, index) => {
		if (typeof scene !== 'object' || scene === null) {
			throw new TypeError(`imposeSheet: cell ${index} is not a scene.`);
		}
		if (
			typeof scene.width !== 'number' ||
			typeof scene.height !== 'number' ||
			!(scene.width > 0) ||
			!(scene.height > 0) ||
			!Number.isFinite(scene.width) ||
			!Number.isFinite(scene.height)
		) {
			throw new TypeError(`imposeSheet: cell ${index} has no size.`);
		}
		const slot = index + skip;
		const pageIndex = Math.floor(slot / perPage);
		const within = slot % perPage;
		const column = within % template.columns;
		const row = Math.floor(within / template.columns);
		const at = cellAt(template, column, row);
		let size = trueSize(scene);
		if (fit === 'contain' || size === null) {
			if (fit === 'none') {
				throw new TypeError(
					`imposeSheet: cell ${index} has no physical size. Give the scene unitsPerMm, or pass fit: 'contain'.`,
				);
			}
			const scale = Math.min(
				template.cell.widthMm / scene.width,
				template.cell.heightMm / scene.height,
			);
			size = { width: scene.width * scale, height: scene.height * scale };
		} else if (
			size.width > template.cell.widthMm + SLACK_MM ||
			size.height > template.cell.heightMm + SLACK_MM
		) {
			issues.push(
				issue('sheet.cell-too-small', ['cells', index], 'warning', {
					widthMm: Math.round(size.width * 10) / 10,
					heightMm: Math.round(size.height * 10) / 10,
				}),
			);
		}
		while (pages.length <= pageIndex) pages.push({ cells: [], marks });
		(pages[pageIndex] as (typeof pages)[number]).cells.push(
			Object.freeze({
				index,
				column,
				row,
				scene,
				xMm: at.x + (template.cell.widthMm - size.width) / 2,
				yMm: at.y + (template.cell.heightMm - size.height) / 2,
				widthMm: size.width,
				heightMm: size.height,
				bleedMm: bleed,
			}),
		);
	});
	return Object.freeze({
		template,
		pages: Object.freeze(
			pages.map((page) => Object.freeze({ cells: Object.freeze(page.cells), marks: page.marks })),
		),
		issues: Object.freeze(issues),
	});
}

/** `copies` of one scene, filling as many sheets as they need. */
export function imposeCopies(
	scene: Scene,
	copies: number,
	template: SheetTemplate,
	options: ImposeOptions = {},
): SheetDocument {
	if (!Number.isInteger(copies) || copies < 1 || copies > 10000) {
		throw new TypeError('imposeCopies: copies is a whole number from 1 to 10000.');
	}
	return imposeSheet(new Array<Scene>(copies).fill(scene), template, options);
}

export type Paper = 'a4' | 'letter';

/** ISO 216 A4, and US Letter (8.5 by 11 inches) in millimetres. */
export const PAPER: Readonly<
	Record<Paper, { readonly widthMm: number; readonly heightMm: number }>
> = Object.freeze({
	a4: Object.freeze({ widthMm: 210, heightMm: 297 }),
	letter: Object.freeze({ widthMm: 215.9, heightMm: 279.4 }),
});

export interface PrintSheetOptions {
	readonly paper: Paper;
	/** The size of each copy. */
	readonly widthMm: number;
	/** Defaults to the width: codes are square. */
	readonly heightMm?: number;
	/** Default 0. */
	readonly bleedMm?: number;
	/** Between neighbouring copies. Defaults to twice the bleed, and at least 3 mm so each copy is cut on its own. */
	readonly gapMm?: number;
	/** The least room left at each edge of the paper, for the crop marks and the printer's grip. Default 12. */
	readonly marginMm?: number;
}

/**
 * A template for a sheet of copies of one code at one size, with crop marks:
 * as many as fit inside the margins, the grid centred on the paper.
 *
 * The margin must hold the crop marks, which stand off the grid by the bleed
 * or 3 mm, whichever is more, and are 5 mm long; a margin too small for them
 * is a TypeError, as is a size that leaves room for no copies at all.
 */
export function printSheetTemplate(options: PrintSheetOptions): SheetTemplate {
	if (typeof options !== 'object' || options === null) {
		throw new TypeError('printSheetTemplate: options gives at least the paper and the size.');
	}
	const paper = PAPER[options.paper];
	if (paper === undefined || !Object.hasOwn(PAPER, options.paper)) {
		throw new TypeError("printSheetTemplate: paper is 'a4' or 'letter'.");
	}
	const check = (value: unknown, name: string, zero: boolean): number => {
		if (
			typeof value !== 'number' ||
			!Number.isFinite(value) ||
			value < 0 ||
			(!zero && value === 0)
		) {
			throw new TypeError(
				`printSheetTemplate: ${name} is a finite number${zero ? ', zero or more' : ' more than zero'}.`,
			);
		}
		return value;
	};
	const width = check(options.widthMm, 'widthMm', false);
	const height = check(options.heightMm ?? width, 'heightMm', false);
	const bleed = check(options.bleedMm ?? 0, 'bleedMm', true);
	const gap = check(options.gapMm ?? Math.max(2 * bleed, 3), 'gapMm', true);
	const margin = check(options.marginMm ?? 12, 'marginMm', true);
	if (margin < Math.max(MARK_OFFSET_MM, bleed) + MARK_LENGTH_MM) {
		throw new TypeError('printSheetTemplate: the margin is too small to hold the crop marks.');
	}
	if (gap < 2 * bleed) {
		throw new TypeError(
			'printSheetTemplate: the gap must hold the bleed of the copies either side.',
		);
	}
	const fits = (room: number, size: number): number =>
		Math.floor((room - size) / (size + gap) + 1 + SLACK_MM);
	const columns = fits(paper.widthMm - 2 * margin, width);
	const rows = fits(paper.heightMm - 2 * margin, height);
	if (columns < 1 || rows < 1) {
		throw new TypeError(
			'printSheetTemplate: that size does not fit on the paper inside the margins.',
		);
	}
	const gridWidth = columns * width + (columns - 1) * gap;
	const gridHeight = rows * height + (rows - 1) * gap;
	return Object.freeze({
		id: `print-${options.paper}`,
		labelKey: `sheet.template.print-${options.paper}`,
		page: paper,
		columns,
		rows,
		cell: Object.freeze({ widthMm: width, heightMm: height }),
		origin: Object.freeze({
			xMm: (paper.widthMm - gridWidth) / 2,
			yMm: (paper.heightMm - gridHeight) / 2,
		}),
		gap: Object.freeze({ xMm: gap, yMm: gap }),
		cropMarks: true,
		bleedMm: bleed,
	});
}
