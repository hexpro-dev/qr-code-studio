/**
 * Imposition: the built-in templates, where cells and marks go, the print
 * sheet generator, and sheets written as PDF and read back.
 *
 * Positions are checked twice: in the document `imposeSheet` returns, and in
 * the PDF, by parsing each cell's placement back out of the page's content,
 * so a mistake in either the layout or the conversion to points shows.
 */

import { describe, expect, it } from 'vitest';
import { QrStudioError } from '../../src/core/errors.js';
import { PathBuilder } from '../../src/geometry/path.js';
import {
	MARK_LENGTH_MM,
	MARK_OFFSET_MM,
	PAPER,
	checkTemplate,
	cropMarks,
	imposeCopies,
	imposeSheet,
	printSheetTemplate,
} from '../../src/render/impose.js';
import type { SheetDocument, SheetTemplate } from '../../src/render/impose.js';
import { MAX_PAGE_MM, PT_PER_MM, sheetToPdf } from '../../src/render/pdf.js';
import { builtInSheets } from '../../src/render/sheets.js';
import type { Scene } from '../../src/render/types.js';
import {
	NEEDS_PDFTOPPM,
	PDFTOPPM,
	codeScene,
	contentStreams,
	crop,
	objectsWhere,
	popplerRender,
	readCodes,
	readPdf,
} from './pdf-tools.js';

const KEBAB = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

/** A scene `widthMm` across at its true size. */
function sized(widthMm: number, heightMm = widthMm): Scene {
	return {
		width: widthMm * 2,
		height: heightMm * 2,
		unitsPerMm: 2,
		background: { kind: 'solid', colour: { r: 0, g: 0, b: 0, a: 1 } },
		layers: [],
	};
}

describe('the built-in templates', () => {
	const sheets = builtInSheets();

	it('are a dozen or so, with unique kebab-case ids and their message keys', () => {
		expect(sheets.length).toBeGreaterThanOrEqual(12);
		expect(new Set(sheets.map((t) => t.id)).size).toBe(sheets.length);
		for (const t of sheets) {
			expect(t.id).toMatch(KEBAB);
			expect(t.labelKey).toBe(`sheet.template.${t.id}`);
			expect([PAPER.a4, PAPER.letter]).toContain(t.page);
		}
		expect(sheets.some((t) => t.cornerRadiusMm === t.cell.widthMm / 2)).toBe(true);
		expect(sheets.some((t) => t.id.includes('square'))).toBe(true);
		expect(sheets.filter((t) => t.id.includes('cards'))).toHaveLength(2);
	});

	it('each fit their page, with margins that match left and right, top and bottom', () => {
		for (const t of sheets) {
			expect(() => checkTemplate(t), t.id).not.toThrow();
			const right =
				t.page.widthMm - (t.origin.xMm + t.columns * t.cell.widthMm + (t.columns - 1) * t.gap.xMm);
			const bottom =
				t.page.heightMm - (t.origin.yMm + t.rows * t.cell.heightMm + (t.rows - 1) * t.gap.yMm);
			expect(Math.abs(right - t.origin.xMm), `${t.id} left and right`).toBeLessThan(0.01);
			expect(Math.abs(bottom - t.origin.yMm), `${t.id} top and bottom`).toBeLessThan(0.01);
		}
	});

	it('put every cell where the template says, in the document and in the PDF', () => {
		for (const t of sheets) {
			const count = t.columns * t.rows + 3;
			const sheet = imposeCopies(sized(t.cell.widthMm, t.cell.heightMm), count, t);
			expect(sheet.pages).toHaveLength(2);
			expect(sheet.issues).toEqual([]);
			const cells = sheet.pages.flatMap((page) => page.cells);
			expect(cells).toHaveLength(count);
			cells.forEach((cell, i) => {
				const slot = i % (t.columns * t.rows);
				const c = slot % t.columns;
				const r = Math.floor(slot / t.columns);
				expect([cell.index, cell.column, cell.row]).toEqual([i, c, r]);
				expect(cell.xMm).toBeCloseTo(t.origin.xMm + c * (t.cell.widthMm + t.gap.xMm), 9);
				expect(cell.yMm).toBeCloseTo(t.origin.yMm + r * (t.cell.heightMm + t.gap.yMm), 9);
				expect(cell.xMm + cell.widthMm).toBeLessThanOrEqual(t.page.widthMm + 1e-9);
				expect(cell.yMm + cell.heightMm).toBeLessThanOrEqual(t.page.heightMm + 1e-9);
			});
			// Read the placements back: each cell's `cm` gives its scale and its
			// top left corner in points, y up.
			const pdf = readPdf(sheetToPdf(sheet, { colour: 'srgb' }));
			const pages = objectsWhere(pdf, /\/Type \/Page /);
			expect(pages).toHaveLength(2);
			const placed = contentStreams(pdf)
				.flatMap((stream) => [
					...stream.matchAll(/^([\d.]+) 0 0 -([\d.]+) ([\d.-]+) ([\d.-]+) cm$/gm),
				])
				.map((m) => ({
					sx: Number(m[1]),
					x: Number(m[3]) / PT_PER_MM,
					top: t.page.heightMm - Number(m[4]) / PT_PER_MM,
				}));
			expect(placed).toHaveLength(count);
			placed.forEach((p, i) => {
				const cell = cells[i]!;
				expect(p.x, `${t.id} cell ${i} x`).toBeCloseTo(cell.xMm, 3);
				expect(p.top, `${t.id} cell ${i} y`).toBeCloseTo(cell.yMm, 3);
				expect(p.sx * 2).toBeCloseTo(PT_PER_MM, 6);
			});
			const box = pages[0]!.text.match(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/)!;
			expect(Number(box[1]) / PT_PER_MM).toBeCloseTo(t.page.widthMm, 3);
			expect(Number(box[2]) / PT_PER_MM).toBeCloseTo(t.page.heightMm, 3);
		}
	});
});

describe('imposing scenes', () => {
	const template = builtInSheets()[0] as SheetTemplate;

	it('places each scene at its true size, centred in its cell', () => {
		const sheet = imposeSheet([sized(20, 10)], template);
		const [cell] = sheet.pages[0]!.cells;
		expect(cell!.widthMm).toBe(20);
		expect(cell!.heightMm).toBe(10);
		expect(cell!.xMm).toBeCloseTo(template.origin.xMm + (template.cell.widthMm - 20) / 2, 12);
		expect(cell!.yMm).toBeCloseTo(template.origin.yMm + (template.cell.heightMm - 10) / 2, 12);
		expect(cell!.bleedMm).toBe(0);
		expect(sheet.pages[0]!.marks).toEqual([]);
	});

	it('scales to fit only when asked, and refuses a scene with no size otherwise', () => {
		const loose: Scene = { width: 10, height: 20, background: null, layers: [] };
		const fitted = imposeSheet([loose, sized(100)], template, { fit: 'contain' });
		const [a, b] = fitted.pages[0]!.cells;
		expect(a!.heightMm).toBeCloseTo(template.cell.heightMm, 12);
		expect(a!.widthMm).toBeCloseTo(template.cell.heightMm / 2, 12);
		expect(b!.widthMm).toBeCloseTo(template.cell.heightMm, 12);
		expect(fitted.issues).toEqual([]);
		expect(() => imposeSheet([loose], template)).toThrow(/no physical size/);
	});

	it('reports a scene larger than its cell, and still places it', () => {
		const sheet = imposeSheet([sized(10), sized(70, 20), sized(20, 50)], template);
		expect(sheet.issues).toEqual([
			{
				code: 'sheet.cell-too-small',
				path: ['cells', 1],
				severity: 'warning',
				params: { widthMm: 70, heightMm: 20 },
			},
			{
				code: 'sheet.cell-too-small',
				path: ['cells', 2],
				severity: 'warning',
				params: { widthMm: 20, heightMm: 50 },
			},
		]);
		expect(sheet.pages[0]!.cells).toHaveLength(3);
	});

	it('starts after the cells of a used sheet when asked to skip them', () => {
		const sheet = imposeSheet([sized(10), sized(10)], template, { skip: 20 });
		expect(sheet.pages).toHaveLength(2);
		expect(sheet.pages[0]!.cells.map((c) => [c.column, c.row])).toEqual([[2, 6]]);
		expect(sheet.pages[1]!.cells.map((c) => [c.column, c.row])).toEqual([[0, 0]]);
	});

	it('makes no page for no scenes, and sheetToPdf still writes one blank page', () => {
		const empty = imposeSheet([], template);
		expect(empty.pages).toEqual([]);
		const pdf = readPdf(sheetToPdf(empty, { colour: 'cmyk', title: 'Labels' }));
		expect(objectsWhere(pdf, /\/Type \/Page /)).toHaveLength(1);
		expect(pdf.objects.get(pdf.info)?.text).toContain('/Title (Labels)');
	});

	it('refuses templates, scenes and options of the wrong kind', () => {
		const bad: unknown[] = [
			null,
			{ ...template, id: 'Not Kebab' },
			{ ...template, labelKey: 3 },
			{ ...template, page: undefined },
			{ ...template, cell: undefined },
			{ ...template, origin: undefined },
			{ ...template, gap: undefined },
			{ ...template, page: { widthMm: 0, heightMm: 10 } },
			{ ...template, columns: 0 },
			{ ...template, rows: 1.5 },
			{ ...template, rows: 1001 },
			{ ...template, cell: { widthMm: -1, heightMm: 1 } },
			{ ...template, origin: { xMm: -1, yMm: 0 } },
			{ ...template, gap: { xMm: Number.NaN, yMm: 0 } },
			{ ...template, cornerRadiusMm: -2 },
			{ ...template, bleedMm: -1 },
			{ ...template, cropMarks: 'yes' },
			{ ...template, columns: 4 },
			{ ...template, rows: 8 },
		];
		for (const t of bad)
			expect(() => imposeSheet([], t as SheetTemplate), JSON.stringify(t)).toThrow(TypeError);
		const scenes: unknown[] = [
			null,
			{ width: 0, height: 1 },
			{ width: 1, height: Infinity },
			{ width: 1, height: 1, unitsPerMm: -1 },
		];
		for (const scene of scenes)
			expect(() => imposeSheet([scene as Scene], template)).toThrow(TypeError);
		expect(() => imposeSheet('x' as never, template)).toThrow(TypeError);
		expect(() => imposeSheet([], template, null as never)).toThrow(TypeError);
		expect(() => imposeSheet([], template, { fit: 'cover' as never })).toThrow(TypeError);
		expect(() => imposeSheet([], template, { skip: 21 })).toThrow(TypeError);
		expect(() => imposeSheet([], template, { skip: -1 })).toThrow(TypeError);
		expect(() => imposeCopies(sized(10), 0, template)).toThrow(TypeError);
		expect(() => imposeCopies(sized(10), 10001, template)).toThrow(TypeError);
	});
});

describe('crop marks', () => {
	const t = printSheetTemplate({ paper: 'a4', widthMm: 40, bleedMm: 2 });

	it('stand in the margins at every cut, clear of the grid by the bleed or 3 mm', () => {
		const marks = cropMarks(t);
		const left = t.origin.xMm;
		const top = t.origin.yMm;
		const right = left + t.columns * t.cell.widthMm + (t.columns - 1) * t.gap.xMm;
		const bottom = top + t.rows * t.cell.heightMm + (t.rows - 1) * t.gap.yMm;
		// Two edges a column, above and below; two a row, left and right.
		expect(marks).toHaveLength(4 * t.columns + 4 * t.rows);
		for (const m of marks) {
			const length = Math.hypot(m.x2Mm - m.x1Mm, m.y2Mm - m.y1Mm);
			expect(length).toBeCloseTo(MARK_LENGTH_MM, 9);
			const inside = (x: number, y: number): boolean =>
				x > left - MARK_OFFSET_MM + 1e-9 &&
				x < right + MARK_OFFSET_MM - 1e-9 &&
				y > top - MARK_OFFSET_MM + 1e-9 &&
				y < bottom + MARK_OFFSET_MM - 1e-9;
			expect(inside(m.x1Mm, m.y1Mm) || inside(m.x2Mm, m.y2Mm)).toBe(false);
			expect(Math.min(m.x1Mm, m.x2Mm)).toBeGreaterThanOrEqual(0);
			expect(Math.min(m.y1Mm, m.y2Mm)).toBeGreaterThanOrEqual(0);
		}
		const xs = new Set(marks.filter((m) => m.x1Mm === m.x2Mm).map((m) => m.x1Mm));
		for (let c = 0; c < t.columns; c += 1) {
			const x = left + c * (t.cell.widthMm + t.gap.xMm);
			expect(xs.has(x) && xs.has(x + t.cell.widthMm)).toBe(true);
		}
	});

	it('are drawn once where neighbouring cells share an edge', () => {
		const shared = { ...builtInSheets().find((s) => s.id === 'a4-21-63x38')!, cropMarks: true };
		// Rows touch, so each inner row edge is one cut.
		expect(cropMarks(shared)).toHaveLength(4 * shared.columns + 2 * (shared.rows + 1));
		expect(imposeSheet([sized(10)], shared).pages[0]!.marks.length).toBe(
			4 * shared.columns + 2 * (shared.rows + 1),
		);
	});
});

describe('the print sheet generator', () => {
	it('fits as many copies as the margins allow, centred, with marks', () => {
		const t = printSheetTemplate({ paper: 'a4', widthMm: 30 });
		// (210 - 24 + 3) / 33 = 5.7 columns; (297 - 24 + 3) / 33 = 8.4 rows.
		expect([t.columns, t.rows]).toEqual([5, 8]);
		expect(t.gap).toEqual({ xMm: 3, yMm: 3 });
		expect(t.origin.xMm).toBeCloseTo((210 - (5 * 30 + 4 * 3)) / 2, 12);
		expect(t.cropMarks).toBe(true);
		expect(t.labelKey).toBe('sheet.template.print-a4');
		const letter = printSheetTemplate({
			paper: 'letter',
			widthMm: 50,
			heightMm: 70,
			bleedMm: 3,
			marginMm: 10,
		});
		expect(letter.gap.xMm).toBe(6);
		expect(letter.cell).toEqual({ widthMm: 50, heightMm: 70 });
		expect(letter.id).toBe('print-letter');
		expect(() => checkTemplate(letter)).not.toThrow();
	});

	it('refuses what it cannot lay out', () => {
		const bad: unknown[] = [
			null,
			{ paper: 'a3', widthMm: 30 },
			{ paper: 'toString', widthMm: 30 },
			{ paper: 'a4', widthMm: 0 },
			{ paper: 'a4', widthMm: 30, heightMm: -1 },
			{ paper: 'a4', widthMm: 30, bleedMm: Number.NaN },
			{ paper: 'a4', widthMm: 30, marginMm: 7 },
			{ paper: 'a4', widthMm: 30, bleedMm: 5, marginMm: 9 },
			{ paper: 'a4', widthMm: 30, bleedMm: 3, gapMm: 5 },
			{ paper: 'a4', widthMm: 200 },
		];
		for (const options of bad)
			expect(() => printSheetTemplate(options as never), JSON.stringify(options)).toThrow(
				TypeError,
			);
	});
});

describe('sheets as PDF', () => {
	it('refuses a sheet or options of the wrong kind, and a page larger than PDF allows', () => {
		const t = builtInSheets()[0] as SheetTemplate;
		const good = imposeSheet([codeScene('https://example.com/s', { unitsPerMm: 1 })], t);
		const cell = good.pages[0]!.cells[0]!;
		const variants: unknown[] = [
			null,
			{ ...good, pages: 'x' },
			{ ...good, pages: [{ cells: [{ ...cell, xMm: Number.NaN }], marks: [] }] },
			{ ...good, pages: [{ cells: [{ ...cell, widthMm: 0 }], marks: [] }] },
			{ ...good, pages: [{ cells: [{ ...cell, bleedMm: 60 }], marks: [] }] },
			{ ...good, pages: [{ cells: [], marks: [{ x1Mm: 0, y1Mm: 0, x2Mm: Infinity, y2Mm: 0 }] }] },
		];
		for (const sheet of variants)
			expect(() => sheetToPdf(sheet as SheetDocument, { colour: 'srgb' })).toThrow(TypeError);
		expect(() => sheetToPdf(good, null as never)).toThrow(TypeError);
		expect(() => sheetToPdf(good, { colour: 'srgb', title: 1 as never })).toThrow(TypeError);
		const huge = { ...t, page: { widthMm: MAX_PAGE_MM + 1, heightMm: 300 } };
		expect(() => sheetToPdf({ ...good, template: huge }, { colour: 'srgb' })).toThrow(
			QrStudioError,
		);
	});

	it('draws bleed into the gap and crop marks in registration', () => {
		const t = printSheetTemplate({ paper: 'a4', widthMm: 30, bleedMm: 2 });
		const scene = {
			...codeScene('https://example.com/b', { unitsPerMm: 1 }),
			background: { kind: 'solid' as const, colour: { r: 255, g: 0, b: 0, a: 1 } },
		};
		const sheet = imposeCopies(
			{
				...scene,
				width: 30,
				height: 30,
				layers: [
					{
						kind: 'path',
						path: new PathBuilder().rect(5, 5, 20, 20).build(),
						paint: { kind: 'solid', colour: { r: 0, g: 0, b: 0, a: 1 } },
					},
				],
			},
			3,
			t,
		);
		const streams = contentStreams(readPdf(sheetToPdf(sheet, { colour: 'cmyk' })));
		expect(streams.join('\n')).toContain('1 1 1 1 K');
		// The visible box reaches 2 mm (2 units) past the scene on each side.
		expect(streams.join('\n')).toContain('-2 -2 34 34 re');
	});

	it.skipIf(PDFTOPPM === null)(
		`prints 30 different codes on two pages, every one readable${NEEDS_PDFTOPPM}`,
		async () => {
			const t = builtInSheets().find((s) => s.id === 'a4-21-63x38') as SheetTemplate;
			const texts = Array.from({ length: 30 }, (_, i) => `https://example.com/label/${i + 1}`);
			const sheet = imposeSheet(
				texts.map((text) => codeScene(text, { unitsPerMm: 37 / 30 })),
				t,
			);
			const pdf = sheetToPdf(sheet, { colour: 'cmyk', title: 'Thirty labels' });
			const DPI = 200;
			const px = (mm: number): number => Math.round((mm * DPI) / 25.4);
			for (const [p, page] of sheet.pages.entries()) {
				const { image, stderr } = popplerRender(pdf, DPI, p + 1);
				expect(stderr).toBe('');
				expect(image.width).toBe(px(210));
				for (const cell of page.cells) {
					const region = crop(
						image,
						px(cell.xMm - 1),
						px(cell.yMm - 1),
						px(cell.widthMm + 2),
						px(cell.heightMm + 2),
					);
					expect(await readCodes(region), `cell ${cell.index}`).toEqual([texts[cell.index]]);
				}
			}
		},
		60_000,
	);
});
