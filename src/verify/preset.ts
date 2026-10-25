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

import type { Preset, DesignRegistries } from '../design/types.js';
import type { EcLevel } from '../segment/types.js';
import { createSymbologyRegistry } from '../symbology/registry.js';
import { CAMERA, minModuleMm, pxPerModuleAt } from './camera.js';
import { framingPxPerModule } from './ladders.js';
import type { RunOptions } from './job.js';
import { runPrepared } from './job.js';
import { prepare } from './prepare.js';
import type { VerifyRegistries, VerifyReport } from './types.js';

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
export function scansAtSize(report: VerifyReport): boolean {
	// A failed check or a failed clean capture already makes the verdict fail.
	if (report.verdict === 'fail') return false;
	if (report.checks.some((check) => check.id === 'module-size' && check.status !== 'pass')) {
		return false;
	}
	// Levels grow with severity on every axis (distance in millimetres from
	// the camera), so failing at or before the typical level is <=.
	return report.captures.every(
		(capture) => capture.firstFailed === null || capture.firstFailed > capture.typical,
	);
}

export interface PresetRunOptions extends RunOptions {
	/** Seeded captures per level, 1 to 8. */
	readonly seeds?: number;
	/** Seed for the job: the same for every size, so sizes differ only in size. */
	readonly seed?: number;
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
	const run = runPrepared(prepared, options);
	for (;;) {
		const step = run.next();
		if (step.done === true) return step.value;
	}
}

export interface Calibration {
	readonly id: string;
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
 * frames; `sizedModules` is what the size measures, in modules.
 */
export function saturationMm(modulesAcross: number, sizedModules = modulesAcross): number {
	const framing = framingPxPerModule(modulesAcross, null);
	return Math.ceil((framing / pxPerModuleAt(1, CAMERA.minFocusMm)) * sizedModules);
}

/** The smallest whole millimetre size, of `sizedModules` modules, a phone can resolve a module at, at all. */
export function floorMm(sizedModules: number): number {
	return Math.max(5, Math.floor(minModuleMm() * sizedModules));
}

/**
 * The smallest whole millimetre size at which `preset` scans with each
 * content at its own level, climbing 1 mm at a time from the smallest size a
 * phone can resolve at all. A content that still fails one millimetre past
 * the size where larger stops helping (see `saturationMm`) never passes, and
 * nor does any larger content after it.
 */
export function calibratePreset(
	preset: Preset,
	registries: VerifyRegistries,
	options: PresetRunOptions = {},
): Calibration {
	const level = preset.design.symbol.ecLevel ?? 'M';
	const passed: Record<ContentSize, number | null> = { small: null, medium: null, large: null };
	let from = 0;
	for (const size of ['small', 'medium', 'large'] as const) {
		// Sizes are of what the design measures (the whole artwork unless it
		// says the symbol), which can be wider than the code a phone frames.
		const probe = prepare(
			{
				content: PRESET_CONTENT[size],
				design: { ...preset.design, symbol: { ...preset.design.symbol, ecLevel: level } },
				conditions: { sizeMm: 100, dpi: null, distanceMm: null },
				seed: 1,
				requires: [],
			},
			registries,
		);
		const across = probe.symbol.matrix.width + 2 * probe.quietZone;
		const sized = 100 / (probe.moduleMm as number);
		const last = Math.min(CALIBRATION_LIMIT_MM, saturationMm(across, sized) + 1);
		for (let mm = Math.max(from, floorMm(sized)); mm <= last; mm += 1) {
			if (scansAtSize(presetReport(preset, PRESET_CONTENT[size], mm, level, registries, options))) {
				passed[size] = mm;
				from = mm;
				break;
			}
		}
		if (passed[size] === null) break;
	}
	const values = Object.values(passed);
	return {
		id: preset.id,
		passedMm: passed,
		minSizeMm: values.some((value) => value === null)
			? null
			: withMargin(Math.max(...(values as number[]))),
	};
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
 * The strict scan check as `checkPreset`'s hook: every content, at
 * `minSizeMm`, at the preset's own level (or every level it allows).
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
				const report = presetReport(
					preset,
					PRESET_CONTENT[size],
					preset.minSizeMm,
					level,
					registries,
					options,
				);
				if (!scansAtSize(report)) {
					out.push({
						entry: preset.id,
						rule: 'scan-check',
						detail: `${size} content at level ${level} does not scan at ${preset.minSizeMm} mm: ${describe(report)}`,
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
