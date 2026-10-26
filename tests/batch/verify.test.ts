/**
 * The scan check as a batch's default checker: the job each row becomes,
 * the report as a verdict and issues, the seed counts and samples each mode
 * chooses, and the real check run inside the batch's slices. Real checks run
 * at one seed here, which keeps each to a couple of seconds.
 */

import { describe, expect, it } from 'vitest';
import { parseCsv } from '../../src/batch/csv.js';
import { planBatch } from '../../src/batch/plan.js';
import { MAX_SAMPLES, SEEDS_ALL, SEEDS_SAMPLED, runBatch } from '../../src/batch/run.js';
import type { BatchRow, BatchVerifier, BatchVerifyRequest } from '../../src/batch/types.js';
import { reportResult, scanCheckJob, scanCheckVerifier } from '../../src/batch/verify.js';
import { defaultDesign } from '../../src/design/document.js';
import { buildScene } from '../../src/design/scene.js';
import type { QrDesignV1 } from '../../src/design/types.js';
import { encode } from '../../src/encode/encode.js';
import { verify } from '../../src/verify/job.js';
import { designRequirements } from '../../src/verify/prepare.js';
import type { VerifyJob, VerifyProgress, VerifyReport } from '../../src/verify/types.js';
import { assetOf, designWith, discImage } from '../design/helpers.js';
import { drain, registries } from './helpers.js';

const reg = registries();

function rows(count: number, longest?: number): readonly BatchRow[] {
	let csv = 'sku\n';
	for (let i = 0; i < count; i += 1)
		csv += i === longest ? `EX-${i}-LONGEST-OF-ALL\n` : `EX-${i}\n`;
	return planBatch(
		parseCsv(csv),
		{
			typeId: 'url',
			fields: { url: { template: 'https://example.com/p/{sku}' } },
			filename: '{sku}',
		},
		reg,
	);
}

function recorder(): { seen: BatchVerifyRequest[]; verifyRow: BatchVerifier } {
	const seen: BatchVerifyRequest[] = [];
	return {
		seen,
		verifyRow: (request) => {
			seen.push(request);
			return { verdict: 'pass' };
		},
	};
}

const request: BatchVerifyRequest = {
	index: 0,
	rowNumber: 2,
	content: 'https://example.com/p/EX-1',
	design: defaultDesign(),
	overlay: null,
	sizeMm: 30,
	dpi: 300,
	seed: 7,
	captureSeeds: 2,
	assets: {},
};

describe('scanCheckJob', () => {
	it('gives verify the content, the design as drawn, the size, the seed and what the design needs', () => {
		expect(scanCheckJob(request)).toEqual({
			content: 'https://example.com/p/EX-1',
			design: defaultDesign(),
			conditions: { sizeMm: 30, dpi: 300, distanceMm: null },
			seed: 7,
			requires: designRequirements(defaultDesign()),
			captureSeeds: 2,
			overlay: null,
		});
		const picture = discImage(8);
		const job = scanCheckJob({ ...request, overlay: 'swiss-cross', assets: { mark: picture } });
		expect(job.assets).toEqual({ mark: picture });
		expect(job.overlay).toBe('swiss-cross');
	});
});

describe('reportResult', () => {
	it('makes a failing check a warning in its own key, a warned one a note, and says when the clean capture failed', () => {
		const report = {
			verdict: 'fail',
			baseline: { passed: false, minMargin: null, seeds: 1 },
			checks: [
				{
					id: 'contrast',
					status: 'fail',
					measured: 0.1,
					threshold: 0.4,
					messageKey: 'verify.check.contrast.fail',
					params: { ratio: 1.2 },
				},
				{
					id: 'quiet-zone',
					status: 'pass',
					measured: 4,
					threshold: 4,
					messageKey: 'verify.check.quiet-zone.pass',
				},
				{
					id: 'module-size',
					status: 'warn',
					measured: 0,
					threshold: 0.3,
					messageKey: 'verify.check.module-size.unknown',
				},
			],
		} as unknown as VerifyReport;
		expect(reportResult(report)).toEqual({
			verdict: 'fail',
			issues: [
				{ code: 'verify.baseline.fail', path: ['check', 'baseline'], severity: 'warning' },
				{
					code: 'verify.check.contrast.fail',
					path: ['check', 'contrast'],
					severity: 'warning',
					params: { ratio: 1.2 },
				},
				{
					code: 'verify.check.module-size.unknown',
					path: ['check', 'module-size'],
					severity: 'info',
				},
			],
		});
		expect(
			reportResult({
				...report,
				verdict: 'pass',
				baseline: { passed: true, minMargin: 1, seeds: 1 },
				checks: [],
			}).issues,
		).toEqual([]);
	});
});

describe('scanCheckVerifier', () => {
	it('runs each job with the generator it is given, over the registries it is given', () => {
		const seen: { job: VerifyJob; registries: unknown }[] = [];
		function* stand(
			job: VerifyJob,
			registries: typeof reg,
		): Generator<VerifyProgress, VerifyReport> {
			seen.push({ job, registries });
			yield { done: 0, total: 1, axis: 'static' };
			return {
				verdict: 'fail',
				baseline: { passed: true, minMargin: 1, seeds: 1 },
				checks: [],
			} as unknown as VerifyReport;
		}
		const { outcomes } = drain(
			runBatch(rows(1), defaultDesign(), { kind: 'zip', format: 'svg' }, reg, {
				verifyRow: scanCheckVerifier(reg, stand),
			}),
		);
		expect(seen).toHaveLength(1);
		expect(seen[0]?.registries).toBe(reg);
		expect(seen[0]?.job.captureSeeds).toBe(SEEDS_ALL);
		expect(outcomes[0]?.check).toBe('fail');
	});
});

describe('seeds and samples', () => {
	it('checks every row at 2 seeds, a sample at 8, or as many as the output says', () => {
		for (const [verify, seeds] of [
			['all', SEEDS_ALL],
			['sampled', SEEDS_SAMPLED],
		] as const) {
			const { seen, verifyRow } = recorder();
			drain(
				runBatch(rows(3), defaultDesign(), { kind: 'zip', format: 'svg', verify }, reg, {
					verifyRow,
				}),
			);
			expect(seen.every((r) => r.captureSeeds === seeds)).toBe(true);
		}
		const { seen, verifyRow } = recorder();
		drain(
			runBatch(rows(2), defaultDesign(), { kind: 'zip', format: 'svg', verifySeeds: 3 }, reg, {
				verifyRow,
			}),
		);
		expect(seen.map((r) => r.captureSeeds)).toEqual([3, 3]);
		for (const verifySeeds of [0, 9, 1.5]) {
			expect(() =>
				runBatch(rows(1), defaultDesign(), { kind: 'zip', format: 'svg', verifySeeds }, reg),
			).toThrow(TypeError);
		}
	});

	it(`samples a large batch at most ${MAX_SAMPLES} rows and the longest, however large`, () => {
		const { seen, verifyRow } = recorder();
		drain(
			runBatch(
				rows(250, 101),
				defaultDesign(),
				{ kind: 'zip', format: 'svg', verify: 'sampled' },
				reg,
				{ verifyRow },
			),
		);
		// One in 25: 250 rows over ten samples.
		expect(seen.map((r) => r.rowNumber)).toEqual([
			2, 27, 52, 77, 102, 103, 127, 152, 177, 202, 227,
		]);
	});

	it('measures the symbol with its quiet zone from the scene, whatever the design measures', () => {
		const { seen, verifyRow } = recorder();
		const framed = designWith({
			frame: { ref: { id: 'rounded-card' } },
			output: { colourSpace: 'srgb', sizeMm: 40 },
		});
		const [row] = rows(1);
		drain(runBatch([row as BatchRow], framed, { kind: 'zip', format: 'pdf' }, reg, { verifyRow }));
		const symbol = encode(row?.content as string, { ecLevel: 'M' });
		const scene = buildScene(symbol, framed, { registries: reg.design }).scene;
		const expected = (symbol.matrix.width + 2 * framed.quietZone) / (scene.unitsPerMm as number);
		expect(seen[0]?.sizeMm).toBeCloseTo(expected, 9);
		expect(seen[0]?.sizeMm).toBeLessThan(40);
		expect(seen[0]?.design.output.sizeMm).toBe(40);
	});
});

describe('the real scan check', () => {
	it('is off without a checker, and refuses to be asked for without one', () => {
		const { outcomes } = drain(
			runBatch(rows(2), defaultDesign(), { kind: 'zip', format: 'svg' }, reg),
		);
		expect(outcomes.every((outcome) => outcome.check === null)).toBe(true);
		for (const verify of ['sampled', 'all'] as const) {
			expect(() =>
				runBatch(rows(1), defaultDesign(), { kind: 'zip', format: 'svg', verify }, reg),
			).toThrow(/scanCheckVerifier/);
		}
	});

	it('checks a small batch in full when given, a capture a slice, and agrees with verify run alone', () => {
		const batch = rows(1);
		const sized: QrDesignV1 = { ...defaultDesign(), output: { colourSpace: 'srgb', sizeMm: 30 } };
		const { outcomes, progress } = drain(
			runBatch(batch, sized, { kind: 'zip', format: 'pdf', verifySeeds: 1 }, reg, {
				verifyRow: scanCheckVerifier(reg),
			}),
		);
		const report = verify(
			scanCheckJob({
				...request,
				content: batch[0]?.content as string,
				design: sized,
				dpi: null,
				seed: 0,
				captureSeeds: 1,
			}),
			reg,
		);
		expect(outcomes[0]?.check).toBe(report.verdict);
		expect(outcomes[0]?.issues).toEqual([
			...(report.verdict === 'warn'
				? [{ code: 'batch.issue.check-warned', path: [], severity: 'info' }]
				: []),
			...(reportResult(report).issues ?? []),
		]);
		// Each capture was its own step, with no row finished yet.
		expect(progress.filter((event) => event.row === undefined).length).toBeGreaterThan(20);
	}, 30_000);

	it('fails a design phones cannot read, and says which check', () => {
		const faint = designWith({
			modules: { shape: { id: 'square' }, paint: { kind: 'solid', ink: '#d8d8d8' }, light: null },
		});
		const { outcomes } = drain(
			runBatch(rows(1), faint, { kind: 'zip', format: 'svg', verifySeeds: 1 }, reg, {
				verifyRow: scanCheckVerifier(reg),
			}),
		);
		expect(outcomes[0]?.check).toBe('fail');
		expect(outcomes[0]?.status).toBe('written');
		const codes = outcomes[0]?.issues.map((found) => found.code) ?? [];
		expect(codes[0]).toBe('batch.issue.check-failed');
		expect(codes.some((code) => code.startsWith('verify.check.contrast'))).toBe(true);
	}, 30_000);

	it('notes a check it cannot run when the design names a picture that would not decode', () => {
		const asset = assetOf(discImage(16));
		const png = Buffer.from(asset.png, 'base64');
		png[png.length - 20] = (png[png.length - 20] as number) ^ 0xff;
		const broken = designWith({
			symbol: { symbology: 'qr', ecLevel: 'H' },
			logo: {
				source: { kind: 'asset', id: 'mark' },
				size: 0.2,
				clear: 'box',
				padding: 1,
				plate: null,
			},
			assets: { mark: { ...asset, png: Buffer.from(png).toString('base64') } },
		});
		const { outcomes } = drain(
			runBatch(rows(1), broken, { kind: 'zip', format: 'svg' }, reg, {
				verifyRow: scanCheckVerifier(reg),
			}),
		);
		expect(outcomes[0]?.check).toBeNull();
		expect(outcomes[0]?.issues).toContainEqual({
			code: 'batch.issue.check-unavailable',
			path: [],
			severity: 'warning',
			params: { code: 'verify/missing-entry' },
		});
	});
});
