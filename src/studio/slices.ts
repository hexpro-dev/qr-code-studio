/**
 * Driving a long generator on this thread a slice at a time.
 *
 * The scan check and a batch run are both generators that do one unit of
 * work (a capture, a row) per `next()`, because this package has no worker
 * of its own: Chrome refuses a blob worker under file://. This steps one for
 * about `scheduler.sliceMs`, then hands the thread back until the scheduler
 * calls again, which keeps typing and scrolling responsive while it runs. An
 * abort stops it between units and cancels the waiting slice, so nothing is
 * left on the clock.
 *
 * A QrStudioError, or anything else a generator throws, ends the run as a
 * failed Result. A TypeError is a bug rather than something a person did, so
 * it rejects the promise instead, which is how it reaches a developer: a
 * throw inside a timer would reach nobody.
 */

import { CancelledError } from '../core/errors.js';
import type { QrStudioErrorCode } from '../core/errors.js';
import { err, ok } from '../core/result.js';
import type { Result } from '../core/result.js';
import { asStudioError } from './keys.js';
import type { Scheduler } from './types.js';

export interface SliceOptions<P> {
	readonly scheduler: Scheduler;
	readonly clock: () => number;
	readonly signal: AbortSignal;
	readonly progress: (p: P) => void;
	/** The code a failure is reported under when what was thrown is not a QrStudioError. */
	readonly failure: QrStudioErrorCode;
}

export function driveInSlices<P, R>(
	start: () => Generator<P, R>,
	options: SliceOptions<P>,
): Promise<Result<R>> {
	const { scheduler, clock, signal, progress, failure } = options;
	return new Promise((resolve, reject) => {
		let cancel: (() => void) | null = null;
		let finished = false;
		// Reached once: the abort listener is removed here, and the slice loop
		// stops at the first sign of `finished`.
		const end = (): void => {
			finished = true;
			signal.removeEventListener('abort', onAbort);
			cancel?.();
			cancel = null;
		};
		const finish = (result: Result<R>): void => {
			end();
			resolve(result);
		};
		const thrown = (error: unknown): void => {
			end();
			if (error instanceof TypeError) reject(error);
			else resolve(err(asStudioError(error, failure)));
		};
		const onAbort = (): void => finish(err(new CancelledError()));
		if (signal.aborted) {
			finish(err(new CancelledError()));
			return;
		}
		signal.addEventListener('abort', onAbort);
		let steps: Generator<P, R>;
		try {
			steps = start();
		} catch (error) {
			thrown(error);
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
			} catch (error) {
				thrown(error);
				return;
			}
			cancel = scheduler.later(slice, 0);
		};
		cancel = scheduler.later(slice, 0);
	});
}
