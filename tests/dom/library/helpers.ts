/**
 * What the library tests share: a studio document holding content that must
 * never reach a store, a logo drawn in code, a brand kit, and designs for
 * the property runs, generated from the design layer's own catalogue.
 *
 * The content is synthetic, as CLAUDE.md requires, and distinctive, so a
 * search of everything a store wrote can show it is not there.
 */

import fc from 'fast-check';
import type { RgbaImage } from '../../../src/core/image.js';
import type { BrandKit } from '../../../src/dom/file-library.js';
import { base64 } from '../../../src/render/base64.js';
import { encodePng } from '../../../src/render/png.js';
import { createRegistries } from '../../../src/registries.js';
import { DEFAULT_CONDITIONS, designFrom } from '../../../src/studio/document.js';
import type { DesignAsset, QrDesignV1, StudioDocument } from '../../../src/studio/index.js';

export const registries = createRegistries();

/** A Wi-Fi password nobody has, which no store may ever write down. */
export const SECRET = 'Synthetic-Passphrase-4f1c9e';
export const NETWORK = 'Example Network 7d2a';

const preset = registries.design.presets.require('rounded-ocean');

/** A Wi-Fi document whose fields are the content a library must never keep. */
export function wifiDocument(design: QrDesignV1 = preset.design): StudioDocument {
	return Object.freeze({
		mode: 'create',
		typeId: 'wifi',
		fields: Object.freeze({ ssid: NETWORK, security: 'WPA', password: SECRET, hidden: false }),
		design,
		conditions: DEFAULT_CONDITIONS,
	});
}

/** A small opaque picture, as a logo the person chose would arrive. */
export function picture(width = 4, height = 3): RgbaImage {
	const data = new Uint8ClampedArray(width * height * 4);
	for (let i = 0; i < data.length; i += 4) {
		data[i] = (i * 13) % 256;
		data[i + 1] = 90;
		data[i + 2] = 200;
		data[i + 3] = 255;
	}
	return { width, height, data };
}

export function assetOf(image: RgbaImage = picture()): DesignAsset {
	return { png: base64(encodePng(image)), width: image.width, height: image.height };
}

export function brandKit(overrides: Partial<BrandKit> = {}): BrandKit {
	return {
		palette: ['#0b76d9', { srgb: '#9f9f9f', cmyk: [0, 0, 0, 0.38] }],
		logo: assetOf(),
		presets: ['hex-pro-blue', 'rounded-ocean'],
		...overrides,
	};
}

/** The design as the design layer reads it back, which is what a store must return. */
export function normalised(design: unknown): QrDesignV1 {
	const read = designFrom(design, registries);
	if (read.design === null) throw new Error('the generated design does not validate');
	return read.design;
}

const colour = fc
	.integer({ min: 0, max: 0xffffff })
	.map((n) => `#${n.toString(16).padStart(6, '0')}`);
/** A CMYK part in hundredths, as a printer's swatch gives one. */
const fraction = fc.integer({ min: 0, max: 100 }).map((n) => n / 100);
const ink = fc.oneof(
	colour,
	fc.record({
		srgb: colour,
		cmyk: fc.tuple(fraction, fraction, fraction, fraction),
	}),
);

/**
 * Designs across the catalogue: any preset, with its colours, quiet zone,
 * error correction, background and name changed. Every one validates, and
 * a store must hand each back exactly as the design layer reads it.
 */
export const designs: fc.Arbitrary<QrDesignV1> = fc
	.record({
		preset: fc.constantFrom(...registries.design.presets.list()),
		ink,
		background: fc.oneof(fc.constant(null), colour),
		quietZone: fc.integer({ min: 0, max: 20 }),
		ecLevel: fc.constantFrom('L' as const, 'M' as const, 'Q' as const, 'H' as const),
		name: fc.option(fc.stringMatching(/^[A-Za-z0-9 .,'-]{0,40}$/), { nil: undefined }),
	})
	.map(({ preset: from, ink: chosen, background, quietZone, ecLevel, name }) => {
		const base = from.design;
		const design: QrDesignV1 = {
			...base,
			symbol: { ...base.symbol, ecLevel },
			quietZone,
			background: background === null ? null : { kind: 'solid', ink: background },
			modules: { ...base.modules, paint: { kind: 'solid', ink: chosen } },
			...(name === undefined ? {} : { name }),
		};
		return normalised(design);
	});

/** A name a person might type, control characters and all. */
export const names = fc.oneof(
	fc.string({ maxLength: 120 }),
	fc
		.array(
			fc.constantFrom(' ', '\t', '\n', '\u0000', '\u0085', '\u2028', '\ud800', 'a', 'B', '\u00e9'),
			{ maxLength: 100 },
		)
		.map((chars) => chars.join('')),
	fc.constant(''),
);
