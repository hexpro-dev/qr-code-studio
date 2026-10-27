/**
 * What the offline file promises, checked in each engine: a whole session
 * sends no request and leaves nothing behind, and every state of the page
 * passes axe at WCAG 2.2 AA.
 *
 * The privacy session runs with the file's real policy. The axe checks run in
 * a separate context with bypassCSP, because the page's hash policy refuses
 * the script axe injects; nothing else differs.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { buildScene } from '../src/design/scene.js';
import { defaultDesign } from '../src/design/document.js';
import { createDesignRegistries } from '../src/design/registries.js';
import { encode } from '../src/encode/encode.js';
import { encodePng } from '../src/render/png.js';
import { rasterise } from '../src/render/raster.js';
import { buildStandaloneHtml } from '../scripts/build-html.js';

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
let url = '';

test.beforeAll(async () => {
	const dir = fileURLToPath(new URL('../test-results/', import.meta.url));
	await mkdir(dir, { recursive: true });
	const file = `${dir}app-privacy-${test.info().project.name}.html`;
	await writeFile(file, (await buildStandaloneHtml()).html, 'utf8');
	url = pathToFileURL(file).href;
});

function codePng(text: string): Buffer {
	const symbol = encode(text, { ecLevel: 'M' });
	const scene = buildScene(symbol, defaultDesign(), { registries: createDesignRegistries() }).scene;
	return Buffer.from(encodePng(rasterise(scene, { width: 330, height: 330 })));
}

/** Everything the page offers, once: make, design, save in three formats, scan, bulk, library. */
async function fullSession(page: Page): Promise<void> {
	await page.goto(url);
	await page.getByLabel('Web address').fill('https://example.com/session');
	await expect(page.locator('.proof__stage')).toHaveAttribute('data-state', 'ok');
	await page.locator('#card-style input[value="midnight-dots"]').check();
	for (const id of ['card-modules', 'card-eyes', 'card-colour', 'card-logo', 'card-frame']) {
		await page.locator(`#${id} > summary`).click();
	}
	await page.locator('#card-frame input[value="banner-bottom"]').check();
	// The scan check runs here too, in the tab, and to its end.
	await page.locator('#card-check > summary').click();
	await page.getByRole('button', { name: 'Check it scans' }).click();
	await expect(page.locator('.check')).toHaveAttribute('data-status', 'done', { timeout: 120_000 });
	await page.locator('#card-export > summary').click();
	for (const format of ['svg', 'png', 'pdf']) {
		await page.locator(`#card-export input[value="${format}"]`).check();
		await Promise.all([
			page.waitForEvent('download'),
			page.locator('.proof__actions .btn--primary').click(),
		]);
	}
	await page.locator('#card-library > summary').click();
	await page.getByRole('button', { name: 'Save this design' }).click();
	await expect(page.locator('.library__item')).toHaveCount(1);
	await Promise.all([
		page.waitForEvent('download'),
		page.getByRole('button', { name: 'Save library file' }).click(),
	]);
	await page.getByRole('tab', { name: /Scan/ }).click();
	await page.locator('#panel-scan input[type="file"]').setInputFiles({
		name: 'code.png',
		mimeType: 'image/png',
		buffer: codePng('https://example.com/read'),
	});
	await expect(page.locator('.results__text')).toHaveText('https://example.com/read');
	await page.getByRole('tab', { name: /Bulk/ }).click();
	await page
		.getByLabel('Or paste its text')
		.fill('url\nhttps://example.com/1\nhttps://example.com/2\n');
	await Promise.all([
		page.waitForEvent('download'),
		page.getByRole('button', { name: 'Make 2 codes' }).click(),
	]);
	await page.getByRole('tab', { name: /Create/ }).click();
}

test('sends no request at all during a whole session', async ({ page }) => {
	const outside: string[] = [];
	const local = (address: string): boolean => /^(file|data|blob):/.test(address);
	await page.route('**/*', async (route) => {
		const address = route.request().url();
		if (local(address)) await route.continue();
		else {
			outside.push(address);
			await route.abort();
		}
	});
	page.on('request', (request) => {
		if (!local(request.url())) outside.push(request.url());
	});
	await fullSession(page);
	expect(outside).toEqual([]);
});

test('leaves nothing stored after a whole session', async ({ page, context }) => {
	await fullSession(page);
	const stored = await page.evaluate(async () => {
		const length = (read: () => Storage): number => {
			try {
				return read().length;
			} catch {
				// A store a file:// page may not open holds nothing.
				return 0;
			}
		};
		let databases: unknown[] = [];
		try {
			databases =
				typeof indexedDB !== 'undefined' && typeof indexedDB.databases === 'function'
					? await indexedDB.databases()
					: [];
		} catch {
			databases = [];
		}
		let cacheNames: string[] = [];
		try {
			cacheNames = typeof caches !== 'undefined' ? await caches.keys() : [];
		} catch {
			cacheNames = [];
		}
		return {
			local: length(() => localStorage),
			session: length(() => sessionStorage),
			databases,
			cookie: document.cookie,
			caches: cacheNames,
		};
	});
	expect(stored).toEqual({ local: 0, session: 0, databases: [], cookie: '', caches: [] });
	expect(await context.cookies()).toEqual([]);
});

/**
 * The innermost elements that reach past the window's right edge, so a sideways
 * scroll names what causes it. Only engines on CI have shown one, where nobody
 * can look at the page.
 */
async function widerThanTheWindow(page: Page): Promise<string> {
	return page.evaluate(() => {
		const edge = document.documentElement.clientWidth;
		const reaching = [...document.querySelectorAll('body *')].filter((element) => {
			const box = element.getBoundingClientRect();
			return box.width > 0 && box.right > edge + 1;
		});
		const innermost = reaching.filter(
			(element) => !reaching.some((other) => other !== element && element.contains(other)),
		);
		return innermost
			.slice(0, 6)
			.map((element) => {
				const box = element.getBoundingClientRect();
				const name = [
					element.tagName.toLowerCase(),
					element.id ? `#${element.id}` : '',
					...[...element.classList].map((c) => `.${c}`),
				].join('');
				return `${name} (${Math.round(box.left)} to ${Math.round(box.right)})`;
			})
			.join(', ');
	});
}

test.describe('accessibility', () => {
	async function axe(page: Page, label: string): Promise<void> {
		const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
		const found = results.violations.map((violation) => ({
			id: violation.id,
			impact: violation.impact,
			nodes: violation.nodes.slice(0, 3).map((node) => node.target.join(' ')),
		}));
		expect(found, `axe violations ${label}`).toEqual([]);
	}

	test('has no WCAG 2.2 AA violations in any mode or panel', async ({ browser }) => {
		const context = await browser.newContext({ bypassCSP: true });
		const page = await context.newPage();
		await page.goto(url);
		await axe(page, 'on opening');
		await page.getByLabel('Web address').fill('https://example.com/axe');
		await expect(page.locator('.proof__stage')).toHaveAttribute('data-state', 'ok');
		for (const id of [
			'card-modules',
			'card-eyes',
			'card-colour',
			'card-logo',
			'card-frame',
			'card-print',
			'card-check',
			'card-export',
			'card-library',
		]) {
			await page.locator(`#${id} > summary`).click();
		}
		await page.locator('#card-logo input[value="wifi"]').check();
		await page.locator('#card-frame input[value="banner-bottom"]').check();
		await page.locator('.encoding > summary').click();
		await axe(page, 'in Create with every card open');
		await page.getByRole('tab', { name: /Scan/ }).click();
		await page.locator('#panel-scan input[type="file"]').setInputFiles({
			name: 'code.png',
			mimeType: 'image/png',
			buffer: codePng('https://example.com/axe-scan'),
		});
		await expect(page.locator('.results__text')).toBeVisible();
		await axe(page, 'in Scan with a result');
		await page.getByRole('tab', { name: /Bulk/ }).click();
		await page.getByLabel('Or paste its text').fill('url\nhttps://example.com/1\nnot a link\n');
		await expect(page.locator('.preview__row')).toHaveCount(2);
		await axe(page, 'in Bulk with a preview');
		await page.locator('.about > summary').click();
		await axe(page, 'with About this file open');
		await context.close();
	});

	test('has no violations in the dark theme or at phone width', async ({ browser }) => {
		const context = await browser.newContext({
			bypassCSP: true,
			colorScheme: 'dark',
			viewport: { width: 390, height: 844 },
		});
		const page = await context.newPage();
		await page.goto(url);
		await page.getByLabel('Web address').fill('https://example.com/axe-dark');
		await expect(page.locator('.proof__stage')).toHaveAttribute('data-state', 'ok');
		await page.locator('#card-colour > summary').click();
		await page.locator('#card-check > summary').click();
		await axe(page, 'dark, at phone width');
		const width = await page.evaluate(() => document.documentElement.scrollWidth);
		expect(width, 'the page scrolls sideways at phone width').toBeLessThanOrEqual(390);
		await context.close();
	});

	test('has no sideways scroll at 320 pixels', async ({ browser }) => {
		const context = await browser.newContext({ viewport: { width: 320, height: 640 } });
		const page = await context.newPage();
		await page.goto(url);
		await page.getByLabel('Web address').fill('https://example.com/narrow');
		for (const id of ['card-colour', 'card-logo', 'card-export', 'card-library']) {
			await page.locator(`#${id} > summary`).click();
		}
		for (const tab of [/Create/, /Scan/, /Bulk/]) {
			await page.getByRole('tab', { name: tab }).click();
			const width = await page.evaluate(() => document.documentElement.scrollWidth);
			const wide = width > 320 ? await widerThanTheWindow(page) : '';
			expect(width, `${String(tab)} scrolls sideways at 320 pixels: ${wide}`).toBeLessThanOrEqual(
				320,
			);
		}
		await context.close();
	});
});
