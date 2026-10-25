import { DOMParser } from '@xmldom/xmldom';
import type { Element } from '@xmldom/xmldom';
import { describe, expect, it } from 'vitest';
import { PathBuilder } from '../../src/geometry/path.js';
import { parseColour } from '../../src/render/colour.js';
import { clipToBox, conicWedges } from '../../src/render/conic.js';
import { conicOffset } from '../../src/render/paint.js';
import { rasterise } from '../../src/render/raster.js';
import { sceneToSvg } from '../../src/render/svg.js';
import type { Scene, ScenePaint, Stop } from '../../src/render/types.js';

const black = parseColour('#000000');
const white = parseColour('#ffffff');
const ramp: Stop[] = [
	{ offset: 0, colour: black },
	{ offset: 1, colour: white },
];

function conic(
	angle: number,
	stops: readonly Stop[] = ramp,
): Extract<ScenePaint, { kind: 'conic' }> {
	return { kind: 'conic', cx: 50, cy: 50, angle, stops };
}

function filled(paint: ScenePaint): Scene {
	return { width: 100, height: 100, background: paint, layers: [] };
}

function grey(scene: Scene, x: number, y: number): number {
	const image = rasterise(scene, { width: 100 });
	return image.data[(y * 100 + x) * 4] as number;
}

/** What a pixel's centre should read, worked out with Math.atan2 as an outside check. */
function expected(x: number, y: number, angle: number): number {
	let t = (Math.atan2(y + 0.5 - 50, x + 0.5 - 50) - (angle * Math.PI) / 180) / (2 * Math.PI);
	t -= Math.floor(t);
	return Math.floor(t * 255 + 0.5);
}

describe('conic paints in the rasteriser', () => {
	it('run clockwise from the start angle, once round', () => {
		for (const angle of [0, 90, -45, 400]) {
			for (const [x, y] of [
				[80, 50],
				[50, 80],
				[20, 50],
				[50, 20],
				[71, 29],
				[13, 77],
			] as const) {
				expect(
					Math.abs(grey(filled(conic(angle)), x, y) - expected(x, y, angle)),
				).toBeLessThanOrEqual(1);
			}
		}
	});

	it('put offset zero on the start ray and wrap to it just before', () => {
		expect(conicOffset(1, 0, 0)).toBe(0);
		expect(conicOffset(0, 1, 0)).toBe(0.25);
		expect(conicOffset(-1, 0, 0)).toBe(0.5);
		expect(conicOffset(0, -1, 0)).toBe(0.75);
		expect(conicOffset(1, -1e-12, 0)).toBeGreaterThan(0.999);
		expect(conicOffset(0, 0, 0)).toBe(0);
	});

	it('respect a hard stop exactly where it falls', () => {
		const stops: Stop[] = [
			{ offset: 0, colour: black },
			{ offset: 0.5, colour: black },
			{ offset: 0.5, colour: white },
			{ offset: 1, colour: white },
		];
		// Below the centre is a quarter turn, above it three quarters.
		expect(grey(filled(conic(0, stops)), 50, 90)).toBe(0);
		expect(grey(filled(conic(0, stops)), 50, 10)).toBe(255);
	});
});

describe('conic paints in SVG', () => {
	function parse(svg: string): Element {
		const root = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement;
		if (root === null) throw new Error('no root');
		return root;
	}

	it('become wedges in a group clipped to the shape', () => {
		const path = new PathBuilder().circle(50, 50, 40).build();
		const svg = sceneToSvg({
			width: 100,
			height: 100,
			background: null,
			layers: [{ kind: 'path', path, paint: conic(30) }],
		});
		const root = parse(svg);
		const [group] = Array.from(root.getElementsByTagName('g'));
		expect(group?.getAttribute('clip-path')).toBe('url(#qrs-1)');
		expect(group?.hasAttribute('opacity')).toBe(false);
		const wedges = Array.from(group?.getElementsByTagName('path') ?? []);
		// Black to white is 255 levels, cut one wedge a level; neighbours that
		// round to the same colour are joined, so a few fewer fans than that.
		expect(wedges.length).toBeGreaterThan(220);
		expect(wedges.length).toBeLessThanOrEqual(255);
		// Each wedge takes the colour at its middle, so the ends are within a
		// level of the stops.
		expect(['#000000', '#010101']).toContain(wedges[0]?.getAttribute('fill'));
		expect(['#fefefe', '#ffffff']).toContain(wedges[wedges.length - 1]?.getAttribute('fill'));
		expect(
			sceneToSvg({
				width: 100,
				height: 100,
				background: null,
				layers: [{ kind: 'path', path, paint: conic(30) }],
			}),
		).toBe(svg);
	});

	it('carry one shared opacity on the group, and draw mixed opacities edge to edge', () => {
		const half = ramp.map((stop) => ({ ...stop, colour: { ...stop.colour, a: 0.5 } }));
		const root = parse(sceneToSvg(filled(conic(0, half))));
		const [group] = Array.from(root.getElementsByTagName('g'));
		expect(group?.getAttribute('opacity')).toBe('0.5');
		for (const wedge of Array.from(group?.getElementsByTagName('path') ?? [])) {
			expect(wedge.hasAttribute('fill-opacity')).toBe(false);
		}
		const mixed = [
			{ offset: 0, colour: parseColour('#ff000080') },
			{ offset: 1, colour: parseColour('#0000ff') },
		];
		const wedges = conicWedges(
			{ kind: 'conic', cx: 50, cy: 50, angle: 0, stops: mixed },
			{ x: 0, y: 0, width: 100, height: 100 },
		);
		expect(wedges.opacity).toBe(1);
		expect(wedges.fans.some((fan) => fan.a < 1)).toBe(true);
		// Opaque first, then translucent: the opaque fans stop being drawn on
		// where the translucent ones begin.
		const reversed = conicWedges(
			{
				kind: 'conic',
				cx: 50,
				cy: 50,
				angle: 0,
				stops: [
					{ offset: 0, colour: mixed[1]!.colour },
					{ offset: 0.5, colour: mixed[1]!.colour },
					{ offset: 1, colour: mixed[0]!.colour },
				],
			},
			{ x: 0, y: 0, width: 100, height: 100 },
		);
		expect(reversed.fans[0]?.a).toBe(1);
		expect(reversed.fans[reversed.fans.length - 1]?.a).toBeLessThan(1);
	});

	it('use the fewest wedges the colours allow, within the angular limits', () => {
		const box = { x: 0, y: 0, width: 100, height: 100 };
		const same = conicWedges(
			{ kind: 'conic', cx: 50, cy: 50, angle: 0, stops: [ramp[0]!, { offset: 1, colour: black }] },
			box,
		);
		// One colour all round: one fan.
		expect(same.fans).toHaveLength(1);
		const gentle = conicWedges(
			{
				kind: 'conic',
				cx: 50,
				cy: 50,
				angle: 0,
				stops: [
					{ offset: 0.25, colour: black },
					{ offset: 0.75, colour: parseColour('#030303') },
				],
			},
			box,
		);
		// The padding either side is one fan each and the slope a handful.
		expect(gentle.fans.length).toBeLessThanOrEqual(6);
		const steep = conicWedges(
			{
				kind: 'conic',
				cx: 50,
				cy: 50,
				angle: 0,
				stops: [
					{ offset: 0, colour: black },
					{ offset: 0.01, colour: white },
				],
			},
			box,
		);
		// 255 levels in a hundredth of a turn is capped at a quarter degree a wedge.
		expect(steep.fans.length).toBeLessThan(40);
	});

	it('keep every point inside the box they cover', () => {
		const box = { x: 10, y: 20, width: 30, height: 40 };
		const { fans } = conicWedges({ kind: 'conic', cx: -500, cy: 900, angle: 12, stops: ramp }, box);
		expect(fans.length).toBeGreaterThan(0);
		for (const fan of fans) {
			for (let i = 0; i < fan.points.length; i += 2) {
				expect(fan.points[i]).toBeGreaterThanOrEqual(10 - 1e-9);
				expect(fan.points[i]).toBeLessThanOrEqual(40 + 1e-9);
				expect(fan.points[i + 1]).toBeGreaterThanOrEqual(20 - 1e-9);
				expect(fan.points[i + 1]).toBeLessThanOrEqual(60 + 1e-9);
			}
		}
		// A centre absurdly far away gives nothing rather than infinities.
		const far = conicWedges({ kind: 'conic', cx: 1e300, cy: 0, angle: 0, stops: ramp }, box);
		for (const fan of far.fans)
			for (const value of fan.points) expect(Number.isFinite(value)).toBe(true);
	});

	it('clip polygons to a box exactly', () => {
		const box = { x: 0, y: 0, width: 10, height: 10 };
		expect(clipToBox([2, 2, 8, 2, 8, 8], box)).toEqual([2, 2, 8, 2, 8, 8]);
		expect(clipToBox([20, 20, 30, 20, 30, 30], box)).toEqual([]);
		expect(clipToBox([-10, 5, 20, 5, 5, 20], box)).toEqual([0, 5, 10, 5, 10, 10, 0, 10]);
	});

	it('cover the scene when used as the background', () => {
		const root = parse(sceneToSvg(filled(conic(0))));
		const [clip] = Array.from(root.getElementsByTagName('clipPath'));
		expect(clip?.getElementsByTagName('path')[0]?.getAttribute('d')).toBe(
			'M0 0L100 0L100 100L0 100Z',
		);
	});
});
