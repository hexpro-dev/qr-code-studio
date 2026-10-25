/**
 * The built-in frames.
 *
 * A frame is drawn round the symbol's quiet zone and never in it: every card
 * here is one outline with the quiet zone box cut out of it (a hole wound the
 * other way), so the design's background shows there and nothing else does.
 * Sizes are fractions of a unit that grows with the symbol, the geometric
 * mean of the quiet zone box's sides, so a frame looks the same round a
 * version 1 code as round a version 40 one, and stays in proportion round a
 * long rMQR strip.
 *
 * Each frame that takes a caption reserves a text box for it, outside the
 * quiet zone. The caption itself is set by the text layer (M9); see
 * `buildScene`.
 */

import { PathBuilder } from '../../geometry/path.js';
import type { SceneNode, ScenePaint } from '../../render/types.js';
import { num } from '../params.js';
import type { FrameEntry, FrameLayout, FrameLayoutContext, FrameTextBox } from '../types.js';
import { Contour, circleContour, polygonContour, roundedBox } from './draw.js';
import { numberParam } from './schema.js';

interface Measure {
	/** The quiet zone box. */
	readonly w: number;
	readonly h: number;
	/** The unit frame sizes are fractions of. */
	readonly u: number;
}

function measure(ctx: FrameLayoutContext): Measure {
	const w = ctx.symbolSize.width + 2 * ctx.quietZone;
	const h = ctx.symbolSize.height + 2 * ctx.quietZone;
	return { w, h, u: Math.sqrt(w * h) };
}

/** A filled path node in the frame's paint. */
function node(path: PathBuilder, paint: ScenePaint): SceneNode {
	return { kind: 'path', path: path.build(), paint, role: 'frame' };
}

/**
 * A card's corner radius, held small enough that the card still covers the
 * quiet zone box's corner `inset` in from its own. Past that the hole would
 * poke out of the rounded corner, and a hole outside its card is ink.
 */
function cornerRadius(radius: number, inset: number): number {
	// The corner (inset, inset) stays inside the arc about (r, r) while
	// root 2 (r - inset) <= r, which is r <= inset / (1 - 1 / root 2).
	return Math.min(radius, (inset / (1 - Math.SQRT1_2)) * 0.98);
}

/** The quiet zone box at (x, y), wound as a hole. */
function cutQuietZone(out: PathBuilder, x: number, y: number, m: Measure): void {
	out.rect(x + m.w, y, -m.w, m.h);
}

function box(
	x: number,
	y: number,
	width: number,
	height: number,
	align: FrameTextBox['align'] = 'centre',
): FrameTextBox {
	return { x, y, width, height, align };
}

function frame(entry: FrameEntry): FrameEntry {
	return Object.freeze({ ...entry, params: Object.freeze([...entry.params]) });
}

const none = frame({
	id: 'none',
	labelKey: 'design.frame.none',
	params: [],
	text: null,
	layout(ctx): FrameLayout {
		const m = measure(ctx);
		return { width: m.w, height: m.h, symbol: { x: 0, y: 0 }, nodes: [], textBox: null };
	},
});

/** A border round the quiet zone with a deeper band on one side for the caption. */
function banner(id: string, top: boolean): FrameEntry {
	return frame({
		id,
		labelKey: `design.frame.${id}`,
		params: [
			numberParam('border', 0.05, 0.02, 0.1, 0.01),
			numberParam('band', 0.2, 0.14, 0.32, 0.01),
			numberParam('radius', 0.05, 0, 0.12, 0.01),
		],
		text: { maxLines: 1, maxChars: 24 },
		layout(ctx) {
			const m = measure(ctx);
			const b = num(ctx.params, 'border') * m.u;
			const band = num(ctx.params, 'band') * m.u;
			const r = cornerRadius(num(ctx.params, 'radius') * m.u, b);
			const width = m.w + 2 * b;
			const height = m.h + 2 * b + band;
			const qy = top ? b + band : b;
			const out = new PathBuilder();
			roundedBox(0, 0, width, height, [r, r, r, r]).emit(out);
			cutQuietZone(out, b, qy, m);
			return {
				width,
				height,
				symbol: { x: b, y: qy },
				nodes: [node(out, ctx.paint)],
				textBox: top ? box(b, b, m.w, band - b) : box(b, b + m.h + b, m.w, band - b),
			};
		},
	});
}

const roundedCard = frame({
	id: 'rounded-card',
	labelKey: 'design.frame.rounded-card',
	params: [
		numberParam('padding', 0.09, 0.06, 0.14, 0.01),
		numberParam('radius', 0.1, 0.04, 0.2, 0.01),
		numberParam('caption', 0.16, 0.12, 0.24, 0.01),
	],
	text: { maxLines: 2, maxChars: 40 },
	layout(ctx) {
		const m = measure(ctx);
		const p = num(ctx.params, 'padding') * m.u;
		const r = cornerRadius(num(ctx.params, 'radius') * m.u, p);
		const caption = num(ctx.params, 'caption') * m.u;
		const width = m.w + 2 * p;
		const height = m.h + 2 * p + caption;
		const out = new PathBuilder();
		roundedBox(0, 0, width, height, [r, r, r, r]).emit(out);
		cutQuietZone(out, p, p, m);
		return {
			width,
			height,
			symbol: { x: p, y: p },
			nodes: [node(out, ctx.paint)],
			textBox: box(p, p + m.h + p / 2, m.w, caption),
		};
	},
});

const speechBubble = frame({
	id: 'speech-bubble',
	labelKey: 'design.frame.speech-bubble',
	params: [
		numberParam('border', 0.05, 0.03, 0.1, 0.01),
		numberParam('radius', 0.1, 0.04, 0.16, 0.01),
		numberParam('tail', 0.14, 0.08, 0.2, 0.01),
	],
	text: { maxLines: 1, maxChars: 20 },
	layout(ctx) {
		const m = measure(ctx);
		const b = num(ctx.params, 'border') * m.u;
		const r = cornerRadius(num(ctx.params, 'radius') * m.u, b);
		const tail = num(ctx.params, 'tail') * m.u;
		const width = m.w + 2 * b;
		const bottom = m.h + 2 * b;
		const out = new PathBuilder();
		roundedBox(0, 0, width, bottom, [r, r, r, r]).emit(out);
		cutQuietZone(out, b, b, m);
		// The tail starts half a border up inside the bubble's edge, so the two
		// outlines overlap and fill as one, and never reaches the quiet zone.
		const tx = Math.max(r, width * 0.16);
		polygonContour([tx, bottom - b / 2, tx + tail, bottom - b / 2, tx, bottom + tail]).emit(out);
		const gap = tail * 0.3;
		return {
			width,
			height: bottom + tail,
			symbol: { x: b, y: b },
			nodes: [node(out, ctx.paint)],
			textBox: box(
				tx + tail + gap,
				bottom + gap * 0.5,
				width - (tx + tail + gap),
				tail - gap,
				'start',
			),
		};
	},
});

const ticket = frame({
	id: 'ticket',
	labelKey: 'design.frame.ticket',
	params: [
		numberParam('border', 0.06, 0.04, 0.1, 0.01),
		numberParam('stub', 0.22, 0.16, 0.3, 0.01),
		numberParam('notch', 0.05, 0.03, 0.07, 0.005),
	],
	text: { maxLines: 1, maxChars: 24 },
	layout(ctx) {
		const m = measure(ctx);
		const b = num(ctx.params, 'border') * m.u;
		const stub = num(ctx.params, 'stub') * m.u;
		// A notch deeper than root two borders would reach round the quiet
		// zone's corner, and where the card is cut away a hole is ink.
		const n = Math.min(num(ctx.params, 'notch') * m.u, b * 1.4);
		const width = m.w + 2 * b;
		const line = m.h + 2 * b;
		const height = line + stub;
		const out = new PathBuilder();
		// The outline, with a half-round notch bitten from each side where the
		// stub tears off.
		new Contour(0, 0)
			.lineTo(width, 0)
			.lineTo(width, line - n)
			.arc(width, line, n, 270, 90)
			.lineTo(width, height)
			.lineTo(0, height)
			.lineTo(0, line + n)
			.arc(0, line, n, 90, -90)
			.emit(out);
		cutQuietZone(out, b, b, m);
		// A perforation of small round holes between the notches.
		const hole = n * 0.35;
		const from = n * 2;
		const count = Math.max(1, Math.floor((width - 2 * from) / (hole * 3)));
		const pitch = (width - 2 * from) / count;
		for (let i = 0; i <= count; i += 1) {
			circleContour(from + i * pitch, line, hole).emit(out, true);
		}
		return {
			width,
			height,
			symbol: { x: b, y: b },
			nodes: [node(out, ctx.paint)],
			textBox: box(b, line + stub * 0.25, m.w, stub * 0.5),
		};
	},
});

const polaroid = frame({
	id: 'polaroid',
	labelKey: 'design.frame.polaroid',
	params: [
		numberParam('border', 0.05, 0.04, 0.08, 0.01),
		numberParam('band', 0.24, 0.18, 0.3, 0.01),
	],
	text: { maxLines: 1, maxChars: 24 },
	layout(ctx) {
		const m = measure(ctx);
		const b = num(ctx.params, 'border') * m.u;
		const band = num(ctx.params, 'band') * m.u;
		const width = m.w + 2 * b;
		const height = m.h + b + band;
		const r = m.u * 0.01;
		const out = new PathBuilder();
		roundedBox(0, 0, width, height, [r, r, r, r]).emit(out);
		cutQuietZone(out, b, b, m);
		return {
			width,
			height,
			symbol: { x: b, y: b },
			nodes: [node(out, ctx.paint)],
			textBox: box(b, b + m.h + band * 0.2, m.w, band * 0.6),
		};
	},
});

const badgeCircle = frame({
	id: 'badge-circle',
	labelKey: 'design.frame.badge-circle',
	params: [numberParam('border', 0.05, 0.02, 0.1, 0.01)],
	text: { maxLines: 1, maxChars: 16 },
	layout(ctx) {
		const m = measure(ctx);
		const b = num(ctx.params, 'border') * m.u;
		const radius = Math.sqrt(m.w * m.w + m.h * m.h) / 2 + b;
		const size = radius * 2;
		const qx = radius - m.w / 2;
		const qy = radius - m.h / 2;
		const out = new PathBuilder();
		circleContour(radius, radius, radius).emit(out);
		cutQuietZone(out, qx, qy, m);
		// The caption sits in the segment of the disc below the quiet zone, as
		// wide as the chord at its lower edge allows.
		const segment = radius - m.h / 2;
		const top = radius + m.h / 2 + segment * 0.15;
		const height = segment * 0.45;
		const below = top + height - radius;
		const inner = radius - b;
		const half = Math.sqrt(Math.max(inner * inner - below * below, 0)) * 0.9;
		return {
			width: size,
			height: size,
			symbol: { x: qx, y: qy },
			nodes: [node(out, ctx.paint)],
			textBox: box(radius - half, top, half * 2, height),
		};
	},
});

const phone = frame({
	id: 'phone',
	labelKey: 'design.frame.phone',
	params: [
		numberParam('bezel', 0.06, 0.04, 0.1, 0.01),
		numberParam('radius', 0.14, 0.08, 0.2, 0.01),
	],
	text: { maxLines: 1, maxChars: 20 },
	layout(ctx) {
		const m = measure(ctx);
		const side = num(ctx.params, 'bezel') * m.u;
		const r = cornerRadius(num(ctx.params, 'radius') * m.u, side);
		const top = m.u * 0.16;
		const chin = m.u * 0.22;
		const width = m.w + 2 * side;
		const height = top + m.h + chin;
		const out = new PathBuilder();
		roundedBox(0, 0, width, height, [r, r, r, r]).emit(out);
		cutQuietZone(out, side, top, m);
		// The earpiece and the home bar, cut through the bezels.
		const slot = m.u * 0.03;
		roundedBox(width * 0.39, top * 0.42, width * 0.22, slot, [
			slot / 2,
			slot / 2,
			slot / 2,
			slot / 2,
		]).emit(out, true);
		roundedBox(width * 0.35, top + m.h + chin * 0.72, width * 0.3, slot, [
			slot / 2,
			slot / 2,
			slot / 2,
			slot / 2,
		]).emit(out, true);
		return {
			width,
			height,
			symbol: { x: side, y: top },
			nodes: [node(out, ctx.paint)],
			textBox: box(side, top + m.h + chin * 0.14, m.w, chin * 0.46),
		};
	},
});

const hangTag = frame({
	id: 'hang-tag',
	labelKey: 'design.frame.hang-tag',
	params: [
		numberParam('border', 0.06, 0.04, 0.1, 0.01),
		numberParam('caption', 0.14, 0.1, 0.2, 0.01),
	],
	text: { maxLines: 2, maxChars: 32 },
	layout(ctx) {
		const m = measure(ctx);
		const b = num(ctx.params, 'border') * m.u;
		const caption = num(ctx.params, 'caption') * m.u;
		const head = m.u * 0.24;
		const width = m.w + 2 * b;
		const height = head + m.h + b + caption;
		const cut = Math.min(m.u * 0.2, head, width / 2);
		const out = new PathBuilder();
		polygonContour([cut, 0, width - cut, 0, width, cut, width, height, 0, height, 0, cut]).emit(
			out,
		);
		cutQuietZone(out, b, head, m);
		circleContour(width / 2, head * 0.45, m.u * 0.05).emit(out, true);
		return {
			width,
			height,
			symbol: { x: b, y: head },
			nodes: [node(out, ctx.paint)],
			textBox: box(b, head + m.h + b / 2, m.w, caption),
		};
	},
});

const cornerBrackets = frame({
	id: 'corner-brackets',
	labelKey: 'design.frame.corner-brackets',
	params: [
		numberParam('gap', 0.015, 0, 0.05, 0.005),
		numberParam('thickness', 0.035, 0.02, 0.06, 0.005),
		numberParam('arm', 0.18, 0.1, 0.3, 0.01),
	],
	text: { maxLines: 1, maxChars: 24 },
	layout(ctx) {
		const m = measure(ctx);
		const gap = num(ctx.params, 'gap') * m.u;
		const t = num(ctx.params, 'thickness') * m.u;
		const arm = Math.min(num(ctx.params, 'arm') * m.u, (m.w + 2 * t) / 2, (m.h + 2 * t) / 2);
		const margin = gap + t;
		const caption = m.u * 0.14;
		const width = m.w + 2 * margin;
		const framed = m.h + 2 * margin;
		const out = new PathBuilder();
		for (const [cx, cy, sx, sy] of [
			[0, 0, 1, 1],
			[width, 0, -1, 1],
			[width, framed, -1, -1],
			[0, framed, 1, -1],
		] as const) {
			// The L at each corner, with its arms along the edges. Wound
			// clockwise whichever way the corner faces.
			const points = [
				cx,
				cy,
				cx + sx * arm,
				cy,
				cx + sx * arm,
				cy + sy * t,
				cx + sx * t,
				cy + sy * t,
				cx + sx * t,
				cy + sy * arm,
				cx,
				cy + sy * arm,
			];
			if (sx * sy < 0) {
				const reversed: number[] = [];
				for (let i = points.length - 2; i >= 0; i -= 2)
					reversed.push(points[i] as number, points[i + 1] as number);
				polygonContour(reversed).emit(out);
			} else polygonContour(points).emit(out);
		}
		return {
			width,
			height: framed + caption,
			symbol: { x: margin, y: margin },
			nodes: [node(out, ctx.paint)],
			textBox: box(margin, framed + caption * 0.15, m.w, caption * 0.7),
		};
	},
});

const stamp = frame({
	id: 'stamp',
	labelKey: 'design.frame.stamp',
	params: [
		numberParam('border', 0.07, 0.05, 0.1, 0.005),
		numberParam('caption', 0.14, 0.1, 0.2, 0.01),
	],
	text: { maxLines: 1, maxChars: 20 },
	layout(ctx) {
		const m = measure(ctx);
		const b = num(ctx.params, 'border') * m.u;
		const caption = num(ctx.params, 'caption') * m.u;
		const width = m.w + 2 * b;
		const height = m.h + 2 * b + caption;
		// Half-round bites along every edge, no deeper than 0.4 of the border,
		// so the perforation never comes near the quiet zone.
		const bite = b * 0.4;
		const pitch = bite * 2.6;
		const contour = new Contour(0, 0);
		const along = (length: number): number[] => {
			const count = Math.max(1, Math.floor((length - pitch) / pitch));
			const start = (length - (count - 1) * pitch) / 2;
			return Array.from({ length: count }, (_, i) => start + i * pitch);
		};
		for (const x of along(width)) contour.lineTo(x - bite, 0).arc(x, 0, bite, 180, 0);
		contour.lineTo(width, 0);
		for (const y of along(height)) contour.lineTo(width, y - bite).arc(width, y, bite, 270, 90);
		contour.lineTo(width, height);
		for (const x of along(width).reverse())
			contour.lineTo(x + bite, height).arc(x, height, bite, 360, 180);
		contour.lineTo(0, height);
		for (const y of along(height).reverse()) contour.lineTo(0, y + bite).arc(0, y, bite, 90, -90);
		const out = new PathBuilder();
		contour.emit(out);
		cutQuietZone(out, b, b, m);
		return {
			width,
			height,
			symbol: { x: b, y: b },
			nodes: [node(out, ctx.paint)],
			textBox: box(b, b + m.h + caption * 0.15, m.w, caption * 0.7),
		};
	},
});

export const BUILT_IN_FRAMES: readonly FrameEntry[] = Object.freeze([
	none,
	banner('banner-bottom', false),
	banner('banner-top', true),
	roundedCard,
	speechBubble,
	ticket,
	polaroid,
	badgeCircle,
	phone,
	hangTag,
	cornerBrackets,
	stamp,
]);
