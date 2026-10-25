/**
 * Designs as SVG: well formed, and drawn by resvg as this package's own
 * rasteriser draws them.
 *
 * The comparison is the render layer's "same picture" test (see
 * tests/render/resvg.test.ts): both renderers at eight times the size, box
 * filtered down in premultiplied space, so anti-aliasing and gradient
 * sampling average out and what is left is geometry and paint. Limits are
 * the render layer's: no pixel more than 8 levels apart (16 where a picture
 * is drawn, 24 where a conic gradient is) and a mean under 0.4 of a level.
 */

import { Resvg } from '@resvg/resvg-js';
import { DOMParser } from '@xmldom/xmldom';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import type { RgbaImage } from '../../src/core/image.js';
import { createDesignRegistries } from '../../src/design/registries.js';
import { buildScene } from '../../src/design/scene.js';
import type { QrDesignV1 } from '../../src/design/types.js';
import { rasterise } from '../../src/render/raster.js';
import { sceneToSvg } from '../../src/render/svg.js';
import type { Scene } from '../../src/render/types.js';
import type { BuiltSymbol } from '../../src/symbology/types.js';
import { designWith, discImage } from './helpers.js';
import { microSymbol, qrSymbol, rmqrSymbol } from './symbols.js';

const OVERSAMPLE = 8;
const registries = createDesignRegistries();

function shrink(big: RgbaImage, k: number): RgbaImage {
	// A framed design's artwork is a fractional number of modules, so the
	// last partial block of rows is dropped rather than half averaged.
	const width = Math.floor(big.width / k);
	const height = Math.floor(big.height / k);
	const data = new Uint8ClampedArray(width * height * 4);
	for (let y = 0; y < height; y += 1) {
		for (let x = 0; x < width; x += 1) {
			let r = 0;
			let g = 0;
			let b = 0;
			let a = 0;
			for (let dy = 0; dy < k; dy += 1) {
				for (let dx = 0; dx < k; dx += 1) {
					const at = ((y * k + dy) * big.width + x * k + dx) * 4;
					const alpha = (big.data[at + 3] as number) / 255;
					r += (big.data[at] as number) * alpha;
					g += (big.data[at + 1] as number) * alpha;
					b += (big.data[at + 2] as number) * alpha;
					a += alpha;
				}
			}
			const out = (y * width + x) * 4;
			if (a > 0) {
				data[out] = Math.round(r / a);
				data[out + 1] = Math.round(g / a);
				data[out + 2] = Math.round(b / a);
			}
			data[out + 3] = Math.round((a / (k * k)) * 255);
		}
	}
	return { width, height, data };
}

function viaResvg(svg: string, width: number): RgbaImage {
	const png = new Resvg(svg, { fitTo: { mode: 'width', value: width * OVERSAMPLE } })
		.render()
		.asPng();
	const decoded = PNG.sync.read(png);
	return shrink(
		{ width: decoded.width, height: decoded.height, data: new Uint8ClampedArray(decoded.data) },
		OVERSAMPLE,
	);
}

/**
 * The largest and mean difference, colours compared premultiplied by their
 * alpha: a framed design has no background, and at its faint outer edge a
 * pixel one renderer leaves at alpha 0 has no colour to compare.
 */
function difference(ours: RgbaImage, theirs: RgbaImage): { max: number; mean: number } {
	// The two may round a fractional height to different whole rows; the
	// rows both have are compared.
	expect(theirs.width).toBe(ours.width);
	expect(Math.abs(theirs.height - ours.height)).toBeLessThanOrEqual(1);
	const length = Math.min(ours.data.length, theirs.data.length);
	let max = 0;
	let sum = 0;
	for (let i = 0; i < length; i += 4) {
		const a1 = ours.data[i + 3] as number;
		const a2 = theirs.data[i + 3] as number;
		for (let c = 0; c < 4; c += 1) {
			const d =
				c === 3
					? Math.abs(a1 - a2)
					: Math.abs((ours.data[i + c] as number) * a1 - (theirs.data[i + c] as number) * a2) / 255;
			sum += d;
			if (d > max) max = d;
		}
	}
	return { max, mean: sum / length };
}

function wellFormed(svg: string): void {
	const document = new DOMParser({
		onError: (level, message) => {
			if (level !== 'warning') throw new Error(`${level}: ${message}`);
		},
	}).parseFromString(svg, 'image/svg+xml');
	expect(document.documentElement?.nodeName).toBe('svg');
}

const stops = [
	{ offset: 0, ink: '#101820' },
	{ offset: 1, ink: '#0b3d91' },
];

const picture = discImage(24);

const cases: { label: string; symbol: BuiltSymbol; design: QrDesignV1; limit: number }[] = [
	{
		label: 'classic',
		symbol: qrSymbol('https://example.com/svg', 'M'),
		design: designWith({}),
		limit: 8,
	},
	...[
		'midnight-dots',
		'fluid-lagoon',
		'violet-glow',
		'two-tone',
		'mosaic-tiles',
		'red-badge',
		'shop-tag',
		'print-ticket',
	].map((id) => ({
		label: id,
		symbol: qrSymbol('https://example.com/svg/preset', 'Q'),
		design: registries.presets.require(id).design,
		limit: 8,
	})),
	{
		label: 'module space gradients, a conic ring and a picture logo',
		symbol: qrSymbol('https://example.com/a', 'H', { maxVersion: '3' }),
		design: designWith({
			modules: {
				shape: { id: 'squircle' },
				paint: { kind: 'radial', cx: 0.3, cy: 0.3, radius: 0.8, stops, space: 'module' },
				light: null,
			},
			regions: {
				finder: {
					outer: { id: 'circle' },
					inner: { id: 'circle-centre' },
					outerPaint: { kind: 'conic', cx: 0.5, cy: 0.5, angle: 0, stops, space: 'module' },
				},
			},
			logo: {
				source: { kind: 'asset', id: 'mark' },
				size: 0.25,
				clear: 'box',
				padding: 0.5,
				plate: { paint: { kind: 'solid', ink: '#ffffff' }, shape: 'circle' },
			},
			assets: { mark: { png: '', width: 24, height: 24 } },
		}),
		limit: 24,
	},
	// Captions as outlines: one line, two lines, one beside the artwork in
	// the frame's paint, and one too long for its frame, cut by a clip.
	...(
		[
			['banner-bottom', 'Scan me'],
			['rounded-card', 'Scan for the menu\nand specials'],
			['corner-brackets', 'Free Wi-Fi'],
			['badge-circle', 'MMMMMMMMMMMMMMMM'],
		] as const
	).map(([id, content]) => ({
		label: `a caption in ${id}`,
		symbol: qrSymbol('https://example.com/svg/caption', 'M'),
		design: designWith({
			frame: {
				ref: { id },
				paint: { kind: 'solid', ink: '#0b3d91' },
				text: { content, fontId: 'plex-sans-bold' },
			},
		}),
		limit: 8,
	})),
	{
		label: 'Micro QR with a frame',
		symbol: microSymbol('12345'),
		design: designWith({ quietZone: 2, frame: { ref: { id: 'phone' } } }),
		limit: 8,
	},
	{
		label: 'rMQR with light modules',
		symbol: rmqrSymbol('HELLO', 'R11x43'),
		design: designWith({
			quietZone: 2,
			background: {
				kind: 'linear',
				angle: 0,
				stops: [
					{ offset: 0, ink: '#ffe0b0' },
					{ offset: 1, ink: '#b0e0ff' },
				],
				space: 'symbol',
			},
			modules: {
				shape: { id: 'rounded' },
				paint: { kind: 'solid', ink: '#000000' },
				light: { shape: { id: 'dot' }, paint: { kind: 'solid', ink: '#ffffff' } },
			},
		}),
		limit: 8,
	},
];

describe('designs as SVG', () => {
	for (const { label, symbol, design, limit } of cases) {
		it(label, () => {
			const { scene } = buildScene(symbol, design, { registries, seed: 2, assets: () => picture });
			const svg = sceneToSvg(scene);
			wellFormed(svg);
			const width = Math.round(scene.width * 4);
			const ours = shrink(rasterise(scene as Scene, { width: width * OVERSAMPLE }), OVERSAMPLE);
			const found = difference(ours, viaResvg(svg, width));
			expect(found.max, `${label}: ${JSON.stringify(found)}`).toBeLessThanOrEqual(limit);
			expect(found.mean, `${label}: ${JSON.stringify(found)}`).toBeLessThan(0.4);
		});
	}
});
