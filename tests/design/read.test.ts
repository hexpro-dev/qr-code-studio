/**
 * Every preset, drawn by this package and read back by two readers that
 * know nothing about it.
 *
 * QR presets are built on seeded content in small, medium and large
 * versions, rasterised at 8 pixels a module, and must be read to the right
 * text by both zxing-cpp and jsQR. This is a sanity check, not the strict
 * scan check, which the verify layer adds with printed sizes and simulated
 * damage.
 *
 * Micro QR and rMQR are read by zxing-cpp alone (jsQR reads QR Model 2
 * only), each preset built as it would be for them: the level mapped to the
 * nearest the symbology has, Micro QR without logos (it cannot spare the
 * codewords) and without shapes that ink under half a module (zxing-cpp
 * loses some of the smallest Micro QR symbols drawn in small squares).
 */

import { describe, expect, it } from 'vitest';
import { createPrng } from '../../src/core/prng.js';
import { regionPairConforms } from '../../src/design/finder.js';
import { resolveParams } from '../../src/design/params.js';
import { createDesignRegistries } from '../../src/design/registries.js';
import { buildScene } from '../../src/design/scene.js';
import type { Preset } from '../../src/design/types.js';
import type { EcLevel } from '../../src/segment/types.js';
import { draw } from './helpers.js';
import { jsqrText, zxingTexts } from './oracles.js';
import { microSymbol, qrSymbol, rmqrSymbol } from './symbols.js';

const registries = createDesignRegistries();
const presets = registries.presets.list();

/** A seeded link of about `length` characters. */
function content(seed: number, length: number): string {
	const prng = createPrng(seed);
	const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789-';
	let path = '';
	while (path.length < length) path += alphabet[prng.int(alphabet.length)];
	return `https://example.com/${path}`;
}

const SIZES = [
	{ label: 'small', length: 12 },
	{ label: 'medium', length: 110 },
	{ label: 'large', length: 420 },
];

function levelOf(preset: Preset): EcLevel {
	return preset.design.symbol.ecLevel ?? 'M';
}

describe('presets read back as QR', () => {
	for (const preset of presets) {
		it(preset.id, async () => {
			for (const [i, size] of SIZES.entries()) {
				const text = content(i * 100 + preset.id.length, size.length);
				const symbol = qrSymbol(text, levelOf(preset));
				const built = buildScene(symbol, preset.design, { registries, seed: 11 });
				const image = draw(built.scene);
				const where = `${preset.id}, ${size.label}, version ${symbol.version}`;
				expect(await zxingTexts(image), where).toContain(text);
				expect(jsqrText(image), where).toBe(text);
			}
		});
	}

	it('cover small, medium and large versions', () => {
		const versions = SIZES.map((size, i) =>
			Number(qrSymbol(content(i * 100 + 12, size.length), 'M').version),
		);
		expect(versions[0]).toBeLessThanOrEqual(3);
		expect(versions[1]).toBeGreaterThanOrEqual(6);
		expect(versions[2]).toBeGreaterThanOrEqual(14);
	});
});

describe('presets read back as Micro QR', () => {
	for (const preset of presets) {
		it(preset.id, async () => {
			if (preset.design.logo !== null) return;
			const level = levelOf(preset) === 'H' || levelOf(preset) === 'Q' ? 'Q' : levelOf(preset);
			for (const text of ['12345', 'HELLO WORLD', '0123456789012345678']) {
				const symbol = microSymbol(text, undefined, level === 'Q' ? 'M' : level);
				const built = buildScene(
					symbol,
					{ ...preset.design, quietZone: 2 },
					{ registries, seed: 11 },
				);
				if (built.inkFraction < 0.5) return;
				expect(
					await zxingTexts(draw(built.scene), 'MicroQRCode'),
					`${preset.id}, ${symbol.version}`,
				).toContain(text);
			}
		});
	}
});

describe('presets read back as rMQR', () => {
	for (const preset of presets) {
		it(preset.id, async () => {
			const level = levelOf(preset) === 'Q' || levelOf(preset) === 'H' ? 'H' : 'M';
			const cases: readonly (readonly [string, string])[] =
				level === 'M'
					? [
							['HELLO', 'R7x43'],
							['https://example.com/a', 'R11x59'],
							['https://example.com/rmqr/label-0042', 'R17x99'],
						]
					: [
							['HELLO', 'R9x59'],
							['https://example.com/a', 'R13x77'],
							['https://example.com/rmqr/label-0042', 'R17x139'],
						];
			for (const [text, version] of cases) {
				const symbol = rmqrSymbol(text, version, level);
				const built = buildScene(symbol, preset.design, { registries, seed: 11 });
				expect(
					await zxingTexts(draw(built.scene), 'rMQRCode'),
					`${preset.id}, ${version}`,
				).toContain(text);
			}
		});
	}
});

describe('every module shape and every finder centre', () => {
	const qrText = content(5, 60);
	const qr = qrSymbol(qrText, 'M');
	const micro = microSymbol('HELLO WORLD', undefined, 'L');
	const rmqr = rmqrSymbol('https://example.com/a', 'R11x59');
	const base = registries.presets.require('classic-black').design;

	async function readsEverywhere(design: typeof base, where: string, jsqr: boolean): Promise<void> {
		const qrImage = draw(buildScene(qr, design, { registries }).scene);
		expect(await zxingTexts(qrImage), where).toEqual([qrText]);
		if (jsqr) expect(jsqrText(qrImage), where).toBe(qrText);
		const microImage = draw(buildScene(micro, { ...design, quietZone: 2 }, { registries }).scene);
		expect(await zxingTexts(microImage, 'MicroQRCode'), where).toContain('HELLO WORLD');
		const rmqrImage = draw(buildScene(rmqr, { ...design, quietZone: 2 }, { registries }).scene);
		expect(await zxingTexts(rmqrImage, 'rMQRCode'), where).toContain('https://example.com/a');
	}

	it('read back at their defaults: each module shape with square finders, by both readers', async () => {
		for (const shape of registries.moduleShapes.list()) {
			const design = {
				...base,
				modules: {
					shape: { id: shape.id },
					paint: { kind: 'solid' as const, ink: '#000000' },
					light: null,
				},
			};
			await readsEverywhere(design, shape.id, true);
		}
	});

	// jsQR scores a finder by how alike its runs are along the axes and the
	// diagonals, so a round or cut centre can lose to a square-ish cluster
	// of data modules. zxing-cpp, and the strict reader, measure the ratio.
	it('read back at their defaults: each centre with a ring it pairs with, by zxing-cpp', async () => {
		const rings = registries.regionShapes.list().filter((shape) => shape.part === 'outer');
		for (const centre of registries.regionShapes.list().filter((shape) => shape.part === 'inner')) {
			const ring = rings.find((candidate) =>
				regionPairConforms(
					candidate,
					resolveParams(candidate.params, undefined),
					centre,
					resolveParams(centre.params, undefined),
					'concentric-7',
				),
			);
			expect(ring, centre.id).toBeDefined();
			const design = {
				...base,
				regions: { finder: { outer: { id: ring!.id }, inner: { id: centre.id } } },
			};
			await readsEverywhere(design, `${ring!.id} with ${centre.id}`, false);
		}
	});
});
