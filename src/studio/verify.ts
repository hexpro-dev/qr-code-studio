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

import { CancelledError, QrStudioError } from '../core/errors.js';
import type { RgbaImage } from '../core/image.js';
import { err, ok } from '../core/result.js';
import type { Result } from '../core/result.js';
import type { DesignPaint, DesignRegistries, QrDesignV1 } from '../design/types.js';
import type { Registries } from '../registries.js';
import { asStudioError } from './keys.js';
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
): VerifyJob {
	return Object.freeze({
		content,
		design,
		conditions,
		seed,
		requires: requiredEntries(design, registries),
		...(assets === undefined ? {} : { assets }),
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
 * A runner that steps `generator` on this thread, for about `scheduler.sliceMs`
 * at a time, then hands the thread back until the scheduler calls again. An
 * abort stops it between captures and cancels the pending slice, so nothing
 * is left waiting on the clock.
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
			return new Promise((resolve) => {
				let cancel: (() => void) | null = null;
				let finished = false;
				// Reached once: the abort listener is removed here, and the slice
				// loop stops at the first sign of `finished`.
				const finish = (result: Result<VerifyReport>): void => {
					finished = true;
					signal.removeEventListener('abort', onAbort);
					cancel?.();
					cancel = null;
					resolve(result);
				};
				const onAbort = (): void => finish(err(new CancelledError()));
				if (signal.aborted) {
					finish(err(new CancelledError()));
					return;
				}
				signal.addEventListener('abort', onAbort);
				let steps: Generator<VerifyProgress, VerifyReport>;
				try {
					steps = generator(job, registries);
				} catch (thrown) {
					finish(err(asStudioError(thrown, 'verify/missing-entry')));
					return;
				}
				const slice = (): void => {
					cancel = null;
					const started = clock();
					try {
						for (;;) {
							const step = steps.next();
							if (step.done === true) {
								finish(ok(step.value));
								return;
							}
							progress(step.value);
							if (finished) return;
							if (clock() - started >= scheduler.sliceMs) break;
						}
					} catch (thrown) {
						finish(err(asStudioError(thrown, 'verify/missing-entry')));
						return;
					}
					cancel = scheduler.later(slice, 0);
				};
				cancel = scheduler.later(slice, 0);
			});
		},
	});
}
