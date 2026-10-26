/**
 * The commands besides export, batch and the library: the design link and
 * the inspector seam. Every one resolves to a Result; none throws for
 * anything a person can cause.
 */

import { describe, expect, it } from 'vitest';
import { QrStudioError } from '../../src/core/errors.js';
import { err, ok } from '../../src/core/result.js';
import { createPrng } from '../../src/core/prng.js';
import { decodeDesignLink } from '../../src/design/link.js';
import { defaultDesign } from '../../src/design/document.js';
import type { InspectReport, Inspector } from '../../src/studio/seams.js';
import { studioError } from '../../src/studio/keys.js';
import { logoPatches } from '../../src/studio/logo.js';

const studioErrorOf = (error: QrStudioError): string => studioError(error).messageKey;
import { assetOf, discImage } from '../design/helpers.js';
import { studioWith, studioWithCode } from './helpers.js';

const REPORT: InspectReport = { symbols: [], sets: [], payload: null, safety: null };

describe('design-link', () => {
	it('gives a link to the design and nothing of the content', async () => {
		const { studio } = studioWithCode({}, 'https://example.com/private-0451');
		studio.dispatch({ type: 'design/shuffle', seed: 4 });
		const result = await studio.run({ type: 'design-link' });
		if (!result.ok) throw result.error;
		expect(result.value.issues).toEqual([]);
		expect(decodeDesignLink(result.value.link)).toEqual(studio.getSnapshot().document.design);
		expect(result.value.link).not.toContain('private');
	});

	it('says a picture logo was left out of the link', async () => {
		const { studio } = studioWithCode();
		studio.dispatch({
			type: 'design/patch',
			patch: logoPatches(defaultDesign(), assetOf(discImage(8))),
		});
		const result = await studio.run({ type: 'design-link' });
		expect(result.ok && result.value.issues.map((found) => found.code)).toEqual([
			'design.issue.link-assets-dropped',
		]);
	});

	it('reports a design too large for a link as a failed result', async () => {
		const { studio } = studioWithCode();
		const prng = createPrng(5);
		const hex = (): string =>
			`#${Array.from({ length: 6 }, () => '0123456789abcdef'[prng.int(16)]).join('')}`;
		const gradient = () => ({
			kind: 'linear',
			angle: prng.int(360),
			space: 'symbol',
			stops: Array.from({ length: 16 }, (_, i) => ({
				offset: i / 15,
				ink: { srgb: hex(), cmyk: [prng.next(), prng.next(), prng.next(), prng.next()] },
			})),
		});
		const style = () => ({
			outer: { id: 'square' },
			inner: { id: 'square-centre' },
			outerPaint: gradient(),
			innerPaint: gradient(),
		});
		studio.dispatch({
			type: 'design/replace',
			design: {
				...defaultDesign(),
				background: gradient(),
				modules: {
					shape: { id: 'square' },
					paint: gradient(),
					light: { shape: { id: 'dot' }, paint: gradient() },
				},
				regions: { finder: style(), 'sub-finder': style(), 'corner-finder': style() },
			},
		});
		expect(studio.getSnapshot().refusal).toBeNull();
		const result = await studio.run({ type: 'design-link' });
		expect(!result.ok && result.error).toMatchObject({
			code: 'design/invalid',
			params: { reason: 'size' },
		});
	});
});

describe('inspect', () => {
	it('runs through the injected inspector and keeps the report in the snapshot', async () => {
		const seen: string[] = [];
		const inspector: Inspector = {
			image: () => {
				seen.push('image');
				return ok(REPORT);
			},
			text: () => {
				seen.push('text');
				return REPORT;
			},
		};
		const { studio } = studioWith({ inspector });
		const image = { width: 1, height: 1, data: new Uint8ClampedArray(4) };
		const states: string[] = [];
		studio.subscribe(() => states.push(studio.getSnapshot().inspect.status));
		expect(await studio.run({ type: 'inspect/image', image })).toEqual(ok(REPORT));
		expect(studio.getSnapshot().inspect).toEqual({
			status: 'done',
			source: 'image',
			report: REPORT,
		});
		expect(await studio.run({ type: 'inspect/text', text: 'WIFI:S:x;;' })).toEqual(ok(REPORT));
		expect(studio.getSnapshot().inspect).toMatchObject({ status: 'done', source: 'text' });
		expect(seen).toEqual(['image', 'text']);
		expect(states).toEqual(['running', 'done', 'running', 'done']);
	});

	it('reports a picture with no code, and an inspector that throws, as failures', async () => {
		const notFound = new QrStudioError('decode/not-found', 'none', { stage: 'finders' });
		const inspector: Inspector = {
			image: () => err(notFound),
			text: () => {
				throw new Error('broken inspector');
			},
		};
		const { studio } = studioWith({ inspector });
		const image = { width: 1, height: 1, data: new Uint8ClampedArray(4) };
		const failed = await studio.run({ type: 'inspect/image', image });
		expect(!failed.ok && failed.error).toBe(notFound);
		expect(studio.getSnapshot().inspect).toEqual({
			status: 'failed',
			source: 'image',
			error: {
				code: 'decode/not-found',
				messageKey: 'decode.not-found',
				params: { stage: 'finders' },
			},
		});
		const thrown = await studio.run({ type: 'inspect/text', text: 'x' });
		expect(!thrown.ok && thrown.error.code).toBe('decode/unreadable');
	});

	it('says reading is not in this copy when the host leaves the inspector out', async () => {
		const { studio } = studioWith({ inspector: null });
		const result = await studio.run({ type: 'inspect/text', text: 'x' });
		expect(!result.ok && result.error).toMatchObject({
			code: 'platform/unavailable',
			params: { feature: 'inspect' },
		});
		expect(studio.getSnapshot().inspect.status).toBe('failed');
	});

	it('keeps quiet when the studio was disposed while it read', async () => {
		let studioRef: { dispose(): void } | null = null;
		const inspector: Inspector = {
			image: () => ok(REPORT),
			text: () => {
				studioRef?.dispose();
				return REPORT;
			},
		};
		const { studio } = studioWith({ inspector });
		studioRef = studio;
		expect((await studio.run({ type: 'inspect/text', text: 'x' })).ok).toBe(true);
	});
});

describe('run', () => {
	it("refuses a command that is not one, as a caller's mistake", async () => {
		const { studio } = studioWith();
		await expect(studio.run(null as never)).rejects.toThrow(TypeError);
		await expect(studio.run({ type: 'nope' } as never)).rejects.toThrow(TypeError);
	});
});

describe('the real inspector, by default', () => {
	it('reads a code from a picture and explains a text', async () => {
		const { createDesignRegistries } = await import('../../src/design/registries.js');
		const { buildScene } = await import('../../src/design/scene.js');
		const { encode } = await import('../../src/encode/encode.js');
		const { rasterise } = await import('../../src/render/raster.js');
		const scene = buildScene(
			encode('WIFI:T:WPA;S:Example Network;P:example-pass;;'),
			defaultDesign(),
			{
				registries: createDesignRegistries(),
			},
		).scene;
		const { studio } = studioWith();
		const read = await studio.run({
			type: 'inspect/image',
			image: rasterise(scene, { width: 300 }),
		});
		if (!read.ok) throw read.error;
		expect(read.value.symbols).toHaveLength(1);
		expect(read.value.payload?.typeId).toBe('wifi');
		expect(studio.getSnapshot().inspect).toMatchObject({ status: 'done', source: 'image' });
		const text = await studio.run({ type: 'inspect/text', text: 'https://example.com/' });
		expect(text.ok && text.value.payload?.typeId).toBe('url');
		const blank = await studio.run({
			type: 'inspect/image',
			image: { width: 40, height: 40, data: new Uint8ClampedArray(6400).fill(255) },
		});
		expect(!blank.ok && studioErrorOf(blank.error)).toMatch(/^decode\.not-found/);
	});
});
