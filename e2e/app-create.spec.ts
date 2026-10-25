/**
 * The offline application, as a person uses it: the built file, opened from a
 * file:// URL with its real policy, in each engine.
 *
 * The file is built from source here (not read from dist/), written under
 * test-results/, and opened from disk, which is the only way it is ever used.
 * Downloads are read back and checked with this package's own reader and the
 * format's signature, so "a file was saved" means a file that holds the code.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expect, test } from '@playwright/test';
import type { Download, Page } from '@playwright/test';
import { PNG } from 'pngjs';
import { decodeImage } from '../src/decode/decoder.js';
import { buildStandaloneHtml } from '../scripts/build-html.js';

const CONTENT = 'https://example.com/e2e';
let url = '';

test.beforeAll(async () => {
	const dir = fileURLToPath(new URL('../test-results/', import.meta.url));
	await mkdir(dir, { recursive: true });
	const file = `${dir}app-create-${test.info().project.name}.html`;
	await writeFile(file, (await buildStandaloneHtml()).html, 'utf8');
	url = pathToFileURL(file).href;
});

async function open(page: Page): Promise<void> {
	await page.goto(url);
	await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
}

async function makeLink(page: Page, text = CONTENT): Promise<void> {
	await page.getByLabel('Web address').fill(text);
	await expect(page.locator('.proof__stage')).toHaveAttribute('data-state', 'ok');
}

async function bytesOf(download: Download): Promise<Buffer> {
	const path = await download.path();
	if (path === null) throw new Error('the download was not saved');
	return readFile(path);
}

async function chooseFormat(page: Page, format: string): Promise<void> {
	const card = page.locator('#card-export');
	if ((await card.getAttribute('open')) === null) await card.locator('> summary').click();
	await card.locator(`input[value="${format}"]`).check();
}

async function download(page: Page, label: RegExp): Promise<Download> {
	const [saved] = await Promise.all([
		page.waitForEvent('download'),
		page.locator('.proof__actions').getByRole('button', { name: label }).click(),
	]);
	return saved;
}

test('makes a code from a link', async ({ page }) => {
	await open(page);
	// Before anything is typed the proof shows a sample, and says so.
	await expect(page.locator('.proof__stage')).toHaveAttribute('data-state', 'sample');
	await expect(page.locator('.proof__img')).toHaveAttribute('alt', /sample/i);
	await makeLink(page);
	await expect(page.locator('.proof__img')).toHaveAttribute('src', /^blob:/);
	await expect(page.locator('.proof__img')).toHaveAttribute('alt', /QR code\. Web link\./);
	await expect(page.locator('.proof__slug')).toContainText('Version');
	await expect(page.locator('.encoding__reading')).toContainText('bits');
});

test('keeps the last code on screen while the content is not valid', async ({ page }) => {
	await open(page);
	await makeLink(page);
	await page.getByLabel('Web address').fill('not a link');
	await expect(page.locator('.proof__stage')).toHaveAttribute('data-state', 'stale');
	await expect(page.locator('.proof__badge')).toHaveText(/not updated/i);
	await expect(page.locator('.proof__img')).toHaveAttribute('src', /^blob:/);
});

test('changes the design with a preset', async ({ page }) => {
	await open(page);
	await makeLink(page);
	const before = await page.locator('.proof__img').getAttribute('src');
	await page.locator('#card-style input[value="midnight-dots"]').check();
	await expect(page.locator('#card-style .card__meta')).toHaveText('Midnight dots');
	await expect(page.locator('.proof__img')).not.toHaveAttribute('src', before ?? '');
});

test('saves SVG and PNG, and the PNG reads back as the same text', async ({ page }) => {
	await open(page);
	await makeLink(page);

	await chooseFormat(page, 'svg');
	const svg = (await bytesOf(await download(page, /Download SVG/))).toString('utf8');
	expect(svg).toMatch(/<svg[\s>]/);
	expect(svg).not.toContain(CONTENT);

	await chooseFormat(page, 'png');
	const saved = await download(page, /Download PNG/);
	expect(saved.suggestedFilename()).toMatch(/\.png$/);
	const png = PNG.sync.read(await bytesOf(saved));
	const read = decodeImage({
		width: png.width,
		height: png.height,
		data: new Uint8ClampedArray(png.data.buffer, png.data.byteOffset, png.data.length),
	});
	expect(read.ok).toBe(true);
	if (read.ok) expect(read.value.map((symbol) => symbol.read.bitstream.text)).toEqual([CONTENT]);
	await expect(page.getByRole('status')).toContainText('Saved');
});

test('saves a PDF', async ({ page }) => {
	await open(page);
	await makeLink(page);
	await chooseFormat(page, 'pdf');
	const pdf = await bytesOf(await download(page, /Download PDF/));
	expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
});

test('can be used from the keyboard alone, from the first key to a saved file', async ({
	page,
	browserName,
}) => {
	// WebKit on macOS moves Tab between text fields only, as Safari does by
	// default; Option+Tab is its key for every control, buttons included.
	const next = browserName === 'webkit' ? 'Alt+Tab' : 'Tab';
	await open(page);
	const focusedIs = (selector: string) =>
		page.evaluate((s) => document.activeElement?.matches(s) ?? false, selector);
	// Tab to the address field, the way a keyboard user would get there.
	let reached = false;
	for (let i = 0; i < 40 && !reached; i += 1) {
		await page.keyboard.press(next);
		reached = await focusedIs('input[type="url"]');
	}
	expect(reached, 'Tab never reached the address field').toBe(true);
	await page.keyboard.type(CONTENT);
	await expect(page.locator('.proof__stage')).toHaveAttribute('data-state', 'ok');
	// On, through every card, to the Download button under the proof.
	reached = false;
	for (let i = 0; i < 200 && !reached; i += 1) {
		await page.keyboard.press(next);
		reached = await focusedIs('.proof__actions .btn--primary');
	}
	expect(reached, 'Tab never reached Download').toBe(true);
	const [saved] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Enter')]);
	expect(saved.suggestedFilename()).toMatch(/\.png$/);
});

test('switches modes with the arrow keys', async ({ page }) => {
	await open(page);
	await page.getByRole('tab', { name: /Create/ }).focus();
	await page.keyboard.press('ArrowRight');
	await expect(page.getByRole('tab', { name: /Scan/ })).toHaveAttribute('aria-selected', 'true');
	await expect(page.getByRole('tab', { name: /Scan/ })).toBeFocused();
	await expect(page.locator('#panel-scan')).toBeVisible();
	await page.keyboard.press('End');
	await expect(page.getByRole('tab', { name: /Bulk/ })).toHaveAttribute('aria-selected', 'true');
	await page.keyboard.press('Home');
	await expect(page.locator('#panel-create')).toBeVisible();
});

test('opens a panel and changes a slider as one undo step', async ({ page }) => {
	await open(page);
	await makeLink(page);
	await page.locator('#card-modules > summary').click();
	await page.locator('#card-modules input[value="rounded"]').check();
	const slider = page.locator('#card-modules input[type="range"]').first();
	await slider.focus();
	const before = await slider.inputValue();
	await page.keyboard.press('ArrowRight');
	await page.keyboard.press('ArrowRight');
	await expect(slider).not.toHaveValue(before);
	await page.getByRole('button', { name: 'Undo' }).click();
	await page.getByRole('button', { name: 'Undo' }).click();
	await expect(slider).toHaveValue(before);
});

test('undoes and redoes, from the buttons and from the keyboard', async ({ page }) => {
	await open(page);
	await makeLink(page);
	const meta = page.locator('#card-style .card__meta');
	await expect(meta).toHaveText('Standard');
	await page.locator('#card-style input[value="midnight-dots"]').check();
	await expect(meta).toHaveText('Midnight dots');
	await page.getByRole('button', { name: 'Undo' }).click();
	await expect(meta).toHaveText('Standard');
	await page.getByRole('button', { name: 'Redo' }).click();
	await expect(meta).toHaveText('Midnight dots');
	await page.locator('body').click({ position: { x: 5, y: 5 } });
	await page.keyboard.press('ControlOrMeta+z');
	await expect(meta).toHaveText('Standard');
	await page.keyboard.press('ControlOrMeta+Shift+z');
	await expect(meta).toHaveText('Midnight dots');
});

test('opens with a mode and a content type from the address', async ({ page }) => {
	await page.goto(`${url}#create/wifi`);
	await expect(page.locator('#card-content .card__meta')).toHaveText('Wi-Fi network');
	await page.goto(`${url}#bulk`);
	await expect(page.getByRole('tab', { name: /Bulk/ })).toHaveAttribute('aria-selected', 'true');
});
