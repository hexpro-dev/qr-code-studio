/**
 * The Swiss QR-bill's cross: SIX's 7 mm graphic, centred on the 46 mm code,
 * measured from the raster; the modules it hides marked obscured, within
 * level M's budget at every version a bill can be; and a bill built from the
 * payload type's spec vector and constraints read back to the exact text.
 *
 * The expected figures are SIX's, from CH-Kreuz_7mm.svg (19.8 units to the
 * 7 mm logo), cited in src/design/swiss-cross.ts: the white border to
 * 1.41785, the black square to 18.38215, and the bars at x 8.3 to 11.6, y 4
 * to 15 and x 4.4 to 15.4, y 7.9 to 11.2.
 */

import { describe, expect, it } from 'vitest';
import { applyConstraints } from '../../src/design/constraints.js';
import { defaultDesign } from '../../src/design/document.js';
import { createDesignRegistries } from '../../src/design/registries.js';
import { buildScene } from '../../src/design/scene.js';
import { encode } from '../../src/encode/encode.js';
import { swissQrBillType } from '../../src/payload/content/swiss-qr-bill.js';
import { rasterise } from '../../src/render/raster.js';
import type { Scene } from '../../src/render/types.js';
import { blockCapacity, interleaveOrder } from '../../src/symbology/qr/blocks.js';
import { createSymbologyRegistry } from '../../src/symbology/registry.js';
import type { BuiltSymbol } from '../../src/symbology/types.js';
import { designWith } from './helpers.js';
import { jsqrText, zxingTexts } from './oracles.js';
import { microSymbol, qrSymbol } from './symbols.js';

const registries = createDesignRegistries();
const vector = swissQrBillType.vectors[0]!;
const constrained = applyConstraints(defaultDesign(), swissQrBillType.constraints);
const bill = swissQrBillType.build(vector.value).text;

/** The bill as the studio makes it: the constrained design, its level and limits, and the overlay. */
function billSymbol(text: string): BuiltSymbol {
	const { symbol } = constrained.design;
	return encode(text, {
		ecLevel: symbol.ecLevel,
		maxVersion: symbol.maxVersion,
		segmentation: symbol.segmentation,
	});
}

/** SIX's units to millimetres: the 19.8 unit view box is the 7 mm logo. */
const SIX_MM = 7 / 19.8;

/** The bounding box, in pixels, of the pixels `keep` picks; null when none. */
function extent(
	image: { width: number; height: number; data: Uint8ClampedArray },
	keep: (r: number, a: number, x: number, y: number) => boolean,
	within?: { x0: number; y0: number; x1: number; y1: number },
) {
	let x0 = Infinity;
	let y0 = Infinity;
	let x1 = -Infinity;
	let y1 = -Infinity;
	for (let y = within?.y0 ?? 0; y <= (within?.y1 ?? image.height - 1); y += 1) {
		for (let x = within?.x0 ?? 0; x <= (within?.x1 ?? image.width - 1); x += 1) {
			const at = (y * image.width + x) * 4;
			if (!keep(image.data[at] as number, image.data[at + 3] as number, x, y)) continue;
			x0 = Math.min(x0, x);
			y0 = Math.min(y0, y);
			x1 = Math.max(x1, x);
			y1 = Math.max(y1, y);
		}
	}
	return { x0, y0, x1, y1 };
}

describe('the Swiss QR-bill cross', () => {
	it('comes from the constraints, beside the design and not in it', () => {
		expect(swissQrBillType.constraints?.overlay).toBe('swiss-cross');
		expect(constrained.overlay).toBe('swiss-cross');
		expect(JSON.stringify(constrained.design)).not.toContain('swiss');
		expect(constrained.issues).toEqual([]);
		expect(bill).toBe(vector.text);
	});

	it("is SIX's 7 mm graphic, centred on the 46 mm symbol, measured from the raster", () => {
		const symbol = billSymbol(bill);
		const built = buildScene(symbol, constrained.design, {
			registries,
			overlay: constrained.overlay,
		});
		expect(built.issues).toEqual([]);
		const width = symbol.matrix.width;
		const perModule = 16;
		const cross: Scene = {
			...built.scene,
			background: null,
			layers: built.scene.layers.filter(
				(node) => node.kind === 'path' && node.role === 'swiss-cross',
			),
		};
		expect(cross.layers).toHaveLength(2);
		const image = rasterise(cross, { width: built.scene.width * perModule });
		// Millimetres from the symbol's top left corner, where a pixel's edge is.
		const mm = (pixels: number): number => (pixels / perModule - 4) * (46 / width);
		const pixel = 46 / width / perModule;

		const logo = extent(image, (_, a) => a >= 128);
		const black = extent(image, (r, a) => a >= 128 && r < 128);
		const white = extent(image, (r, a) => a >= 128 && r >= 128, {
			x0: black.x0,
			y0: black.y0,
			x1: black.x1,
			y1: black.y1,
		});
		const left = mm(logo.x0);
		const top = mm(logo.y0);
		const near = (actual: number, expected: number) =>
			expect(Math.abs(actual - expected)).toBeLessThanOrEqual(pixel * 1.01);

		// The logo is 7 mm, centred on the 46 mm symbol.
		near(mm(logo.x1 + 1) - left, 7);
		near(mm(logo.y1 + 1) - top, 7);
		near(left, (46 - 7) / 2);
		near(top, (46 - 7) / 2);
		// A 0.5 mm white border round a 6 mm black square.
		near(mm(black.x0) - left, 1.41785 * SIX_MM);
		near(mm(black.y0) - top, 1.41785 * SIX_MM);
		near(mm(black.x1 + 1) - left, 18.38215 * SIX_MM);
		near(mm(black.y1 + 1) - top, 18.38215 * SIX_MM);
		// The white cross inside it, where SIX's artwork puts it.
		near(mm(white.x0) - left, 4.4 * SIX_MM);
		near(mm(white.x1 + 1) - left, 15.4 * SIX_MM);
		near(mm(white.y0) - top, 4 * SIX_MM);
		near(mm(white.y1 + 1) - top, 15 * SIX_MM);
		// Its upright bar and its crossbar, each 3.3 units thick.
		const at = (units: number, from: number) =>
			Math.round(from + (units * SIX_MM * perModule * width) / 46);
		const upright = extent(image, (r, a) => a >= 128 && r >= 128, {
			x0: black.x0,
			y0: at(5, logo.y0),
			x1: black.x1,
			y1: at(5, logo.y0),
		});
		near(mm(upright.x0) - left, 8.3 * SIX_MM);
		near(mm(upright.x1 + 1) - left, 11.6 * SIX_MM);
		const bar = extent(image, (r, a) => a >= 128 && r >= 128, {
			x0: at(5, logo.x0),
			y0: black.y0,
			x1: at(5, logo.x0),
			y1: black.y1,
		});
		near(mm(bar.y0) - top, 7.9 * SIX_MM);
		near(mm(bar.y1 + 1) - top, 11.2 * SIX_MM);

		// Every module with any part under the logo is obscured, and no other.
		const side = (width * 7) / 46;
		const from = (width - side) / 2;
		let count = 0;
		for (let y = 0; y < width; y += 1) {
			for (let x = 0; x < width; x += 1) {
				const under = x < from + side && x + 1 > from && y < from + side && y + 1 > from;
				expect(built.obscured[y * width + x], `${x}, ${y}`).toBe(under ? 1 : 0);
				if (under) count += 1;
			}
		}
		const across = Math.ceil(from + side) - Math.floor(from);
		expect(count).toBe(across * across);
	});

	it('reads back to the exact bill with zxing-cpp and jsQR', async () => {
		const symbol = billSymbol(bill);
		const built = buildScene(symbol, constrained.design, {
			registries,
			overlay: constrained.overlay,
		});
		for (const perModule of [4, 6]) {
			const image = rasterise(built.scene, { width: built.scene.width * perModule });
			expect(await zxingTexts(image), `${perModule} px a module`).toEqual([bill]);
			expect(jsqrText(image), `${perModule} px a module`).toBe(bill);
		}
	});

	it("keeps within level M's budget, counted as errors, at every version a bill can be", () => {
		const qr = createSymbologyRegistry().require('qr');
		// The header and an IBAN alone are 32 bytes, more than version 1 holds
		// at level M, so a bill is never version 1 (where the cross would hide
		// one codeword more than the block corrects).
		expect(qr.blocks('1', 'M').dataBits / 8).toBeLessThan(
			'SPC\n0200\n1\nCH4431999123000889012\n'.length,
		);
		for (let version = 2; version <= 25; version += 1) {
			const symbol = qrSymbol('x', 'M', {
				minVersion: String(version),
				maxVersion: String(version),
			});
			const built = buildScene(symbol, constrained.design, { registries, overlay: 'swiss-cross' });
			const order = interleaveOrder(symbol.blocks);
			const hit = symbol.blocks.blocks.map(() => new Set<number>());
			let data = 0;
			built.obscured.forEach((flag, i) => {
				const bit = symbol.layout.dataBits[i] as number;
				if (flag !== 1 || bit < 0) return;
				data += 1;
				const codeword = bit >> 3;
				hit[order.block[codeword] as number]!.add(codeword);
			});
			expect(data, `version ${version}`).toBeGreaterThan(0);
			hit.forEach((codewords, block) => {
				const capacity = blockCapacity(symbol.blocks.blocks[block]!.ecCount, symbol.blocks.p);
				expect(codewords.size, `version ${version}, block ${block}`).toBeLessThanOrEqual(capacity);
			});
		}
	});

	it('joins whatever a logo already hides', () => {
		const symbol = qrSymbol('https://example.com/logo-and-cross', 'H');
		const logo = designWith({
			logo: {
				source: { kind: 'icon', id: 'heart' },
				size: 0.3,
				clear: 'box',
				padding: 0,
				plate: null,
			},
		});
		const alone = buildScene(symbol, logo, { registries });
		const both = buildScene(symbol, logo, { registries, overlay: 'swiss-cross' });
		const cross = buildScene(symbol, designWith({}), { registries, overlay: 'swiss-cross' });
		both.obscured.forEach((flag, i) => {
			expect(flag).toBe((alone.obscured[i] as number) | (cross.obscured[i] as number));
		});
		// The cross goes over the logo.
		expect(
			both.scene.layers.map((node) => (node.kind === 'path' ? node.role : node.kind)).slice(-3),
		).toEqual(['logo', 'swiss-cross', 'swiss-cross']);
	});

	it('is drawn only when asked, only on QR, and refuses an overlay it does not know', () => {
		const symbol = qrSymbol('https://example.com/no-cross', 'M');
		const roles = (overlay?: null | 'swiss-cross') =>
			buildScene(symbol, designWith({}), { registries, overlay }).scene.layers.filter(
				(node) => node.kind === 'path' && node.role === 'swiss-cross',
			).length;
		expect(roles()).toBe(0);
		expect(roles(null)).toBe(0);
		expect(roles('swiss-cross')).toBe(2);
		expect(() =>
			buildScene(symbol, designWith({}), { registries, overlay: 'flag' as never }),
		).toThrow(TypeError);

		const micro = buildScene(microSymbol('12345'), designWith({ quietZone: 2 }), {
			registries,
			overlay: 'swiss-cross',
		});
		expect(micro.issues).toEqual([
			{
				code: 'design.issue.overlay-unsupported',
				path: [],
				severity: 'warning',
				params: { overlay: 'swiss-cross' },
			},
		]);
		expect(micro.obscured.every((flag) => flag === 0)).toBe(true);
		expect(
			micro.scene.layers.some((node) => node.kind === 'path' && node.role === 'swiss-cross'),
		).toBe(false);
	});
});
