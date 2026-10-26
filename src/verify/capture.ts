/**
 * One simulated photograph of a printed design.
 *
 * The order is the order things happen to a real code. First the print:
 * ink spreads or starves, or fades. Then the camera's view: the artwork on a
 * sheet of paper, turned a little in the frame (nobody holds a phone
 * square), tilted when the axis is angle, at the pixels a module the
 * distance gives, each pixel integrating the light over its own area. Then
 * the lens and sensor: the lens's softness and any defocus, any motion, light
 * that is dim or uneven, glare, and noise, rounded to bytes once at the end.
 *
 * Every random choice comes from a stream forked off the job's seed by axis
 * and seed index and never by level, so the levels of one seed are the same
 * photograph with more of one kind of damage, which is what makes a ladder
 * mean something.
 */

import type { RgbaImage } from '../core/image.js';
import { PI, cos, sin } from '../core/math.js';
import { createPrng } from '../core/prng.js';
import type { Prng } from '../core/prng.js';
import type { GreyPlane } from './degrade.js';
import {
	addNoise,
	dim,
	fade,
	gaussianBlur,
	glare,
	lightFalloff,
	motionBlur,
	quantise,
	spreadInk,
	starveInk,
	tiltedQuad,
	toRgba,
	turnedQuad,
	warpInto,
} from './degrade.js';
import type { Point, Quad } from './homography.js';
import {
	BASELINE_LABEL,
	BASE_BLUR_PX,
	BASE_NOISE,
	GLARE_RADIUS,
	LADDERS,
	MAX_ROLL_DEGREES,
	PAPER_MODULES,
	TILT_CAMERA_DISTANCE,
} from './ladders.js';
import type { Master } from './prepare.js';
import type { CaptureAxis } from './types.js';

export interface CaptureSpec {
	readonly axis: CaptureAxis | 'baseline';
	/** In the axis's unit; ignored for the baseline. */
	readonly level: number;
	/** 0 to 7. */
	readonly seed: number;
	/** Capture pixels a module. For distance, the level itself. */
	readonly pxPerModule: number;
}

const DEGREES = PI / 180;

function labelOf(axis: CaptureAxis | 'baseline'): number {
	if (axis === 'baseline') return BASELINE_LABEL;
	return (LADDERS.find((ladder) => ladder.axis === axis) as { label: number }).label;
}

/** The seeded choices of one capture, the same at every level of its axis. */
interface Draws {
	readonly roll: number;
	readonly phaseX: number;
	readonly phaseY: number;
	readonly direction: number;
	readonly spotX: number;
	readonly spotY: number;
	readonly noise: Prng;
}

function draws(jobSeed: number, spec: CaptureSpec): Draws {
	const stream = createPrng(jobSeed).fork(labelOf(spec.axis)).fork(spec.seed);
	const geometry = stream.fork(1);
	return {
		roll: (geometry.next() * 2 - 1) * MAX_ROLL_DEGREES * DEGREES,
		phaseX: geometry.next(),
		phaseY: geometry.next(),
		direction: geometry.next() * PI,
		spotX: geometry.next(),
		spotY: geometry.next(),
		noise: stream.fork(2),
	};
}

/** The print, after the axis's print damage. */
function printed(master: Master, spec: CaptureSpec): GreyPlane {
	if (spec.axis === 'ink') {
		const radius = spec.level * master.scaleX;
		return spec.seed % 2 === 0 ? spreadInk(master.plane, radius) : starveInk(master.plane, radius);
	}
	if (spec.axis === 'contrast') return fade(master.plane, spec.level);
	return master.plane;
}

export interface CaptureFrame {
	readonly image: RgbaImage;
	/** Where the artwork's corners landed, clockwise from top left, in capture pixels. */
	readonly quad: Quad;
}

/**
 * The capture for one level of one axis and one seed. `sceneWidth` and
 * `sceneHeight` are the artwork's size in modules.
 */
export function renderCapture(
	master: Master,
	sceneWidth: number,
	sceneHeight: number,
	jobSeed: number,
	spec: CaptureSpec,
): CaptureFrame {
	const d = draws(jobSeed, spec);
	const ppm = spec.pxPerModule;
	const width = sceneWidth * ppm;
	const height = sceneHeight * ppm;
	const margin = PAPER_MODULES * ppm;

	// Where the artwork lands in the frame.
	let corners: Point[];
	if (spec.axis === 'angle') {
		const tilted = tiltedQuad(
			width,
			height,
			spec.level * DEGREES,
			d.direction,
			TILT_CAMERA_DISTANCE,
		);
		corners = rotatePoints(tilted, d.roll);
	} else {
		corners = [...turnedQuad(width, height, d.roll)];
	}
	const minX = Math.min(...corners.map((p) => p.x));
	const minY = Math.min(...corners.map((p) => p.y));
	const maxX = Math.max(...corners.map((p) => p.x));
	const maxY = Math.max(...corners.map((p) => p.y));
	const canvasWidth = Math.ceil(maxX - minX + 2 * margin + 1);
	const canvasHeight = Math.ceil(maxY - minY + 2 * margin + 1);
	const quad = corners.map((p) => ({
		x: p.x - minX + margin + d.phaseX,
		y: p.y - minY + margin + d.phaseY,
	})) as unknown as Quad;

	const source = printed(master, spec);
	const supersample = Math.min(6, Math.max(2, Math.ceil(master.scaleX / ppm)));
	let frame = warpInto(source, quad, canvasWidth, canvasHeight, supersample);

	// The lens, and any defocus.
	const focus = spec.axis === 'focus' ? spec.level * ppm : 0;
	frame = gaussianBlur(frame, Math.sqrt(BASE_BLUR_PX * BASE_BLUR_PX + focus * focus));
	if (spec.axis === 'motion') frame = motionBlur(frame, spec.level * ppm, d.direction);
	if (spec.axis === 'light') {
		// Less light reaches the sensor, unevenly; the sensor adds its noise and
		// rounds to whole levels at that exposure, and then the phone's auto
		// exposure lifts the picture back up, noise, rounding and all.
		const near = 1 - 0.5 * spec.level;
		const far = 1 - spec.level;
		frame = lightFalloff(frame, near, far, d.direction * 2);
		frame = quantise(addNoise(frame, BASE_NOISE, d.noise.fork(1)));
		frame = dim(frame, 2 / (near + far));
	}
	if (spec.axis === 'glare') {
		// Somewhere over the middle half of the artwork.
		const cx = (quad[0].x + quad[1].x + quad[2].x + quad[3].x) / 4;
		const cy = (quad[0].y + quad[1].y + quad[2].y + quad[3].y) / 4;
		const radius = GLARE_RADIUS * Math.min(width, height);
		frame = glare(frame, spec.level, {
			cx: cx + (d.spotX - 0.5) * 0.5 * width,
			cy: cy + (d.spotY - 0.5) * 0.5 * height,
			rx: radius,
			ry: radius * 0.75,
		});
	}
	frame = addNoise(frame, spec.axis === 'noise' ? spec.level : BASE_NOISE, d.noise);
	return { image: toRgba(frame), quad };
}

/** Points turned by `radians` about the origin. */
function rotatePoints(points: readonly Point[], radians: number): Point[] {
	const c = cos(radians);
	const s = sin(radians);
	return points.map((p) => ({ x: p.x * c - p.y * s, y: p.x * s + p.y * c }));
}
