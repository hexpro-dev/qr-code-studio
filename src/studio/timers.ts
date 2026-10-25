/**
 * Every timer a studio starts, kept track of, so `dispose` can stop them all.
 *
 * A studio is made and thrown away by a view (a React component mounting
 * twice in development, a route left), and a debounce or a time slice still
 * waiting after that would run against a studio nobody holds, and keep the
 * page's work alive. So every timer goes through here, `cancelAll` stops the
 * lot, and a task whose timer was cancelled never runs, even under a
 * scheduler whose own cancel came too late.
 */

import type { Scheduler } from './types.js';

export interface TrackedScheduler extends Scheduler {
	/** Timers started and not yet run or cancelled. */
	readonly pending: number;
	cancelAll(): void;
}

export function trackedScheduler(base: Scheduler): TrackedScheduler {
	const live = new Set<() => void>();
	return {
		sliceMs: base.sliceMs,
		get pending() {
			return live.size;
		},
		later(task: () => void, delayMs: number): () => void {
			const cancel = (): void => {
				if (live.delete(cancel)) inner();
			};
			const inner = base.later(() => {
				if (live.delete(cancel)) task();
			}, delayMs);
			live.add(cancel);
			return cancel;
		},
		cancelAll(): void {
			for (const cancel of [...live]) cancel();
		},
	};
}
