/**
 * The layers the studio drives through a seam a caller can replace: the
 * scan check (verify), the inspector and the print writers.
 *
 * Their types are the layers' own; the seams are the shapes a caller passes
 * in when it wants something else in their place. The website runs the scan
 * check in a module worker of its own and passes a `VerifyRunner`; a test
 * passes fakes; and by default the studio uses the layers themselves.
 */

import type { Result } from '../core/result.js';
import type { RgbaImage } from '../core/image.js';
import type { QrDesignV1 } from '../design/types.js';
import type { DecodeOptions, Point } from '../decode/types.js';
import type { InspectReport } from '../inspect/types.js';
import type { EpsOptions } from '../render/eps.js';
import type { PdfOptions } from '../render/pdf.js';
import type { Scene } from '../render/types.js';
import type { Registries } from '../registries.js';
import type {
	CaptureAxis,
	CheckId,
	Fix,
	VerifyJob,
	VerifyProgress,
	VerifyReport,
} from '../verify/types.js';

/** Every capture axis, for a view that labels them. Written as a record so a new axis fails to compile here. */
const AXES: Readonly<Record<CaptureAxis, true>> = {
	distance: true,
	focus: true,
	motion: true,
	noise: true,
	angle: true,
	light: true,
	glare: true,
	ink: true,
	contrast: true,
};
export const CAPTURE_AXES: readonly CaptureAxis[] = Object.freeze(
	Object.keys(AXES) as CaptureAxis[],
);

/** Every check id, for a view that names the rows. Written as a record for the same reason. */
const CHECKS: Readonly<Record<CheckId, true>> = {
	'quiet-zone': true,
	contrast: true,
	polarity: true,
	'function-patterns': true,
	'logo-budget': true,
	'module-size': true,
	'finder-shape': true,
	'colour-red-channel': true,
	'reader-support': true,
};
export const CHECK_IDS: readonly CheckId[] = Object.freeze(Object.keys(CHECKS) as CheckId[]);

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

/** verify's `suggestFixes`, over the design registries the studio was given. */
export type FixSuggester = (report: VerifyReport, design: QrDesignV1) => readonly Fix[];

/** inspect's `inspectImage` and `inspectText`, together. */
export interface Inspector {
	image(image: RgbaImage, registries: Registries, options?: DecodeOptions): Result<InspectReport>;
	text(text: string, registries: Registries): InspectReport;
}

/** render's `sceneToPdf` and `sceneToEps`, together. */
export interface Printer {
	pdf(scene: Scene, options: PdfOptions): Uint8Array;
	eps(scene: Scene, options: EpsOptions): string;
}

export type { DecodeOptions, EpsOptions, PdfOptions, Point };
export type { BatchMapping, BatchOutcome, BatchOutput } from '../batch/types.js';
export type {
	Gs1Element,
	InspectPayload,
	InspectReport,
	InspectSet,
	InspectedSymbol,
} from '../inspect/types.js';
export type {
	Baseline,
	CaptureAxis,
	CheckId,
	CheckStatus,
	DesignPatch,
	Fix,
	VerifyBlock,
	VerifyCapture,
	VerifyCheck,
	VerifyConditions,
	VerifyJob,
	VerifyProgress,
	VerifyReport,
} from '../verify/types.js';
