/**
 * The rasteriser against resvg, drawing this package's own SVG.
 *
 * resvg is an independent renderer of the SVG format, so the comparison checks
 * two things at once: that `sceneToSvg` says what the scene means, and that
 * `rasterise` draws what the SVG says.
 *
 * resvg anti-aliases coarsely: its edge coverage comes in quarters, so a pixel
 * that is 88 percent covered is drawn fully dark, 31 levels from the exact
 * answer, and a grid of modules at a fractional scale differs by 2 levels on
 * average for that reason alone. So resvg always draws at eight times the
 * size and is box filtered down in premultiplied space, which leaves its edges
 * good to about a sixtieth. Two comparisons follow from that, and they guard
 * different things:
 *
 * - Same picture. Both renderers at eight times, both filtered down the same
 *   way. Here anti-aliasing and the sampling of gradients are averaged out on
 *   both sides, so what is left is geometry and paint: a shape in the wrong
 *   place, the wrong winding, a clip that leaks or a stop misread. No pixel
 *   may differ by more than 8 levels and the mean must stay under 0.4 of one
 *   (resvg evaluates gradients in single precision, which accounts for most
 *   of the mean). Measured: worst pixel 5 levels, worst mean 0.27.
 * - Our real output. `rasterise` at the size asked for, against the filtered
 *   resvg. This samples each gradient at the pixel centre where the filtered
 *   oracle averages it over the pixel, and a steep gradient or a stop edge
 *   changes by tens of levels across one pixel, so single pixels may differ by
 *   up to 48 levels. No more than 0.5 percent of the picture may differ by
 *   more than 8, pixels whose 3 by 3 neighbourhood is flat in our render must
 *   match to 4 levels (a geometry error shows up there, away from any edge),
 *   and the mean stays under half a level. Measured: worst pixel 43, worst
 *   mean 0.27, worst share over 8 levels 0.25 percent.
 *
 * A module grid at a fractional scale has no gradient to sample, so it is held
 * to 6 levels in the second comparison too, and to exactly zero on the pixel
 * grid.
 *
 * Images and conic paints have looser limits, set out beside the corpus
 * below. Measured when they were set: images, worst pixel 13 (same picture)
 * and 15 (real output), with 0.33 percent of the picture flat and over 4
 * levels; conic paints, 14 and 129, all at the centre.
 * Conic paints in the corpus share one opacity across their stops, which is
 * the case `conic.ts` draws without seams.
 */

import { Resvg } from '@resvg/resvg-js';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { PathBuilder } from '../../src/geometry/path.js';
import { traceGrid } from '../../src/geometry/trace.js';
import { parseColour } from '../../src/render/colour.js';
import { rasterise } from '../../src/render/raster.js';
import { sceneToSvg } from '../../src/render/svg.js';
import type { RgbaImage, Scene } from '../../src/render/types.js';
import { sceneFor, seeded } from './scenes.js';

/** How much larger each oracle picture is drawn before it is filtered down. */
const OVERSAMPLE = 8;

interface Difference {
	readonly mean: number;
	readonly max: number;
	readonly overEight: number;
	readonly interiorOverFour: number;
}

/** Box filter an RGBA picture down by `k` on each side, in premultiplied space. */
function shrink(big: RgbaImage, k: number): RgbaImage {
	const width = big.width / k;
	const height = big.height / k;
	const data = new Uint8ClampedArray(width * height * 4);
	for (let y = 0; y < height; y += 1) {
		for (let x = 0; x < width; x += 1) {
			let r = 0;
			let g = 0;
			let b = 0;
			let a = 0;
			for (let dy = 0; dy < k; dy += 1) {
				for (let dx = 0; dx < k; dx += 1) {
					const at = ((y * k + dy) * big.width + x * k + dx) * 4;
					const alpha = (big.data[at + 3] as number) / 255;
					r += (big.data[at] as number) * alpha;
					g += (big.data[at + 1] as number) * alpha;
					b += (big.data[at + 2] as number) * alpha;
					a += alpha;
				}
			}
			const out = (y * width + x) * 4;
			if (a > 0) {
				data[out] = Math.round(r / a);
				data[out + 1] = Math.round(g / a);
				data[out + 2] = Math.round(b / a);
			}
			data[out + 3] = Math.round((a / (k * k)) * 255);
		}
	}
	return { width, height, data };
}

function viaResvg(scene: Scene, width: number): RgbaImage {
	const png = new Resvg(sceneToSvg(scene), { fitTo: { mode: 'width', value: width * OVERSAMPLE } })
		.render()
		.asPng();
	const decoded = PNG.sync.read(png);
	const big = {
		width: decoded.width,
		height: decoded.height,
		data: new Uint8ClampedArray(decoded.data),
	};
	return shrink(big, OVERSAMPLE);
}

function compare(ours: RgbaImage, theirs: RgbaImage): Difference {
	expect(theirs.width).toBe(ours.width);
	expect(theirs.height).toBe(ours.height);
	const { width, height } = ours;
	let sum = 0;
	let max = 0;
	let overEight = 0;
	let interiorOverFour = 0;
	for (let y = 0; y < height; y += 1) {
		for (let x = 0; x < width; x += 1) {
			const at = (y * width + x) * 4;
			let worst = 0;
			for (let c = 0; c < 4; c += 1) {
				const d = Math.abs((ours.data[at + c] as number) - (theirs.data[at + c] as number));
				sum += d;
				if (d > worst) worst = d;
			}
			if (worst > max) max = worst;
			if (worst > 8) overEight += 1;
			if (worst <= 4 || x === 0 || y === 0 || x === width - 1 || y === height - 1) continue;
			let flat = true;
			for (let dy = -1; dy <= 1; dy += 1) {
				for (let dx = -1; dx <= 1; dx += 1) {
					const near = ((y + dy) * width + x + dx) * 4;
					for (let c = 0; c < 4; c += 1) {
						const step = Math.abs((ours.data[near + c] as number) - (ours.data[at + c] as number));
						if (step > 3) flat = false;
					}
				}
			}
			if (flat) interiorOverFour += 1;
		}
	}
	const pixels = width * height;
	return {
		mean: sum / (pixels * 4),
		max,
		overEight: overEight / pixels,
		interiorOverFour: interiorOverFour / pixels,
	};
}

/** The limits a part of the corpus is held to; see the comment at the top of the file. */
interface Limits {
	readonly sameMax: number;
	readonly realMax: number;
	/** Share of the picture allowed to be flat in our render and still differ by more than 4 levels. */
	readonly interior: number;
}

const PLAIN: Limits = { sameMax: 8, realMax: 48, interior: 0 };
/**
 * resvg filters a stretched image its own way, smoother than bilinear, so
 * inside an image, where the picture is flat to the 3 by 3 test, the two can
 * differ by more than the 4 levels the geometry check allows.
 */
const IMAGES: Limits = { sameMax: 16, realMax: 48, interior: 0.01 };
/**
 * Near a conic's centre every colour of the gradient meets within a pixel or
 * two: the wedges there are thinner than resvg's samples, and our real output
 * takes the colour at the pixel's centre where the filtered oracle averages
 * the whole turn.
 */
const CONIC: Limits = { sameMax: 24, realMax: 160, interior: 0 };

function samePicture(scene: Scene, width: number, label: string, limits: Limits): void {
	const ours = shrink(rasterise(scene, { width: width * OVERSAMPLE }), OVERSAMPLE);
	const difference = compare(ours, viaResvg(scene, width));
	const report = `${label}: ${JSON.stringify(difference)}`;
	expect(difference.max, report).toBeLessThanOrEqual(limits.sameMax);
	expect(difference.mean, report).toBeLessThan(0.4);
}

function realOutput(
	scene: Scene,
	width: number,
	label: string,
	limits: Limits = PLAIN,
): Difference {
	const difference = compare(rasterise(scene, { width }), viaResvg(scene, width));
	const report = `${label}: ${JSON.stringify(difference)}`;
	expect(difference.mean, report).toBeLessThan(0.5);
	expect(difference.max, report).toBeLessThanOrEqual(limits.realMax);
	expect(difference.overEight, report).toBeLessThanOrEqual(0.005);
	expect(difference.interiorOverFour, report).toBeLessThanOrEqual(limits.interior);
	return difference;
}

const corpus: { label: string; scene: Scene; width: number; limits: Limits }[] = [];
for (let seed = 1; seed <= 40; seed += 1) {
	corpus.push({
		label: `seed ${seed}`,
		scene: sceneFor(seed, { size: 32, layers: 4, translucent: true, groups: true }),
		width: 128,
		limits: PLAIN,
	});
}
for (let seed = 100; seed < 120; seed += 1) {
	corpus.push({
		label: `opaque seed ${seed}`,
		scene: sceneFor(seed, { size: 29, layers: 6, translucent: false, groups: false }),
		width: 101,
		limits: PLAIN,
	});
}
for (let seed = 200; seed < 216; seed += 1) {
	corpus.push({
		label: `conic seed ${seed}`,
		scene: sceneFor(seed, { size: 32, layers: 4, translucent: true, groups: true, conic: true }),
		width: 128,
		limits: CONIC,
	});
	corpus.push({
		label: `image seed ${seed}`,
		scene: sceneFor(seed, { size: 32, layers: 4, translucent: true, groups: true, images: true }),
		width: 128,
		limits: IMAGES,
	});
}

describe('rasterise against resvg', () => {
	it('draws the same picture as resvg when both are oversampled', () => {
		// Every third scene: drawing our side at eight times is the slow part
		// of this file, and a third of the corpus covers every kind of node.
		for (const { label, scene, width, limits } of corpus.filter((_, i) => i % 3 === 0)) {
			samePicture(scene, width, label, limits);
		}
	});

	it('stays within anti-aliasing of resvg at the size asked for', () => {
		for (const { label, scene, width, limits } of corpus) realOutput(scene, width, label, limits);
	});

	it('matches a traced module grid at whole and fractional scales', () => {
		const random = seeded(7);
		const cells = Array.from({ length: 25 * 25 }, () => random() < 0.5);
		const grid = traceGrid(25, 25, (x, y) => cells[y * 25 + x] === true);
		const placed = new PathBuilder().transform([1, 0, 0, 1, 4, 4]).append(grid).build();
		const scene: Scene = {
			width: 33,
			height: 33,
			background: { kind: 'solid', colour: parseColour('#ffffff') },
			layers: [
				{ kind: 'path', path: placed, paint: { kind: 'solid', colour: parseColour('#000000') } },
			],
		};
		for (const width of [33, 132, 100, 77]) {
			const difference = realOutput(scene, width, `width ${width}`);
			expect(difference.max).toBeLessThanOrEqual(width % 33 === 0 ? 0 : 6);
		}
	});
});
