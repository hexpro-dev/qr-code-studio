/**
 * The built-in logo icons: generic pictograms, no marks belonging to anyone.
 *
 * All drawn in the unit box on one grid: outlines 0.08 thick, the artwork
 * inside a 0.1 margin so every icon has the same visual size on its plate,
 * and the same rounded ends and joins. They are filled outlines, not strokes,
 * so an icon looks the same in an SVG, a PNG and a print file, and a ring is
 * an outline with a hole wound the other way. Where pieces overlap (the links
 * of a chain), each piece is filled one deep on its own, so their sum still
 * fills under the nonzero rule.
 */

import { PI, atan2 } from '../../core/math.js';
import { rotate } from '../../geometry/matrix.js';
import { PathBuilder } from '../../geometry/path.js';
import type { Path } from '../../geometry/path.js';
import { direction } from '../paint.js';
import type { LogoIcon } from '../types.js';
import {
	Contour,
	capsule,
	circleContour,
	polygonContour,
	ring,
	roundedBox,
	starContour,
} from './draw.js';

/** The outline weight every icon is drawn with. */
export const ICON_STROKE = 0.08;
const S = ICON_STROKE;

/** An icon's id and how to draw it, so nothing is drawn until a registry asks. */
type IconDefinition = readonly [string, (out: PathBuilder) => void];

function icon([id, draw]: IconDefinition): LogoIcon {
	const out = new PathBuilder();
	draw(out);
	const path: Path = out.build();
	return Object.freeze({ id, labelKey: `design.icon.${id}`, path });
}

/** A rounded rectangle outline, `S` thick. */
function frameBox(out: PathBuilder, x: number, y: number, w: number, h: number, r: number): void {
	ring(
		out,
		roundedBox(x, y, w, h, [r, r, r, r]),
		roundedBox(x + S, y + S, w - 2 * S, h - 2 * S, [r - S, r - S, r - S, r - S]),
	);
}

/** A circle outline, `S` thick, of outer radius `r`. */
function frameCircle(out: PathBuilder, cx: number, cy: number, r: number): void {
	ring(out, circleContour(cx, cy, r), circleContour(cx, cy, r - S));
}

/** A point on the circle about (cx, cy) of radius r at `degrees`. */
function on(cx: number, cy: number, r: number, degrees: number): [number, number] {
	const [dx, dy] = direction(degrees);
	return [cx + r * dx, cy + r * dy];
}

/**
 * A thick arc from `from` to `to` degrees (clockwise, `to` larger), `S`
 * wide about radius `r`, with round ends.
 */
function band(out: PathBuilder, cx: number, cy: number, r: number, from: number, to: number): void {
	const [sx, sy] = on(cx, cy, r + S / 2, from);
	const [ex, ey] = on(cx, cy, r, to);
	const [bx, by] = on(cx, cy, r, from);
	new Contour(sx, sy)
		.arc(cx, cy, r + S / 2, from, to)
		.arc(ex, ey, S / 2, to, to + 180)
		.arc(cx, cy, r - S / 2, to, from)
		.arc(bx, by, S / 2, from + 180, from + 360)
		.emit(out);
}

function degrees(y: number, x: number): number {
	return (atan2(y, x) * 180) / PI;
}

const link: IconDefinition = [
	'link',
	(out) => {
		// Two open chain links joined by a short bar, turned to the diagonal.
		out.transform(rotate(-45, 0.5, 0.5));
		for (const [ax, bx] of [
			[0.2, 0.36],
			[0.64, 0.8],
		] as const) {
			ring(out, capsule(ax, 0.5, bx, 0.5, 0.32), capsule(ax, 0.5, bx, 0.5, 0.32 - 2 * S));
		}
		capsule(0.36, 0.5, 0.64, 0.5, S).emit(out);
		out.transform([1, 0, 0, 1, 0, 0]);
	},
];

const wifi: IconDefinition = [
	'wifi',
	(out) => {
		for (const r of [0.2, 0.36, 0.52]) band(out, 0.5, 0.82, r - S / 2, 225, 315);
		circleContour(0.5, 0.82, 0.07).emit(out);
	},
];

const mail: IconDefinition = [
	'mail',
	(out) => {
		frameBox(out, 0.1, 0.22, 0.8, 0.56, 0.08);
		capsule(0.18, 0.31, 0.5, 0.55, S).emit(out);
		capsule(0.5, 0.55, 0.82, 0.31, S).emit(out);
	},
];

const phone: IconDefinition = [
	'phone',
	(out) => {
		frameBox(out, 0.28, 0.1, 0.44, 0.8, 0.09);
		capsule(0.43, 0.2, 0.57, 0.2, 0.04).emit(out);
		circleContour(0.5, 0.78, 0.045).emit(out);
	},
];

const chat: IconDefinition = [
	'chat',
	(out) => {
		frameBox(out, 0.1, 0.14, 0.8, 0.56, 0.12);
		// The tail, joined to the bubble's lower edge.
		polygonContour([0.24, 0.66, 0.4, 0.66, 0.22, 0.88]).emit(out);
		for (const x of [0.33, 0.5, 0.67]) circleContour(x, 0.42, 0.055).emit(out);
	},
];

const locationPin: IconDefinition = [
	'location-pin',
	(out) => {
		// A teardrop: a circle and the two tangents to it from the tip. The hole
		// is the same construction with the radius less the stroke and the tip
		// raised by the stroke over the sine of the half angle at the tip, which
		// keeps its sides parallel to the outline's, a stroke's width in.
		const cx = 0.5;
		const cy = 0.4;
		const r = 0.3;
		const tip = 0.9;
		const drop = (radius: number, tipY: number): Contour => {
			const d = tipY - cy;
			// The tangent points sit this far either side of straight down.
			const spread = degrees(Math.sqrt(d * d - radius * radius), radius);
			const [lx, ly] = on(cx, cy, radius, 90 + spread);
			return new Contour(cx, tipY)
				.lineTo(lx, ly)
				.arc(cx, cy, radius, 90 + spread, 450 - spread)
				.lineTo(cx, tipY);
		};
		ring(out, drop(r, tip), drop(r - S, tip - (S * (tip - cy)) / r));
		frameCircle(out, cx, cy, 0.12);
	},
];

const calendar: IconDefinition = [
	'calendar',
	(out) => {
		frameBox(out, 0.12, 0.18, 0.76, 0.7, 0.08);
		roundedBox(0.12, 0.18, 0.76, 0.18, [0.08, 0.08, 0, 0]).emit(out);
		capsule(0.32, 0.1, 0.32, 0.24, S).emit(out);
		capsule(0.68, 0.1, 0.68, 0.24, S).emit(out);
		for (const y of [0.52, 0.7]) {
			for (const x of [0.32, 0.5, 0.68])
				roundedBox(x - 0.05, y - 0.05, 0.1, 0.1, [0.02, 0.02, 0.02, 0.02]).emit(out);
		}
	},
];

const contactCard: IconDefinition = [
	'contact-card',
	(out) => {
		frameBox(out, 0.08, 0.2, 0.84, 0.6, 0.08);
		frameCircle(out, 0.32, 0.42, 0.09);
		band(out, 0.32, 0.7, 0.13, 200, 340);
		capsule(0.54, 0.4, 0.78, 0.4, S).emit(out);
		capsule(0.54, 0.56, 0.72, 0.56, S).emit(out);
	},
];

const cart: IconDefinition = [
	'cart',
	(out) => {
		capsule(0.1, 0.2, 0.22, 0.2, S).emit(out);
		capsule(0.22, 0.2, 0.32, 0.64, S).emit(out);
		capsule(0.32, 0.64, 0.8, 0.64, S).emit(out);
		ring(
			out,
			polygonContour([0.24, 0.28, 0.9, 0.28, 0.82, 0.56, 0.3, 0.56]),
			polygonContour([0.34, 0.36, 0.79, 0.36, 0.76, 0.48, 0.37, 0.48]),
		);
		circleContour(0.38, 0.8, 0.07).emit(out);
		circleContour(0.74, 0.8, 0.07).emit(out);
	},
];

const food: IconDefinition = [
	'food',
	(out) => {
		// A fork on the left and a knife on the right.
		capsule(0.34, 0.12, 0.34, 0.88, S).emit(out);
		for (const x of [0.22, 0.46]) capsule(x, 0.12, x, 0.36, S).emit(out);
		roundedBox(0.18, 0.34, 0.32, 0.1, [0, 0, 0.05, 0.05]).emit(out);
		capsule(0.68, 0.5, 0.68, 0.88, S).emit(out);
		new Contour(0.64, 0.56)
			.lineTo(0.64, 0.24)
			.cubicTo(0.64, 0.16, 0.7, 0.1, 0.78, 0.1)
			.lineTo(0.78, 0.56)
			.emit(out);
	},
];

const star: IconDefinition = [
	'star',
	(out) => {
		// The star's edges all lie at one distance from its centre, so the hole
		// brought in by the stroke weight is the same star scaled about it.
		const outer = 0.44;
		const inner = outer * 0.45;
		const cy = 0.54;
		const apothem = edgeDistance(outer, inner);
		const k = (apothem - S) / apothem;
		ring(
			out,
			starContour(0.5, cy, 5, outer, inner, -90),
			starContour(0.5, cy, 5, outer * k, inner * k, -90),
		);
	},
];

/** How far a star polygon's edges lie from its centre. */
function edgeDistance(outer: number, inner: number): number {
	const [tx, ty] = [0, -outer];
	const [nx, ny] = on(0, 0, inner, -54);
	const ex = nx - tx;
	const ey = ny - ty;
	return Math.abs(tx * ey - ty * ex) / Math.sqrt(ex * ex + ey * ey);
}

const heart: IconDefinition = [
	'heart',
	(out) => {
		const shape = (inset: number): Contour => {
			const k = 1 - inset * 2.6;
			const at = (x: number, y: number): [number, number] => [
				0.5 + (x - 0.5) * k,
				0.52 + (y - 0.52) * k,
			];
			const p = (x: number, y: number): [number, number] => at(x, y);
			const [sx, sy] = p(0.5, 0.86);
			const contour = new Contour(sx, sy);
			const c = (a: [number, number], b: [number, number], e: [number, number]): void => {
				contour.cubicTo(a[0], a[1], b[0], b[1], e[0], e[1]);
			};
			c(p(0.3, 0.7), p(0.08, 0.52), p(0.08, 0.34));
			c(p(0.08, 0.2), p(0.18, 0.12), p(0.3, 0.12));
			c(p(0.4, 0.12), p(0.47, 0.18), p(0.5, 0.26));
			c(p(0.53, 0.18), p(0.6, 0.12), p(0.7, 0.12));
			c(p(0.82, 0.12), p(0.92, 0.2), p(0.92, 0.34));
			c(p(0.92, 0.52), p(0.7, 0.7), p(0.5, 0.86));
			return contour;
		};
		ring(out, shape(0), shape(S));
	},
];

const play: IconDefinition = [
	'play',
	(out) => {
		frameCircle(out, 0.5, 0.5, 0.4);
		polygonContour([0.42, 0.33, 0.68, 0.5, 0.42, 0.67]).emit(out);
	},
];

const music: IconDefinition = [
	'music',
	(out) => {
		circleContour(0.3, 0.74, 0.1).emit(out);
		circleContour(0.7, 0.66, 0.1).emit(out);
		capsule(0.38, 0.74, 0.38, 0.22, S).emit(out);
		capsule(0.78, 0.66, 0.78, 0.14, S).emit(out);
		polygonContour([0.34, 0.18, 0.82, 0.1, 0.82, 0.24, 0.34, 0.32]).emit(out);
	},
];

const shop: IconDefinition = [
	'shop',
	(out) => {
		// An awning of three scallops over a shopfront with a door.
		const scallop = 0.8 / 6;
		const awning = new Contour(0.1, 0.18).lineTo(0.9, 0.18).lineTo(0.9, 0.34);
		for (const x of [0.9 - scallop, 0.9 - 3 * scallop, 0.9 - 5 * scallop]) {
			awning.arc(x, 0.34, scallop, 0, 180);
		}
		awning.lineTo(0.1, 0.18).emit(out);
		ring(
			out,
			polygonContour([0.16, 0.4, 0.84, 0.4, 0.84, 0.86, 0.16, 0.86]),
			polygonContour([0.16 + S, 0.4, 0.84 - S, 0.4, 0.84 - S, 0.86 - S, 0.16 + S, 0.86 - S]),
		);
		roundedBox(0.4, 0.58, 0.2, 0.28, [0.03, 0.03, 0, 0]).emit(out);
	},
];

const info: IconDefinition = [
	'info',
	(out) => {
		frameCircle(out, 0.5, 0.5, 0.4);
		circleContour(0.5, 0.31, 0.055).emit(out);
		capsule(0.5, 0.46, 0.5, 0.7, 0.1).emit(out);
	},
];

const DEFINITIONS: readonly IconDefinition[] = [
	link,
	wifi,
	mail,
	phone,
	chat,
	locationPin,
	calendar,
	contactCard,
	cart,
	food,
	star,
	heart,
	play,
	music,
	shop,
	info,
];

/**
 * The built-in icons, drawn afresh. A function rather than a constant so
 * that importing this module draws nothing; `createDesignRegistries` calls
 * it.
 */
export function builtInIcons(): readonly LogoIcon[] {
	return Object.freeze(DEFINITIONS.map(icon));
}
