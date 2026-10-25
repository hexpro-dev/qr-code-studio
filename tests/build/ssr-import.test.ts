/**
 * Every subpath imports on a server with no browser in sight.
 *
 * hex-web bundles this package's source into a server-side render, so a module
 * that touches `document`, `window` or a canvas while it is being imported takes
 * the whole website's render down, not just the tool. The rule in CLAUDE.md is
 * that nothing outside `src/dom/` and `src/app/` reaches for the DOM at all, and
 * nothing anywhere does so at import. This holds the second half to account:
 * every exported module is imported with the browser globals replaced by
 * getters that throw, so reaching for one during import fails here by name.
 *
 * It also checks the half a reader would not think of: importing must not
 * change any state another import could see. Registries are instances made by
 * `createRegistries()`, never module-level lists that an import appends to,
 * because `sideEffects: false` lets a bundler drop an import whose only purpose
 * was its side effect.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
	exports: Record<string, string | Record<string, string>>;
};

/** Globals a browser has and a server render does not. */
const BROWSER_GLOBALS = [
	'window',
	'document',
	'indexedDB',
	'localStorage',
	'sessionStorage',
	'HTMLElement',
	'HTMLCanvasElement',
	'OffscreenCanvas',
	'createImageBitmap',
	'ImageData',
	'VideoFrame',
	'BarcodeDetector',
] as const;

function importableSources(): { subpath: string; source: string }[] {
	const out: { subpath: string; source: string }[] = [];
	for (const [subpath, value] of Object.entries(manifest.exports)) {
		if (typeof value === 'string') continue;
		const match = /^\.\/dist\/(.+?)\.js$/.exec(value.import ?? '');
		if (match?.[1]) out.push({ subpath, source: resolve(root, 'src', `${match[1]}.ts`) });
	}
	return out;
}

const installed: string[] = [];

function trapBrowserGlobals(): void {
	for (const name of BROWSER_GLOBALS) {
		if (name in globalThis) continue;
		Object.defineProperty(globalThis, name, {
			configurable: true,
			get() {
				throw new Error(`${name} was read while a module was being imported`);
			},
		});
		installed.push(name);
	}
}

afterEach(() => {
	for (const name of installed.splice(0)) {
		delete (globalThis as Record<string, unknown>)[name];
	}
	vi.resetModules();
});

describe('importing the package on a server', () => {
	const sources = importableSources();

	it('has subpaths to import', () => {
		expect(sources.length).toBeGreaterThan(0);
	});

	for (const { subpath, source } of sources) {
		it(`imports ${subpath} without touching a browser global`, async () => {
			trapBrowserGlobals();
			const module = (await import(source)) as Record<string, unknown>;
			expect(Object.keys(module).length, `${subpath} exports nothing`).toBeGreaterThan(0);
		});
	}
});
