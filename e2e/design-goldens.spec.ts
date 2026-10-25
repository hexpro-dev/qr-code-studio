/**
 * Designs build to the same scene, SVG and pixels in every engine.
 *
 * The design layer sits on top of the rasteriser and adds its own arithmetic:
 * paint resolution, shape geometry, logo placement and frame layout. Each of
 * those could reach for something an engine computes differently, and the
 * render goldens alone would not notice.
 */
import { expect, test } from '@playwright/test';
import { bundleForPage } from './bundle.js';

test('builds the same design output as Node', async ({ page }) => {
	const script = await bundleForPage('../tests/design/goldens.ts', 'qrsDesignGoldens');
	await page.setContent('<!doctype html><html><body></body></html>');
	await page.addScriptTag({ content: script });
	const failures = await page.evaluate(() => {
		const module = (
			globalThis as unknown as { qrsDesignGoldens: { checkDesignGoldens(): unknown[] } }
		).qrsDesignGoldens;
		return module.checkDesignGoldens();
	});
	expect(failures).toEqual([]);
});
