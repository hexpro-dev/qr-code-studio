/**
 * The PDF writer: the file's structure read back, its sizes, its colour, its
 * bytes, and what two independent renderers make of it.
 *
 * Poppler (pdftoppm) and Ghostscript are the renderers most print and preview
 * pipelines are built on, and they were written independently of each other
 * and of this package. Each must draw every test file without a word on
 * stderr, and draw the same picture as `rasterise` draws from the same scene
 * at the same resolution, to within anti-aliasing. Both snap and sample edges
 * their own way (Poppler pixel-aligns axis-aligned edges, Ghostscript
 * anti-aliases with four bits), so edge pixels differ by up to a full level
 * range and are only counted; what is held tightly is the share of pixels
 * that are flat in our render, away from any edge, and still differ, which
 * is where a misplaced shape, a wrong colour or a gradient read wrongly shows.
 * The limits are just above what was measured when they were written:
 *
 * - Poppler: mean at most 1.37 levels, 1.7 percent of pixels more than 32 out
 *   (all on edges), and 0.032 percent flat and more than 6 out.
 * - Ghostscript: mean 2.01, 2.8 percent over 32, 0.067 percent flat and over
 *   6, and 0.39 percent for a scene with small stretched images.
 * - Poppler smooths a small stretched image with its own filter rather than
 *   bilinear sampling between texel centres, so across a 4 by 7 image blown
 *   up to a hundred pixels it differs by a few levels everywhere: up to 32
 *   percent of such a picture was flat and over 6 out, with a mean of 5.3.
 *   Ghostscript matches the rasteriser on the same images, so images are
 *   held tightly there, and a large image is placed to the pixel by both.
 */

import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { QrStudioError } from '../../src/core/errors.js';
import { PathBuilder } from '../../src/geometry/path.js';
import { PdfDocument } from '../../src/render/pdf-document.js';
import { sha256 } from '../../src/render/pdf-hash.js';
import { rgbToCmyk } from '../../src/render/pdf-colour.js';
import { MAX_PAGE_MM, PT_PER_MM, sceneToPdf } from '../../src/render/pdf.js';
import { num, stopsFunction, textString } from '../../src/render/pdf-syntax.js';
import { rasterise } from '../../src/render/raster.js';
import type { RgbaImage, Scene } from '../../src/render/types.js';
import { layoutText } from '../../src/text/layout.js';
import {
	NEEDS_GS,
	NEEDS_PDFTOPPM,
	GS,
	PDFTOPPM,
	boxOf,
	codeScene,
	compare,
	contentStreams,
	crop,
	ghostscriptRender,
	objectsWhere,
	popplerRender,
	readCodes,
	readPdf,
} from './pdf-tools.js';
import type { Difference } from './pdf-tools.js';
import { sceneFor } from './scenes.js';

const white = { r: 255, g: 255, b: 255, a: 1 };
const black = { r: 0, g: 0, b: 0, a: 1 };

/** Two inches wide: 144 points, a whole number of pixels at any whole dpi. */
const TWO_INCHES = 50.8;

/** A scene with every kind of paint, a clip, a translucent group and an image, for structure tests. */
function everything(): Scene {
	const image: RgbaImage = {
		width: 3,
		height: 2,
		data: new Uint8ClampedArray([
			255, 0, 0, 255, 0, 255, 0, 0, 0, 0, 255, 128, 9, 9, 9, 255, 1, 2, 3, 255, 200, 100, 0, 255,
		]),
	};
	const square = new PathBuilder().rect(2, 2, 10, 10).build();
	return {
		width: 32,
		height: 32,
		title: 'Everything',
		background: {
			kind: 'linear',
			x1: 0,
			y1: 0,
			x2: 32,
			y2: 32,
			stops: [
				{ offset: 0, colour: white },
				{ offset: 0.5, colour: { r: 200, g: 220, b: 255, a: 1 } },
				{ offset: 0.5, colour: { r: 255, g: 240, b: 200, a: 1 } },
				{ offset: 1, colour: white },
			],
		},
		layers: [
			{ kind: 'path', path: square, paint: { kind: 'solid', colour: black } },
			{
				kind: 'path',
				path: new PathBuilder().circle(22, 8, 6).build(),
				paint: {
					kind: 'radial',
					cx: 22,
					cy: 8,
					r: 6,
					stops: [
						{ offset: 0, colour: { r: 255, g: 0, b: 0, a: 1 } },
						{ offset: 1, colour: { r: 0, g: 0, b: 255, a: 0.2 } },
					],
				},
			},
			{
				kind: 'path',
				path: new PathBuilder().rect(2, 20, 10, 10).build(),
				paint: {
					kind: 'conic',
					cx: 7,
					cy: 25,
					angle: 30,
					stops: [
						{ offset: 0, colour: { r: 255, g: 0, b: 0, a: 0.6 } },
						{ offset: 1, colour: { r: 0, g: 128, b: 0, a: 0.6 } },
					],
				},
			},
			{
				kind: 'group',
				opacity: 0.5,
				clip: new PathBuilder().circle(22, 25, 6).build(),
				children: [
					{
						kind: 'path',
						path: new PathBuilder().rect(14, 16, 16, 16).build(),
						paint: { kind: 'solid', colour: { r: 11, g: 118, b: 217, a: 0.8 } },
					},
					{ kind: 'image', image, x: 16, y: 20, width: 9, height: 6, clip: square },
				],
			},
			{ kind: 'image', image, x: 14, y: 14, width: 3, height: 2 },
		],
	};
}

describe('the file', () => {
	it('reads back: header, a cross-reference table that lands on every object, references that resolve', () => {
		for (const colour of ['srgb', 'cmyk'] as const) {
			const pdf = readPdf(
				sceneToPdf(everything(), { colour, widthMm: 40, bleedMm: 3, cropMarks: true }),
			);
			expect(pdf.version).toBe('1.7');
			expect(pdf.objects.get(pdf.root)?.text).toBe('<< /Type /Catalog /Pages 2 0 R >>');
			expect(pdf.id[0]).toBe(pdf.id[1]);
			const pages = objectsWhere(pdf, /\/Type \/Page /);
			expect(pages).toHaveLength(1);
			expect(pages[0]?.text).toContain('/Group << /Type /Group /S /Transparency');
		}
	});

	it('names its title and producer, and holds no date anywhere', () => {
		const bytes = sceneToPdf(everything(), { colour: 'srgb', widthMm: 40 });
		const pdf = readPdf(bytes);
		expect(pdf.objects.get(pdf.info)?.text).toBe(
			'<< /Title (Everything) /Producer (Hex Pro QR Code Studio) >>',
		);
		const text = Buffer.from(bytes).toString('latin1');
		expect(text).not.toMatch(/CreationDate|ModDate|D:20/);
		const named = readPdf(
			sceneToPdf(
				{ ...everything(), title: undefined },
				{ colour: 'srgb', widthMm: 40, title: 'Café (menu)' },
			),
		);
		expect(named.objects.get(named.info)?.text).toContain(
			'/Title <FEFF00430061006600E900200028006D0065006E00750029>',
		);
		const untitled = readPdf(
			sceneToPdf({ ...everything(), title: undefined }, { colour: 'srgb', widthMm: 40 }),
		);
		expect(untitled.objects.get(untitled.info)?.text).toBe(
			'<< /Producer (Hex Pro QR Code Studio) >>',
		);
	});

	it('gives the same bytes twice, and a different identifier for a different picture', () => {
		const a = sceneToPdf(everything(), {
			colour: 'cmyk',
			widthMm: 40,
			bleedMm: 2,
			cropMarks: true,
		});
		const b = sceneToPdf(everything(), {
			colour: 'cmyk',
			widthMm: 40,
			bleedMm: 2,
			cropMarks: true,
		});
		expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
		const c = sceneToPdf(everything(), {
			colour: 'cmyk',
			widthMm: 41,
			bleedMm: 2,
			cropMarks: true,
		});
		expect(readPdf(a).id[0]).not.toBe(readPdf(c).id[0]);
		// The identifier is the first half of the body's SHA-256.
		const text = Buffer.from(a).toString('latin1');
		const body = a.subarray(0, text.lastIndexOf('\nxref\n') + 1);
		expect(readPdf(a).id[0]).toBe(
			createHash('sha256').update(body).digest('hex').slice(0, 32).toUpperCase(),
		);
	});

	it('writes each image once however often it is drawn, with its alpha as a soft mask', () => {
		const pdf = readPdf(sceneToPdf(everything(), { colour: 'srgb', widthMm: 40 }));
		const images = objectsWhere(pdf, /\/Subtype \/Image/);
		expect(images).toHaveLength(2);
		const colour = images.find((image) => image.text.includes('/DeviceRGB'));
		const mask = images.find((image) => image.text.includes('/DeviceGray'));
		expect(colour?.text).toMatch(/\/SMask \d+ 0 R/);
		expect(Array.from(mask?.stream ?? [])).toEqual([255, 0, 128, 255, 255, 255]);
		// The transparent green pixel takes its opaque neighbour's colour.
		expect(Array.from(colour?.stream?.subarray(3, 6) ?? [])).toEqual([255, 0, 0]);
	});

	it('declares no transparency group on a page that has no transparency', () => {
		const pdf = readPdf(
			sceneToPdf(codeScene('https://example.com/plain'), { colour: 'srgb', widthMm: 30 }),
		);
		expect(objectsWhere(pdf, /\/Type \/Page /)[0]?.text).not.toContain('/Group');
		expect(objectsWhere(pdf, /ExtGState/)).toHaveLength(0);
	});
});

describe('the page', () => {
	const mm = (pt: number): number => pt / PT_PER_MM;
	const size = (box: number[]): [number, number] => [
		mm((box[2] as number) - (box[0] as number)),
		mm((box[3] as number) - (box[1] as number)),
	];
	const page = (bytes: Uint8Array): string =>
		objectsWhere(readPdf(bytes), /\/Type \/Page /)[0]?.text as string;

	it('is the size asked for, and the scene aspect gives the height', () => {
		const text = page(
			sceneToPdf(codeScene('https://example.com/a'), { colour: 'srgb', widthMm: 25 }),
		);
		for (const name of ['MediaBox', 'TrimBox', 'BleedBox']) {
			const [w, h] = size(boxOf(text, name));
			expect(w).toBeCloseTo(25, 3);
			expect(h).toBeCloseTo(25, 3);
		}
		const code = codeScene('https://example.com/a');
		const tall = page(
			sceneToPdf({ ...code, height: code.width * 2 }, { colour: 'srgb', widthMm: 20 }),
		);
		const [, h] = size(boxOf(tall, 'TrimBox'));
		expect(h).toBeCloseTo(40, 3);
		const given = page(
			sceneToPdf(codeScene('https://example.com/a'), { colour: 'srgb', widthMm: 20, heightMm: 30 }),
		);
		expect(size(boxOf(given, 'TrimBox'))[1]).toBeCloseTo(30, 3);
	});

	it('grows by the bleed, and by room for crop marks outside it', () => {
		const bled = page(
			sceneToPdf(codeScene('https://example.com/a'), { colour: 'cmyk', widthMm: 40, bleedMm: 3 }),
		);
		expect(size(boxOf(bled, 'MediaBox'))[0]).toBeCloseTo(46, 3);
		expect(size(boxOf(bled, 'BleedBox'))[0]).toBeCloseTo(46, 3);
		expect(size(boxOf(bled, 'TrimBox'))[0]).toBeCloseTo(40, 3);
		expect(mm(boxOf(bled, 'TrimBox')[0] as number)).toBeCloseTo(3, 3);
		const marked = page(
			sceneToPdf(codeScene('https://example.com/a'), {
				colour: 'cmyk',
				widthMm: 40,
				bleedMm: 3,
				cropMarks: true,
			}),
		);
		// Marks stand off the trim by the bleed or 3 mm, whichever is more, and are 5 mm long.
		expect(size(boxOf(marked, 'MediaBox'))[0]).toBeCloseTo(56, 3);
		expect(mm(boxOf(marked, 'TrimBox')[0] as number)).toBeCloseTo(8, 3);
		expect(mm(boxOf(marked, 'BleedBox')[0] as number)).toBeCloseTo(5, 3);
		const wide = page(
			sceneToPdf(codeScene('https://example.com/a'), {
				colour: 'cmyk',
				widthMm: 40,
				bleedMm: 6,
				cropMarks: true,
			}),
		);
		expect(mm(boxOf(wide, 'TrimBox')[0] as number)).toBeCloseTo(11, 3);
	});

	it('refuses options of the wrong kind, and a page larger than PDF allows', () => {
		const scene = codeScene('https://example.com/a');
		const bad: unknown[] = [
			null,
			{ colour: 'rgb', widthMm: 10 },
			{ colour: 'srgb', widthMm: 0 },
			{ colour: 'srgb', widthMm: Number.NaN },
			{ colour: 'srgb', widthMm: 10, heightMm: -1 },
			{ colour: 'srgb', widthMm: 10, bleedMm: -1 },
			{ colour: 'srgb', widthMm: 10, bleedMm: 51 },
			{ colour: 'srgb', widthMm: 10, cropMarks: 'yes' },
			{ colour: 'srgb', widthMm: 10, title: 7 },
		];
		for (const options of bad) expect(() => sceneToPdf(scene, options as never)).toThrow(TypeError);
		expect(() =>
			sceneToPdf(
				{
					...scene,
					layers: [
						{
							kind: 'path',
							path: new PathBuilder().rect(0, 0, 1, 1).build(),
							paint: { kind: 'solid', colour: { ...black, cmyk: [0, 0, 2, 0] } },
						},
					],
				},
				{ colour: 'cmyk', widthMm: 10 },
			),
		).toThrow(TypeError);
		expect(() =>
			sceneToPdf(
				{
					...scene,
					background: {
						kind: 'linear',
						x1: 0,
						y1: 0,
						x2: 1,
						y2: 1,
						stops: [
							{ offset: 0, colour: { ...white, cmyk: [0, 0] as never } },
							{ offset: 1, colour: white },
						],
					},
				},
				{ colour: 'cmyk', widthMm: 10 },
			),
		).toThrow(TypeError);
		try {
			sceneToPdf(scene, { colour: 'srgb', widthMm: MAX_PAGE_MM, cropMarks: true });
			throw new Error('expected a refusal');
		} catch (error) {
			expect((error as QrStudioError).code).toBe('render/surface-too-large');
		}
		expect(() =>
			sceneToPdf(scene, { colour: 'srgb', widthMm: 10, heightMm: MAX_PAGE_MM + 1 }),
		).toThrow(QrStudioError);
	});
});

describe('paint the comparison corpus does not reach', () => {
	it('writes conic wedges of their own opacities, and in CMYK', () => {
		const scene: Scene = {
			width: 10,
			height: 10,
			background: null,
			layers: [
				{
					kind: 'path',
					path: new PathBuilder().rect(1, 1, 8, 8).build(),
					paint: {
						kind: 'conic',
						cx: 5,
						cy: 5,
						angle: 0,
						stops: [
							{ offset: 0, colour: { r: 255, g: 0, b: 0, a: 1 } },
							{ offset: 1, colour: { r: 0, g: 0, b: 255, a: 0.2 } },
						],
					},
				},
			],
		};
		for (const colour of ['srgb', 'cmyk'] as const) {
			const streams = contentStreams(readPdf(sceneToPdf(scene, { colour, widthMm: 10 }))).join(
				'\n',
			);
			// Each translucent wedge sets its own alpha inside a save and restore.
			expect(streams).toMatch(/q\n\/GS\d+ gs\n[\d. ]+ (rg|k) [\d. mlh]+ f\nQ/);
			expect(streams).toMatch(
				colour === 'srgb'
					? /\n[\d.]+ [\d.]+ [\d.]+ rg [\d. ]+ m/
					: /\n[\d.]+ [\d.]+ [\d.]+ [\d.]+ k [\d. ]+ m/,
			);
		}
	});

	it('draws an opaque group in place, clipped or not, with no form', () => {
		const square = new PathBuilder().rect(1, 1, 3, 3).build();
		const child = {
			kind: 'path' as const,
			path: square,
			paint: { kind: 'solid' as const, colour: black },
		};
		const scene: Scene = {
			width: 5,
			height: 5,
			background: null,
			layers: [
				{ kind: 'group', children: [child] },
				{ kind: 'group', clip: square, children: [child] },
			],
		};
		const pdf = readPdf(sceneToPdf(scene, { colour: 'srgb', widthMm: 10 }));
		expect(objectsWhere(pdf, /\/Subtype \/Form/)).toHaveLength(0);
		const streams = contentStreams(pdf).join('\n');
		expect(streams.match(/0 0 0 rg\n1 1 m 4 1 l 4 4 l 1 4 l h\nf/g)).toHaveLength(2);
		expect(streams).toContain('q\n1 1 m 4 1 l 4 4 l 1 4 l h\nW n\n0 0 0 rg');
	});

	it('gives a transparent pixel the colour of an opaque neighbour, when it has one', () => {
		// A transparent border round one opaque pixel, and a transparent pixel
		// with no opaque neighbour at all.
		const data = new Uint8ClampedArray(5 * 3 * 4);
		data.set([10, 20, 30, 255], (1 * 5 + 1) * 4);
		const pdf = readPdf(
			sceneToPdf(
				{
					width: 5,
					height: 3,
					background: null,
					layers: [
						{
							kind: 'image',
							image: { width: 5, height: 3, data },
							x: 0,
							y: 0,
							width: 5,
							height: 3,
						},
					],
				},
				{ colour: 'srgb', widthMm: 10 },
			),
		);
		const colour = objectsWhere(pdf, /\/DeviceRGB/)[0]?.stream as Uint8Array;
		const at = (x: number, y: number): number[] =>
			Array.from(colour.subarray((y * 5 + x) * 3, (y * 5 + x) * 3 + 3));
		for (const [x, y] of [
			[0, 0],
			[1, 0],
			[2, 2],
			[0, 2],
		])
			expect(at(x, y)).toEqual([10, 20, 30]);
		expect(at(4, 1)).toEqual([0, 0, 0]);
	});
});

describe('colour', () => {
	/** Every colour-setting operator in every content stream, with its operands. */
	function colourOperators(bytes: Uint8Array): string[] {
		const out: string[] = [];
		for (const stream of contentStreams(readPdf(bytes))) {
			for (const match of stream.matchAll(
				/((?:-?[\d.]+ )+)(rg|RG|g|G|k|K|sc|SC|scn|SCN|cs|CS)(?=[\s]|$)/g,
			)) {
				out.push(`${(match[1] as string).trim()} ${match[2] as string}`);
			}
		}
		return out;
	}

	it('in CMYK uses k and K only, black is K alone, and every shading and image is CMYK', () => {
		const scene: Scene = {
			...everything(),
			layers: [
				...everything().layers,
				{
					kind: 'path',
					path: new PathBuilder().rect(0, 0, 1, 1).build(),
					paint: { kind: 'solid', colour: { r: 128, g: 128, b: 128, a: 1 } },
				},
				{
					kind: 'path',
					path: new PathBuilder().rect(1, 0, 1, 1).build(),
					paint: {
						kind: 'solid',
						colour: { r: 255, g: 0, b: 0, a: 1, cmyk: [0, 0.9, 0.85, 0.05] },
					},
				},
			],
		};
		const bytes = sceneToPdf(scene, { colour: 'cmyk', widthMm: 40, cropMarks: true });
		const operators = colourOperators(bytes);
		expect(operators.length).toBeGreaterThan(5);
		for (const op of operators) expect(op).toMatch(/^[\d.]+ [\d.]+ [\d.]+ [\d.]+ [kK]$/);
		expect(operators).toContain('0 0 0 1 k');
		expect(operators).toContain('0 0 0 0.498 k');
		expect(operators).toContain('0 0.9 0.85 0.05 k');
		expect(operators).toContain('1 1 1 1 K');
		const pdf = readPdf(bytes);
		for (const object of objectsWhere(pdf, /\/ShadingType/)) {
			expect(object.text).toMatch(/\/ColorSpace \/Device(CMYK|Gray)/);
		}
		for (const object of objectsWhere(pdf, /\/Subtype \/Image/)) {
			expect(object.text).toMatch(/\/ColorSpace \/Device(CMYK|Gray)/);
		}
		// DeviceGray appears only for soft masks.
		for (const object of objectsWhere(pdf, /\/DeviceGray/)) {
			const id = object.id;
			const used = [...pdf.objects.values()].some(
				(o) =>
					new RegExp(`/(SMask|G) ${id} 0 R`).test(o.text) ||
					(o.text.includes('/S /Luminosity') && o.text.includes(`${id} 0 R`)),
			);
			const inMask = [...pdf.objects.values()].some(
				(o) =>
					o.text.includes('/CS /DeviceGray') &&
					o.text.includes('/Shading') &&
					o.text.includes(`${id} 0 R`),
			);
			expect(used || inMask || object.text.includes('/CS /DeviceGray'), `object ${id}`).toBe(true);
		}
	});

	it('in sRGB uses rg and RG only', () => {
		const operators = colourOperators(
			sceneToPdf(everything(), { colour: 'srgb', widthMm: 40, cropMarks: true }),
		);
		for (const op of operators) expect(op).toMatch(/^[\d.]+ [\d.]+ [\d.]+ (rg|RG)$/);
		expect(operators).toContain('0 0 0 rg');
		expect(operators).toContain('0 0 0 RG');
	});

	it('converts by the documented formula, every neutral to black ink alone', () => {
		expect(rgbToCmyk(0, 0, 0)).toEqual([0, 0, 0, 1]);
		expect(rgbToCmyk(255, 255, 255)).toEqual([0, 0, 0, 0]);
		for (let v = 0; v <= 255; v += 1) {
			const [c, m, y, k] = rgbToCmyk(v, v, v);
			expect([c, m, y]).toEqual([0, 0, 0]);
			expect(k).toBeCloseTo(1 - v / 255, 12);
		}
		const [c, m, y, k] = rgbToCmyk(11, 118, 217);
		expect(k).toBeCloseTo(1 - 217 / 255, 12);
		expect(c).toBeCloseTo((1 - 11 / 255 - k) / (1 - k), 12);
		expect(m).toBeCloseTo((1 - 118 / 255 - k) / (1 - k), 12);
		expect(y).toBeCloseTo(0, 12);
	});
});

describe('the syntax pieces', () => {
	it('hashes with a SHA-256 that agrees with node:crypto', () => {
		for (const length of [0, 1, 55, 56, 63, 64, 65, 119, 1000, 70000]) {
			const bytes = Uint8Array.from({ length }, (_, i) => (i * 131 + 7) & 0xff);
			expect(Buffer.from(sha256(bytes)).toString('hex')).toBe(
				createHash('sha256').update(bytes).digest('hex'),
			);
		}
	});

	it('writes numbers without exponents, trailing zeros or a negative zero', () => {
		expect([num(1.5), num(-0.00001), num(2), num(0.12345678, 6), num(1e300), num(-1e300)]).toEqual([
			'1.5',
			'0',
			'2',
			'0.123457',
			'1125899906842624',
			'-1125899906842624',
		]);
	});

	it('writes text strings literally when it can and as UTF-16 when it cannot', () => {
		expect(textString('a (b) \\ c')).toBe('(a \\(b\\) \\\\ c)');
		expect(textString('\u{1f600}')).toBe('<FEFFD83DDE00>');
		expect(textString('\ud800x\udc00\u0007\u007fé')).toBe('<FEFFFFFD0078FFFDFFFDFFFD00E9>');
	});

	it('writes one stretch as an exponential function and several as a stitching one, bounds rising', () => {
		const c = (v: number): { r: number; g: number; b: number; a: number } => ({
			r: v,
			g: v,
			b: v,
			a: 1,
		});
		expect(
			stopsFunction(
				[
					{ offset: 0, colour: c(0) },
					{ offset: 1, colour: c(255) },
				],
				'srgb',
			),
		).toBe('<< /FunctionType 2 /Domain [0 1] /C0 [0 0 0] /C1 [1 1 1] /N 1 >>');
		const padded = stopsFunction(
			[
				{ offset: 0.25, colour: c(0) },
				{ offset: 0.25, colour: c(255) },
				{ offset: 0.75, colour: c(0) },
			],
			'cmyk',
		);
		expect(padded).toContain('/Bounds [0.25 0.75]');
		expect(padded).toContain('/Encode [0 1 0 1 0 1]');
		const close = stopsFunction(
			[
				{ offset: 0, colour: c(0) },
				{ offset: 0.5, colour: c(9) },
				{ offset: 0.5000001, colour: c(200) },
				{ offset: 1, colour: c(255) },
			],
			'srgb',
		);
		expect(close).toContain('/Bounds [0.5]');
		expect(
			stopsFunction(
				[
					{ offset: 0, colour: c(0) },
					{ offset: 1, colour: { ...c(0), a: 0.25 } },
				],
				'srgb',
				true,
			),
		).toContain('/C1 [0.25]');
	});

	it('refuses to finish a file with an object reserved and never written', () => {
		const doc = new PdfDocument();
		doc.reserve();
		expect(() => doc.finish(1, 1)).toThrow(/never written/);
		const ok = new PdfDocument();
		const id = ok.addStream('', new Uint8Array([1, 2, 3]));
		expect(ok.addShared('<< >>')).toBe(ok.addShared('<< >>'));
		expect(Buffer.from(ok.finish(id, id)).toString('latin1')).toContain(
			'<< /Filter /FlateDecode /Length',
		);
	});
});

/** The comparison corpus: the rasteriser's own random scenes, of every kind. */
const corpus: { label: string; scene: Scene; images: boolean }[] = [];
for (const [label, options] of [
	['opaque', { translucent: false, groups: false }],
	['translucent', { translucent: true, groups: true }],
	['conic', { translucent: true, groups: true, conic: true }],
	['images', { translucent: true, groups: true, images: true }],
] as const) {
	for (let seed = 1; seed <= 4; seed += 1) {
		corpus.push({
			label: `${label} ${seed}`,
			scene: sceneFor(seed * 31 + label.length, { size: 32, layers: 4, ...options }),
			images: label === 'images',
		});
	}
}
corpus.push({ label: 'everything', scene: everything(), images: true });
{
	const caption = layoutText('Scan for the menu', {
		fontId: 'plex-sans-bold',
		size: 3,
		box: { x: 0, y: 37, width: 37, height: 5 },
	});
	const code = codeScene('https://example.com/menu');
	corpus.push({
		label: 'code with a caption',
		scene: {
			...code,
			height: 42,
			layers: [
				...code.layers,
				...caption.paths.map((path) => ({
					kind: 'path' as const,
					path,
					paint: { kind: 'solid' as const, colour: { r: 11, g: 118, b: 217, a: 1 } },
				})),
			],
		},
		images: false,
	});
}

const GHOSTSCRIPT = { mean: 2.2, over32: 0.03, interior: 0.005 };

function check(
	difference: Difference,
	limits: { mean: number; over32: number; interior: number },
	label: string,
): void {
	const report = `${label}: ${JSON.stringify(difference)}`;
	expect(difference.mean, report).toBeLessThan(limits.mean);
	expect(difference.over32, report).toBeLessThanOrEqual(limits.over32);
	expect(difference.interior, report).toBeLessThanOrEqual(limits.interior);
}

describe('renderers', () => {
	const DPI = 150;
	const pixels = (TWO_INCHES / 25.4) * DPI;

	it.skipIf(PDFTOPPM === null)(
		`Poppler draws every file as the rasteriser does${NEEDS_PDFTOPPM}`,
		() => {
			for (const { label, scene, images } of corpus) {
				const pdf = sceneToPdf(scene, { colour: 'srgb', widthMm: TWO_INCHES });
				const { image, stderr } = popplerRender(pdf, DPI);
				expect(stderr, label).toBe('');
				const ours = rasterise(scene, {
					width: pixels,
					height: Math.round((pixels * scene.height) / scene.width),
				});
				check(
					compare(ours, image),
					images
						? { mean: 6, over32: 0.11, interior: 0.33 }
						: { mean: 1.5, over32: 0.02, interior: 0.0005 },
					label,
				);
			}
		},
		60_000,
	);

	it.skipIf(GS === null)(
		`Ghostscript draws every file as the rasteriser does${NEEDS_GS}`,
		() => {
			for (const { label, scene } of corpus) {
				const pdf = sceneToPdf(scene, { colour: 'srgb', widthMm: TWO_INCHES });
				const { image, stderr } = ghostscriptRender(pdf, DPI);
				expect(stderr, label).toBe('');
				const ours = rasterise(scene, {
					width: pixels,
					height: Math.round((pixels * scene.height) / scene.width),
				});
				check(compare(ours, image), GHOSTSCRIPT, label);
			}
		},
		60_000,
	);

	it.skipIf(PDFTOPPM === null || GS === null)(
		`both place a large image exactly${NEEDS_PDFTOPPM}${NEEDS_GS}`,
		() => {
			const size = 96;
			const data = new Uint8ClampedArray(size * size * 4);
			// Smooth, so the comparison is about where the image is rather than
			// how each renderer filters an edge inside it.
			for (let y = 0; y < size; y += 1) {
				for (let x = 0; x < size; x += 1)
					data.set([x * 2, y * 2, 255 - x - y, 255], (y * size + x) * 4);
			}
			const scene: Scene = {
				width: 100,
				height: 100,
				background: { kind: 'solid', colour: white },
				layers: [
					{
						kind: 'image',
						image: { width: size, height: size, data },
						x: 2,
						y: 2,
						width: 96,
						height: 96,
					},
				],
			};
			const pdf = sceneToPdf(scene, { colour: 'srgb', widthMm: TWO_INCHES });
			// 96 texels over 288 pixels: three to a texel.
			const ours = rasterise(scene, { width: 300 });
			check(
				compare(ours, popplerRender(pdf, 150).image, 8),
				{ mean: 1.5, over32: 0.01, interior: 0.01 },
				'poppler',
			);
			check(
				compare(ours, ghostscriptRender(pdf, 150).image, 8),
				{ mean: 1.5, over32: 0.01, interior: 0.01 },
				'ghostscript',
			);
		},
	);

	it.skipIf(GS === null)(`trims to the scene, bleed and marks outside it${NEEDS_GS}`, () => {
		const scene = everything();
		const pdf = sceneToPdf(scene, {
			colour: 'srgb',
			widthMm: TWO_INCHES,
			bleedMm: 3,
			cropMarks: true,
		});
		const trimmed = ghostscriptRender(pdf, 150, { trimBox: true });
		expect(trimmed.stderr).toBe('');
		check(compare(rasterise(scene, { width: 300 }), trimmed.image), GHOSTSCRIPT, 'trimmed');
	});

	it.skipIf(PDFTOPPM === null)(
		`draws crop marks in the slug and the background into the bleed${NEEDS_PDFTOPPM}`,
		() => {
			const scene = codeScene('https://example.com/bleed', { colour: { r: 0, g: 0, b: 0 } });
			const red: Scene = {
				...scene,
				background: { kind: 'solid', colour: { r: 255, g: 0, b: 0, a: 1 } },
			};
			// 72 dpi: a point a pixel. Trim 144 points at 8 mm in; bleed 3 mm.
			const { image } = popplerRender(
				sceneToPdf(red, { colour: 'srgb', widthMm: TWO_INCHES, bleedMm: 3, cropMarks: true }),
				72,
			);
			const at = (x: number, y: number): number[] =>
				Array.from(image.data.subarray((y * image.width + x) * 4, (y * image.width + x) * 4 + 3));
			const mm = (v: number): number => Math.round(v * PT_PER_MM);
			// In the bleed, just outside the trim: the background.
			expect(at(mm(8) - 3, mm(8) + 20)).toEqual([255, 0, 0]);
			// Beyond the bleed: paper, apart from the marks.
			expect(at(mm(4), mm(8) + 20)).toEqual([255, 255, 255]);
			// A horizontal mark level with the trim's top edge, 3 to 8 mm out.
			const markRow = image.height - mm(8) - 144;
			let dark = 0;
			for (let x = 1; x < mm(5) - 1; x += 1)
				if ((at(x, markRow)[0] as number) < 200 || (at(x, markRow - 1)[0] as number) < 200)
					dark += 1;
			expect(dark).toBeGreaterThan(mm(4));
		},
	);

	it.skipIf(PDFTOPPM === null || GS === null)(
		`renders codes zxing reads, in both colour spaces${NEEDS_PDFTOPPM}${NEEDS_GS}`,
		async () => {
			for (const colour of ['srgb', 'cmyk'] as const) {
				for (const [i, text] of [
					'https://example.com/print/1',
					'WIFI:S:Example Network;T:WPA;P:example-pass;;',
					'tel:+61400000000',
				].entries()) {
					const scene = codeScene(text, {
						colour: i === 1 ? { r: 11, g: 60, b: 120 } : { r: 0, g: 0, b: 0 },
					});
					const marks = i === 2;
					const pdf = sceneToPdf(scene, { colour, widthMm: 30, bleedMm: i, cropMarks: marks });
					// Read as it would be after trimming. The crop marks are lines a few
					// millimetres from the quiet zone, and zxing-cpp's fast search gives
					// up on a picture with them in it; its slow one reads it.
					const poppler = popplerRender(pdf, 200).image;
					const margin = Math.round(((marks ? 8 : i) * 200) / 25.4);
					const side = Math.round((30 * 200) / 25.4);
					expect(
						await readCodes(crop(poppler, margin, margin, side, side)),
						`${colour} ${i}`,
					).toEqual([text]);
					expect(
						await readCodes(ghostscriptRender(pdf, 200, { trimBox: true }).image),
						`${colour} ${i}`,
					).toEqual([text]);
				}
			}
		},
	);
});
