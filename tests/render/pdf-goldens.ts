/**
 * Golden prints: the bytes of PDF and EPS files and caption renders, which
 * must be the same in Node, Chromium, WebKit and Firefox.
 *
 * Plain on purpose, like `goldens.ts` beside it, whose SHA-256 it uses: it
 * imports only `src/` and that module, uses no Node API, and needs nothing
 * from a browser beyond `TextEncoder`, so a page can bundle it, call
 * `checkPrintGoldens()` and report what comes back.
 * `tests/render/pdf-goldens.test.ts` runs the same check in Node.
 *
 * A file's bytes rest on everything beneath them: the scene, the caption's
 * layout from the compiled font, the number formatting, the deflate, the
 * hash that makes the file identifier. A digest that moves without a reason
 * is the bug this file exists to catch; one that moves on purpose is
 * updated in the same commit, which says why.
 */

import { encode } from '../../src/encode/encode.js';
import { PathBuilder } from '../../src/geometry/path.js';
import { traceGrid } from '../../src/geometry/trace.js';
import { sceneToEps } from '../../src/render/eps.js';
import { imposeCopies, printSheetTemplate } from '../../src/render/impose.js';
import { sceneToPdf, sheetToPdf } from '../../src/render/pdf.js';
import { rasterise } from '../../src/render/raster.js';
import { sceneToSvg } from '../../src/render/svg.js';
import type { Colour, Scene } from '../../src/render/types.js';
import { layoutText } from '../../src/text/layout.js';
import { sha256Hex } from './goldens.js';

const white: Colour = { r: 255, g: 255, b: 255, a: 1 };
const ink: Colour = { r: 16, g: 24, b: 32, a: 1 };
const blue: Colour = { r: 11, g: 118, b: 217, a: 1 };

/** A code with a caption under it: what a framed design becomes. */
function captioned(caption: string, fontId: string): Scene {
	const symbol = encode('https://example.com/golden', { ecLevel: 'Q' });
	const m = symbol.matrix;
	const size = m.width + 8;
	const grid = traceGrid(m.width, m.height, (x, y) => m.get(x, y) === 1);
	const layout = layoutText(caption, {
		fontId,
		size: 3.5,
		box: { x: 1, y: size, width: size - 2, height: 6 },
		maxLines: 1,
		shrinkToFit: true,
	});
	return {
		width: size,
		height: size + 6,
		unitsPerMm: size / 30,
		title: 'Golden',
		background: { kind: 'solid', colour: white },
		layers: [
			{
				kind: 'path',
				path: new PathBuilder().transform([1, 0, 0, 1, 4, 4]).append(grid).build(),
				paint: { kind: 'solid', colour: ink },
			},
			...layout.paths.map((path) => ({
				kind: 'path' as const,
				path,
				paint: { kind: 'solid' as const, colour: blue },
			})),
		],
	};
}

/** Gradients of every kind, a clip, a translucent group and an image. */
function painted(): Scene {
	const image = {
		width: 2,
		height: 2,
		data: new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 0, 0, 0, 255, 255, 255, 255, 0, 128]),
	};
	return {
		width: 30,
		height: 20,
		background: {
			kind: 'linear',
			x1: 0,
			y1: 0,
			x2: 30,
			y2: 0,
			stops: [
				{ offset: 0, colour: white },
				{ offset: 0.5, colour: { r: 220, g: 235, b: 255, a: 1 } },
				{ offset: 0.5, colour: { r: 255, g: 245, b: 220, a: 1 } },
				{ offset: 1, colour: white },
			],
		},
		layers: [
			{
				kind: 'path',
				path: new PathBuilder().circle(8, 10, 6).build(),
				paint: {
					kind: 'radial',
					cx: 8,
					cy: 10,
					r: 6,
					stops: [
						{ offset: 0, colour: blue },
						{ offset: 1, colour: { ...ink, a: 0.4 } },
					],
				},
			},
			{
				kind: 'path',
				path: new PathBuilder().roundedRect(16, 3, 10, 14, 3).build(),
				paint: {
					kind: 'conic',
					cx: 21,
					cy: 10,
					angle: -30,
					stops: [
						{ offset: 0, colour: blue },
						{ offset: 1, colour: { r: 255, g: 153, b: 0, a: 1 } },
					],
				},
			},
			{
				kind: 'group',
				opacity: 0.6,
				clip: new PathBuilder().rect(2, 2, 26, 16).build(),
				children: [{ kind: 'image', image, x: 11, y: 6, width: 8, height: 8 }],
			},
		],
	};
}

const text = (value: string): Uint8Array => new TextEncoder().encode(value);

function captionPixels(): Uint8Array {
	const scene = captioned('Scan for the menu → €5', 'plex-sans-bold');
	const image = rasterise(
		{ ...scene, layers: scene.layers.slice(1), background: { kind: 'solid', colour: white } },
		{ width: 240 },
	);
	return new Uint8Array(image.data.buffer, image.data.byteOffset, image.data.byteLength);
}

export interface PrintGolden {
	readonly name: string;
	readonly render: () => Uint8Array;
	readonly sha256: string;
}

export const PRINT_GOLDENS: readonly PrintGolden[] = [
	{
		name: 'a code with a bold caption as an sRGB PDF',
		render: () =>
			sceneToPdf(captioned('SCAN ME', 'plex-sans-bold'), { colour: 'srgb', widthMm: 30 }),
		sha256: '3c86b5e2a0cb543680ab179549b85dfec75cbf6e6d2d8631db0adbce25cc4302',
	},
	{
		name: 'the same in CMYK with bleed and crop marks',
		render: () =>
			sceneToPdf(captioned('SCAN ME', 'plex-sans-bold'), {
				colour: 'cmyk',
				widthMm: 30,
				bleedMm: 3,
				cropMarks: true,
			}),
		sha256: 'd389bf87d46a63c80c90e03328781d09fea1a6572841c8d0cd5b2294f9c9a2a9',
	},
	{
		name: 'gradients, a clip, a translucent group and an image as a PDF',
		render: () => sceneToPdf(painted(), { colour: 'srgb', widthMm: 60, title: 'Café' }),
		sha256: 'ac5f960e4ce1244c6180856aecb9a6c8eeb2fbd421b48b7fd1f162dd1b1a06d5',
	},
	{
		name: 'a print sheet of copies as a CMYK PDF',
		render: () =>
			sheetToPdf(
				imposeCopies(
					captioned('Menu', 'plex-sans-regular'),
					7,
					printSheetTemplate({ paper: 'a4', widthMm: 30, heightMm: 36, bleedMm: 2 }),
				),
				{
					colour: 'cmyk',
				},
			),
		sha256: '68ba92e62322a2b72b07c32580174e60d042d9b8a7355ea0529927fbe1197a82',
	},
	{
		name: 'a code with a regular caption as an sRGB EPS',
		render: () =>
			text(
				sceneToEps(captioned('Scan to pay', 'plex-sans-regular'), { colour: 'srgb', widthMm: 30 }),
			),
		sha256: 'f5c29aed5a45420365789b239b509da4f385b10403cfe0a8e538e50d93220da2',
	},
	{
		name: 'the same in CMYK with a Cyrillic caption',
		render: () =>
			text(sceneToEps(captioned('Меню', 'plex-sans-bold'), { colour: 'cmyk', widthMm: 30 })),
		sha256: '1140fd1ef7a9430e76c1667e22ee1ead4624aec5d61fcbf7b4682689b9e15f9f',
	},
	{
		name: 'a caption laid out and rasterised',
		render: captionPixels,
		sha256: '52370ef227fd1d4f313354e9c891ba05cba181a4b4f1863214e8a23bbba1ed74',
	},
	{
		name: 'a Greek caption laid out as SVG paths',
		render: () => text(sceneToSvg(captioned('Μενού', 'plex-sans-bold'))),
		sha256: '4e02c03f52a7d4575507499467a8430adba3ba57c450a4d9f90a37c9c9f78a19',
	},
];

export interface PrintGoldenResult {
	readonly name: string;
	readonly expected: string;
	readonly actual: string;
	readonly stable: boolean;
}

/** Render every golden twice and report each one that moved, or that differed between runs. */
export function checkPrintGoldens(): readonly PrintGoldenResult[] {
	const out: PrintGoldenResult[] = [];
	for (const golden of PRINT_GOLDENS) {
		const first = sha256Hex(golden.render());
		const second = sha256Hex(golden.render());
		if (first !== golden.sha256 || second !== first) {
			out.push({
				name: golden.name,
				expected: golden.sha256,
				actual: first,
				stable: first === second,
			});
		}
	}
	return out;
}
