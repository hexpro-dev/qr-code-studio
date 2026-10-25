import { defineConfig, devices } from '@playwright/test';

/**
 * Browser tests.
 *
 * One worker, always. These run on a laptop that other work shares, and three
 * engines in parallel is three browsers at once for no gain: the suites are
 * small and the engines are what is being compared, not the throughput.
 */
export default defineConfig({
	testDir: 'e2e',
	workers: 1,
	fullyParallel: false,
	reporter: [['list']],
	timeout: 120_000,
	projects: [
		{ name: 'chromium', use: { ...devices['Desktop Chrome'] } },
		{ name: 'firefox', use: { ...devices['Desktop Firefox'] } },
		{ name: 'webkit', use: { ...devices['Desktop Safari'] } },
	],
});
