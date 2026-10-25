/**
 * Logo import: any picture to a PNG of at most 1024 pixels a side and the
 * design's byte limit, area-averaged, with the pixels it decodes to; SVG
 * refused for now, with the issue a view shows.
 */

import { describe, expect, it } from 'vitest';
import { createPrng } from '../../src/core/prng.js';
import { base64Decode } from '../../src/design/base64.js';
import { createDesignRegistries } from '../../src/design/registries.js';
import { defaultDesign } from '../../src/design/document.js';
import { validateDesign } from '../../src/design/validate.js';
import { importLogo } from '../../src/dom/logo.js';
import { decodePng } from '../../src/render/png-decode.js';
import { LOGO_MAX_BYTES } from '../../src/studio/logo.js';
import { logoPatches } from '../../src/studio/logo.js';
import { createStudio } from '../../src/studio/studio.js';
import { blobOf, fakeDecoding, pattern } from './fakes.js';

/** Noise, which PNG cannot compress, for the byte limit. */
function noise(width: number, height: number) {
	const data = new Uint8ClampedArray(width * height * 4);
	const prng = createPrng(1);
	for (let i = 0; i < data.length; i += 1) data[i] = i % 4 === 3 ? 255 : prng.int(256);
	return { width, height, data };
}

describe('importLogo', () => {
	it('makes a large picture a PNG of at most 1024 a side, keeping its proportions', async () => {
		const fake = fakeDecoding(3000, 1500);
		const result = await importLogo(blobOf('x', 'image/jpeg'), { deps: fake.deps });
		if (!result.ok) throw new Error(result.error.code);
		const { asset, image, issues } = result.value;
		expect([asset.width, asset.height]).toEqual([1024, 512]);
		expect([image.width, image.height]).toEqual([1024, 512]);
		expect(issues).toEqual([
			{
				code: 'dom.issue.logo-downscaled',
				path: ['logo'],
				severity: 'info',
				params: { width: 1024, height: 512 },
			},
		]);
		// The asset decodes to exactly the pixels handed back.
		const decoded = decodePng(base64Decode(asset.png) as Uint8Array);
		expect(decoded.width).toBe(1024);
		// Compared as buffers: a deep equal over two megabytes takes seconds.
		expect(Buffer.from(decoded.data).equals(Buffer.from(image.data))).toBe(true);
		// The canvas did the coarse steps, and the last reduction was this package's own.
		expect(Math.max(...fake.log.made.map(([w, h]) => w * h))).toBeLessThanOrEqual(3000 * 1500);
	});

	it('leaves a small picture at its own size, with nothing to say', async () => {
		const result = await importLogo(blobOf('x', 'image/png'), { deps: fakeDecoding(64, 48).deps });
		if (!result.ok) throw new Error(result.error.code);
		expect([result.value.asset.width, result.value.asset.height]).toEqual([64, 48]);
		expect(result.value.issues).toEqual([]);
		expect(decodePng(base64Decode(result.value.asset.png) as Uint8Array).data).toEqual(
			pattern(64, 48).data,
		);
	});

	it("makes a picture smaller again until its PNG fits the design's limit", async () => {
		const fake = fakeDecoding(512, 512, { picture: noise });
		const result = await importLogo(blobOf('x', 'image/png'), { deps: fake.deps });
		if (!result.ok) throw new Error(result.error.code);
		const bytes = base64Decode(result.value.asset.png) as Uint8Array;
		expect(bytes.length).toBeLessThanOrEqual(LOGO_MAX_BYTES);
		expect(result.value.asset.width).toBeLessThan(512);
		expect(result.value.asset.width).toBeGreaterThan(256);
		expect(result.value.issues[0]?.code).toBe('dom.issue.logo-downscaled');
	});

	it('is an asset the design validates and the studio draws', async () => {
		const result = await importLogo(blobOf('x', 'image/png'), {
			deps: fakeDecoding(200, 100).deps,
		});
		if (!result.ok) throw new Error(result.error.code);
		const studio = createStudio();
		studio.dispatch({ type: 'payload/field', key: 'url', value: 'https://example.com/' });
		studio.dispatch({
			type: 'design/patch',
			patch: logoPatches(defaultDesign(), result.value.asset),
		});
		expect(studio.getSnapshot().refusal).toBeNull();
		const design = studio.getSnapshot().document.design;
		expect(
			validateDesign(design, createDesignRegistries()).issues.filter(
				(found) => found.severity === 'error',
			),
		).toEqual([]);
		expect(studio.getSnapshot().preview?.svg).toContain('data:image/png;base64,');
	});

	it('refuses an SVG logo for now, by type, by name or by content', async () => {
		const later = { code: 'design.issue.svg-logo-later', path: ['logo'], severity: 'error' };
		const deps = fakeDecoding(10, 10).deps;
		expect(await importLogo(blobOf('<svg/>', 'image/svg+xml'), { deps })).toEqual({
			ok: false,
			error: later,
		});
		expect(await importLogo(blobOf('x', '', 'logo.SVG'), { deps })).toEqual({
			ok: false,
			error: later,
		});
		expect(await importLogo(blobOf('\ufeff  \n<?xml version="1.0"?><svg/>', ''), { deps })).toEqual(
			{
				ok: false,
				error: later,
			},
		);
		expect(await importLogo(blobOf('\t<svg/>', 'application/octet-stream'), { deps })).toEqual({
			ok: false,
			error: later,
		});
	});

	it('reports a picture that will not open as the issue a view shows', async () => {
		const result = await importLogo(blobOf('x', 'image/heic'), {
			deps: fakeDecoding(1, 1, { fail: true }).deps,
		});
		expect(result).toEqual({
			ok: false,
			error: {
				code: 'error.image.unreadable',
				path: ['logo'],
				severity: 'error',
				params: { reason: 'decode' },
			},
		});
		// A blob that cannot be read for sniffing is judged by its type alone.
		const unsliceable = {
			type: 'image/png',
			slice: () => ({ arrayBuffer: () => Promise.reject(new Error('gone')) }),
		} as unknown as Blob;
		const read = await importLogo(unsliceable, { deps: fakeDecoding(4, 4).deps });
		expect(read.ok).toBe(true);
		expect(await importLogo(blobOf('x', 'image/png'))).toMatchObject({ ok: false });
	});
});
