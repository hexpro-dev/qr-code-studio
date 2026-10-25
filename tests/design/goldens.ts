/**
 * Golden designs: the bytes a design must produce, the same in Node,
 * Chromium, WebKit and Firefox.
 *
 * Like tests/render/goldens.ts this imports only `src/` (and that module's
 * SHA-256), uses no Node API, and needs nothing from the page, so a browser
 * harness can bundle it, call `checkDesignGoldens()` and report what comes
 * back. tests/design/determinism.test.ts runs it under Node.
 *
 * Each golden builds a symbol with this package's encoder, a scene from a
 * design, and then either the SVG text or the rasterised pixels, so the
 * whole chain is covered: shapes drawn through core's sine and cosine, finder
 * pairs measured, paints resolved, seeded mosaics and scatters, captions set
 * from the compiled font, and the Swiss QR-bill's cross. A digest that moves
 * without a reason is a determinism bug somewhere along it.
 */

import { applyConstraints } from '../../src/design/constraints.js';
import { defaultDesign } from '../../src/design/document.js';
import { createDesignRegistries } from '../../src/design/registries.js';
import { buildScene } from '../../src/design/scene.js';
import type { DesignOverlay, QrDesignV1 } from '../../src/design/types.js';
import { encode } from '../../src/encode/encode.js';
import { swissQrBillType } from '../../src/payload/content/swiss-qr-bill.js';
import { swissQrBillVectors } from '../../src/payload/vectors/swiss-qr-bill.js';
import { rasterise } from '../../src/render/raster.js';
import { sceneToSvg } from '../../src/render/svg.js';
import type { Scene } from '../../src/render/types.js';
import type { BuiltSymbol } from '../../src/symbology/types.js';
import { sha256Hex } from '../render/goldens.js';

export interface DesignGolden {
	readonly name: string;
	readonly render: () => Uint8Array;
	readonly sha256: string;
}

function scene(
	symbol: BuiltSymbol,
	design: QrDesignV1,
	seed = 1,
	overlay: DesignOverlay | null = null,
): Scene {
	return buildScene(symbol, design, { registries: createDesignRegistries(), seed, overlay }).scene;
}

function preset(id: string): QrDesignV1 {
	return createDesignRegistries().presets.require(id).design;
}

function svgBytes(value: Scene): Uint8Array {
	return new TextEncoder().encode(sceneToSvg(value));
}

function pixels(value: Scene, perModule: number): Uint8Array {
	const image = rasterise(value, { width: Math.round(value.width * perModule) });
	return new Uint8Array(image.data.buffer, image.data.byteOffset, image.data.byteLength);
}

const URL_TEXT = 'https://example.com/golden';

/** The spec vector of SIX's guidelines (Annex A, example 2), cited in the payload type. */
function swissBill(): Scene {
	const type = swissQrBillType;
	const { design, overlay } = applyConstraints(defaultDesign(), type.constraints);
	const text = type.build(swissQrBillVectors[0]!.value).text;
	const symbol = encode(text, {
		ecLevel: design.symbol.ecLevel,
		maxVersion: design.symbol.maxVersion,
		segmentation: design.symbol.segmentation,
	});
	return scene(symbol, design, 1, overlay);
}

export const DESIGN_GOLDENS: readonly DesignGolden[] = [
	{
		name: 'classic black as SVG',
		render: () => svgBytes(scene(encode(URL_TEXT), defaultDesign())),
		sha256: '53e5307e7e28a9517b9c9aad595153db6c83c53d4bb0b00468f31e3decd6cc76',
	},
	{
		name: 'midnight dots rasterised at 6 px a module',
		render: () => pixels(scene(encode(URL_TEXT, { ecLevel: 'M' }), preset('midnight-dots')), 6),
		sha256: 'c391381a07a7c54642fabf3fc177606b2c45e86c0e85cef05d4424cb5b4cde25',
	},
	{
		name: 'mosaic tiles, seeded, as SVG',
		render: () => svgBytes(scene(encode(URL_TEXT, { ecLevel: 'M' }), preset('mosaic-tiles'), 42)),
		sha256: 'ffd84ab9955caba35ce1d4a167d527ae07fa410c9ef2e6631916cc56e1dbc82e',
	},
	{
		name: 'shop tag with its icon and frame, rasterised',
		render: () => pixels(scene(encode(URL_TEXT, { ecLevel: 'H' }), preset('shop-tag')), 4),
		sha256: '9618f23ecb856967b34751399398f243c9e92bc3b27dc3fe058f254d2e592733',
	},
	{
		name: 'fluid lagoon gradient on rMQR as SVG',
		render: () =>
			svgBytes(
				scene(encode('HELLO', { symbology: 'rmqr', minVersion: 'R11x43', maxVersion: 'R11x43' }), {
					...preset('fluid-lagoon'),
					quietZone: 2,
				}),
			),
		sha256: 'df08a4e0f937f86660e7dada990629c056a17aba03c104514711b9117b287f4b',
	},
	{
		name: 'hex on Micro QR, rasterised',
		render: () =>
			pixels(
				scene(encode('12345', { symbology: 'micro', ecLevel: 'L' }), {
					...preset('hex-honey'),
					quietZone: 2,
				}),
				5,
			),
		sha256: '9a4091e10106fce4e34a30e0c87a2592db6eb36f1f2c9af616b07ba76816f2d5',
	},
	{
		name: 'two-line caption on a rounded card as SVG',
		render: () =>
			svgBytes(
				scene(encode(URL_TEXT, { ecLevel: 'M' }), {
					...defaultDesign(),
					frame: {
						ref: { id: 'rounded-card' },
						paint: { kind: 'solid', ink: '#0b3d91' },
						text: { content: 'Scan for the menu\nand specials', fontId: 'plex-sans-bold' },
					},
				}),
			),
		sha256: '7f6b038a0ec04e84185d12d273e79f5b40a0367e6ae23c68a9a456287255cac3',
	},
	{
		name: 'Swiss QR-bill with its cross, rasterised at 4 px a module',
		render: () => pixels(swissBill(), 4),
		sha256: '0ca73d3a730be7e2bd1134b854cb5433c36b8b446cbb6db0fb89c0bd6165fb7e',
	},
];

export interface DesignGoldenResult {
	readonly name: string;
	readonly expected: string;
	readonly actual: string;
	readonly stable: boolean;
}

/** Render every golden twice and report each one that moved, or that differed between runs. */
export function checkDesignGoldens(): readonly DesignGoldenResult[] {
	const out: DesignGoldenResult[] = [];
	for (const golden of DESIGN_GOLDENS) {
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
