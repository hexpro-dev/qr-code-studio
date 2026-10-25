/**
 * The capture axes: what each one does to a picture, the severity ladder it
 * climbs, and the level that counts as everyday conditions.
 *
 * Each ladder runs from damage every design survives to damage almost none
 * does, so the report can say where between the two a design gives out.
 * Levels are in each axis's own unit, mildest first, and every level is
 * captured with the same seeded geometry and noise, only stronger, so a
 * harder level is the same photograph made worse rather than a different
 * photograph.
 *
 * The typical level is what a person can expect any day: a phone held at an
 * angle over a menu under a lamp, a little soft, a little shaky. A design
 * that fails before it gets a warning, because some people will not get it
 * to scan. These are calibration targets for the owner's phone session, like
 * the camera constants: the session's job is to say whether a code that
 * passes a level here scans on real phones under that much of the real
 * thing.
 *
 * Distance is the odd one: its ladder is in pixels a module (the camera's
 * view of the code) and is reported in millimetres once the printed size
 * says what those pixels mean.
 */

import { CAMERA, pxPerModuleAt } from './camera.js';
import type { CaptureAxis } from './types.js';

export interface AxisLadder {
	readonly axis: CaptureAxis;
	/** The label the axis's seeded streams are forked by, so adding an axis never moves another's. */
	readonly label: number;
	/** Mildest first, in `unit`. */
	readonly levels: readonly number[];
	readonly typical: number;
	readonly unit: string;
}

/**
 * How much of the frame a person fills with the code, in pixels: half the
 * short side of a 1920 by 1080 frame. Scanner apps draw a viewfinder square
 * over the middle of the preview and people move the phone until the code
 * sits in it.
 */
export const FRAMING_PX = 540;
/** The most pixels a module any capture is made at: past this nothing about reading changes, only the cost. */
export const MAX_CAPTURE_PX_PER_MODULE = 10;

/**
 * Pixels a module the camera sees in everyday use, for every axis but
 * distance: the code filling the viewfinder, or as close as the lens
 * focuses when filling it would need the phone nearer than that. Never fewer
 * than a reader needs (a person moves closer) and never more than
 * `MAX_CAPTURE_PX_PER_MODULE`.
 */
export function framingPxPerModule(modulesAcross: number, moduleMm: number | null): number {
	let ppm = FRAMING_PX / modulesAcross;
	if (moduleMm !== null) ppm = Math.min(ppm, pxPerModuleAt(moduleMm, CAMERA.minFocusMm));
	return Math.min(MAX_CAPTURE_PX_PER_MODULE, Math.max(CAMERA.minPxPerModule, ppm));
}
/** Lens and demosaic softness in every capture: a Gaussian of this many capture pixels. */
export const BASE_BLUR_PX = 0.5;
/** Sensor noise in every capture, in levels of 255. */
export const BASE_NOISE = 2;
/** The most a capture is turned in its own plane, either way, in degrees. Nobody holds a phone square. */
export const MAX_ROLL_DEGREES = 4;
/** Paper round the artwork in every capture, in modules. */
export const PAPER_MODULES = 2;
/** How far the camera is from a tilted code, in half-widths of the artwork: a code about a third of the frame across. */
export const TILT_CAMERA_DISTANCE = 5;
/** Glare spot radius as a share of the artwork's shorter side. */
export const GLARE_RADIUS = 0.3;

/** Distance, as the pixels a module the camera sees: from comfortably close to past what any reader manages. */
export const DISTANCE_LADDER: readonly number[] = Object.freeze([8, 6, 5, 4.5, 4, 3.5, 3, 2.5]);

export const LADDERS: readonly AxisLadder[] = Object.freeze([
	{
		axis: 'distance',
		label: 1,
		levels: DISTANCE_LADDER,
		// Replaced per job: the expected distance, or the furthest a phone
		// needs (four pixels a module).
		typical: 4,
		unit: 'px-per-module',
	},
	{
		// Out of focus: a Gaussian blur of this many modules (sigma), on top of
		// the lens's own softness. 0.2 is a phone that has not quite settled; by
		// 0.5 a module's centre has as much of its neighbours in it as of itself.
		axis: 'focus',
		label: 2,
		levels: Object.freeze([0.1, 0.15, 0.2, 0.3, 0.4, 0.5, 0.6]),
		typical: 0.2,
		unit: 'modules',
	},
	{
		// A hand moving during the exposure: a straight smear this many modules
		// long in a seeded direction. 0.3 is a steady hand at 1/30 s indoors.
		axis: 'motion',
		label: 3,
		levels: Object.freeze([0.15, 0.3, 0.5, 0.75, 1, 1.5, 2]),
		typical: 0.3,
		unit: 'modules',
	},
	{
		// Sensor noise left after the phone's own denoising, standard deviation in
		// levels of 255. 4 is an ordinary indoor preview frame; a dark bar is 8 to
		// 12. The strict profile refuses a picture whose ground breaks up into
		// speckle, which noise past about 8 does on a flat ground.
		axis: 'noise',
		label: 4,
		levels: Object.freeze([2, 3, 4, 6, 8, 12, 16, 24]),
		typical: 4,
		unit: 'levels',
	},
	{
		// The phone tilted away from square on, in degrees, about a seeded axis.
		// 20 is a menu on a table read from the chair in front of it.
		axis: 'angle',
		label: 5,
		levels: Object.freeze([10, 15, 20, 25, 30, 40, 50, 60]),
		typical: 20,
		unit: 'degrees',
	},
	{
		// Light lost: the bright side of the picture keeps 1 - level / 2 of it
		// and the dark side 1 - level, the sensor adds its noise and rounds at that
		// exposure, and auto exposure lifts it back. 0.7 is the dim corner of a
		// room in the evening; 0.9 is a candlelit table.
		axis: 'light',
		label: 6,
		levels: Object.freeze([0.5, 0.7, 0.8, 0.9, 0.95, 0.98]),
		typical: 0.7,
		unit: 'fraction',
	},
	{
		// A reflection on gloss over a spot 0.3 of the artwork across: levels
		// pulled towards white by level times (1 - d squared), clipped (see
		// `glare` in degrade.ts). 0.5 is the sheen of a lamp on a laminated menu;
		// at 1 its centre is white.
		axis: 'glare',
		label: 7,
		levels: Object.freeze([0.25, 0.5, 0.75, 1, 1.25, 1.5, 2]),
		typical: 0.5,
		unit: 'fraction',
	},
	{
		// Ink that spreads or starves: every dark edge moved out (even seeds) or
		// in (odd seeds) by this many modules. 0.05 is ordinary dot gain on office
		// paper for a module about a millimetre wide.
		axis: 'ink',
		label: 8,
		levels: Object.freeze([0.025, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3]),
		typical: 0.05,
		unit: 'modules',
	},
	{
		// Faded print: the ink keeps 1 - level of its contrast with the paper.
		// 0.3 is a printer running low on toner, or a menu left in a window.
		axis: 'contrast',
		label: 9,
		levels: Object.freeze([0.15, 0.3, 0.45, 0.6, 0.7, 0.8, 0.9]),
		typical: 0.3,
		unit: 'fraction',
	},
] satisfies AxisLadder[]);

/** The baseline's stream label. */
export const BASELINE_LABEL = 0;
