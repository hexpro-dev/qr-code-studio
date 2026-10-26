/**
 * The scan check gives the same verdict in every engine.
 *
 * A report is built from a rasterised design, seeded damage and the strict
 * reader, all in the determinism zone. If any of it drifted in one engine, a
 * design could pass the check in Chrome and fail it in Safari, which is the
 * one thing a scan check cannot be allowed to do.
 */
import { expect, test } from '@playwright/test';
import { bundleForPage } from './bundle.js';

test('produces the same scan check reports as Node', async ({ page }) => {
	const script = await bundleForPage('../tests/verify/goldens.ts', 'qrsVerifyGoldens');
	await page.setContent('<!doctype html><html><body></body></html>');
	await page.addScriptTag({ content: script });
	const failures = await page.evaluate(() => {
		const module = (
			globalThis as unknown as { qrsVerifyGoldens: { checkVerifyGoldens(): unknown[] } }
		).qrsVerifyGoldens;
		return module.checkVerifyGoldens();
	});
	expect(failures).toEqual([]);
});
