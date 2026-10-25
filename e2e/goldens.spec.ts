/**
 * The determinism claim, checked where it matters: in each engine.
 *
 * tests/render/goldens.ts renders a set of scenes and writes PNGs with this
 * package's own rasteriser and encoder, and compares SHA-256 digests with the
 * ones recorded under Node. The scan check's verdict depends on the rasteriser
 * giving the same pixels everywhere, and an export's bytes depend on the same
 * thing, so a digest that differs in one engine is a bug in the package rather
 * than a curiosity about the browser.
 */
import { expect, test } from '@playwright/test';
import { bundleForPage } from './bundle.js';

test('renders and encodes the same bytes as Node', async ({ page }) => {
	const script = await bundleForPage('../tests/render/goldens.ts', 'qrsGoldens');
	await page.setContent('<!doctype html><html><body></body></html>');
	await page.addScriptTag({ content: script });
	const failures = await page.evaluate(() => {
		const module = (globalThis as unknown as { qrsGoldens: { checkGoldens(): unknown[] } })
			.qrsGoldens;
		return module.checkGoldens();
	});
	expect(failures).toEqual([]);
});
