/**
 * Scan and Bulk in the built offline file, opened from disk in each engine.
 *
 * The picture scanned is drawn and encoded by this package in the test, never
 * a photograph, and the spreadsheet is five synthetic rows (see CLAUDE.md).
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import yauzl from 'yauzl';
import { buildScene } from '../src/design/scene.js';
import { defaultDesign } from '../src/design/document.js';
import { createDesignRegistries } from '../src/design/registries.js';
import { encode } from '../src/encode/encode.js';
import { encodePng } from '../src/render/png.js';
import { rasterise } from '../src/render/raster.js';
import { buildStandaloneHtml } from '../scripts/build-html.js';

const SCANNED = 'https://example.com/scanned';
let url = '';

test.beforeAll(async () => {
	const dir = fileURLToPath(new URL('../test-results/', import.meta.url));
	await mkdir(dir, { recursive: true });
	const file = `${dir}app-modes-${test.info().project.name}.html`;
	await writeFile(file, (await buildStandaloneHtml()).html, 'utf8');
	url = pathToFileURL(file).href;
});

/** A PNG of a code that holds `text`, drawn by this package. */
function codePng(text: string): Buffer {
	const symbol = encode(text, { ecLevel: 'M' });
	const scene = buildScene(symbol, defaultDesign(), { registries: createDesignRegistries() }).scene;
	return Buffer.from(encodePng(rasterise(scene, { width: 330, height: 330 })));
}

function entryNames(archive: Buffer): Promise<string[]> {
	return new Promise((resolveNames, reject) => {
		yauzl.fromBuffer(archive, { lazyEntries: true }, (error, zip) => {
			if (error || !zip) {
				reject(error ?? new Error('no archive'));
				return;
			}
			const names: string[] = [];
			zip.on('error', reject);
			zip.on('entry', (entry: yauzl.Entry) => {
				names.push(entry.fileName);
				zip.readEntry();
			});
			zip.on('end', () => resolveNames(names));
			zip.readEntry();
		});
	});
}

async function mode(page: Page, name: RegExp): Promise<void> {
	await page.getByRole('tab', { name }).click();
	await expect(page.getByRole('tab', { name })).toHaveAttribute('aria-selected', 'true');
}

test('reads a code from a chosen picture, and remakes it as a static code', async ({ page }) => {
	await page.goto(url);
	await mode(page, /Scan/);
	await page.locator('#panel-scan input[type="file"]').setInputFiles({
		name: 'code.png',
		mimeType: 'image/png',
		buffer: codePng(SCANNED),
	});
	await expect(page.locator('.results__text')).toHaveText(SCANNED);
	await expect(page.locator('.results__status')).toHaveText('Found 1 code.');
	// Until the inspector is part of the build, its card says so in words;
	// once it is, the kind of content takes that place.
	await expect(
		page.locator('.results__card').getByText(/not in this copy of the file yet|Kind of content/),
	).toBeVisible();
	await page.getByRole('button', { name: 'Remake as a static code' }).click();
	await expect(page.getByRole('tab', { name: /Create/ })).toHaveAttribute('aria-selected', 'true');
	await expect(page.getByLabel('Web address')).toHaveValue(SCANNED);
	await expect(page.locator('.proof__stage')).toHaveAttribute('data-state', 'ok');
});

test('says plainly when a picture holds no code', async ({ page }) => {
	await page.goto(url);
	await mode(page, /Scan/);
	const blank = new Uint8ClampedArray(64 * 64 * 4).fill(255);
	await page.locator('#panel-scan input[type="file"]').setInputFiles({
		name: 'blank.png',
		mimeType: 'image/png',
		buffer: Buffer.from(encodePng({ width: 64, height: 64, data: blank })),
	});
	await expect(page.locator('.results__status')).toHaveText(/No code was found/);
});

test('falls back to a picture, and says why, when the camera is refused', async ({ page }) => {
	// The camera cannot be relied on in a test browser, so it is refused the
	// way a person or a file:// page refuses it, and the fallback is checked.
	await page.addInitScript(() => {
		const refuse = () => Promise.reject(new DOMException('Permission denied', 'NotAllowedError'));
		if (navigator.mediaDevices !== undefined) {
			Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value: refuse });
		}
	});
	await page.goto(url);
	await mode(page, /Scan/);
	const viewfinder = page.locator('.viewfinder');
	if ((await viewfinder.getAttribute('data-live')) !== 'refused') {
		await page.getByRole('button', { name: 'Start the camera' }).click();
	}
	await expect(viewfinder).toHaveAttribute('data-live', 'refused');
	await expect(page.locator('.viewfinder__status')).toHaveText(/picture/);
	await expect(page.getByRole('button', { name: 'Choose a picture' })).toBeEnabled();
});

test('makes a ZIP of codes from a five row spreadsheet', async ({ page }) => {
	await page.goto(url);
	await mode(page, /Bulk/);
	const csv = [
		'name,url',
		'Alpha,https://example.com/a',
		'Bravo,https://example.com/b',
		'Charlie,https://example.com/c',
		'Delta,https://example.com/d',
		'Echo,https://example.com/e',
	].join('\n');
	await page.getByLabel('Or paste its text').fill(csv);
	const make = page.getByRole('button', { name: 'Make 5 codes' });
	await expect(make).toBeEnabled();
	await expect(page.locator('.preview__row')).toHaveCount(5);
	const [saved] = await Promise.all([page.waitForEvent('download'), make.click()]);
	expect(saved.suggestedFilename()).toBe('qr-codes.zip');
	const path = await saved.path();
	if (path === null) throw new Error('the download was not saved');
	const archive = await readFile(path);
	expect(archive.subarray(0, 2).toString('latin1')).toBe('PK');
	const names = await entryNames(archive);
	expect(names.filter((name) => name.endsWith('.png'))).toHaveLength(5);
	await expect(page.locator('.bulk__summary').last()).toContainText('Made 5 codes');
});

test('keeps designs in a library file that never holds what a code says', async ({ page }) => {
	const content = 'https://example.com/library';
	await page.goto(url);
	await page.getByLabel('Web address').fill(content);
	await page.locator('#card-style input[value="midnight-dots"]').check();
	await page.locator('#card-library > summary').click();
	const card = page.locator('#card-library');
	await card.getByLabel('Name').fill('Night');
	await card.getByRole('button', { name: 'Save this design' }).click();
	await expect(card.locator('.library__item')).toHaveCount(1);
	await expect(card.getByText('changes that are not in a file yet')).toBeVisible();
	await card.getByLabel('Name').fill('Brand');
	await card.getByRole('button', { name: 'Save as brand kit' }).click();
	await expect(card.locator('.library__item')).toHaveCount(2);

	const [saved] = await Promise.all([
		page.waitForEvent('download'),
		card.getByRole('button', { name: 'Save library file' }).click(),
	]);
	expect(saved.suggestedFilename()).toMatch(/\.qrlibrary\.json$/);
	const path = await saved.path();
	if (path === null) throw new Error('the download was not saved');
	const file = await readFile(path);
	expect(file.toString('utf8')).toContain('"qr-library"');
	expect(file.toString('utf8'), 'the library file holds the content').not.toContain(content);
	await expect(card.getByText('changes that are not in a file yet')).toBeHidden();

	// A fresh page: open the file, and use the design on a code typed there.
	await page.goto(url);
	await page.getByLabel('Web address').fill('https://example.com/other');
	await page.locator('#card-library > summary').click();
	await card.locator('input[type="file"]').first().setInputFiles({
		name: saved.suggestedFilename(),
		mimeType: 'application/json',
		buffer: file,
	});
	await expect(card.locator('.library__item')).toHaveCount(2);
	await card.getByRole('button', { name: 'Use Night' }).click();
	await expect(page.locator('#card-style .card__meta')).toHaveText('Midnight dots');
	await expect(page.getByLabel('Web address')).toHaveValue('https://example.com/other');
});
