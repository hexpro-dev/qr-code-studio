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
import type { DesignOverlay, DesignPaint, DesignRegistries, QrDesignV1 } from '../design/types.js';
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

function paintEntries(paint: DesignPaint | undefined, out: Set<string>, fills: string): void {
	if (paint?.kind === 'entry') out.add(`${fills}:${paint.ref.id}`);
}

/**
 * The registry entries a design draws with, as `kind:id`, so a worker whose
 * registries lack one refuses the job by name rather than drawing squares.
 */
export function requiredEntries(design: QrDesignV1, registries: Registries): readonly string[] {
	const out = new Set<string>();
	const kinds: DesignRegistries = registries.design;
	const fills = kinds.fills.kind;
	out.add(`${registries.symbologies.kind}:${design.symbol.symbology}`);
	out.add(`${kinds.moduleShapes.kind}:${design.modules.shape.id}`);
	paintEntries(design.modules.paint, out, fills);
	paintEntries(design.background ?? undefined, out, fills);
	if (design.modules.light !== null) {
		out.add(`${kinds.moduleShapes.kind}:${design.modules.light.shape.id}`);
		paintEntries(design.modules.light.paint, out, fills);
	}
	for (const role of ['finder', 'sub-finder', 'corner-finder'] as const) {
		const style = design.regions[role];
		if (style === undefined) continue;
		out.add(`${kinds.regionShapes.kind}:${style.outer.id}`);
		out.add(`${kinds.regionShapes.kind}:${style.inner.id}`);
		paintEntries(style.outerPaint, out, fills);
		paintEntries(style.innerPaint, out, fills);
	}
	if (design.logo !== null) {
		if (design.logo.source.kind === 'icon') out.add(`${kinds.icons.kind}:${design.logo.source.id}`);
		paintEntries(design.logo.paint, out, fills);
		paintEntries(design.logo.plate?.paint, out, fills);
	}
	if (design.frame !== null) {
		out.add(`${kinds.frames.kind}:${design.frame.ref.id}`);
		paintEntries(design.frame.paint, out, fills);
		paintEntries(design.frame.text?.paint, out, fills);
	}
	return Object.freeze([...out].sort());
}

export function verifyJob(
	content: string,
	design: QrDesignV1,
	conditions: VerifyConditions,
	seed: number,
	registries: Registries,
	assets: Readonly<Record<string, RgbaImage>> | undefined,
	overlay: DesignOverlay | null,
): VerifyJob {
	return Object.freeze({
		content,
		design,
		conditions,
		seed,
		requires: requiredEntries(design, registries),
		...(assets === undefined ? {} : { assets }),
		overlay,
	});
}

/** The runner while the verify layer is still to merge: it says the check is not in this build. */
export const UNAVAILABLE_RUNNER: VerifyRunner = Object.freeze({
	run: async () =>
		err(
			new QrStudioError('platform/unavailable', 'The scan check is not part of this build yet.', {
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
