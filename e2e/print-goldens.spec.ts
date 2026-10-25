/**
 * PDF, EPS, label sheets and captions come out byte for byte the same in
 * every engine.
 *
 * The print writers format numbers, compress streams and lay out glyph
 * outlines, any of which could differ between engines in a way the raster
 * goldens would not see. A printer's preflight report is the wrong place to
 * find out.
 */
import { expect, test } from '@playwright/test';
import { bundleForPage } from './bundle.js';

test('writes the same print files as Node', async ({ page }) => {
	const script = await bundleForPage('../tests/render/pdf-goldens.ts', 'qrsPrintGoldens');
	await page.setContent('<!doctype html><html><body></body></html>');
	await page.addScriptTag({ content: script });
	const failures = await page.evaluate(() => {
		const module = (
			globalThis as unknown as { qrsPrintGoldens: { checkPrintGoldens(): unknown[] } }
		).qrsPrintGoldens;
		return module.checkPrintGoldens();
	});
	expect(failures).toEqual([]);
});
