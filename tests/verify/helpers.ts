/**
 * Shared set-up for the verify tests: registries, jobs, and readers that
 * stand in for the strict profile where a test is about the pipeline around
 * it rather than about reading.
 */

import { defaultDesign } from '../../src/design/document.js';
import { createDesignRegistries } from '../../src/design/registries.js';
import type { QrDesignV1 } from '../../src/design/types.js';
import { createSymbologyRegistry } from '../../src/symbology/registry.js';
import type { CaptureReader, RunOptions } from '../../src/verify/job.js';
import { runPrepared } from '../../src/verify/job.js';
import type { Prepared } from '../../src/verify/prepare.js';
import { prepare } from '../../src/verify/prepare.js';
import type { VerifyJob, VerifyRegistries, VerifyReport } from '../../src/verify/types.js';

export const registries: VerifyRegistries = {
	symbologies: createSymbologyRegistry(),
	design: createDesignRegistries(),
};

export const CONTENT = 'https://example.com/menu/table-12';

export function preset(id: string): QrDesignV1 {
	return registries.design.presets.require(id).design;
}

export function job(overrides: Partial<VerifyJob> = {}): VerifyJob {
	return {
		content: CONTENT,
		design: defaultDesign(),
		conditions: { sizeMm: 30, dpi: null, distanceMm: null },
		seed: 7,
		requires: [],
		captureSeeds: 1,
		...overrides,
	};
}

export function design(overrides: Partial<QrDesignV1>): QrDesignV1 {
	return { ...defaultDesign(), ...overrides };
}

/** Drive a run to its report, collecting every progress step. */
export function drive(
	prepared: Prepared,
	options: RunOptions = {},
): { report: VerifyReport; steps: { done: number; total: number; axis: string }[] } {
	const run = runPrepared(prepared, options);
	const steps: { done: number; total: number; axis: string }[] = [];
	for (;;) {
		const step = run.next();
		if (step.done === true) return { report: step.value, steps };
		steps.push(step.value);
	}
}

export function run(overrides: Partial<VerifyJob> = {}, options: RunOptions = {}): VerifyReport {
	return drive(prepare(job(overrides), registries), options).report;
}

/** Reads everything, with a fixed margin. */
export const alwaysReads: CaptureReader = () => ({ read: true, margin: 3 });

/** Reads nothing. */
export const neverReads: CaptureReader = () => ({ read: false, margin: null });
