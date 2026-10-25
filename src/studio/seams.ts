/**
 * The shapes of the layers the studio drives that are still being written,
 * the scan check (verify) and the inspector, and the seam the print writers
 * come in through.
 *
 * Each is copied from docs/CONTRACTS.md so the studio can be typed, wired
 * and tested against it now, with the real layer injected through an option
 * and a fake standing in for it in the tests. When a layer merges, its types
 * replace the copies here (`SEAM(verify)` and `SEAM(inspect)` mark each one)
 * and the option's default becomes the real function.
 */

import type { Result } from '../core/result.js';
import type { RgbaImage } from '../core/image.js';
import type { Issue, MessageKey } from '../core/issue.js';
import type { DesignOverlay, QrDesignV1 } from '../design/types.js';
import type { FieldValue, UrlAnalysis } from '../payload/types.js';
import type { DecodeOptions, Point } from '../decode/types.js';
import type { EpsOptions } from '../render/eps.js';
import type { PdfOptions } from '../render/pdf.js';
import type { Scene } from '../render/types.js';
import type { DecodedBitstream, DecodedSegment, EcLevel } from '../segment/types.js';
import type { Registries } from '../registries.js';

// SEAM(verify): from the verify layer once it merges.

export type CaptureAxis =
	'distance' | 'focus' | 'motion' | 'noise' | 'angle' | 'light' | 'glare' | 'ink' | 'contrast';

/** Every capture axis, in the contract's order, for a view that labels them. */
export const CAPTURE_AXES: readonly CaptureAxis[] = Object.freeze([
	'distance',
	'focus',
	'motion',
	'noise',
	'angle',
	'light',
	'glare',
	'ink',
	'contrast',
]);

export interface VerifyConditions {
	/** Printed width of the symbol including its quiet zone. */
	readonly sizeMm: number | null;
	/** For screen use, or for a raster export. */
	readonly dpi: number | null;
	/** The furthest a person is expected to scan from. */
	readonly distanceMm: number | null;
}

/** Structured-cloneable, so a website can post it to a worker. The worker re-encodes from it. */
export interface VerifyJob {
	readonly content: string;
	readonly design: QrDesignV1;
	readonly conditions: VerifyConditions;
	readonly seed: number;
	/** Registry ids the design uses, as `kind:id`; a worker missing one refuses. */
	readonly requires: readonly string[];
	readonly assets?: Readonly<Record<string, RgbaImage>>;
	/** What the content prints over the code, as applyConstraints returns it, for the worker's scene. */
	readonly overlay?: DesignOverlay | null;
}

export interface VerifyProgress {
	readonly done: number;
	readonly total: number;
	readonly axis: CaptureAxis | 'static';
}

export type CheckId =
	| 'quiet-zone'
	| 'contrast'
	| 'polarity'
	| 'function-patterns'
	| 'logo-budget'
	| 'module-size'
	| 'finder-shape'
	| 'colour-red-channel'
	| 'reader-support';

/** Every check id, in the contract's order. */
export const CHECK_IDS: readonly CheckId[] = Object.freeze([
	'quiet-zone',
	'contrast',
	'polarity',
	'function-patterns',
	'logo-budget',
	'module-size',
	'finder-shape',
	'colour-red-channel',
	'reader-support',
]);

export interface VerifyCheck {
	readonly id: CheckId;
	readonly status: 'pass' | 'warn' | 'fail';
	readonly measured: number;
	readonly threshold: number;
	readonly grade?: 'SC' | 'MOD' | 'FPD' | 'UEC';
	readonly messageKey: MessageKey;
}

export interface VerifyReport {
	readonly schema: 1;
	readonly profile: 'strict-v1';
	readonly seed: number;
	readonly verdict: 'pass' | 'warn' | 'fail';
	readonly symbol: {
		readonly symbology: string;
		readonly version: string;
		readonly ecLevel: EcLevel;
		readonly mask: number;
		readonly modules: readonly [number, number];
	};
	readonly conditions: VerifyConditions;
	readonly checks: readonly VerifyCheck[];
	readonly blocks: readonly {
		readonly index: number;
		readonly ec: number;
		readonly p: number;
		readonly t: number;
		readonly coveredWorst: number;
		readonly coveredExpected: number;
		readonly margin: number;
	}[];
	readonly captures: readonly {
		readonly axis: CaptureAxis;
		readonly worstPassed: number | null;
		readonly firstFailed: number | null;
		readonly minMargin: number | null;
		readonly seeds: number;
	}[];
	readonly limits: {
		readonly maxDistanceMm: number | null;
		readonly minModuleMm: number | null;
		readonly inkFraction: number;
	};
}

/** A shallow, path-addressed change: `{ path: ['modules', 'shape'], value: { id: 'dot' } }`. */
export interface DesignPatch {
	readonly path: readonly (string | number)[];
	readonly value: unknown;
}

export interface Fix {
	readonly id: string;
	readonly labelKey: MessageKey;
	readonly patch: DesignPatch;
}

/** Runs one job to its report. The website's runs it in a worker; the default runs the generator here. */
export interface VerifyRunner {
	run(
		job: VerifyJob,
		signal: AbortSignal,
		progress: (p: VerifyProgress) => void,
	): Promise<Result<VerifyReport>>;
}

/** verify's `runVerifyJob`, the generator a runner drives one capture at a time. */
export type VerifyGenerator = (
	job: VerifyJob,
	registries: Registries,
) => Generator<VerifyProgress, VerifyReport>;

/** verify's `suggestFixes`. */
export type FixSuggester = (report: VerifyReport, design: QrDesignV1) => readonly Fix[];

// SEAM(inspect): from the inspect layer once it merges.

export interface InspectedSymbol {
	readonly symbology: string;
	readonly version: string;
	readonly ecLevel: EcLevel;
	readonly mask: number;
	readonly corners: readonly Point[];
	readonly segments: readonly DecodedSegment[];
	readonly text: string;
	readonly textSource: DecodedBitstream['textSource'];
	readonly structuredAppend: {
		readonly index: number;
		readonly total: number;
		readonly parity: number;
	} | null;
	readonly gs1: readonly { readonly ai: string; readonly value: string }[] | null;
	readonly quality: {
		readonly errorsPerBlock: readonly number[];
		readonly capacityPerBlock: readonly number[];
		readonly erasuresUsed: number;
		readonly formatErrors: number;
		readonly mirrored: boolean;
		readonly inverted: boolean;
		readonly minConfidence: number;
	};
}

export interface InspectReport {
	readonly symbols: readonly InspectedSymbol[];
	readonly sets: readonly {
		readonly parity: number;
		readonly complete: boolean;
		readonly text: string | null;
		readonly missing: readonly number[];
	}[];
	readonly payload: {
		readonly typeId: string;
		readonly value: Readonly<Record<string, FieldValue>>;
		readonly issues: readonly Issue[];
	} | null;
	readonly safety: UrlAnalysis | null;
}

/** inspect's `inspectImage` and `inspectText`, together. */
export interface Inspector {
	image(image: RgbaImage, registries: Registries, options?: DecodeOptions): Result<InspectReport>;
	text(text: string, registries: Registries): InspectReport;
}

// The print writers, render's `sceneToPdf` and `sceneToEps`, as one seam so a
// caller can pass its own (the studio defaults to render's).

/** render's `sceneToPdf` and `sceneToEps`, together. */
export interface Printer {
	pdf(scene: Scene, options: PdfOptions): Uint8Array;
	eps(scene: Scene, options: EpsOptions): string;
}

export type { DecodeOptions, EpsOptions, PdfOptions, Point };
export type { BatchMapping, BatchOutcome, BatchOutput } from '../batch/types.js';
