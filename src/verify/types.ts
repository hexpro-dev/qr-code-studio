/**
 * The public shape of the scan check, as docs/CONTRACTS.md (`verify`) gives
 * it.
 *
 * Additions to the contract, each optional or new so a caller written to the
 * contract alone still works, and each listed in the branch report:
 *
 * - `VerifyRegistries` is what verify needs from the root `createRegistries()`
 *   bag: the symbologies and the design registries. The root bag satisfies it
 *   structurally.
 * - `VerifyJob.captureSeeds` lowers the number of seeded captures per level
 *   from eight, for the conformance gate. The report records the count used
 *   in `captures[].seeds`, which the contract already carries.
 * - `VerifyCheck.params`: the numbers a check's sentence uses, rounded for
 *   reading, the way an `Issue` carries them. Without them a sentence such as
 *   "Scans from about 40 cm away when printed 25 mm wide" could not be built
 *   from a check.
 * - `captures[].typical`: the level of each axis that counts as everyday
 *   conditions, so a view can say how far short of it a design falls.
 * - `VerifyReport.baseline`: whether the clean capture read, which fails the
 *   verdict on its own and so has to be visible.
 * - `VerifyJob.overlay`, from the design layer's `applyConstraints`.
 * - `VerifyConditions.sizeMm` measures what the design's
 *   `output.sizeBasis` names (the whole artwork by default) rather than the
 *   symbol and its quiet zone, as the design layer settled; the module size
 *   comes from the scene's own units per millimetre.
 * - `Fix.patch` may be null for a fix that is a change of conditions rather
 *   than of the design (print it larger), with the change in
 *   `Fix.conditions`; `Fix.params` carries the numbers its label uses; and
 *   `Fix.targets` names the check or capture axis it is meant to improve.
 * - `DesignPatch` is the studio's type, defined here because the studio
 *   imports verify and not the other way round. An empty path replaces the
 *   whole design, which is how a fix that changes two settings at once (drop
 *   light on dark: swap the module and ground colours) stays one patch.
 */

import type { Registry } from '../core/registry.js';
import type { MessageKey } from '../core/issue.js';
import type { RgbaImage } from '../core/image.js';
import type { DesignRegistries, QrDesignV1 } from '../design/types.js';
import type { EcLevel } from '../segment/types.js';
import type { SymbologyEntry } from '../symbology/types.js';

export type CaptureAxis =
	'distance' | 'focus' | 'motion' | 'noise' | 'angle' | 'light' | 'glare' | 'ink' | 'contrast';

export interface VerifyConditions {
	/**
	 * Printed width in millimetres of what the design's `output.sizeBasis`
	 * names: the whole artwork, quiet zone and frame included, by default; the
	 * symbol alone for a design that says 'symbol' (the Swiss QR-bill's 46 mm).
	 */
	readonly sizeMm: number | null;
	/** For screen use, or for a raster export. */
	readonly dpi: number | null;
	/** The furthest a person is expected to scan from, in millimetres. */
	readonly distanceMm: number | null;
}

/** What verify needs from the root registries bag. */
export interface VerifyRegistries {
	readonly symbologies: Registry<SymbologyEntry>;
	readonly design: DesignRegistries;
}

/** Structured-cloneable, so a website can post it to a worker. The worker re-encodes from it. */
export interface VerifyJob {
	readonly content: string;
	readonly design: QrDesignV1;
	readonly conditions: VerifyConditions;
	/** An integer from 0 to 2^32 - 1. */
	readonly seed: number;
	/** Registry entries the design uses, as `kind:id` (see `designRequirements`); a worker missing one refuses. */
	readonly requires: readonly string[];
	/** Decoded PNG assets the design's logo may use, by asset id. */
	readonly assets?: Readonly<Record<string, RgbaImage>>;
	/** Seeded captures per level, 1 to 8. Default 8. A contract addition. */
	readonly captureSeeds?: number;
	/**
	 * What the content prints over every code of its kind, as the design
	 * layer's `applyConstraints` returns it: the Swiss QR-bill's cross. Its
	 * modules count against the logo budget like a logo's. A contract
	 * addition, because verify may not import the content types.
	 */
	readonly overlay?: 'swiss-cross' | null;
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

export type CheckStatus = 'pass' | 'warn' | 'fail';

/** Which way round a design is: dark modules on a light ground, or the reverse. */
export type Polarity = 'dark-on-light' | 'light-on-dark';

export interface VerifyCheck {
	readonly id: CheckId;
	readonly status: CheckStatus;
	readonly measured: number;
	readonly threshold: number;
	/** The ISO/IEC 15415 parameter it corresponds to. */
	readonly grade?: 'SC' | 'MOD' | 'FPD' | 'UEC';
	readonly messageKey: MessageKey;
	/** The numbers the sentence uses, rounded for reading. A contract addition. */
	readonly params?: Readonly<Record<string, number | string>>;
}

export interface VerifyBlock {
	readonly index: number;
	readonly ec: number;
	readonly p: number;
	/** Errors the block may correct: floor((ec - p) / 2). */
	readonly t: number;
	/** Codewords with any module under the logo or its plate. */
	readonly coveredWorst: number;
	/** Codewords whose covered modules sample wrong in a clean capture. */
	readonly coveredExpected: number;
	/** t - reserve - coveredWorst; below zero fails. */
	readonly margin: number;
}

export interface VerifyCapture {
	readonly axis: CaptureAxis;
	/** The most severe level every seed passed, in the axis's own unit; null when the first level failed. */
	readonly worstPassed: number | null;
	/** The first level any seed failed at; null when every level passed. */
	readonly firstFailed: number | null;
	/** The least spare correction left in any block of any passing capture. */
	readonly minMargin: number | null;
	readonly seeds: number;
	/** The level that counts as everyday conditions. A contract addition. */
	readonly typical: number;
}

/** The clean capture at everyday framing, once per seed. A contract addition: a failed baseline fails the verdict, and a view needs to say so. */
export interface Baseline {
	readonly passed: boolean;
	/** The least spare correction in any block of any seed that read. */
	readonly minMargin: number | null;
	/** Seeds tried: the first failure ends the baseline. */
	readonly seeds: number;
}

export interface VerifyReport {
	readonly schema: 1;
	readonly profile: 'strict-v1';
	readonly seed: number;
	readonly verdict: CheckStatus;
	readonly symbol: {
		readonly symbology: string;
		readonly version: string;
		readonly ecLevel: EcLevel;
		readonly mask: number;
		readonly modules: readonly [number, number];
	};
	readonly conditions: VerifyConditions;
	readonly checks: readonly VerifyCheck[];
	readonly blocks: readonly VerifyBlock[];
	readonly captures: readonly VerifyCapture[];
	readonly limits: {
		readonly maxDistanceMm: number | null;
		readonly minModuleMm: number | null;
		readonly inkFraction: number;
	};
	readonly baseline: Baseline;
}

/** A shallow, path-addressed change: `{ path: ['modules', 'shape'], value: { id: 'dot' } }`. An empty path replaces the design. */
export interface DesignPatch {
	readonly path: readonly (string | number)[];
	readonly value: unknown;
}

export interface Fix {
	readonly id: string;
	readonly labelKey: MessageKey;
	/** Null when the fix is a change of conditions, given in `conditions`. */
	readonly patch: DesignPatch | null;
	readonly conditions?: Partial<VerifyConditions>;
	readonly params?: Readonly<Record<string, number | string>>;
	/** The check or capture axis this fix is meant to improve. */
	readonly targets: CheckId | CaptureAxis;
}
