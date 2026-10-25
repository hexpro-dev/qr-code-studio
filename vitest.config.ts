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
				// Generated data: the compiled font tables, rebuilt and compared
				// byte for byte by tests/text/build-fonts.test.ts. The loader that
				// reads them is src/text/compiled.ts, which is held to 100 below.
				'src/fonts/**',
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
				// The codecs, fields and arithmetic everything else is built on. One
				// defensive re-check in reed-solomon.ts is excluded by a v8 hint, with
				// the reason beside it; everything else is reached. The branches left
				// over are in deflate.ts: a non-final block that fixed Huffman wins,
				// and zlib's TOO_FAR cut-off, which a four-byte hash reaches only
				// through a collision.
				'src/core/**': { statements: 100, branches: 99.5, functions: 100, lines: 100 },
				// The content types and the redirect writers parse other people's
				// text and write payment instructions, so every branch is exercised.
				// The deterministic suites reach 100 on their own, without the
				// property and fuzz runs, so a random seed cannot move these.
				'src/payload/**': { statements: 100, branches: 100, functions: 100, lines: 100 },
				'src/own-link/**': { statements: 100, branches: 100, functions: 100, lines: 100 },
				// Geometry and render: every line and branch is reached. Branches sit
				// one point under so a change in how v8 counts a ternary does not
				// fail a clean tree. The render gate covers the print writers (pdf*,
				// eps*, impose*, sheets*), which reach 100 without Ghostscript or
				// Poppler installed: the renderer comparisons add evidence, not lines.
				'src/geometry/**': { statements: 100, branches: 99, functions: 100, lines: 100 },
				'src/render/**': { statements: 100, branches: 99, functions: 100, lines: 100 },
				// The bitstream, the symbology and the encoder. Every line and every
				// branch is reached today; branches are gated at 99, the figure set for
				// these layers when they were written.
				'src/segment/**': { statements: 100, branches: 99, functions: 100, lines: 100 },
				'src/symbology/qr/**': { statements: 100, branches: 99, functions: 100, lines: 100 },
				'src/symbology/*.ts': { statements: 100, branches: 99, functions: 100, lines: 100 },
				'src/encode/**': { statements: 100, branches: 99, functions: 100, lines: 100 },
				// The TrueType parser reads files a person chose, so every refusal
				// is reached by a file built to provoke it (tests/text/ttf.ts).
				// Every line and branch is reached; branches are gated at 99 with
				// the other layers.
				'src/text/**': { statements: 100, branches: 99, functions: 100, lines: 100 },
			},
		},
	},
});
