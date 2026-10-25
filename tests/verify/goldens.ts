/**
 * Golden scan checks: the report a job must produce, the same in Node,
 * Chromium, WebKit and Firefox.
 *
 * Like tests/design/goldens.ts this imports only `src/` (and the render
 * goldens' SHA-256), uses no Node API, and needs nothing from the page, so a
 * browser harness can bundle it, call `checkVerifyGoldens()` and report what
 * comes back. tests/verify/goldens.test.ts runs it under Node.
 *
 * A report is the end of the longest deterministic chain in the package:
 * encoding, the scene, the rasteriser, every seeded capture through core's
 * maths, and the strict reader's verdict on each. One engine computing one
 * float differently anywhere along it moves a capture, and sooner or later a
 * verdict, so the digest of the whole report is what is compared.
 *
 * One seed per level and a small print keep each golden to a few dozen
 * small captures.
 */

import { defaultDesign } from '../../src/design/document.js';
import { createDesignRegistries } from '../../src/design/registries.js';
import type { QrDesignV1 } from '../../src/design/types.js';
import { createSymbologyRegistry } from '../../src/symbology/registry.js';
import { verify } from '../../src/verify/job.js';
import type { VerifyJob } from '../../src/verify/types.js';
import { sha256Hex } from '../render/goldens.js';

export interface VerifyGolden {
	readonly name: string;
	readonly job: () => VerifyJob;
	readonly sha256: string;
}

function preset(id: string): QrDesignV1 {
	return createDesignRegistries().presets.require(id).design;
}

function job(design: QrDesignV1, overrides: Partial<VerifyJob> = {}): VerifyJob {
	return {
		content: 'https://example.com/g',
		design,
		conditions: { sizeMm: 16, dpi: null, distanceMm: null },
		seed: 1,
		requires: [],
		captureSeeds: 1,
		...overrides,
	};
}

export const VERIFY_GOLDENS: readonly VerifyGolden[] = [
	{
		name: 'classic black at 16 mm',
		job: () => job(defaultDesign()),
		sha256: '564706950fb8a7831a145302e1389b214476cdf27c730c5d9bf3b0addf14fa8f',
	},
	{
		name: 'shop tag with its logo and frame, 30 mm across, 30 cm away',
		job: () => job(preset('shop-tag'), { conditions: { sizeMm: 30, dpi: null, distanceMm: 300 } }),
		sha256: '97d094a32cbb24dd38e355dc5509d5aeb9141f1231698306f35457408b1ac8f5',
	},
	{
		name: 'fluid lagoon gradient printed from a 150 dpi export',
		job: () =>
			job(preset('fluid-lagoon'), {
				conditions: { sizeMm: 16, dpi: 150, distanceMm: null },
				seed: 99,
			}),
		sha256: '103b919a4c70e30e3b7c1eee0ebef9f4d759cfdd07f0bbd298d05bf6829b38e7',
	},
];

/** The report's bytes, as JSON in the order the runner builds it. */
export function reportBytes(golden: VerifyGolden): Uint8Array {
	const registries = { symbologies: createSymbologyRegistry(), design: createDesignRegistries() };
	return new TextEncoder().encode(JSON.stringify(verify(golden.job(), registries)));
}

export interface VerifyGoldenResult {
	readonly name: string;
	readonly expected: string;
	readonly actual: string;
}

/** Run every golden and report each one whose report moved. */
export function checkVerifyGoldens(): readonly VerifyGoldenResult[] {
	const out: VerifyGoldenResult[] = [];
	for (const golden of VERIFY_GOLDENS) {
		const actual = sha256Hex(reportBytes(golden));
		if (actual !== golden.sha256) out.push({ name: golden.name, expected: golden.sha256, actual });
	}
	return out;
}
