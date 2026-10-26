/**
 * Presets under the scan check: the smallest print size each one scans at,
 * and the verifier the conformance gate plugs into `checkPreset`.
 *
 * A preset promises that a design works, so it is checked with three
 * contents (a short link, a link with a path and a query, and a long one)
 * because a design that suits a version 2 symbol can fail at version 7,
 * where the same logo or shape meets more, smaller modules. "Scans at a
 * size" means: nothing fails, the clean captures read, every axis holds up
 * to its everyday level, and the print size check itself passes. Warnings
 * about the design as such (light on dark, red ink) do not depend on the
 * size and are left to the full report.
 */

import { presetSizeMm } from '../design/preset-size.js';
import type { Preset, DesignRegistries } from '../design/types.js';
import type { EcLevel } from '../segment/types.js';
import { createSymbologyRegistry } from '../symbology/registry.js';
import { CAMERA, minModuleMm, pxPerModuleAt } from './camera.js';
import { LADDERS, framingPxPerModule } from './ladders.js';
import type { RunOptions } from './job.js';
import { runPrepared } from './job.js';
import { prepare } from './prepare.js';
import type { CaptureAxis, VerifyRegistries, VerifyReport } from './types.js';

/** The contents every preset is calibrated and gated with: synthetic, as every test content is. */
export const PRESET_CONTENT = Object.freeze({
	small: 'https://example.com/',
	medium: 'https://example.com/menu/table-12?from=poster',
	large:
		'https://example.com/events/2026/spring-market/stall-holders/register?ref=window-poster&lang=en-AU&utm_source=print',
});

export type ContentSize = keyof typeof PRESET_CONTENT;

/**
 * The margin added to the smallest size that passed, to make `minSizeMm`:
 * a tenth of it, and at least two millimetres. Print shops trim and scale,
 * and eight seeded captures are a sample of the photographs people take,
 * not all of them.
 */
export function withMargin(passedMm: number): number {
	return Math.ceil(passedMm + Math.max(2, passedMm * 0.1));
}

/** Whether a report counts as scanning at its size, in the sense above. */
/**
 * A shortfall a preset is known to have at every size: an axis that gives
 * out before its everyday level, or the clean capture itself, measured and
 * recorded (tests/verify/shortfalls.ts) so the gate holds the preset to
 * everything else and notices the day it is no longer true.
 */
export type Shortfall = CaptureAxis | 'baseline';

export function scansAtSize(report: VerifyReport, allowed: readonly Shortfall[] = []): boolean {
	if (report.checks.some((check) => check.status === 'fail')) return false;
	if (!report.baseline.passed && !allowed.includes('baseline')) return false;
	if (report.checks.some((check) => check.id === 'module-size' && check.status !== 'pass')) {
		return false;
	}
	// Levels grow with severity on every axis (distance in millimetres from
	// the camera), so failing at or before the typical level is <=.
	return report.captures.every(
		(capture) =>
			allowed.includes(capture.axis) ||
			capture.firstFailed === null ||
			capture.firstFailed > capture.typical,
	);
}

/** What a report falls short on at its everyday levels: the axes, and the clean capture. */
export function shortfalls(report: VerifyReport): Shortfall[] {
	const out: Shortfall[] = report.baseline.passed ? [] : ['baseline'];
	for (const capture of report.captures) {
		if (capture.firstFailed !== null && capture.firstFailed <= capture.typical)
			out.push(capture.axis);
	}
	return out;
}

export interface PresetRunOptions extends RunOptions {
	/** Seeded captures per level, 1 to 8. */
	readonly seeds?: number;
	/** Seed for the job: the same for every size, so sizes differ only in size. */
	readonly seed?: number;
	/** Shortfalls each preset is known to have at every size, by preset id. */
	readonly known?: Readonly<Record<string, readonly Shortfall[]>>;
	/** The level to calibrate at; default the preset's own. */
	readonly ecLevel?: EcLevel;
}

/**
 * The options a preset's runs take: with a recorded distance shortfall, the
 * distance axis is left out. Its refusal would otherwise feed the print size
 * check (a design that seems to need ten pixels a module asks for a print
 * large enough to hold ten comfortably), so the size would grow to cover the
 * very shortfall the record exists to keep visible. Without the axis, the
 * size check assumes what any reader needs.
 */
export function presetOptions(preset: Preset, options: PresetRunOptions): PresetRunOptions {
	if (!(options.known?.[preset.id] ?? []).includes('distance')) return options;
	const axes = (options.axes ?? LADDERS.map((ladder) => ladder.axis)).filter(
		(axis) => axis !== 'distance',
	);
	return { ...options, axes };
}

/** The report for one preset, content and level at one size. */
export function presetReport(
	preset: Preset,
	content: string,
	sizeMm: number,
	ecLevel: EcLevel,
	registries: VerifyRegistries,
	options: PresetRunOptions = {},
): VerifyReport {
	const design = { ...preset.design, symbol: { ...preset.design.symbol, ecLevel } };
	const prepared = prepare(
		{
			content,
			design,
			conditions: { sizeMm, dpi: null, distanceMm: null },
			seed: options.seed ?? 1,
			requires: [],
			captureSeeds: options.seeds ?? 8,
		},
		registries,
	);
	const run = runPrepared(prepared, presetOptions(preset, options));
	for (;;) {
		const step = run.next();
		if (step.done === true) return step.value;
	}
}

export interface Calibration {
	readonly id: string;
	/** The level the sizes are for. A contract addition. */
	readonly level: EcLevel;
	/** The smallest size, in whole millimetres, at which each content scanned; null when none did up to the limit. */
	readonly passedMm: Readonly<Record<ContentSize, number | null>>;
	/** The largest of those plus the margin; null when any content never scanned. */
	readonly minSizeMm: number | null;
}

/** The most the climb ever goes to, in millimetres. */
export const CALIBRATION_LIMIT_MM = 120;

/**
 * The size past which a larger print changes nothing but the distances in
 * millimetres: the phone no longer has to stay back to focus, so every
 * capture is the same picture. A design still failing there fails at every
 * size. `modulesAcross` is the code and its quiet zone, which the phone
 * frames and the size measures.
 */
export function saturationMm(modulesAcross: number): number {
	const framing = framingPxPerModule(modulesAcross, null);
	return Math.ceil((framing / pxPerModuleAt(1, CAMERA.minFocusMm)) * modulesAcross);
}

/** The smallest whole millimetre size, of `modulesAcross` modules, a phone can resolve a module at, at all. */
export function floorMm(modulesAcross: number): number {
	return Math.max(5, Math.floor(minModuleMm() * modulesAcross));
}

/**
 * The smallest whole millimetre size at which `preset` scans with each
 * content at its own level (or `options.ecLevel`), climbing 1 mm at a time from the smallest size a
 * phone can resolve at all. A content that still fails one millimetre past
 * the size where larger stops helping (see `saturationMm`) never passes, and
 * nor does any larger content after it.
 */
export function calibratePreset(
	preset: Preset,
	registries: VerifyRegistries,
	options: PresetRunOptions = {},
): Calibration {
	const level = options.ecLevel ?? preset.design.symbol.ecLevel ?? 'M';
	const passed: Record<ContentSize, number | null> = { small: null, medium: null, large: null };
	let from = 0;
	for (const size of ['small', 'medium', 'large'] as const) {
		const probe = prepare(
			{
				content: PRESET_CONTENT[size],
				design: { ...preset.design, symbol: { ...preset.design.symbol, ecLevel: level } },
				conditions: { sizeMm: null, dpi: null, distanceMm: null },
				seed: 1,
				requires: [],
			},
			registries,
		);
		const across = probe.symbol.matrix.width + 2 * probe.quietZone;
		const last = Math.min(CALIBRATION_LIMIT_MM, saturationMm(across) + 1);
		const known = options.known?.[preset.id] ?? [];
		for (let mm = Math.max(from, floorMm(across)); mm <= last; mm += 1) {
			const report = presetReport(preset, PRESET_CONTENT[size], mm, level, registries, options);
			if (scansAtSize(report, known)) {
				passed[size] = mm;
				from = mm;
				break;
			}
		}
		if (passed[size] === null) break;
	}
	const values = Object.values(passed);
	if (values.some((value) => value === null)) {
		return { id: preset.id, level, passedMm: passed, minSizeMm: null };
	}
	// The reader is not monotonic in size below saturation (a capture at a
	// few more pixels a module can read worse), so the size with its margin is
	// confirmed with every content, and raised a millimetre at a time until it
	// passes: the preset must pass at the size it records.
	for (
		let mm = withMargin(Math.max(...(values as number[])));
		mm <= CALIBRATION_LIMIT_MM;
		mm += 1
	) {
		const known = options.known?.[preset.id] ?? [];
		const all = (['small', 'medium', 'large'] as const).every((size) =>
			scansAtSize(
				presetReport(preset, PRESET_CONTENT[size], mm, level, registries, options),
				known,
			),
		);
		if (all) return { id: preset.id, level, passedMm: passed, minSizeMm: mm };
	}
	return { id: preset.id, level, passedMm: passed, minSizeMm: null };
}

/** What the conformance gate collects: the same shape as its own `Violation`. */
export interface PresetViolation {
	readonly entry: string;
	readonly rule: string;
	readonly detail: string;
}

export interface PresetVerifierOptions extends PresetRunOptions {
	/** Every level the preset allows, or only the level its design asks for. Default 'design'. */
	readonly levels?: 'design' | 'all';
}

/**
 * The strict scan check as `checkPreset`'s hook: every content at the
 * preset's own level and size (or at every level it allows, each at its own
 * size, `presetSizeMm`).
 */
export function presetVerifier(
	options: PresetVerifierOptions = {},
): (preset: Preset, registries: DesignRegistries) => readonly PresetViolation[] {
	return (preset, design) => {
		const registries: VerifyRegistries = { symbologies: createSymbologyRegistry(), design };
		const levels =
			options.levels === 'all' ? preset.ecLevels : [preset.design.symbol.ecLevel ?? 'M'];
		const out: PresetViolation[] = [];
		for (const level of levels) {
			for (const size of ['small', 'medium', 'large'] as const) {
				const sizeMm = presetSizeMm(preset, level);
				const report = presetReport(
					preset,
					PRESET_CONTENT[size],
					sizeMm,
					level,
					registries,
					options,
				);
				if (!scansAtSize(report, options.known?.[preset.id])) {
					out.push({
						entry: preset.id,
						rule: 'scan-check',
						detail: `${size} content at level ${level} does not scan at ${sizeMm} mm: ${describe(report)}`,
					});
				}
			}
		}
		return out;
	};
}

/** What went wrong, for a developer reading a test failure. */
export function describe(report: VerifyReport): string {
	const parts: string[] = [];
	if (!report.baseline.passed) parts.push('the clean capture did not read');
	for (const check of report.checks)
		if (check.status === 'fail') parts.push(`${check.messageKey} failed`);
	const size = report.checks.find((check) => check.id === 'module-size');
	if (size !== undefined && size.status === 'warn') parts.push(`${size.messageKey} warned`);
	for (const capture of report.captures) {
		if (capture.firstFailed !== null && capture.firstFailed <= capture.typical) {
			parts.push(`${capture.axis} failed at ${capture.firstFailed} (typical ${capture.typical})`);
		}
	}
	return parts.length === 0 ? 'no reason recorded' : parts.join('; ');
}
