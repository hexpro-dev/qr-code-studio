/**
 * Each area of the package holds to its own share of the offline file.
 *
 * The size test in standalone-html.test.ts has one floor and one ceiling for
 * the whole document, which says something grew and nothing about what. This
 * reads the esbuild metafile the build returns (the bytes each source file
 * contributed to the minified program) and holds every area under `src/` to
 * a budget of its own, set at its measured size plus about a tenth. A change
 * that pushes one over fails here by name, with the figure, and the diff that
 * caused it is the one to read.
 *
 * An area with no budget fails too: a layer arriving in the offline file is a
 * decision, and the budget is where it is written down.
 *
 * Measured at M8b, 26 October 2026, after the payload vectors moved out of
 * the runtime objects; verify and inspect added when the studio wired them in.
 * Raise a budget only after reading what grew.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { buildStandaloneHtml } from '../../scripts/build-html.js';
import type { StandaloneBuildResult } from '../../scripts/build-html.js';

/** Bytes of minified program each area may contribute. */
const BUDGETS: Readonly<Record<string, number>> = {
	'src/app': 100_000, // 91.1 kB
	'src/design': 89_500, // 81.4 kB
	'src/messages': 80_000, // 72.8 kB
	'src/payload': 79_500, // 72.1 kB
	'src/fonts': 66_500, // 60.5 kB: the compiled caption faces, under their licence
	'src/render': 65_000, // 59.2 kB
	'src/studio': 46_500, // 42.3 kB
	'src/decode': 49_500, // 44.9 kB: strict-v1's styled, tilt and zxing-cpp rules (tiled grid, ring kinds, finder centres)
	'src/symbology': 34_000, // 31.0 kB
	'src/core': 31_500, // 28.5 kB
	'src/verify': 34_000, // 30.6 kB: the scan check, run in time slices in the tab
	'src/batch': 29_000, // 26.5 kB
	'src/segment': 18_500, // 16.9 kB
	'src/dom': 26_000, // 23.4 kB, with the file library (M11)
	'src/geometry': 11_200, // 10.2 kB
	'src/text': 9_600, // 8.7 kB
	'src/inspect': 5_800, // 5.2 kB: what a scanned code says, and whether to trust it
	'src/encode': 4_900, // 4.5 kB
	'src/registries.ts': 200, // 65 bytes
};

/** The stylesheet, which the metafile does not see. */
const STYLE_BUDGET = 37_000; // 33.6 kB

let build: StandaloneBuildResult;
let areas: Record<string, number> = {};
let style = '';

/** `src/design/scene.ts` belongs to `src/design`; a file at the top of src is its own area. */
function areaOf(path: string): string {
	const parts = path.split('/');
	if (parts[0] !== 'src') return parts.slice(0, 2).join('/');
	return parts.length > 2 ? `src/${parts[1]}` : path;
}

beforeAll(async () => {
	build = await buildStandaloneHtml();
	areas = {};
	for (const [path, bytes] of Object.entries(build.inputs)) {
		const area = areaOf(path);
		areas[area] = (areas[area] ?? 0) + bytes;
	}
	style = /<style>([\s\S]*?)<\/style>/.exec(build.html)?.[1] ?? '';
}, 120_000);

describe('the share of the offline file each area takes', () => {
	it('reads a share for the areas it expects', () => {
		// A metafile that came back empty would pass every budget below.
		expect(areas['src/studio'], 'the studio is not in the program').toBeGreaterThan(10_000);
		expect(areas['src/app'], 'the application is not in the program').toBeGreaterThan(10_000);
	});

	it('has a budget for every area in the program', () => {
		const unbudgeted = Object.keys(areas).filter((area) => BUDGETS[area] === undefined);
		expect(unbudgeted, `areas with no budget: ${JSON.stringify(areas)}`).toEqual([]);
	});

	for (const [area, budget] of Object.entries(BUDGETS)) {
		it(`keeps ${area} within ${budget} bytes`, () => {
			const used = areas[area] ?? 0;
			expect(used, `${area} is ${used} bytes, over its budget of ${budget}`).toBeLessThanOrEqual(
				budget,
			);
		});
	}

	it('keeps the stylesheet within its budget', () => {
		expect(style.length).toBeGreaterThan(1_000);
		expect(style.length, `the stylesheet is ${style.length} bytes`).toBeLessThanOrEqual(
			STYLE_BUDGET,
		);
	});

	it('leaves the opt-in library out entirely', () => {
		expect(Object.keys(build.inputs).filter((path) => path.includes('dom/library'))).toEqual([]);
	});
});
