/**
 * The EPS writer: its header, its colour, its refusals, and Ghostscript
 * drawing it as the rasteriser draws the same scene.
 *
 * Ghostscript is the reference PostScript interpreter. Every file must run
 * with nothing on stderr, crop to its bounding box (`-dEPSCrop`), and draw
 * the same picture as `rasterise` within Ghostscript's anti-aliasing. The
 * limits are those of `pdf.test.ts`, which were measured on the same
 * renderer, with one addition: the random scenes stretch images of a few
 * texels over a hundred pixels, and Ghostscript's smoothing of those differs
 * from bilinear sampling by a few levels in places. Measured: up to 1.04
 * percent of such a picture flat in our render and more than 6 levels out,
 * the same in the PDF of the same scene, so it is the renderer's filter and
 * not the writer.
 */

import { describe, expect, it } from 'vitest';
import { QrStudioError } from '../../src/core/errors.js';
import { PathBuilder } from '../../src/geometry/path.js';
import { ascii85, epsIssues, sceneToEps } from '../../src/render/eps.js';
import { MAX_PAGE_MM } from '../../src/render/pdf.js';
import { rasterise } from '../../src/render/raster.js';
import type { RgbaImage, Scene, SceneNode } from '../../src/render/types.js';
import { layoutText } from '../../src/text/layout.js';
import { GS, NEEDS_GS, codeScene, compare, ghostscriptRender, readCodes } from './pdf-tools.js';
import { sceneFor } from './scenes.js';

const white = { r: 255, g: 255, b: 255, a: 1 };
const black = { r: 0, g: 0, b: 0, a: 1 };
const TWO_INCHES = 50.8;

/**
 * Every paint EPS can draw, a clip group and a masked image, and with
 * `noise`, an image whose data takes several ASCII85 strings.
 */
function opaqueScene(noise = true): Scene {
	const masked: RgbaImage = {
		width: 9,
		height: 3,
		data: new Uint8ClampedArray(
			Array.from({ length: 27 }, (_, i) => [i * 9, 255 - i * 9, 128, i % 4 === 0 ? 0 : 255]).flat(),
		),
	};
	const big = 160;
	const noisy = new Uint8ClampedArray(big * big * 4);
	// Noise, so the compressed data runs past one ASCII85 string.
	let state = 7;
	for (let i = 0; i < noisy.length; i += 4) {
		state = (state * 1103515245 + 12345) >>> 0;
		noisy[i] = (state >>> 24) & 0xff;
		noisy[i + 1] = (state >>> 16) & 0xff;
		noisy[i + 2] = (state >>> 8) & 0xff;
		noisy[i + 3] = 255;
	}
	return {
		width: 40,
		height: 40,
		title: 'Opaque (all) é',
		background: {
			kind: 'radial',
			cx: 20,
			cy: 20,
			r: 30,
			stops: [
				{ offset: 0, colour: white },
				{ offset: 1, colour: { r: 200, g: 230, b: 255, a: 1 } },
			],
		},
		layers: [
			{
				kind: 'path',
				path: new PathBuilder().rect(2, 2, 10, 10).build(),
				paint: { kind: 'solid', colour: black },
			},
			{
				kind: 'path',
				path: new PathBuilder().circle(26, 8, 6).build(),
				paint: {
					kind: 'linear',
					x1: 20,
					y1: 2,
					x2: 32,
					y2: 14,
					stops: [
						{ offset: 0.2, colour: { r: 255, g: 0, b: 0, a: 1 } },
						{ offset: 0.2, colour: { r: 0, g: 0, b: 255, a: 1 } },
						{ offset: 1, colour: { r: 0, g: 200, b: 0, a: 1 } },
					],
				},
			},
			{
				kind: 'path',
				path: new PathBuilder().rect(2, 16, 12, 12).build(),
				paint: {
					kind: 'conic',
					cx: 8,
					cy: 22,
					angle: 45,
					stops: [
						{ offset: 0, colour: { r: 255, g: 200, b: 0, a: 1 } },
						{ offset: 1, colour: { r: 120, g: 0, b: 200, a: 1 } },
					],
				},
			},
			{
				kind: 'group',
				clip: new PathBuilder().circle(27, 23, 7).build(),
				children: [
					{
						kind: 'path',
						path: new PathBuilder().rect(18, 14, 18, 18).build(),
						paint: { kind: 'solid', colour: { r: 11, g: 118, b: 217, a: 1 } },
					},
					{ kind: 'image', image: masked, x: 20, y: 20, width: 14, height: 5 },
				],
			},
			...(noise
				? [
						{
							kind: 'group' as const,
							children: [
								{
									kind: 'image' as const,
									image: { width: big, height: big, data: noisy },
									x: 2,
									y: 30,
									width: 8,
									height: 8,
									clip: new PathBuilder().circle(6, 34, 4).build(),
								},
							],
						},
					]
				: []),
		],
	};
}

describe('the file', () => {
	it('is EPSF 3.0 with exact bounding boxes, a title and no date', () => {
		const eps = sceneToEps(opaqueScene(), { colour: 'srgb', widthMm: 40 });
		const lines = eps.split('\n');
		expect(lines[0]).toBe('%!PS-Adobe-3.0 EPSF-3.0');
		// 40 mm is 113.3858 points, which a whole-point box rounds up to 114.
		expect(lines).toContain('%%BoundingBox: 0 0 114 114');
		expect(lines).toContain('%%HiResBoundingBox: 0 0 113.3858 113.3858');
		expect(lines).toContain('%%Title: (Opaque \\(all\\) ?)');
		expect(lines).toContain('%%LanguageLevel: 3');
		expect(eps).not.toMatch(/CreationDate|For:/);
		expect(eps.endsWith('%%EOF\n')).toBe(true);
		// Seven bit text, and no line longer than DSC allows.
		expect([...eps].every((c) => c === '\n' || (c >= ' ' && c <= '~'))).toBe(true);
		for (const line of lines) expect(line.length).toBeLessThanOrEqual(255);
		// The noisy image's data needed more than one string.
		expect(eps.split('<~').length).toBeGreaterThan(3);
	});

	it('gives the same text twice', () => {
		expect(sceneToEps(opaqueScene(), { colour: 'cmyk', widthMm: 40 })).toBe(
			sceneToEps(opaqueScene(), { colour: 'cmyk', widthMm: 40 }),
		);
	});

	it('takes its height from the scene and leaves the title out when there is none', () => {
		const eps = sceneToEps(
			{ ...codeScene('https://example.com/e'), height: 74, title: undefined },
			{ colour: 'srgb', widthMm: 25.4 },
		);
		expect(eps).toContain(
			`%%HiResBoundingBox: 0 0 72 ${Number(((72 * 74) / codeScene('https://example.com/e').width).toFixed(4))}`,
		);
		expect(eps).not.toContain('%%Title');
	});

	it('uses rg in sRGB and k in CMYK, with black as K alone', () => {
		const srgb = sceneToEps(opaqueScene(), { colour: 'srgb', widthMm: 40 });
		const cmyk = sceneToEps(opaqueScene(), { colour: 'cmyk', widthMm: 40 });
		const operators = (eps: string): string[] =>
			[...eps.matchAll(/((?:-?[\d.]+ )+)(rg|k|setrgbcolor|setcmykcolor|setgray)\b/g)].map(
				(m) => `${(m[1] as string).trim()} ${m[2] as string}`,
			);
		expect(operators(srgb)).toContain('0 0 0 rg');
		for (const op of operators(cmyk)) expect(op).toMatch(/^[\d.]+ [\d.]+ [\d.]+ [\d.]+ k$/);
		expect(operators(cmyk)).toContain('0 0 0 1 k');
		expect(cmyk).toContain('/ColorSpace /DeviceCMYK');
		expect(cmyk).not.toContain('/DeviceRGB');
	});

	it('refuses options of the wrong kind and a page larger than PDF allows', () => {
		const scene = codeScene('https://example.com/e');
		for (const options of [
			null,
			{ colour: 'rgb', widthMm: 10 },
			{ colour: 'srgb', widthMm: 0 },
			{ colour: 'srgb' },
		]) {
			expect(() => sceneToEps(scene, options as never)).toThrow(TypeError);
		}
		expect(() => sceneToEps(scene, { colour: 'srgb', widthMm: MAX_PAGE_MM + 1 })).toThrow(
			QrStudioError,
		);
	});
});

describe('ASCII85', () => {
	/** Adobe's decoding, written out from the specification, for the round trip. */
	function decode(text: string): number[] {
		const body = text.slice(2, -2).replace(/\s/g, '');
		const out: number[] = [];
		let group: number[] = [];
		const flush = (count: number): void => {
			let value = 0;
			for (let i = 0; i < 5; i += 1) value = value * 85 + ((group[i] ?? 84) as number);
			for (let i = 0; i < count - 1; i += 1) out.push(Math.floor(value / 256 ** (3 - i)) % 256);
			group = [];
		};
		for (const char of body) {
			if (char === 'z') {
				out.push(0, 0, 0, 0);
				continue;
			}
			group.push(char.charCodeAt(0) - 33);
			if (group.length === 5) flush(5);
		}
		if (group.length > 0) flush(group.length);
		return out;
	}

	it('round trips every tail length, writes z for four zeros, and keeps lines short', () => {
		for (const length of [0, 1, 2, 3, 4, 5, 8, 9, 300]) {
			const bytes = Uint8Array.from({ length }, (_, i) => (i % 7 === 0 ? 0 : (i * 97 + 13) & 0xff));
			const text = ascii85(bytes);
			expect(text.startsWith('<~') && text.endsWith('~>')).toBe(true);
			expect(decode(text)).toEqual(Array.from(bytes));
			for (const line of text.split('\n')) expect(line.length).toBeLessThanOrEqual(76);
		}
		expect(ascii85(new Uint8Array(8))).toBe('<~zz~>');
		expect(ascii85(new Uint8Array(3))).toBe('<~!!!!~>');
	});
});

describe('transparency', () => {
	const translucent: SceneNode[] = [
		{
			kind: 'path',
			path: new PathBuilder().rect(0, 0, 1, 1).build(),
			paint: { kind: 'solid', colour: { ...black, a: 0.5 } },
		},
		{
			kind: 'path',
			path: new PathBuilder().rect(0, 0, 1, 1).build(),
			paint: {
				kind: 'linear',
				x1: 0,
				y1: 0,
				x2: 1,
				y2: 0,
				stops: [
					{ offset: 0, colour: black },
					{ offset: 1, colour: { ...white, a: 0.5 } },
				],
			},
		},
		{
			kind: 'group',
			opacity: 0.5,
			children: [
				{
					kind: 'path',
					path: new PathBuilder().rect(0, 0, 1, 1).build(),
					paint: { kind: 'solid', colour: black },
				},
			],
		},
		{
			kind: 'group',
			children: [
				{
					kind: 'image',
					image: { width: 1, height: 1, data: new Uint8ClampedArray([1, 2, 3, 100]) },
					x: 0,
					y: 0,
					width: 1,
					height: 1,
				},
			],
		},
	];

	it('lists every translucent part, with the path to it', () => {
		const scene: Scene = {
			width: 2,
			height: 2,
			background: { kind: 'solid', colour: { ...white, a: 0.9 } },
			layers: translucent,
		};
		expect(epsIssues(scene)).toEqual([
			{ code: 'render.eps.transparency', path: ['background'], severity: 'error' },
			{ code: 'render.eps.transparency', path: ['layers', 0], severity: 'error' },
			{ code: 'render.eps.transparency', path: ['layers', 1], severity: 'error' },
			{ code: 'render.eps.transparency', path: ['layers', 2], severity: 'error' },
			{ code: 'render.eps.transparency', path: ['layers', 3, 'children', 0], severity: 'error' },
		]);
		expect(epsIssues(opaqueScene())).toEqual([]);
	});

	it('refuses a scene it cannot draw rather than draw a different picture', () => {
		for (const layer of translucent) {
			try {
				sceneToEps(
					{ width: 2, height: 2, background: null, layers: [layer] },
					{ colour: 'srgb', widthMm: 10 },
				);
				throw new Error('expected a refusal');
			} catch (error) {
				expect(error).toBeInstanceOf(QrStudioError);
				expect((error as QrStudioError).code).toBe('render/format-unavailable');
				expect((error as QrStudioError).params).toEqual({
					format: 'eps',
					reason: 'transparency',
					count: 1,
				});
			}
		}
	});
});

describe('Ghostscript', () => {
	const DPI = 150;
	const opaque = (seed: number): Scene =>
		sceneFor(seed, {
			size: 32,
			layers: 5,
			translucent: false,
			groups: true,
			conic: true,
			images: true,
		});

	it.skipIf(GS === null)(
		`draws every file as the rasteriser does${NEEDS_GS}`,
		() => {
			const caption = layoutText('SCAN ME', {
				fontId: 'plex-sans-bold',
				size: 4,
				box: { x: 0, y: 37, width: 37, height: 6 },
			});
			const code = codeScene('https://example.com/eps');
			const corpus: [string, Scene][] = [
				// Noise resampled is only noise, so the noisy image is left out here.
				['opaque scene', opaqueScene(false)],
				[
					'code with a caption',
					{
						...code,
						height: 43,
						layers: [
							...code.layers,
							...caption.paths.map((path) => ({
								kind: 'path' as const,
								path,
								paint: { kind: 'solid' as const, colour: { r: 11, g: 118, b: 217, a: 1 } },
							})),
						],
					},
				],
				...[1, 2, 3, 4, 5, 6].map((seed): [string, Scene] => [`seed ${seed}`, opaque(seed)]),
			];
			for (const [label, scene] of corpus) {
				const stretched = label.startsWith('seed');
				const { image, stderr } = ghostscriptRender(
					sceneToEps(scene, { colour: 'srgb', widthMm: TWO_INCHES }),
					DPI,
					{ eps: true },
				);
				expect(stderr, label).toBe('');
				const ours = rasterise(scene, { width: image.width, height: image.height });
				const difference = compare(ours, image);
				const report = `${label}: ${JSON.stringify(difference)}`;
				// The same limits as the PDF through Ghostscript.
				expect(difference.mean, report).toBeLessThan(2.2);
				expect(difference.over32, report).toBeLessThanOrEqual(0.03);
				expect(difference.interior, report).toBeLessThanOrEqual(stretched ? 0.015 : 0.005);
			}
		},
		60_000,
	);

	it.skipIf(GS === null)(`runs a file with image data in several strings${NEEDS_GS}`, () => {
		expect(
			ghostscriptRender(sceneToEps(opaqueScene(), { colour: 'cmyk', widthMm: 40 }), 72, {
				eps: true,
			}).stderr,
		).toBe('');
	});

	it.skipIf(GS === null)(`draws codes zxing reads, in both colour spaces${NEEDS_GS}`, async () => {
		for (const colour of ['srgb', 'cmyk'] as const) {
			const text = `https://example.com/eps/${colour}`;
			const eps = sceneToEps(codeScene(text), { colour, widthMm: 30 });
			expect(await readCodes(ghostscriptRender(eps, 200, { eps: true }).image)).toEqual([text]);
		}
	});
});
