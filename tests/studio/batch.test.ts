/**
 * The batch command: a spreadsheet in, a ZIP or a sheet out, made in time
 * slices with the person's design, its progress in the snapshot, and every
 * failure a Result. The bytes are the batch layer's own, so the same rows
 * give the same file whether the studio or runBatch makes it.
 */

import iconv from 'iconv-lite';
import { describe, expect, it, vi } from 'vitest';
import { QrStudioError } from '../../src/core/errors.js';
import { parseCsv } from '../../src/batch/csv.js';
import { planBatch } from '../../src/batch/plan.js';
import { runBatch } from '../../src/batch/run.js';
import type { BatchOutput, CsvFallbackEncoding } from '../../src/batch/types.js';
import { createRegistries } from '../../src/registries.js';
import { createFontRegistry } from '../../src/text/registry.js';
import { driveInSlices } from '../../src/studio/slices.js';
import type { Studio, StudioCommand } from '../../src/studio/types.js';
import type { VerifyJob, VerifyProgress, VerifyReport } from '../../src/studio/seams.js';
import { createStudio } from '../../src/studio/studio.js';
import { FakeTime, reportFor, settle, studioWith } from './helpers.js';

const CSV = 'name,link\nOne,https://example.com/1\nTwo,https://example.com/2\nBad,not a link\n';
const MAPPING = { typeId: 'url', fields: { url: { column: 'link' } }, filename: '{name}' };
const ZIP: BatchOutput = { kind: 'zip', format: 'svg' };

/**
 * A studio without the scan check. These tests are about the batch itself;
 * with a check, a batch of two rows is checked in full by default, which is
 * seconds of real captures a row.
 */
function quiet() {
	return studioWith({ verifyGenerator: null });
}

/** Run a command to the end, moving the fake clock as the slices ask. */
async function finish<T>(time: FakeTime, pending: Promise<T>): Promise<T> {
	let done = false;
	void pending.then(
		() => (done = true),
		() => (done = true),
	);
	for (let i = 0; i < 10_000 && !done; i += 1) {
		time.advance(1);
		await settle();
	}
	return pending;
}

function batch(studio: Studio, overrides: Partial<Extract<StudioCommand, { type: 'batch' }>> = {}) {
	return studio.run({ type: 'batch', csv: CSV, mapping: MAPPING, output: ZIP, ...overrides });
}

describe('the batch command', () => {
	it('makes a ZIP, byte for byte what the batch layer makes, with progress on the way', async () => {
		const { studio, time } = quiet();
		studio.dispatch({ type: 'design/shuffle', seed: 6 });
		const states: string[] = [];
		studio.subscribe(() => {
			const state = studio.getSnapshot().batch;
			states.push(state.status === 'running' ? `${state.done}/${state.total}` : state.status);
		});
		const result = await finish(time, batch(studio));
		if (!result.ok) throw result.error;
		const registries = createRegistries();
		const rows = planBatch(parseCsv(CSV), MAPPING, registries);
		const steps = runBatch(rows, studio.getSnapshot().document.design, ZIP, registries, {
			fonts: createFontRegistry(),
			seed: 1,
		});
		let step = steps.next();
		while (step.done !== true) step = steps.next();
		expect(Buffer.from(result.value).equals(Buffer.from(step.value))).toBe(true);
		expect(Array.from(result.value.slice(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]);
		expect(states[0]).toBe('0/4');
		expect(states).toContain('3/4');
		expect(states[states.length - 1]).toBe('done');
		const done = studio.getSnapshot().batch;
		expect(done.status === 'done' && [done.written, done.skipped]).toEqual([2, 1]);
		expect(done.status === 'done' && done.outcomes.map((row) => row.status)).toEqual([
			'written',
			'written',
			'skipped',
		]);
	});

	it('reads a spreadsheet given as bytes, saying how it was encoded', async () => {
		const { studio, time } = quiet();
		const text = 'link\nhttps://example.com/1\n';
		const utf16 = new Uint8Array(2 + text.length * 2);
		utf16[0] = 0xff;
		utf16[1] = 0xfe;
		for (let i = 0; i < text.length; i += 1) utf16[2 + i * 2] = text.charCodeAt(i);
		const result = await finish(
			time,
			batch(studio, { csv: utf16, mapping: { ...MAPPING, filename: 'code' } }),
		);
		expect(result.ok).toBe(true);
		const done = studio.getSnapshot().batch;
		expect(done.status === 'done' && done.issues.map((found) => found.code)).toContain(
			'batch.csv.utf-16',
		);
	});

	it('reads bytes that are not UTF-8 in its fallback, and a command can choose another', async () => {
		const mapping = { ...MAPPING, filename: '{name}' };
		const japanese = new Uint8Array(
			iconv.encode('name,link\r\n\u898b\u672c,https://example.com/1\r\n', 'shift_jis'),
		);
		const chinese = new Uint8Array(
			iconv.encode('name,link\r\n\u793a\u4f8b,https://example.com/1\r\n', 'gb18030'),
		);
		const read = async (
			studio: Studio,
			time: FakeTime,
			csv: Uint8Array,
			encoding?: 'auto' | CsvFallbackEncoding,
		) => {
			const result = await finish(
				time,
				batch(studio, { csv, mapping, ...(encoding === undefined ? {} : { encoding }) }),
			);
			expect(result.ok).toBe(true);
			const done = studio.getSnapshot().batch;
			if (done.status !== 'done') throw new Error('the batch did not finish');
			const fallback = done.issues.find((found) => found.code === 'batch.csv.fallback-encoding');
			return { names: done.outcomes.map((row) => row.filename), encoding: fallback?.params };
		};

		const { studio, time } = studioWith({
			verifyGenerator: null,
			csvFallbackEncoding: 'shift_jis',
		});
		expect(await read(studio, time, japanese)).toEqual({
			names: ['\u898b\u672c.svg'],
			encoding: { encoding: 'shift_jis' },
		});
		expect(await read(studio, time, chinese, 'gb18030')).toEqual({
			names: ['\u793a\u4f8b.svg'],
			encoding: { encoding: 'gb18030' },
		});
		// 'auto' is the studio's own fallback again.
		expect((await read(studio, time, japanese, 'auto')).names).toEqual(['\u898b\u672c.svg']);
		// Text needs no fallback, whatever the command says.
		const text = await finish(time, batch(studio, { encoding: 'big5' }));
		expect(text.ok).toBe(true);

		// A studio told nothing reads Windows-1252, as before.
		const plain = quiet();
		expect((await read(plain.studio, plain.time, japanese)).encoding).toEqual({
			encoding: 'windows-1252',
		});
	});

	it('refuses an encoding it does not know, as a mistake by its caller', async () => {
		expect(() => createStudio({ csvFallbackEncoding: 'latin1' as never })).toThrow(TypeError);
		expect(() => createStudio({ csvFallbackEncoding: 'Shift_JIS' as never })).toThrow(TypeError);
		const { studio } = quiet();
		await expect(batch(studio, { encoding: 'utf-8' as never })).rejects.toThrow(TypeError);
		expect(studio.getSnapshot().batch.status).toBe('idle');
	});

	it('fails with its own sentence when this browser cannot read the encoding', async () => {
		const Real = TextDecoder;
		class Utf8Only extends Real {
			constructor(label?: string, options?: TextDecoderOptions) {
				if (label !== 'utf-8') throw new RangeError(`The "${label}" encoding is not supported`);
				super(label, options);
			}
		}
		vi.stubGlobal('TextDecoder', Utf8Only);
		try {
			const { studio } = studioWith({ verifyGenerator: null, csvFallbackEncoding: 'euc-kr' });
			const korean = new Uint8Array(
				iconv.encode('name,link\r\n\uc608\uc2dc,https://example.com/1\r\n', 'euc-kr'),
			);
			const result = await batch(studio, { csv: korean });
			expect(!result.ok && result.error.code).toBe('platform/unavailable');
			expect(studio.getSnapshot().batch).toMatchObject({
				status: 'failed',
				error: {
					code: 'platform/unavailable',
					messageKey: 'batch.encoding-unavailable',
					params: { feature: 'text-encoding', encoding: 'euc-kr' },
				},
			});
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it('fails with the reason for a file it cannot read or a column it does not have', async () => {
		const { studio } = quiet();
		const broken = await batch(studio, { csv: 'link\n"https://example.com/' });
		expect(!broken.ok && broken.error.code).toBe('batch/malformed-csv');
		expect(studio.getSnapshot().batch).toMatchObject({
			status: 'failed',
			error: { code: 'batch/malformed-csv' },
		});
		const missing = await batch(studio, {
			mapping: { ...MAPPING, fields: { url: { column: 'nowhere' } } },
		});
		expect(!missing.ok && missing.error.code).toBe('batch/unknown-column');
	});

	it("refuses a mapping that is not one, as a caller's mistake", async () => {
		const { studio } = quiet();
		await expect(batch(studio, { mapping: { ...MAPPING, filename: 5 as never } })).rejects.toThrow(
			TypeError,
		);
	});

	it('reports a design the batch layer refuses as a failed run', async () => {
		const { studio, time } = quiet();
		const result = await finish(
			time,
			batch(studio, { output: { kind: 'sheet', template: 'no-such-sheet', colourSpace: 'srgb' } }),
		);
		expect(result.ok).toBe(false);
		expect(studio.getSnapshot().batch.status).toBe('failed');
	});

	it('stops the run before when a new one starts, and stops on dispose', async () => {
		const { studio, time } = quiet();
		const first = batch(studio);
		const second = batch(studio);
		const [a, b] = await finish(time, Promise.all([first, second]));
		expect(!a.ok && a.error.code).toBe('cancelled');
		expect(b.ok).toBe(true);
		const third = batch(studio);
		await settle();
		studio.dispose();
		const c = await finish(time, third);
		expect(!c.ok && c.error.code).toBe('cancelled');
		expect(time.pending).toBe(0);
	});

	it('leaves the snapshot to the newer run when an older one fails late', async () => {
		const { studio, time } = quiet();
		const first = batch(studio, {
			output: { kind: 'sheet', template: 'no-such-sheet', colourSpace: 'srgb' },
		});
		const second = batch(studio);
		await finish(time, Promise.all([first, second]));
		expect(studio.getSnapshot().batch.status).toBe('done');
	});
});

describe('checking the rows', () => {
	it('checks each row with the generator the studio was given', async () => {
		const jobs: VerifyJob[] = [];
		function* fake(job: VerifyJob): Generator<VerifyProgress, VerifyReport> {
			jobs.push(job);
			yield { done: 0, total: 1, axis: 'static' };
			return reportFor(job, job.content.endsWith('/2') ? 'fail' : 'pass');
		}
		const { studio, time } = studioWith({ verifyGenerator: fake });
		const result = await finish(time, batch(studio));
		expect(result.ok).toBe(true);
		const done = studio.getSnapshot().batch;
		if (done.status !== 'done') throw new Error('the batch did not finish');
		expect(done.outcomes.map((row) => row.check)).toEqual(['pass', 'fail', null]);
		expect(done.outcomes[1]?.issues.map((found) => found.code)).toEqual([
			'batch.issue.check-failed',
		]);
		// A small batch is checked in full, at the 2 seeds a row 'all' uses.
		expect(jobs.map((job) => job.captureSeeds)).toEqual([2, 2]);
		expect(jobs[0]?.conditions.sizeMm).toBeNull();
	});

	it('checks nothing when the studio has no scan check', async () => {
		const { studio, time } = quiet();
		await finish(time, batch(studio));
		const done = studio.getSnapshot().batch;
		expect(done.status === 'done' && done.outcomes.map((row) => row.check)).toEqual([
			null,
			null,
			null,
		]);
		const asked = await finish(time, batch(studio, { output: { ...ZIP, verify: 'all' } }));
		expect(!asked.ok && asked.error).toMatchObject({
			code: 'platform/unavailable',
			params: { feature: 'verify' },
		});
		expect(studio.getSnapshot().batch.status).toBe('failed');
		// Asking for none is not asking for the check.
		expect((await finish(time, batch(studio, { output: { ...ZIP, verify: 'off' } }))).ok).toBe(
			true,
		);
	});

	it('reaches real verdicts with the default scan check, at one seed', async () => {
		const time = new FakeTime(8);
		// Each reading spends fake time, so a slice moves the scheduler on and
		// each `advance` below runs two or three slices, not the whole batch.
		const clock = (): number => (time.now += 4);
		const studio = createStudio({ scheduler: time, clock });
		const pending = batch(studio, {
			csv: 'name,link\nOne,https://example.com/1\n',
			output: { kind: 'zip', format: 'pdf', sizeMm: 30, verifySeeds: 1 },
		});
		let settled = false;
		void pending.then(() => (settled = true));
		for (let i = 0; i < 50_000 && !settled; i += 1) {
			time.advance(24);
			await settle();
			// Hand the event loop a turn between batches of slices, so the check
			// does not starve vitest's worker channel under coverage.
			await new Promise<void>((resolve) => setImmediate(resolve));
		}
		const result = await pending;
		expect(result.ok).toBe(true);
		const done = studio.getSnapshot().batch;
		if (done.status !== 'done') throw new Error('the batch did not finish');
		expect(done.outcomes[0]?.check).toMatch(/^(pass|warn)$/);
		studio.dispose();
	}, 300_000);
});

describe('the slice driver', () => {
	const signal = () => new AbortController().signal;

	it('rejects with a TypeError, which is a bug, and reports anything else', async () => {
		const time = new FakeTime();
		const typeError = driveInSlices(
			function* () {
				yield 1;
				throw new TypeError('a bug');
			},
			{
				scheduler: time,
				clock: time.clock,
				signal: signal(),
				progress: () => undefined,
				failure: 'platform/unavailable',
			},
		);
		time.flush();
		await expect(typeError).rejects.toThrow(TypeError);
		const atStart = driveInSlices(
			() => {
				throw new QrStudioError('design/invalid', 'bad');
			},
			{
				scheduler: time,
				clock: time.clock,
				signal: signal(),
				progress: () => undefined,
				failure: 'platform/unavailable',
			},
		);
		expect(await atStart).toMatchObject({ ok: false, error: { code: 'design/invalid' } });
		const other = driveInSlices(
			function* () {
				yield 0;
				throw new RangeError('odd');
			},
			{
				scheduler: time,
				clock: time.clock,
				signal: signal(),
				progress: () => undefined,
				failure: 'platform/unavailable',
			},
		);
		time.flush();
		expect(await other).toMatchObject({ ok: false, error: { code: 'platform/unavailable' } });
	});
});
