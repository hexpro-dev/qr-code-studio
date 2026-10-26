/**
 * Running the scan check: the job a run is given, and the runner that drives
 * verify's generator in time slices on this thread.
 *
 * The check is long work, a few hundred simulated captures, and there is no
 * worker here (Chrome refuses a blob worker under file://), so the generator
 * is stepped for about one slice at a time and the thread is handed back in
 * between, which keeps typing responsive while it runs. The website wraps the
 * same generator in a module worker of its own and passes that runner in
 * instead.
 */

import { QrStudioError } from '../core/errors.js';
import type { RgbaImage } from '../core/image.js';
import { err } from '../core/result.js';
import type { Result } from '../core/result.js';
import type { DesignOverlay, QrDesignV1 } from '../design/types.js';
import { designRequirements } from '../verify/prepare.js';
import type { Registries } from '../registries.js';
import { driveInSlices } from './slices.js';
import type {
	VerifyConditions,
	VerifyGenerator,
	VerifyJob,
	VerifyProgress,
	VerifyReport,
	VerifyRunner,
} from './seams.js';
import type { Scheduler } from './types.js';

/** The most captures per level verify makes, and what a check someone asked for runs at. */
export const FULL_CAPTURE_SEEDS = 8;
/** What the check that follows typing runs at by default: a quarter of the work. */
export const LIVE_CAPTURE_SEEDS = 2;

/**
 * A job for verify, structured-cloneable so a website can post it to a
 * worker. `requires` is verify's own `designRequirements`, the `kind:id` of
 * every registry entry the design draws with, so a worker missing one
 * refuses by name rather than drawing squares.
 */
export function verifyJob(parts: {
	readonly content: string;
	readonly design: QrDesignV1;
	readonly conditions: VerifyConditions;
	readonly seed: number;
	readonly assets: Readonly<Record<string, RgbaImage>> | undefined;
	readonly overlay: DesignOverlay | null;
	readonly captureSeeds: number;
}): VerifyJob {
	const { content, design, conditions, seed, assets, overlay, captureSeeds } = parts;
	return Object.freeze({
		content,
		design,
		conditions,
		seed,
		requires: designRequirements(design),
		...(assets === undefined ? {} : { assets }),
		overlay,
		captureSeeds,
	});
}

/** The runner for a copy whose host left the scan check out (`verifyGenerator: null`). */
export const UNAVAILABLE_RUNNER: VerifyRunner = Object.freeze({
	run: async () =>
		err(
			new QrStudioError('platform/unavailable', 'The scan check is not part of this copy.', {
				feature: 'verify',
			}),
		),
});

/**
 * A runner that steps `generator` on this thread in slices (see slices.ts),
 * which is the default the studio uses once verify is in the build.
 */
export function slicedVerifyRunner(
	generator: VerifyGenerator,
	context: {
		readonly registries: Registries;
		readonly scheduler: Scheduler;
		readonly clock: () => number;
	},
): VerifyRunner {
	const { registries, scheduler, clock } = context;
	return Object.freeze({
		run(
			job: VerifyJob,
			signal: AbortSignal,
			progress: (p: VerifyProgress) => void,
		): Promise<Result<VerifyReport>> {
			return driveInSlices(() => generator(job, registries), {
				scheduler,
				clock,
				signal,
				progress,
				failure: 'verify/missing-entry',
			});
		},
	});
}
