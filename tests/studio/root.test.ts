/**
 * The root conveniences: fresh registries, and an everyday surface that pulls
 * in neither the reader, nor the print writers, nor the fonts.
 *
 * The bundle check asks esbuild which source files `src/index.ts` reaches,
 * which is what a website's bundler would include. A stray import of the
 * decoder from the root would add its weight to every page that only wanted
 * to draw a code.
 */

import { resolve } from 'node:path';
import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';
import * as root from '../../src/index.js';
import { createRegistries } from '../../src/registries.js';

const here = resolve(import.meta.dirname, '../..');

describe('createRegistries', () => {
	it('gives fresh instances of every registry, filled with the built-ins', () => {
		const a = createRegistries();
		const b = createRegistries();
		expect(a.symbologies).not.toBe(b.symbologies);
		expect(a.payloads).not.toBe(b.payloads);
		expect(a.design.moduleShapes).not.toBe(b.design.moduleShapes);
		expect(a.symbologies.ids()).toEqual(['qr', 'micro', 'rmqr']);
		expect(a.payloads.has('url')).toBe(true);
		expect(a.design.presets.list().length).toBeGreaterThan(0);
		a.design.moduleShapes.register({
			id: 'only-in-a',
			labelKey: 'design.module.square',
			params: [],
			connects: false,
			path() {},
		});
		expect(b.design.moduleShapes.has('only-in-a')).toBe(false);
	});
});

describe('the root', () => {
	it('exports the everyday surface', () => {
		for (const name of [
			'encode',
			'encodeStructuredAppend',
			'createRegistries',
			'defaultDesign',
			'validateDesign',
			'migrateDesign',
			'applyConstraints',
			'designLink',
			'encodeDesignLink',
			'decodeDesignLink',
			'buildScene',
			'sceneToSvg',
			'QrStudioError',
			'TooMuchDataError',
			'ok',
			'err',
		]) {
			expect(root, name).toHaveProperty(name);
		}
		const symbol = root.encode('https://example.com/');
		const scene = root.buildScene(symbol, root.defaultDesign(), {
			registries: root.createRegistries().design,
		});
		expect(root.sceneToSvg(scene.scene).startsWith('<svg')).toBe(true);
	});

	it('pulls in no reader, no print writer, no text layer and no fonts', async () => {
		const result = await build({
			entryPoints: [resolve(here, 'src/index.ts')],
			bundle: true,
			write: false,
			metafile: true,
			format: 'esm',
			platform: 'neutral',
			logLevel: 'silent',
		});
		const inputs = Object.keys(result.metafile.inputs);
		expect(inputs.length).toBeGreaterThan(20);
		// Paths are from the repository root, which the pattern below relies on.
		expect(inputs.every((input) => input.startsWith('src/'))).toBe(true);
		expect(inputs).toContain('src/design/scene.ts');
		const banned = inputs.filter((input) =>
			/^src\/(?:decode|text|fonts)\/|^src\/render\/(?:pdf|eps|impose|sheets)[^/]*\.ts$|^src\/(?:studio|dom|verify|inspect|batch)\//.test(
				input,
			),
		);
		expect(banned).toEqual([]);
	});
});
