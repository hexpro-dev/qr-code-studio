/**
 * The scan check, from a job to a report.
 *
 * `runVerifyJob` checks the job and prepares it at once, so a job this copy
 * cannot run is refused when it is handed over rather than on the first
 * slice of work, and returns a generator the caller drives in time slices:
 * the first `next()` makes the static checks, and every one after it makes
 * and reads one capture. The website wraps the same generator in a module
 * worker of its own; this package starts no worker, because Chrome blocks
 * them under file://.
 *
 * The captures, axis by axis:
 *
 * - The baseline: a clean photograph at everyday framing, once per seed. If
 *   any seed of it fails the design does not scan, whatever else is true.
 * - Each axis climbs its ladder from the mildest level. Every seed must pass
 *   a level for it to count, and the first level any seed fails is where the
 *   axis stops: the levels after it are not tried, and nothing past it is
 *   claimed. So `worstPassed` is the last level of an unbroken run of passes
 *   from the mildest, which is the only kind of pass worth reporting.
 *
 * Nothing here reads a clock, so the same job and seed give the same report
 * in every engine and on every run.
 */

import type { RgbaImage } from '../core/image.js';
import { CAMERA, distanceFor, minModuleMm, pxPerModuleAt } from './camera.js';
import type { CaptureSpec } from './capture.js';
import { renderCapture } from './capture.js';
import type { BlockCoverage } from './coverage.js';
import { LADDERS, framingPxPerModule } from './ladders.js';
import type { AxisLadder } from './ladders.js';
import type { Master, Prepared } from './prepare.js';
import {
	MASTER_PX_PER_MODULE,
	MAX_MASTER_PX_PER_MODULE,
	prepare,
	renderMaster,
} from './prepare.js';
import type { CaptureRead } from './read.js';
import { strictRead } from './read.js';
import type { StaticResult } from './static.js';
import { makeCheck, staticChecks } from './static.js';
import type {
	Baseline,
	CaptureAxis,
	CheckStatus,
	VerifyCapture,
	VerifyCheck,
	VerifyJob,
	VerifyProgress,
	VerifyRegistries,
	VerifyReport,
} from './types.js';

/** One capture, drawn the first time its picture is asked for. */
export interface Capture {
	readonly image: RgbaImage;
}

/**
 * How a capture is read: the strict profile, or a stand-in a test supplies.
 * The picture is drawn only if the reader looks at it, so a stand-in that
 * answers from the spec alone costs nothing.
 */
export type CaptureReader = (
	capture: Capture,
	prepared: Prepared,
	spec: CaptureSpec,
) => CaptureRead;

const strictReader: CaptureReader = (capture, prepared) => strictRead(capture.image, prepared);

/** A capture whose picture is drawn on first use. */
function lazyCapture(master: () => Master, prepared: Prepared, spec: CaptureSpec): Capture {
	let image: RgbaImage | undefined;
	return {
		get image(): RgbaImage {
			const { scene } = prepared.built;
			image ??= renderCapture(master(), scene.width, scene.height, prepared.job.seed, spec).image;
			return image;
		},
	};
}

export interface RunOptions {
	readonly reader?: CaptureReader;
	/**
	 * Stop each axis once its typical level has passed, rather than climbing
	 * on to find where it fails. For the conformance gate, which asks only
	 * whether a design passes everyday conditions.
	 */
	readonly stopAtTypical?: boolean;
	/**
	 * Try each axis at its typical level alone, not the milder levels before
	 * it. Cheaper again, for the conformance gate; it trusts that a level
	 * milder than one that passed would pass too, which the full check does
	 * not.
	 */
	readonly onlyTypical?: boolean;
	/** Only these axes, in their usual order. Default all of them. */
	readonly axes?: readonly CaptureAxis[];
}

/** One axis as this job climbs it: levels mildest first, and which of them is typical. */
export interface PlannedAxis {
	readonly ladder: AxisLadder;
	/** In the ladder's unit; for distance, pixels a module. */
	readonly levels: readonly number[];
	/** Index into `levels` of the everyday level, which every plan has. */
	readonly typical: number;
}

/** The ladders for this job: distance needs a printed size, and the expected distance joins its ladder. */
export function planAxes(
	prepared: Prepared,
	framing: number,
	axes?: readonly CaptureAxis[],
): PlannedAxis[] {
	const planned: PlannedAxis[] = [];
	for (const ladder of LADDERS) {
		if (axes !== undefined && !axes.includes(ladder.axis)) continue;
		if (ladder.axis !== 'distance') {
			planned.push({
				ladder,
				levels: ladder.levels,
				typical: ladder.levels.indexOf(ladder.typical),
			});
			continue;
		}
		const { moduleMm } = prepared;
		if (moduleMm === null) continue;
		const { distanceMm } = prepared.conditions;
		// From the everyday framing outwards; the expected distance becomes a
		// level of its own so the verdict is about exactly that distance.
		const wanted =
			distanceMm === null
				? CAMERA.minPxPerModule
				: Math.min(framing, pxPerModuleAt(moduleMm, distanceMm));
		const levels = [framing, ...ladder.levels.filter((ppm) => ppm < framing)];
		if (!levels.includes(wanted)) levels.push(wanted);
		levels.sort((a, b) => b - a);
		planned.push({ ladder, levels, typical: levels.indexOf(wanted) });
	}
	return planned;
}

interface AxisOutcome {
	/** Index of the last level of the unbroken run of passes, or -1. */
	readonly passed: number;
	/** Index of the first level a seed failed, or -1. */
	readonly failed: number;
	readonly minMargin: number | null;
	readonly seeds: number;
}

interface Totals {
	done: number;
	readonly total: number;
}

function* climb(
	prepared: Prepared,
	master: () => Master,
	plan: PlannedAxis,
	framing: number,
	options: RunOptions,
	totals: Totals,
	outcomes: Map<CaptureAxis, AxisOutcome>,
): Generator<VerifyProgress, void> {
	const reader = options.reader ?? strictReader;
	const { axis } = plan.ladder;
	let passed = -1;
	let failed = -1;
	let minMargin: number | null = null;
	let tried = 0;
	const typicalOnly = options.onlyTypical === true;
	const last =
		options.stopAtTypical === true || typicalOnly ? plan.typical : plan.levels.length - 1;
	for (let index = typicalOnly ? plan.typical : 0; index <= last && failed < 0; index += 1) {
		const level = plan.levels[index] as number;
		for (let seed = 0; seed < prepared.seeds; seed += 1) {
			const spec: CaptureSpec = {
				axis,
				level,
				seed,
				pxPerModule: axis === 'distance' ? level : framing,
			};
			const read = reader(lazyCapture(master, prepared, spec), prepared, spec);
			tried += 1;
			totals.done += 1;
			if (read.read) {
				minMargin =
					minMargin === null ? (read.margin as number) : Math.min(minMargin, read.margin as number);
			} else failed = index;
			yield { done: totals.done, total: totals.total, axis };
			if (failed >= 0) break;
		}
		if (failed < 0) passed = index;
	}
	// The captures not made still count towards the total, so progress ends where it said it would.
	totals.done += plan.levels.length * prepared.seeds - tried;
	outcomes.set(axis, { passed, failed, minMargin, seeds: prepared.seeds });
}

/** The master's resolution: half as fine again as the finest capture, within bounds. */
export function masterResolution(framing: number): number {
	return Math.min(
		MAX_MASTER_PX_PER_MODULE,
		Math.max(MASTER_PX_PER_MODULE, Math.ceil(1.5 * framing)),
	);
}

/** The whole check over a prepared job. */
export function* runPrepared(
	prepared: Prepared,
	options: RunOptions = {},
): Generator<VerifyProgress, VerifyReport> {
	const reader = options.reader ?? strictReader;
	const across = prepared.symbol.matrix.width + 2 * prepared.quietZone;
	const framing = framingPxPerModule(across, prepared.moduleMm);
	const plans = planAxes(prepared, framing, options.axes);
	const total =
		1 + prepared.seeds + plans.reduce((sum, plan) => sum + plan.levels.length * prepared.seeds, 0);
	const totals: Totals = { done: 0, total };

	const statics = staticChecks(prepared, renderMaster(prepared, MASTER_PX_PER_MODULE, false));
	totals.done += 1;
	yield { done: totals.done, total, axis: 'static' };

	let drawn: Master | undefined;
	const master = (): Master => {
		drawn ??= renderMaster(prepared, masterResolution(framing));
		return drawn;
	};
	let baselinePassed = true;
	let baselineMargin: number | null = null;
	let baselineTried = 0;
	for (let seed = 0; seed < prepared.seeds; seed += 1) {
		const spec: CaptureSpec = { axis: 'baseline', level: 0, seed, pxPerModule: framing };
		const read = reader(lazyCapture(master, prepared, spec), prepared, spec);
		baselineTried += 1;
		totals.done += 1;
		if (read.read) {
			baselineMargin =
				baselineMargin === null
					? (read.margin as number)
					: Math.min(baselineMargin, read.margin as number);
		} else baselinePassed = false;
		yield { done: totals.done, total, axis: 'static' };
		if (!baselinePassed) break;
	}
	totals.done += prepared.seeds - baselineTried;

	const outcomes = new Map<CaptureAxis, AxisOutcome>();
	for (const plan of plans) {
		yield* climb(prepared, master, plan, framing, options, totals, outcomes);
	}
	return assemble(prepared, statics, plans, outcomes, {
		passed: baselinePassed,
		minMargin: baselineMargin,
		seeds: baselineTried,
	});
}

function round(value: number, places: 1 | 2): number {
	const scale = places === 1 ? 10 : 100;
	return Math.round(value * scale) / scale;
}

/** A level as the report gives it: distance in whole millimetres, everything else as it is. */
function reported(plan: PlannedAxis, index: number, moduleMm: number | null): number | null {
	if (index < 0) return null;
	const level = plan.levels[index] as number;
	if (plan.ladder.axis !== 'distance') return level;
	return Math.round(distanceFor(moduleMm as number, level));
}

/** The report: the checks with module size added, the blocks, each axis, and the verdict. */
export function assemble(
	prepared: Prepared,
	statics: StaticResult,
	plans: readonly PlannedAxis[],
	outcomes: ReadonlyMap<CaptureAxis, AxisOutcome>,
	baseline: Baseline,
): VerifyReport {
	const { moduleMm, conditions, symbol } = prepared;
	const captures: VerifyCapture[] = plans.map((plan) => {
		const outcome = outcomes.get(plan.ladder.axis) as AxisOutcome;
		return {
			axis: plan.ladder.axis,
			worstPassed: reported(plan, outcome.passed, moduleMm),
			firstFailed: reported(plan, outcome.failed, moduleMm),
			minMargin: outcome.minMargin,
			seeds: outcome.seeds,
			typical: reported(plan, plan.typical, moduleMm) as number,
		};
	});

	// What the distance captures say about the module: the fewest pixels a
	// module of an unbroken run from the framing level, and never fewer than
	// a reader needs.
	const distancePlan = plans.find((plan) => plan.ladder.axis === 'distance');
	let needed: number | null = null;
	if (distancePlan !== undefined) {
		const outcome = outcomes.get('distance') as AxisOutcome;
		needed =
			outcome.passed < 0
				? Number.POSITIVE_INFINITY
				: Math.max(CAMERA.minPxPerModule, distancePlan.levels[outcome.passed] as number);
	} else if (moduleMm !== null) {
		// Not measured (a run without the distance axis): what any reader needs.
		needed = CAMERA.minPxPerModule;
	}
	const minModule = needed === null || !Number.isFinite(needed) ? null : minModuleMm(needed);
	const maxDistance =
		moduleMm === null || needed === null
			? null
			: Number.isFinite(needed)
				? distanceFor(moduleMm, needed)
				: 0;

	const checks: VerifyCheck[] = [];
	for (const check of statics.checks) {
		checks.push(check);
		if (check.id === 'logo-budget') checks.push(moduleSizeCheck(prepared, maxDistance, needed));
	}

	const blocks = statics.coverage.blocks.map((block: BlockCoverage) => ({
		index: block.index,
		ec: block.ec,
		p: block.p,
		t: block.t,
		coveredWorst: block.coveredWorst,
		coveredExpected: block.coveredExpected,
		margin: block.margin,
	}));

	let verdict: CheckStatus = 'pass';
	if (checks.some((check) => check.status === 'warn')) verdict = 'warn';
	for (const plan of plans) {
		const outcome = outcomes.get(plan.ladder.axis) as AxisOutcome;
		if (outcome.failed >= 0 && outcome.failed <= plan.typical) verdict = 'warn';
	}
	if (!baseline.passed || checks.some((check) => check.status === 'fail')) verdict = 'fail';

	return {
		schema: 1,
		profile: 'strict-v1',
		seed: prepared.job.seed,
		verdict,
		symbol: {
			symbology: symbol.symbology,
			version: symbol.version,
			ecLevel: symbol.ecLevel,
			mask: symbol.mask,
			modules: [symbol.matrix.width, symbol.matrix.height],
		},
		conditions,
		checks,
		blocks,
		captures,
		limits: {
			maxDistanceMm: maxDistance === null ? null : Math.round(maxDistance),
			minModuleMm: minModule === null ? null : round(minModule, 2),
			inkFraction: prepared.built.inkFraction,
		},
		baseline,
	};
}

/**
 * Module size: whether a phone can focus close enough to see each module at
 * the pixels this design needs, and how far away it still scans from.
 */
function moduleSizeCheck(
	prepared: Prepared,
	maxDistance: number | null,
	needed: number | null,
): VerifyCheck {
	const { moduleMm, conditions } = prepared;
	if (moduleMm === null || maxDistance === null || needed === null) {
		return makeCheck('module-size', 'warn', 0, minModuleMm(), 'verify.check.module-size.unknown');
	}
	const threshold = Number.isFinite(needed) ? minModuleMm(needed) : Number.POSITIVE_INFINITY;
	const sizeMm = conditions.sizeMm as number;
	const params: Record<string, number> = {
		sizeMm: round(sizeMm, 1),
		moduleMm: round(moduleMm, 2),
		distanceCm: Math.round(maxDistance / 10),
	};
	if (!Number.isFinite(threshold)) {
		return makeCheck('module-size', 'fail', moduleMm, 0, 'verify.check.module-size.unread', params);
	}
	// The size scales with the module, whatever the size measures.
	const minimum = Math.ceil((sizeMm * threshold) / moduleMm);
	if (moduleMm < threshold) {
		return makeCheck('module-size', 'fail', moduleMm, threshold, 'verify.check.module-size.fail', {
			...params,
			minimumMm: minimum,
		});
	}
	const expected = conditions.distanceMm;
	if (expected !== null && maxDistance < expected) {
		return makeCheck('module-size', 'warn', moduleMm, threshold, 'verify.check.module-size.short', {
			...params,
			expectedCm: Math.round(expected / 10),
			minimumMm: Math.ceil((sizeMm * expected) / maxDistance),
		});
	}
	if (maxDistance < CAMERA.comfortMm) {
		return makeCheck(
			'module-size',
			'warn',
			moduleMm,
			threshold,
			'verify.check.module-size.close',
			params,
		);
	}
	return makeCheck(
		'module-size',
		'pass',
		moduleMm,
		threshold,
		'verify.check.module-size.pass',
		params,
	);
}

/** Drive it in time slices: each `next()` does one capture. */
export function runVerifyJob(
	job: VerifyJob,
	registries: VerifyRegistries,
): Generator<VerifyProgress, VerifyReport> {
	return runPrepared(prepare(job, registries));
}

/** The whole check at once. */
export function verify(job: VerifyJob, registries: VerifyRegistries): VerifyReport {
	const run = runVerifyJob(job, registries);
	for (;;) {
		const step = run.next();
		if (step.done === true) return step.value;
	}
}
