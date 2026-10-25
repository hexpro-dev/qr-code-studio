/**
 * Seeded scenes for the rasteriser's comparison and fuzz tests.
 *
 * Built only from `src/` and arithmetic, so the same seed gives the same scene
 * anywhere, and a failing seed can be pasted into a test and drawn again.
 */

import { PathBuilder } from '../../src/geometry/path.js';
import type { Path } from '../../src/geometry/path.js';
import type { Colour, Scene, SceneNode, ScenePaint, Stop } from '../../src/render/types.js';

/** mulberry32: small, fast and the same in every engine, which is all a test corpus needs. */
export function seeded(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

export interface SceneOptions {
	/** Scene size in user units. */
	readonly size: number;
	readonly layers: number;
	/** Allow paints and nodes with translucency (opacity, alpha). */
	readonly translucent: boolean;
	readonly groups: boolean;
	/** Allow conic paints, each with one opacity across its stops (see `conic.ts`). */
	readonly conic?: boolean;
	/** Allow image nodes, each a small smooth picture stretched over a box. */
	readonly images?: boolean;
}

export function sceneFor(seed: number, options: SceneOptions): Scene {
	const random = seeded(seed);
	const { size } = options;
	const between = (lo: number, hi: number): number => lo + (hi - lo) * random();
	const int = (n: number): number => Math.floor(random() * n);
	const colour = (alpha: boolean): Colour => ({
		r: int(256),
		g: int(256),
		b: int(256),
		a: alpha && options.translucent ? Math.round(between(0.3, 1) * 255) / 255 : 1,
	});
	const stops = (): Stop[] => {
		const count = 2 + int(3);
		const out: Stop[] = [];
		for (let i = 0; i < count; i += 1) out.push({ offset: i / (count - 1), colour: colour(true) });
		return out;
	};
	const paint = (): ScenePaint => {
		const kind = int(options.conic === true ? 4 : 3);
		if (kind === 3) {
			const alpha =
				options.translucent && int(2) === 0 ? Math.round(between(0.3, 1) * 255) / 255 : 1;
			return {
				kind: 'conic',
				cx: between(0, size),
				cy: between(0, size),
				angle: between(-360, 720),
				stops: stops().map((stop) => ({ ...stop, colour: { ...stop.colour, a: alpha } })),
			};
		}
		if (kind === 0) return { kind: 'solid', colour: colour(true) };
		if (kind === 1) {
			return {
				kind: 'linear',
				x1: between(0, size),
				y1: between(0, size),
				x2: between(0, size),
				y2: between(0, size),
				stops: stops(),
			};
		}
		return {
			kind: 'radial',
			cx: between(0, size),
			cy: between(0, size),
			r: between(size / 8, size),
			stops: stops(),
		};
	};
	const shape = (builder: PathBuilder): void => {
		const kind = int(6);
		const x = between(-size / 8, size);
		const y = between(-size / 8, size);
		const w = between(size / 16, size / 2);
		const h = between(size / 16, size / 2);
		if (kind === 0) builder.rect(x, y, w, h);
		else if (kind === 1)
			builder.roundedRect(x, y, w, h, [between(0, w), between(0, w), between(0, h), between(0, h)]);
		else if (kind === 2) builder.circle(x, y, between(size / 20, size / 4));
		else if (kind === 3) {
			const points: number[] = [];
			const n = 3 + int(6);
			for (let i = 0; i < n; i += 1) points.push(between(x, x + w), between(y, y + h));
			builder.polygon(points);
		} else if (kind === 4) {
			builder
				.moveTo(x, y)
				.cubicTo(
					x + between(0, w),
					y - between(0, h),
					x + w + between(0, w),
					y + between(0, h),
					x + w,
					y + h,
				)
				.quadTo(x + between(-w, w), y + h + between(0, h), x, y + h)
				.close();
		} else {
			// A ring: a hole wound the other way.
			const r = between(size / 10, size / 4);
			builder
				.circle(x, y, r)
				.transform([-1, 0, 0, 1, 2 * x, 0])
				.circle(x, y, r * between(0.3, 0.8))
				.transform([1, 0, 0, 1, 0, 0]);
		}
	};
	const path = (): Path => {
		const builder = new PathBuilder();
		const count = 1 + int(3);
		for (let i = 0; i < count; i += 1) shape(builder);
		return builder.build();
	};
	const image = (): SceneNode => {
		const width = 2 + int(6);
		const height = 2 + int(6);
		const corners = [colour(true), colour(true), colour(true), colour(true)];
		const data = new Uint8ClampedArray(width * height * 4);
		for (let y = 0; y < height; y += 1) {
			for (let x = 0; x < width; x += 1) {
				// A smooth blend of four corner colours, so the picture is about
				// placement and filtering rather than texture.
				const u = width === 1 ? 0 : x / (width - 1);
				const v = height === 1 ? 0 : y / (height - 1);
				const at = (y * width + x) * 4;
				const mix = (key: 'r' | 'g' | 'b'): number =>
					(1 - u) * (1 - v) * corners[0]![key] +
					u * (1 - v) * corners[1]![key] +
					(1 - u) * v * corners[2]![key] +
					u * v * corners[3]![key];
				data[at] = mix('r');
				data[at + 1] = mix('g');
				data[at + 2] = mix('b');
				data[at + 3] = 255;
			}
		}
		return {
			kind: 'image',
			image: { width, height, data },
			x: between(-size / 8, size / 2),
			y: between(-size / 8, size / 2),
			width: between(size / 8, size / 1.5),
			height: between(size / 8, size / 1.5),
			...(int(2) === 0 ? { clip: path() } : {}),
		};
	};
	const node = (depth: number): SceneNode => {
		if (options.images === true && int(4) === 0) return image();
		if (options.groups && depth < 2 && int(4) === 0) {
			const children: SceneNode[] = [];
			const count = 1 + int(3);
			for (let i = 0; i < count; i += 1) children.push(node(depth + 1));
			return {
				kind: 'group',
				children,
				...(int(2) === 0 ? { clip: path() } : {}),
				...(options.translucent && int(2) === 0
					? { opacity: Math.round(between(0.3, 1) * 100) / 100 }
					: {}),
			};
		}
		return { kind: 'path', path: path(), paint: paint() };
	};
	const layers: SceneNode[] = [];
	for (let i = 0; i < options.layers; i += 1) layers.push(node(0));
	return {
		width: size,
		height: size,
		background: { kind: 'solid', colour: colour(false) },
		layers,
	};
}
