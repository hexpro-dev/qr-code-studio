/**
 * "Nothing is stored until you ask", checked where it has to be true: in a
 * browser, with its real IndexedDB, asked through `indexedDB.databases()`
 * after each step what exists.
 *
 * The page is served on an http origin of its own (intercepted, so nothing
 * leaves the machine) because IndexedDB needs an origin to keep a database
 * under, and a blank page has none. Each test gets a fresh browser context,
 * so starts with no databases at all.
 */
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type * as HarnessModule from '../tests/dom/library/harness.js';
import { bundleForPage } from './bundle.js';

const ORIGIN = 'http://library.localhost.test';
const PAGE =
	'<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Library</title></head><body></body></html>';

type Harness = typeof HarnessModule;

let script = '';

test.beforeAll(async () => {
	script = await bundleForPage('../tests/dom/library/harness.ts', 'qrsLibrary');
});

async function open(page: Page): Promise<void> {
	await page.route(`${ORIGIN}/**`, (route) =>
		route.fulfill({ status: 200, contentType: 'text/html', body: PAGE }),
	);
	await page.goto(`${ORIGIN}/`);
	await page.addScriptTag({ content: script });
}

function step<K extends keyof Harness>(page: Page, name: K) {
	return page.evaluate(
		(which) =>
			(globalThis as unknown as { qrsLibrary: Record<string, () => Promise<unknown>> }).qrsLibrary[
				which
			]?.(),
		name,
	) as ReturnType<Harness[K]>;
}

test('leaves no database behind from a whole visit with the library off', async ({ page }) => {
	await open(page);
	expect(await page.evaluate(() => indexedDB.databases())).toEqual([]);
	const visit = await step(page, 'untouched');
	expect(visit.probe).toEqual({ available: true, enabled: false, state: 'off' });
	expect(visit.codes).toEqual(Array(7).fill('library/not-enabled'));
	expect(visit.status).toBe('off');
	expect(visit.saved).toBe('library/not-enabled');
	expect(visit.databases).toEqual([]);

	// The open that finds the database gone aborts, and leaves none in its place.
	const race = await step(page, 'vanished');
	expect(race.listed).toBe('library/not-enabled');
	expect(race.databases).toEqual([]);

	await page.reload();
	expect(await page.evaluate(() => indexedDB.databases())).toEqual([]);
});

test('makes exactly one database when switched on, and none once switched off', async ({
	page,
}) => {
	await open(page);
	const on = await step(page, 'switchOn');
	expect(on.enabled).toBe('ok');
	expect(on.saved).toBe('Office');
	expect(on.kit).toBe('Brand');
	expect(on.databases).toEqual([{ name: 'qr-code-studio-library', version: 1 }]);
	// What was saved is the design, never the code's content.
	expect(on.stored).toContain('qr-design');
	expect(on.stored).not.toContain('Synthetic-Passphrase-4f1c9e');
	expect(on.stored).not.toContain('Example Network');

	// The next visit finds it on, without being switched on again.
	await page.reload();
	await page.addScriptTag({ content: script });
	const next = await step(page, 'reopen');
	expect(next.probe).toEqual({ available: true, enabled: true, state: 'on' });
	expect(next.names).toEqual(['Office']);
	expect(next.fields).toEqual({});
	expect(next.databases).toHaveLength(1);

	const off = await step(page, 'switchOff');
	expect(off.disabled).toBe('ok');
	expect(off.probe).toEqual({ available: true, enabled: false, state: 'off' });
	expect(off.listed).toBe('library/not-enabled');
	expect(off.databases).toEqual([]);

	await page.reload();
	expect(await page.evaluate(() => indexedDB.databases())).toEqual([]);
});
