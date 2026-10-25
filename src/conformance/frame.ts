/**
 * Conformance for frames.
 *
 * A frame decorates the space round the quiet zone and must never draw in
 * it: the quiet zone is how a reader finds where the code stops, and ink in
 * it is the commonest way a styled code fails. Each frame is laid out round
 * the smallest and largest QR codes and round Micro QR and rMQR sizes, at its
 * defaults and the ends of its ranges, and the quiet zone box is rasterised
 * on its own: any coverage at all inside it is a violation. Its caption box
 * must sit inside the artwork and outside the quiet zone, and a frame that
 * takes a caption must reserve one.
 */

import { PathBuilder } from '../geometry/path.js';
import type { Path } from '../geometry/path.js';
import type { FrameEntry, FrameLayout } from '../design/types.js';
import { rasterise } from '../render/raster.js';
import type { SceneNode } from '../render/types.js';
import { sampleParams } from './sample.js';
import type { Violation } from './types.js';

export interface FrameSize {
	readonly width: number;
	readonly height: number;
	readonly quietZone: number;
}

/** QR versions 1 and 40, Micro QR M1, and the shortest and longest rMQR. */
export const FRAME_SIZES: readonly FrameSize[] = Object.freeze([
	{ width: 21, height: 21, quietZone: 4 },
	{ width: 177, height: 177, quietZone: 4 },
	{ width: 11, height: 11, quietZone: 2 },
	{ width: 43, height: 7, quietZone: 2 },
	{ width: 139, height: 17, quietZone: 2 },
]);

/** The longest side of the quiet zone box, in pixels, when it is rasterised on its own. */
const QUIET_PIXELS = 256;

export interface FrameCheckOptions {
	readonly sizes?: readonly FrameSize[];
	readonly seed?: number;
	readonly mixtures?: number;
}

function shiftPath(path: Path, dx: number, dy: number, scale: number): Path {
	return new PathBuilder()
		.transform([scale, 0, 0, scale, dx * scale, dy * scale])
		.append(path)
		.build();
}

/** A node moved by (dx, dy) and scaled, so the quiet zone box lands on the raster. */
function shift(node: SceneNode, dx: number, dy: number, scale: number): SceneNode {
	if (node.kind === 'path') return { ...node, path: shiftPath(node.path, dx, dy, scale) };
	if (node.kind === 'image') {
		return {
			...node,
			x: (node.x + dx) * scale,
			y: (node.y + dy) * scale,
			width: node.width * scale,
			height: node.height * scale,
			...(node.clip === undefined ? {} : { clip: shiftPath(node.clip, dx, dy, scale) }),
		};
	}
	return {
		...node,
		children: node.children.map((child) => shift(child, dx, dy, scale)),
		...(node.clip === undefined ? {} : { clip: shiftPath(node.clip, dx, dy, scale) }),
	};
}

/** Paths as plain arrays, so two layouts compare by value. */
function fingerprint(layout: FrameLayout): string {
	return JSON.stringify(layout, (_key, value: unknown) =>
		ArrayBuffer.isView(value) ? Array.from(value as Uint8Array) : value,
	);
}

export function checkFrame(frame: FrameEntry, options: FrameCheckOptions = {}): Violation[] {
	const violations: Violation[] = [];
	const black = { kind: 'solid' as const, colour: { r: 0, g: 0, b: 0, a: 1 } };
	for (const size of options.sizes ?? FRAME_SIZES) {
		for (const params of sampleParams(frame.params, options.seed ?? 1, options.mixtures ?? 3)) {
			const where = `${size.width} by ${size.height}, quiet zone ${size.quietZone}, params ${JSON.stringify(params)}`;
			const ctx = {
				symbolSize: { width: size.width, height: size.height },
				quietZone: size.quietZone,
				params,
				paint: black,
			};
			const layout = frame.layout(ctx);
			if (fingerprint(layout) !== fingerprint(frame.layout(ctx))) {
				violations.push({
					entry: frame.id,
					rule: 'deterministic',
					detail: `${where}: two layouts differ`,
				});
			}
			const qw = size.width + 2 * size.quietZone;
			const qh = size.height + 2 * size.quietZone;
			const { x, y } = layout.symbol;
			if (x < 0 || y < 0 || x + qw > layout.width + 1e-9 || y + qh > layout.height + 1e-9) {
				violations.push({
					entry: frame.id,
					rule: 'layout',
					detail: `${where}: the quiet zone box is not inside the artwork`,
				});
				continue;
			}
			const scale = QUIET_PIXELS / Math.max(qw, qh);
			const image = rasterise(
				{
					width: qw * scale,
					height: qh * scale,
					background: null,
					layers: [...layout.nodes, ...(layout.over ?? [])].map((node) =>
						shift(node, -x, -y, scale),
					),
				},
				{ width: Math.round(qw * scale), height: Math.round(qh * scale) },
			);
			let inked = 0;
			for (let i = 3; i < image.data.length; i += 4) if (image.data[i] !== 0) inked += 1;
			if (inked > 0) {
				violations.push({
					entry: frame.id,
					rule: 'quiet-zone',
					detail: `${where}: ${inked} pixels of the quiet zone are inked`,
				});
			}
			const box = layout.textBox;
			if (box === null) {
				if (frame.text !== null) {
					violations.push({
						entry: frame.id,
						rule: 'text-box',
						detail: `${where}: a captioned frame reserves no box`,
					});
				}
				continue;
			}
			const inside =
				box.width >= 0 &&
				box.height >= 0 &&
				box.x >= -1e-9 &&
				box.y >= -1e-9 &&
				box.x + box.width <= layout.width + 1e-9 &&
				box.y + box.height <= layout.height + 1e-9;
			const overlaps =
				box.x < x + qw && box.x + box.width > x && box.y < y + qh && box.y + box.height > y;
			if (!inside || overlaps) {
				violations.push({
					entry: frame.id,
					rule: 'text-box',
					detail: `${where}: the caption box ${overlaps ? 'overlaps the quiet zone' : 'leaves the artwork'}`,
				});
			}
		}
	}
	return violations;
}
