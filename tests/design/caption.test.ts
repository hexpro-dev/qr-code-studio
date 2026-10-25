/**
 * Frame captions: set by the text layer into the box each frame reserves,
 * drawn as filled outlines on top of the frame, in the frame's ink, and
 * never anywhere near the quiet zone or an issue's text.
 */

import { describe, expect, it } from 'vitest';
import { Registry } from '../../src/core/registry.js';
import { createDesignRegistries } from '../../src/design/registries.js';
import { buildScene } from '../../src/design/scene.js';
import type {
	DesignFrame,
	DesignRegistries,
	FrameEntry,
	FrameLayout,
	QrDesignV1,
} from '../../src/design/types.js';
import { validateDesign } from '../../src/design/validate.js';
import { bounds } from '../../src/geometry/measure.js';
import { epsIssues, sceneToEps } from '../../src/render/eps.js';
import { sceneToPdf } from '../../src/render/pdf.js';
import { rasterise } from '../../src/render/raster.js';
import { sceneToSvg } from '../../src/render/svg.js';
import type { Scene, SceneNode } from '../../src/render/types.js';
import { builtInFonts, createFontRegistry } from '../../src/text/registry.js';
import type { Font } from '../../src/text/types.js';
import { designWith } from './helpers.js';
import { jsqrText, zxingTexts } from './oracles.js';
import { qrSymbol } from './symbols.js';

const registries = createDesignRegistries();
const captioned = registries.frames.list().filter((frame) => frame.text !== null);
const TEXT = 'https://example.com/caption';
const symbol = qrSymbol(TEXT, 'M');
const NAVY = '#0b3d91';

function framed(
	id: string,
	text: DesignFrame['text'],
	extra: Partial<QrDesignV1> = {},
): QrDesignV1 {
	return designWith({
		frame: {
			ref: { id },
			paint: { kind: 'solid', ink: NAVY },
			...(text === undefined ? {} : { text }),
		},
		...extra,
	});
}

function caption(content: string, fontId = 'plex-sans-bold'): NonNullable<DesignFrame['text']> {
	return { content, fontId };
}

/** The frame's layout for `symbol` at the default params, as buildScene lays it. */
function layoutOf(frame: FrameEntry): FrameLayout {
	return frame.layout({
		symbolSize: { width: symbol.matrix.width, height: symbol.matrix.height },
		quietZone: 4,
		params: Object.fromEntries(frame.params.map((param) => [param.key, param.default])),
		paint: { kind: 'solid', colour: { r: 0, g: 0, b: 0, a: 1 } },
	});
}

function captionNode(scene: Scene): SceneNode | undefined {
	const last = scene.layers.at(-1);
	if (last?.kind === 'group') return last.children[0];
	return last?.kind === 'path' && last.role === 'caption' ? last : undefined;
}

function captionPath(scene: Scene) {
	const node = captionNode(scene);
	if (node?.kind !== 'path') throw new Error('a caption path was expected');
	return node;
}

/** Pixels the caption layer alone inks, 8 to a module, inside and outside `box`. */
function inkedBy(scene: Scene, box: { x: number; y: number; width: number; height: number }) {
	const scale = 8;
	const image = rasterise(
		{ ...scene, background: null, layers: [scene.layers.at(-1) as SceneNode] },
		{ width: Math.round(scene.width * scale) },
	);
	let inside = 0;
	let outside = 0;
	for (let y = 0; y < image.height; y += 1) {
		for (let x = 0; x < image.width; x += 1) {
			if ((image.data[(y * image.width + x) * 4 + 3] as number) === 0) continue;
			const ux = (x + 0.5) / scale;
			const uy = (y + 0.5) / scale;
			// A pixel the box's edge passes through counts as inside.
			const within =
				ux > box.x - 1 / scale &&
				ux < box.x + box.width + 1 / scale &&
				uy > box.y - 1 / scale &&
				uy < box.y + box.height + 1 / scale;
			if (within) inside += 1;
			else outside += 1;
		}
	}
	return { inside, outside };
}

describe('frame captions', () => {
	it('are set in every frame with room for one, as outlines inside its box', () => {
		expect(captioned.length).toBe(registries.frames.list().length - 1);
		for (const frame of captioned) {
			const built = buildScene(symbol, framed(frame.id, caption('Scan me')), {
				registries,
				seed: 3,
			});
			expect(built.issues, frame.id).toEqual([]);
			const node = captionPath(built.scene);
			expect(node.role).toBe('caption');
			const box = layoutOf(frame).textBox!;
			const drawn = bounds(node.path)!;
			// Inside the box the frame reserved, which conformance holds clear of
			// the quiet zone, and filling a fair part of its height.
			expect(drawn.x, frame.id).toBeGreaterThanOrEqual(box.x - 1e-9);
			expect(drawn.y, frame.id).toBeGreaterThanOrEqual(box.y - 1e-9);
			expect(drawn.x + drawn.width, frame.id).toBeLessThanOrEqual(box.x + box.width + 1e-9);
			expect(drawn.y + drawn.height, frame.id).toBeLessThanOrEqual(box.y + box.height + 1e-9);
			expect(drawn.height, frame.id).toBeGreaterThan(box.height * 0.4);
			const ink = inkedBy(built.scene, box);
			expect(ink.inside, frame.id).toBeGreaterThan(50);
			expect(ink.outside, frame.id).toBe(0);
			// Outlines, not text: nothing in the file spells the caption.
			const svg = sceneToSvg(built.scene);
			expect(svg).not.toContain('<text');
			expect(svg).not.toContain('Scan me');
			expect(built.scene.title).toBe('QR code');
		}
	});

	it('follow the box: aligned as the frame asks, and on two lines where the frame has two', () => {
		const bubble = captionPath(
			buildScene(symbol, framed('speech-bubble', caption('Hi')), { registries }).scene,
		);
		const bubbleBox = layoutOf(registries.frames.require('speech-bubble')).textBox!;
		expect(bubbleBox.align).toBe('start');
		expect(bounds(bubble.path)!.x - bubbleBox.x).toBeLessThan(bubbleBox.height * 0.2);

		const card = registries.frames.require('rounded-card');
		expect(card.text?.maxLines).toBe(2);
		const one = buildScene(symbol, framed('rounded-card', caption('Menu')), { registries });
		const two = buildScene(symbol, framed('rounded-card', caption('Today\nMenu')), {
			registries,
		});
		expect(two.issues).toEqual([]);
		// Two lines share the height one line had to itself, so together they
		// reach further down the box, each smaller.
		const oneBox = bounds(captionPath(one.scene).path)!;
		const twoBox = bounds(captionPath(two.scene).path)!;
		expect(twoBox.height).toBeGreaterThan(oneBox.height);
		expect(twoBox.height).toBeLessThan(oneBox.height * 2);
	});

	it('shrink to fit, and past the floor are cut at the box with a warning', () => {
		const short = buildScene(symbol, framed('banner-bottom', caption('MENU')), { registries });
		const long = buildScene(symbol, framed('banner-bottom', caption('MENU AND TODAY SPECIALS')), {
			registries,
		});
		expect(long.issues).toEqual([]);
		// Capitals only, so the outlines' height is the size they were set at.
		const shortHeight = bounds(captionPath(short.scene).path)!.height;
		const longHeight = bounds(captionPath(long.scene).path)!.height;
		expect(longHeight).toBeLessThan(shortHeight * 0.8);

		const box = layoutOf(registries.frames.require('banner-bottom')).textBox!;
		const tooLong = buildScene(symbol, framed('banner-bottom', caption('M'.repeat(24))), {
			registries,
		});
		expect(tooLong.issues).toEqual([
			{
				code: 'design.issue.caption-overflow',
				path: ['frame', 'text', 'content'],
				severity: 'warning',
			},
		]);
		const group = tooLong.scene.layers.at(-1);
		expect(group?.kind).toBe('group');
		if (group?.kind !== 'group') return;
		const clip = bounds(group.clip!)!;
		expect(clip.x).toBeCloseTo(box.x, 9);
		expect(clip.y).toBeCloseTo(box.y, 9);
		expect(clip.width).toBeCloseTo(box.width, 9);
		expect(clip.height).toBeCloseTo(box.height, 9);
		// The outlines run past the box; what is drawn does not.
		expect(bounds(captionPath(tooLong.scene).path)!.width).toBeGreaterThan(box.width);
		expect(inkedBy(tooLong.scene, box).outside).toBe(0);

		// Lines past the frame's limit are left out the same way.
		const lines = buildScene(symbol, framed('banner-bottom', caption('One\nTwo')), {
			registries,
		});
		expect(lines.issues.map((found) => found.code)).toEqual(['design.issue.caption-overflow']);
	});

	it('leave out what the font cannot draw, never another font, and say how many', () => {
		const mixed = buildScene(symbol, framed('banner-bottom', caption('Menu 菜单菜')), {
			registries,
		});
		expect(mixed.issues).toEqual([
			{
				code: 'design.issue.caption-missing-glyphs',
				path: ['frame', 'text', 'content'],
				severity: 'warning',
				params: { count: 2 },
			},
		]);
		// What is drawn is the Latin part alone: the same outlines, moved
		// along by the centring, and nothing where the rest would have gone.
		const latin = buildScene(symbol, framed('banner-bottom', caption('Menu')), { registries });
		const drawn = captionPath(mixed.scene).path;
		const alone = captionPath(latin.scene).path;
		expect(drawn.commands).toEqual(alone.commands);
		const dx = (drawn.points[0] as number) - (alone.points[0] as number);
		drawn.points.forEach((value, i) => {
			const expected = (alone.points[i] as number) + (i % 2 === 0 ? dx : 0);
			expect(Math.abs(value - expected)).toBeLessThan(1e-9);
		});

		const none = buildScene(symbol, framed('banner-bottom', caption('扫码')), {
			registries,
		});
		expect(none.issues.map((found) => found.code)).toEqual(['design.issue.caption-missing-glyphs']);
		expect(none.scene.layers.some((node) => node.kind === 'path' && node.role === 'caption')).toBe(
			false,
		);
	});

	it('take the frame ink for where they sit, unless the design paints them', () => {
		const white = { kind: 'solid', colour: { r: 255, g: 255, b: 255, a: 1 } };
		const navy = { kind: 'solid', colour: { r: 11, g: 61, b: 145, a: 1 } };
		const paintOf = (design: QrDesignV1) =>
			captionPath(buildScene(symbol, design, { registries }).scene).paint;
		// On the frame's band, knocked out in the background.
		expect(paintOf(framed('banner-bottom', caption('Menu')))).toEqual(white);
		expect(
			paintOf(
				framed('banner-bottom', caption('Menu'), {
					background: { kind: 'solid', ink: '#fffdf7' },
				}),
			),
		).toEqual({ kind: 'solid', colour: { r: 255, g: 253, b: 247, a: 1 } });
		// A transparent design still knocks out in white.
		expect(paintOf(framed('banner-bottom', caption('Menu'), { background: null }))).toEqual(white);
		// Beside the artwork, in the frame's own paint.
		expect(paintOf(framed('corner-brackets', caption('Menu')))).toEqual(navy);
		expect(paintOf(framed('speech-bubble', caption('Menu')))).toEqual(navy);
		// A paint of its own, resolved over the caption's box.
		const own = paintOf(
			framed('banner-bottom', {
				...caption('Menu'),
				paint: {
					kind: 'linear',
					angle: 0,
					space: 'symbol',
					stops: [
						{ offset: 0, ink: '#ffcc00' },
						{ offset: 1, ink: '#ffffff' },
					],
				},
			}),
		);
		const box = layoutOf(registries.frames.require('banner-bottom')).textBox!;
		expect(own.kind).toBe('linear');
		if (own.kind !== 'linear') return;
		expect(own.x1).toBeCloseTo(box.x, 9);
		expect(own.x2).toBeCloseTo(box.x + box.width, 9);
		// A fill this registry lacks is reported and the frame's ink used.
		const missing = buildScene(
			symbol,
			framed('banner-bottom', {
				...caption('Menu'),
				paint: { kind: 'entry', ref: { id: 'not-a-fill' } },
			}),
			{ registries },
		);
		expect(missing.issues).toEqual([
			{
				code: 'design.issue.unknown-entry',
				path: ['frame', 'text', 'paint', 'ref', 'id'],
				severity: 'warning',
				params: { kind: 'fill' },
			},
		]);
		expect(captionPath(missing.scene).paint).toEqual(white);
	});

	it('judge a box thinner than a pixel by its centre', () => {
		const base = registries.frames.require('banner-bottom');
		const thin: FrameEntry = {
			...base,
			id: 'thin',
			layout(ctx) {
				const layout = base.layout(ctx);
				const box = layout.textBox!;
				return { ...layout, textBox: { ...box, y: box.y + box.height / 2, height: 0.001 } };
			},
		};
		const own: DesignRegistries = { ...registries, frames: new Registry('frame', [thin]) };
		const built = buildScene(symbol, framed('thin', caption('I')), { registries: own });
		// Set far too small to read, and still knocked out in white on the
		// band, which the pixel at the box's centre finds.
		const node = captionNode(built.scene);
		expect(node?.kind === 'path' ? node.paint : null).toEqual({
			kind: 'solid',
			colour: { r: 255, g: 255, b: 255, a: 1 },
		});
	});

	it('are left out, with a warning, where they cannot be set', () => {
		const codes = (design: QrDesignV1, fonts = createFontRegistry()) =>
			buildScene(symbol, design, { registries, fonts }).issues.map((found) => [
				found.code,
				found.path.join('.'),
			]);
		// A font this registry does not hold is not swapped for another.
		expect(codes(framed('banner-bottom', caption('Menu', 'inter')))).toEqual([
			['design.issue.font-unavailable', 'frame.text.fontId'],
		]);
		expect(codes(framed('banner-bottom', caption('Menu')), new Registry<Font>('font', []))).toEqual(
			[['design.issue.font-unavailable', 'frame.text.fontId']],
		);
		// Longer than the frame allows: validateDesign refuses it, and a scene
		// built without validating leaves it out.
		expect(codes(framed('badge-circle', caption('x'.repeat(17))))).toEqual([
			['design.issue.too-long', 'frame.text.content'],
		]);
		expect(codes(framed('badge-circle', caption('x'.repeat(16))))).toEqual([]);
		// A frame with no box, or a box with no room.
		expect(codes(framed('none', caption('Menu')))).toEqual([
			['design.issue.caption-unsupported', 'frame.text'],
		]);
		const base = registries.frames.require('banner-bottom');
		const flat: FrameEntry = {
			...base,
			id: 'flat',
			layout(ctx) {
				const layout = base.layout(ctx);
				return { ...layout, textBox: { ...layout.textBox!, height: 0 } };
			},
		};
		const own: DesignRegistries = { ...registries, frames: new Registry('frame', [flat]) };
		expect(
			buildScene(symbol, framed('flat', caption('Menu')), { registries: own }).issues.map(
				(found) => found.code,
			),
		).toEqual(['design.issue.caption-unsupported']);
		// An empty caption is no caption.
		expect(codes(framed('banner-bottom', caption('')))).toEqual([]);
	});

	it('are set in a font the website registered', () => {
		const bold = builtInFonts()[1] as Font;
		const fonts = new Registry<Font>('font', [{ ...bold, id: 'house' }]);
		const house = buildScene(symbol, framed('banner-bottom', caption('Menu', 'house')), {
			registries,
			fonts,
		});
		const plex = buildScene(symbol, framed('banner-bottom', caption('Menu')), { registries });
		expect(house.issues).toEqual([]);
		expect(captionPath(house.scene).path).toEqual(captionPath(plex.scene).path);
	});

	it('never put the caption in an issue or the title', () => {
		const secret = 'pw hunter2 菜';
		for (const design of [
			framed('banner-bottom', caption(secret)),
			framed('badge-circle', caption(`${secret} ${secret}`)),
			framed('none', caption(secret)),
			framed('banner-bottom', caption(secret, 'inter')),
		]) {
			const built = buildScene(symbol, design, { registries });
			expect(built.issues.length).toBeGreaterThan(0);
			const text = JSON.stringify(built.issues) + (built.scene.title ?? '');
			expect(text).not.toContain('hunter2');
			expect(sceneToSvg(built.scene)).not.toContain('hunter2');
		}
	});

	it('reach PDF and EPS as the same outlines, with no font in either file', () => {
		// Too long for the badge, so it is cut by a clip as well.
		const built = buildScene(symbol, framed('badge-circle', caption('MMMMMMMMMMMMMMMM')), {
			registries,
		});
		expect(built.scene.layers.at(-1)?.kind).toBe('group');
		expect(epsIssues(built.scene)).toEqual([]);
		const eps = sceneToEps(built.scene, { colour: 'cmyk', widthMm: 40 });
		expect(eps).not.toMatch(/findfont|\bshow\b/);
		expect(eps).not.toContain('MMMM');
		const pdf = new TextDecoder('latin1').decode(
			sceneToPdf(built.scene, { colour: 'srgb', widthMm: 40 }),
		);
		expect(pdf).not.toContain('/Font');
		expect(pdf).not.toContain('MMMM');
	});

	it('give the same scene and the same SVG bytes twice', () => {
		const design = framed('rounded-card', caption('Scan for the menu'));
		const first = buildScene(symbol, design, { registries, seed: 5 });
		const second = buildScene(symbol, design, { registries, seed: 5 });
		expect(second).toEqual(first);
		expect(sceneToSvg(second.scene)).toBe(sceneToSvg(first.scene));
	});

	it('leave the code readable by zxing-cpp and jsQR in every frame', async () => {
		const words: Record<number, string> = { 1: 'Scan me', 2: 'Scan for\nthe menu' };
		for (const frame of captioned) {
			const content = words[frame.text!.maxLines] as string;
			const built = buildScene(symbol, framed(frame.id, caption(content)), {
				registries,
				seed: 1,
			});
			expect(built.issues, frame.id).toEqual([]);
			const image = rasterise(built.scene, {
				width: Math.round(built.scene.width * 6),
				background: { r: 255, g: 255, b: 255, a: 1 },
			});
			expect(await zxingTexts(image), frame.id).toContain(TEXT);
			expect(jsqrText(image), frame.id).toBe(TEXT);
		}
	});
});

describe('validateDesign on captions', () => {
	const issues = (design: QrDesignV1, options?: Parameters<typeof validateDesign>[2]) =>
		validateDesign(design, registries, options).issues.map(
			(found) => `${found.severity} ${found.code} ${found.path.join('.')}`,
		);

	it('warns of a font the registry does not hold, and keeps the design', () => {
		const design = framed('banner-bottom', caption('Menu', 'inter'));
		expect(issues(design)).toEqual(['warning design.issue.font-unavailable frame.text.fontId']);
		expect(validateDesign(design, registries).design).toEqual(design);
		const fonts = createFontRegistry();
		fonts.register({ ...(builtInFonts()[0] as Font), id: 'inter' });
		expect(issues(design, { fonts })).toEqual([]);
		expect(issues(framed('banner-bottom', caption('Menu')))).toEqual([]);
		expect(() => validateDesign(design, registries, null as never)).toThrow(TypeError);
	});

	it("holds a caption to its own frame's length", () => {
		expect(issues(framed('badge-circle', caption('x'.repeat(16))))).toEqual([]);
		expect(issues(framed('badge-circle', caption('x'.repeat(17))))).toEqual([
			'error design.issue.too-long frame.text.content',
		]);
		expect(issues(framed('rounded-card', caption('x'.repeat(40))))).toEqual([]);
	});
});
