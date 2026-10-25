/**
 * The scan check as the studio drives it: debounced, its results tagged with
 * the revision they were made for and dropped once a newer run has started,
 * its progress reported, and nothing left running after dispose.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { QrStudioError } from '../../src/core/errors.js';
import { err, ok } from '../../src/core/result.js';
import { createRegistries } from '../../src/registries.js';
import { createStudio } from '../../src/studio/studio.js';
import type { Fix, VerifyJob, VerifyProgress, VerifyReport } from '../../src/studio/seams.js';
import {
	UNAVAILABLE_RUNNER,
	requiredEntries,
	slicedVerifyRunner,
} from '../../src/studio/verify.js';
import { defaultDesign } from '../../src/design/document.js';
import { logoPatches } from '../../src/studio/logo.js';
import { assetOf, discImage } from '../design/helpers.js';
import { FakeRunner, FakeTime, reportFor, settle, studioWith, studioWithCode } from './helpers.js';

afterEach(() => {
	vi.useRealTimers();
});

describe('verify/request', () => {
	it('waits out the debounce, and starts once however many requests arrive in it', async () => {
		const runner = new FakeRunner();
		const { studio, time } = studioWithCode({ verifyRunner: runner, verifyDebounceMs: 250 });
		studio.dispatch({ type: 'verify/request' });
		time.advance(200);
		studio.dispatch({ type: 'verify/request' });
		time.advance(200);
		expect(runner.runs).toHaveLength(0);
		expect(studio.getSnapshot().verify.status).toBe('idle');
		time.advance(50);
		expect(runner.runs).toHaveLength(1);
		const running = studio.getSnapshot().verify;
		expect(running).toEqual({ status: 'running', progress: 0, revision: 1, axis: null });
		runner.last.progress({ done: 3, total: 12, axis: 'focus' });
		expect(studio.getSnapshot().verify).toEqual({
			status: 'running',
			progress: 0.25,
			revision: 1,
			axis: 'focus',
		});
		runner.last.progress({ done: 0, total: 0, axis: 'static' });
		expect(studio.getSnapshot().verify).toMatchObject({ progress: 0 });
		runner.answer();
		await settle();
		const done = studio.getSnapshot().verify;
		expect(done.status).toBe('done');
		expect(done.status === 'done' && done.stale).toBe(false);
		expect(done.status === 'done' && done.revision).toBe(1);
	});

	it('hands the runner a job made from the content, the design as drawn and the conditions', () => {
		const runner = new FakeRunner();
		const { studio, time } = studioWithCode({ verifyRunner: runner, seed: 77 });
		studio.dispatch({ type: 'conditions', conditions: { sizeMm: 30, distanceMm: 400 } });
		studio.dispatch({ type: 'verify/request' });
		time.advance(250);
		const { job } = runner.last;
		expect(job.content).toBe('https://example.com/');
		expect(job.design).toBe(studio.getSnapshot().design.effective);
		expect(job.conditions).toEqual({ sizeMm: 30, dpi: null, distanceMm: 400 });
		expect(job.seed).toBe(77);
		expect(job.requires).toEqual(['module-shape:square', 'symbology:qr']);
		expect(job.assets).toBeUndefined();
		expect(job.overlay).toBeNull();
		// Structured-cloneable, so a website can post it to a worker.
		expect(structuredClone(job)).toEqual(job);
	});

	it('runs again after a change while it is on, cancelling the run in flight and dropping its answer', async () => {
		const runner = new FakeRunner();
		const { studio, time } = studioWithCode({ verifyRunner: runner });
		studio.dispatch({ type: 'verify/request' });
		time.advance(250);
		const first = runner.last;
		studio.dispatch({ type: 'payload/field', key: 'url', value: 'https://example.com/two' });
		expect(first.signal.aborted).toBe(true);
		expect(studio.getSnapshot().verify.status).toBe('idle');
		// The first runner ignores the abort and answers anyway: dropped.
		runner.answer(first, 'fail');
		await settle();
		expect(studio.getSnapshot().verify.status).toBe('idle');
		time.advance(250);
		expect(runner.runs).toHaveLength(2);
		expect(runner.last.job.content).toBe('https://example.com/two');
		runner.answer(runner.last, 'warn');
		await settle();
		const done = studio.getSnapshot().verify;
		expect(done.status === 'done' && done.report.verdict).toBe('warn');
		expect(done.status === 'done' && done.revision).toBe(2);
	});

	it('marks a report stale when what it checked changes, and keeps it for a change that does not matter', async () => {
		const runner = new FakeRunner();
		const { studio, time } = studioWithCode({ verifyRunner: runner });
		studio.dispatch({ type: 'verify/request' });
		time.advance(250);
		runner.answer();
		await settle();
		const done = studio.getSnapshot().verify;
		studio.dispatch({ type: 'mode', mode: 'scan' });
		expect(studio.getSnapshot().verify).toBe(done);
		studio.dispatch({ type: 'conditions', conditions: { sizeMm: 50 } });
		const stale = studio.getSnapshot().verify;
		expect(stale.status === 'done' && stale.stale).toBe(true);
		expect(stale.status === 'done' && done.status === 'done' && stale.report).toBe(
			done.status === 'done' && done.report,
		);
		studio.dispatch({ type: 'conditions', conditions: { sizeMm: 60 } });
		expect(studio.getSnapshot().verify).toBe(stale);
		time.advance(250);
		expect(runner.runs).toHaveLength(2);
		expect(studio.getSnapshot().verify.status).toBe('running');
		studio.dispatch({ type: 'conditions', conditions: { sizeMm: 70 } });
		expect(studio.getSnapshot().verify).toBe(stale);
	});

	it('does not run while there is no content, and runs once there is', () => {
		const runner = new FakeRunner();
		const { studio, time } = studioWith({ verifyRunner: runner });
		studio.dispatch({ type: 'verify/request' });
		time.advance(250);
		expect(runner.runs).toHaveLength(0);
		expect(studio.getSnapshot().verify.status).toBe('idle');
		studio.dispatch({ type: 'payload/field', key: 'url', value: 'https://example.com/' });
		time.advance(250);
		expect(runner.runs).toHaveLength(1);
	});

	it('stops on verify/cancel, keeping the last report as stale', async () => {
		const runner = new FakeRunner();
		const { studio, time } = studioWithCode({ verifyRunner: runner });
		studio.dispatch({ type: 'verify/request' });
		time.advance(250);
		runner.answer();
		await settle();
		studio.dispatch({ type: 'payload/field', key: 'url', value: 'https://example.com/b' });
		time.advance(250);
		const run = runner.last;
		studio.dispatch({ type: 'verify/cancel' });
		expect(run.signal.aborted).toBe(true);
		const after = studio.getSnapshot().verify;
		expect(after.status === 'done' && after.stale).toBe(true);
		// Off now: a change starts nothing.
		studio.dispatch({ type: 'payload/field', key: 'url', value: 'https://example.com/c' });
		time.advance(1000);
		expect(runner.runs).toHaveLength(2);
		// Cancelling with nothing running says nothing.
		const snapshot = studio.getSnapshot();
		studio.dispatch({ type: 'verify/cancel' });
		expect(studio.getSnapshot()).toBe(snapshot);
	});

	it('cancels a request still waiting out its debounce', () => {
		const runner = new FakeRunner();
		const { studio, time } = studioWithCode({ verifyRunner: runner });
		studio.dispatch({ type: 'verify/request' });
		studio.dispatch({ type: 'verify/cancel' });
		time.advance(1000);
		expect(runner.runs).toHaveLength(0);
		expect(time.pending).toBe(0);
	});

	it('reports a failed run, a cancelled one, a throwing runner and a rejecting one', async () => {
		const failing = {
			run: async () => err(new QrStudioError('verify/missing-entry', 'missing', { id: 'x' })),
		};
		let made = studioWithCode({ verifyRunner: failing });
		made.studio.dispatch({ type: 'verify/request' });
		made.time.advance(250);
		await settle();
		expect(made.studio.getSnapshot().verify).toEqual({
			status: 'failed',
			error: {
				code: 'verify/missing-entry',
				messageKey: 'error.verify.missing-entry',
				params: { id: 'x' },
			},
			revision: 1,
		});

		made = studioWithCode({
			verifyRunner: { run: async () => err(new QrStudioError('cancelled', 'stopped')) },
		});
		made.studio.dispatch({ type: 'verify/request' });
		made.time.advance(250);
		await settle();
		expect(made.studio.getSnapshot().verify.status).toBe('idle');

		made = studioWithCode({
			verifyRunner: {
				run: () => {
					throw new Error('a runner that throws');
				},
			},
		});
		made.studio.dispatch({ type: 'verify/request' });
		made.time.advance(250);
		await settle();
		expect(made.studio.getSnapshot().verify).toMatchObject({
			status: 'failed',
			error: { code: 'platform/unavailable' },
		});

		made = studioWithCode({ verifyRunner: { run: () => Promise.reject(new Error('rejected')) } });
		made.studio.dispatch({ type: 'verify/request' });
		made.time.advance(250);
		await settle();
		expect(made.studio.getSnapshot().verify.status).toBe('failed');
	});

	it('says the check is not in this build when it has no runner and no generator', async () => {
		const { studio, time } = studioWithCode();
		studio.dispatch({ type: 'verify/request' });
		time.advance(250);
		await settle();
		expect(studio.getSnapshot().verify).toMatchObject({
			status: 'failed',
			error: { code: 'platform/unavailable', params: { feature: 'verify' } },
		});
		expect(
			await UNAVAILABLE_RUNNER.run({} as VerifyJob, new AbortController().signal, () => undefined),
		).toMatchObject({
			ok: false,
		});
	});
});

describe('fixes', () => {
	const fix: Fix = {
		id: 'raise-level',
		labelKey: 'design.preset.classic-black',
		patch: { path: ['symbol', 'ecLevel'], value: 'H' },
	};

	it('offers the fixes verify suggests, and applies one as an undoable change', async () => {
		const runner = new FakeRunner();
		const { studio, time } = studioWithCode({
			verifyRunner: runner,
			suggestFixes: (report: VerifyReport) => (report.verdict === 'pass' ? [] : [fix]),
		});
		studio.dispatch({ type: 'verify/request' });
		time.advance(250);
		runner.answer(runner.last, 'fail');
		await settle();
		const done = studio.getSnapshot().verify;
		expect(done.status === 'done' && done.fixes).toEqual([fix]);
		studio.dispatch({ type: 'fix/apply', fixId: 'raise-level' });
		expect(studio.getSnapshot().document.design.symbol.ecLevel).toBe('H');
		studio.dispatch({ type: 'history/undo' });
		expect(studio.getSnapshot().document.design.symbol.ecLevel).toBe('M');
	});

	it('refuses a fix it was not offered', () => {
		const { studio } = studioWithCode();
		studio.dispatch({ type: 'fix/apply', fixId: 'raise-level' });
		expect(studio.getSnapshot().refusal?.issues[0]?.code).toBe('studio.issue.unknown-fix');
	});

	it('survives a suggester that throws, offering nothing', async () => {
		const runner = new FakeRunner();
		const { studio, time } = studioWithCode({
			verifyRunner: runner,
			suggestFixes: () => {
				throw new Error('broken');
			},
		});
		studio.dispatch({ type: 'verify/request' });
		time.advance(250);
		runner.answer();
		await settle();
		const done = studio.getSnapshot().verify;
		expect(done.status === 'done' && done.fixes).toEqual([]);
	});
});

function* steps(
	job: VerifyJob,
	count: number,
	cost: () => void,
): Generator<VerifyProgress, VerifyReport> {
	for (let i = 0; i < count; i += 1) {
		cost();
		yield { done: i + 1, total: count, axis: i === 0 ? 'static' : 'focus' };
	}
	return reportFor(job);
}

describe('the default runner: the generator in time slices', () => {
	it('steps the generator a slice at a time, giving the thread back between', async () => {
		const time = new FakeTime(8);
		let started = 0;
		const generator = (job: VerifyJob) => {
			started += 1;
			return steps(job, 10, () => (time.now += 3));
		};
		const studio = createStudio({ scheduler: time, clock: time.clock, verifyGenerator: generator });
		studio.dispatch({ type: 'payload/field', key: 'url', value: 'https://example.com/' });
		studio.dispatch({ type: 'verify/request' });
		time.advance(249);
		expect(started).toBe(0);
		// The first slice: three captures of 3 ms reach the 8 ms slice.
		time.advance(1);
		expect(started).toBe(1);
		expect(studio.getSnapshot().verify).toMatchObject({ status: 'running', progress: 0.3 });
		time.flush();
		expect(studio.getSnapshot().verify).toMatchObject({ progress: 0.6 });
		time.flush();
		expect(studio.getSnapshot().verify).toMatchObject({ progress: 0.9 });
		time.flush();
		await settle();
		expect(studio.getSnapshot().verify.status).toBe('done');
		expect(time.pending).toBe(0);
	});

	it('stops between captures when aborted and leaves no slice waiting', async () => {
		const time = new FakeTime(8);
		const registries = createRegistries();
		const runner = slicedVerifyRunner((job) => steps(job, 100, () => (time.now += 5)), {
			registries,
			scheduler: time,
			clock: time.clock,
		});
		const controller = new AbortController();
		const job = {
			content: 'x',
			design: defaultDesign(),
			conditions: { sizeMm: 25, dpi: null, distanceMm: null },
			seed: 1,
			requires: [],
		};
		const result = runner.run(job, controller.signal, () => undefined);
		time.flush();
		controller.abort();
		expect(time.pending).toBe(0);
		expect(await result).toMatchObject({ ok: false, error: { code: 'cancelled' } });
		// An already aborted signal starts nothing.
		const early = await runner.run(job, controller.signal, () => undefined);
		expect(early.ok).toBe(false);
		// A progress callback that aborts stops the run at once.
		const second = new AbortController();
		const aborted = runner.run(job, second.signal, () => second.abort());
		time.flush();
		expect(await aborted).toMatchObject({ ok: false });
	});

	it('reports a generator that throws, at the start or part way', async () => {
		const time = new FakeTime();
		const registries = createRegistries();
		const job = {
			content: 'x',
			design: defaultDesign(),
			conditions: { sizeMm: 25, dpi: null, distanceMm: null },
			seed: 1,
			requires: [],
		};
		const atStart = slicedVerifyRunner(
			() => {
				throw new QrStudioError('verify/missing-entry', 'missing');
			},
			{ registries, scheduler: time, clock: time.clock },
		);
		expect(await atStart.run(job, new AbortController().signal, () => undefined)).toMatchObject({
			ok: false,
			error: { code: 'verify/missing-entry' },
		});
		const partWay = slicedVerifyRunner(
			function* () {
				yield { done: 1, total: 2, axis: 'static' };
				throw new Error('broke');
			} as never,
			{ registries, scheduler: time, clock: time.clock },
		);
		const result = partWay.run(job, new AbortController().signal, () => undefined);
		time.flush();
		expect(await result).toMatchObject({ ok: false, error: { code: 'verify/missing-entry' } });
	});
});

describe('the entries a job requires', () => {
	it('names every registry entry the design draws with', () => {
		const registries = createRegistries();
		const design = {
			...defaultDesign(),
			background: { kind: 'entry' as const, ref: { id: 'two-tone-diagonal' } },
			modules: {
				shape: { id: 'dot' },
				paint: { kind: 'entry' as const, ref: { id: 'palette-scatter' } },
				light: { shape: { id: 'square' }, paint: { kind: 'solid' as const, ink: '#ffffff' } },
			},
			regions: {
				finder: {
					outer: { id: 'circle' },
					inner: { id: 'circle-centre' },
					outerPaint: { kind: 'entry' as const, ref: { id: 'palette-scatter' } },
				},
			},
			logo: {
				source: { kind: 'icon' as const, id: 'star' },
				size: 0.2,
				clear: 'box' as const,
				padding: 1,
				plate: null,
			},
			frame: {
				ref: { id: 'banner-bottom' },
				text: { content: 'Scan', fontId: 'plex-sans-regular' },
			},
		};
		expect(requiredEntries(design, registries)).toEqual([
			'fill:palette-scatter',
			'fill:two-tone-diagonal',
			'frame:banner-bottom',
			'icon:star',
			'module-shape:dot',
			'module-shape:square',
			'region-shape:circle',
			'region-shape:circle-centre',
			'symbology:qr',
		]);
		const picture = {
			...defaultDesign(),
			logo: {
				source: { kind: 'asset' as const, id: 'logo' },
				size: 0.2,
				clear: 'box' as const,
				padding: 1,
				plate: null,
			},
		};
		expect(requiredEntries(picture, registries)).toEqual(['module-shape:square', 'symbology:qr']);
	});

	it("names the overlay the content prints, so the worker draws the bill's cross too", async () => {
		const runner = new FakeRunner();
		const { studio, time } = studioWith({ verifyRunner: runner });
		const { swissQrBillType } = await import('../../src/payload/content/swiss-qr-bill.js');
		studio.dispatch({ type: 'payload/raw', text: swissQrBillType.vectors[0]?.text as string });
		studio.dispatch({ type: 'verify/request' });
		time.advance(250);
		expect(runner.last.job.overlay).toBe('swiss-cross');
		expect(runner.last.job.design).toBe(studio.getSnapshot().design.effective);
	});

	it("sends a design's pictures decoded, so a worker can rebuild the scene", () => {
		const runner = new FakeRunner();
		const { studio, time } = studioWithCode({ verifyRunner: runner });
		studio.dispatch({
			type: 'design/patch',
			patch: logoPatches(studio.getSnapshot().document.design, assetOf(discImage(8))),
		});
		studio.dispatch({ type: 'verify/request' });
		time.advance(250);
		expect(runner.last.job.assets?.logo?.width).toBe(8);
	});
});

describe('dispose', () => {
	it('leaves no timer running and no run going', async () => {
		const runner = new FakeRunner();
		const { studio, time } = studioWithCode({ verifyRunner: runner });
		studio.dispatch({ type: 'verify/request' });
		time.advance(250);
		studio.dispatch({ type: 'payload/field', key: 'url', value: 'https://example.com/again' });
		expect(time.pending).toBeGreaterThan(0);
		const run = runner.last;
		studio.dispose();
		expect(time.pending).toBe(0);
		expect(run.signal.aborted).toBe(true);
		studio.dispose();
		// What arrives after is ignored, and nothing new starts.
		runner.answer(run);
		await settle();
		const snapshot = studio.getSnapshot();
		studio.dispatch({ type: 'payload/field', key: 'url', value: 'https://example.com/late' });
		expect(studio.getSnapshot()).toBe(snapshot);
		expect(studio.subscribe(() => undefined)).toBeTypeOf('function');
		expect(await studio.run({ type: 'design-link' })).toMatchObject({
			ok: false,
			error: { code: 'cancelled' },
		});
	});

	it('leaves no real timer behind, with the default scheduler', async () => {
		vi.useFakeTimers();
		const generator = (job: VerifyJob) => steps(job, 1000, () => undefined);
		const studio = createStudio({ verifyGenerator: generator, clock: () => 0 });
		studio.dispatch({ type: 'payload/field', key: 'url', value: 'https://example.com/' });
		studio.dispatch({ type: 'verify/request' });
		expect(vi.getTimerCount()).toBe(1);
		vi.advanceTimersByTime(250);
		// The clock never moves, so each slice runs every capture; a slow one would yield.
		expect(studio.getSnapshot().verify.status).toBe('running');
		studio.dispatch({ type: 'payload/field', key: 'url', value: 'https://example.com/b' });
		expect(vi.getTimerCount()).toBeGreaterThan(0);
		studio.dispose();
		expect(vi.getTimerCount()).toBe(0);
	});
});

describe('the default runner, with ok results', () => {
	it('is what a website wraps: the same generator, the same report', async () => {
		const time = new FakeTime();
		const registries = createRegistries();
		const runner = slicedVerifyRunner((job) => steps(job, 2, () => undefined), {
			registries,
			scheduler: time,
			clock: time.clock,
		});
		const job = {
			content: 'x',
			design: defaultDesign(),
			conditions: { sizeMm: 25, dpi: null, distanceMm: null },
			seed: 3,
			requires: [],
		};
		const seen: VerifyProgress[] = [];
		const result = runner.run(job, new AbortController().signal, (p) => seen.push(p));
		time.flush();
		expect(await result).toEqual(ok(reportFor(job)));
		expect(seen.map((p) => p.done)).toEqual([1, 2]);
	});
});

describe('the default clock', () => {
	it('is performance.now, or Date.now where there is no performance', async () => {
		for (const withPerformance of [true, false]) {
			vi.useFakeTimers();
			if (!withPerformance) vi.stubGlobal('performance', undefined);
			const studio = createStudio({ verifyGenerator: (job) => steps(job, 3, () => undefined) });
			studio.dispatch({ type: 'payload/field', key: 'url', value: 'https://example.com/' });
			studio.dispatch({ type: 'verify/request' });
			vi.advanceTimersByTime(300);
			vi.useRealTimers();
			await settle();
			expect(studio.getSnapshot().verify.status).toBe('done');
			vi.unstubAllGlobals();
			studio.dispose();
		}
	});
});
