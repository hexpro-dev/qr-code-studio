import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		include: ['tests/**/*.test.ts'],
		// The unhandled-rejection guard, installed for every file. A rejection
		// nobody awaited passes every assertion and poisons the process, and
		// vitest reports it as a loose error at the bottom of the run rather than
		// against the test that caused it. See tests/fuzz/setup.ts.
		setupFiles: ['tests/fuzz/setup.ts'],
		coverage: {
			provider: 'v8',
			reporter: ['text', 'lcov'],
			include: ['src/**/*.ts'],
			exclude: [
				// The offline application is browser UI. It is checked by the
				// integrity tests over the built file, by the Playwright suite under
				// e2e/, and by opening it, which is what RELEASING.md is for.
				'src/app/**',
				// Types only, and barrels. Both compile to `export {}` or to
				// re-exports, so v8 scores them 0 of 0 and drags a directory down for
				// no signal.
				'src/**/types.ts',
				'src/**/index.ts',
			],
			// Every threshold sits just under what the suite actually reaches, so a
			// real regression trips it. A lower one gates nothing; a higher one is a
			// gate that has never been green, which teaches everybody to ignore it.
			// Raise them when coverage rises rather than leaving slack.
			thresholds: {
				statements: 98,
				branches: 98,
				functions: 98,
				lines: 98,
				// The content types and the redirect writers parse other people's
				// text and write payment instructions, so every branch is exercised.
				// The deterministic suites reach 100 on their own, without the
				// property and fuzz runs, so a random seed cannot move these.
				'src/payload/**': { statements: 100, branches: 100, functions: 100, lines: 100 },
				'src/own-link/**': { statements: 100, branches: 100, functions: 100, lines: 100 },
			},
		},
	},
});
