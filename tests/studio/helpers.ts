/**
 * What the studio tests share: a scheduler and clock that only move when a
 * test says so, a scan check runner whose answers a test controls, a report
 * to answer with, and a studio built from them.
 */

import { ok } from '../../src/core/result.js';
import type { Result } from '../../src/core/result.js';
import { createStudio } from '../../src/studio/studio.js';
import type {
	VerifyJob,
	VerifyProgress,
	VerifyReport,
	VerifyRunner,
} from '../../src/studio/seams.js';
import type { Scheduler, Studio, StudioOptions } from '../../src/studio/types.js';

/** Time that passes only when `advance` is called, and timers that fire on it. */
export class FakeTime implements Scheduler {
	now = 0;
	readonly sliceMs: number;
	private readonly tasks: { at: number; task: () => void; order: number }[] = [];
	private order = 0;

	constructor(sliceMs = 8) {
		this.sliceMs = sliceMs;
	}

	readonly clock = (): number => this.now;

	later(task: () => void, delayMs: number): () => void {
		const entry = { at: this.now + delayMs, task, order: (this.order += 1) };
		this.tasks.push(entry);
		return () => {
			const at = this.tasks.indexOf(entry);
			if (at !== -1) this.tasks.splice(at, 1);
		};
	}

	/** Timers waiting to fire. */
	get pending(): number {
		return this.tasks.length;
	}

	/** Move time on by `ms`, firing every timer that falls due, in order. */
	advance(ms: number): void {
		const end = this.now + ms;
		for (;;) {
			this.tasks.sort((a, b) => a.at - b.at || a.order - b.order);
			const next = this.tasks[0];
			if (next === undefined || next.at > end) break;
			this.tasks.shift();
			this.now = Math.max(this.now, next.at);
			next.task();
		}
		// A task may have moved the clock on itself, as a slow capture does.
		this.now = Math.max(this.now, end);
	}

	/** Fire everything due now and anything those schedule at zero delay. */
	flush(): void {
		this.advance(0);
	}
}

/** A finished report for `job`, as a verify layer would make it. */
export function reportFor(job: VerifyJob, verdict: VerifyReport['verdict'] = 'pass'): VerifyReport {
	return {
		schema: 1,
		profile: 'strict-v1',
		seed: job.seed,
		verdict,
		symbol: {
			symbology: job.design.symbol.symbology,
			version: '2',
			ecLevel: 'M',
			mask: 0,
			modules: [25, 25],
		},
		conditions: job.conditions,
		checks: [],
		blocks: [],
		captures: [],
		limits: { maxDistanceMm: null, minModuleMm: null, inkFraction: 1 },
	};
}

/** One run the fake runner was asked for, and the means to answer it. */
export interface PendingRun {
	readonly job: VerifyJob;
	readonly signal: AbortSignal;
	readonly progress: (p: VerifyProgress) => void;
	resolve(result: Result<VerifyReport>): void;
}

/** A runner that waits until the test answers each run. */
export class FakeRunner implements VerifyRunner {
	readonly runs: PendingRun[] = [];

	run(
		job: VerifyJob,
		signal: AbortSignal,
		progress: (p: VerifyProgress) => void,
	): Promise<Result<VerifyReport>> {
		return new Promise((resolve) => {
			this.runs.push({ job, signal, progress, resolve });
		});
	}

	get last(): PendingRun {
		const found = this.runs[this.runs.length - 1];
		if (found === undefined) throw new Error('the runner has not been asked for anything');
		return found;
	}

	answer(run: PendingRun = this.last, verdict: VerifyReport['verdict'] = 'pass'): void {
		run.resolve(ok(reportFor(run.job, verdict)));
	}
}

/** Let promise callbacks run. */
export async function settle(): Promise<void> {
	for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

export function studioWith(options: StudioOptions = {}): { studio: Studio; time: FakeTime } {
	const time = new FakeTime();
	const studio = createStudio({ scheduler: time, clock: time.clock, ...options });
	return { studio, time };
}

/** A studio with a valid link in it, so it has a code. */
export function studioWithCode(
	options: StudioOptions = {},
	url = 'https://example.com/',
): { studio: Studio; time: FakeTime } {
	const made = studioWith(options);
	made.studio.dispatch({ type: 'payload/field', key: 'url', value: url });
	return made;
}
