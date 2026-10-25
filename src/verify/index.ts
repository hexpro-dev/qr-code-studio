export { runVerifyJob, verify } from './job.js';
export { suggestFixes, applyDesignPatch } from './fixes.js';
export { designRequirements, REQUIREMENT_KINDS } from './prepare.js';
export type { RequirementKind } from './prepare.js';
export { CAMERA, distanceFor, maxDistanceMm, minModuleMm, pxPerModuleAt } from './camera.js';
export {
	BASE_BLUR_PX,
	BASE_NOISE,
	DISTANCE_LADDER,
	FRAMING_PX,
	GLARE_RADIUS,
	LADDERS,
	MAX_CAPTURE_PX_PER_MODULE,
	MAX_ROLL_DEGREES,
	PAPER_MODULES,
	TILT_CAMERA_DISTANCE,
	framingPxPerModule,
} from './ladders.js';
export type { AxisLadder } from './ladders.js';
export { RESERVE_SHARE, codewordCoverage, reserveFor } from './coverage.js';
export type { BlockCoverage, Coverage } from './coverage.js';
export { MOD_GRADES, RED_CONTRAST_WARN, SC_GRADES } from './static.js';
export { VERIFY_MESSAGE_KEYS } from './keys.js';
export {
	CALIBRATION_LIMIT_MM,
	PRESET_CONTENT,
	calibratePreset,
	presetVerifier,
	scansAtSize,
	withMargin,
} from './preset.js';
export type { Calibration, PresetVerifierOptions, PresetViolation } from './preset.js';
export type {
	Baseline,
	CaptureAxis,
	CheckId,
	CheckStatus,
	DesignPatch,
	Fix,
	Polarity,
	VerifyBlock,
	VerifyCapture,
	VerifyCheck,
	VerifyConditions,
	VerifyJob,
	VerifyProgress,
	VerifyRegistries,
	VerifyReport,
} from './types.js';
