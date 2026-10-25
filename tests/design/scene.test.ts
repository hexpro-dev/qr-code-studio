import { describe, expect, it } from 'vitest';
import { BitMatrix } from '../../src/core/bit-matrix.js';
import { Registry } from '../../src/core/registry.js';
import { createDesignRegistries } from '../../src/design/registries.js';
import { buildScene } from '../../src/design/scene.js';
import type { DesignRegistries, ModuleShape, RegionStyle } from '../../src/design/types.js';
import { traceGrid } from '../../src/geometry/trace.js';
import { PathBuilder } from '../../src/geometry/path.js';
import { rasterise } from '../../src/render/raster.js';
import { sceneToSvg } from '../../src/render/svg.js';
import type { Scene, SceneNode } from '../../src/render/types.js';
import { ROLE_CODES } from '../../src/symbology/roles.js';
import type { BuiltSymbol } from '../../src/symbology/types.js';
import { designWith } from './helpers.js';
import { microSymbol, qrSymbol, rmqrSymbol } from './symbols.js';

const registries = createDesignRegistries();
const v2 = qrSymbol('https://example.com/scene', 'M', { minVersion: '2', maxVersion: '2' });
const v7 = qrSymbol('https://example.com/scene', 'M', { minVersion: '7', maxVersion: '7' });

function roles(scene: Scene): string[] {
	return scene.layers.map((node) => (node.kind === 'path' ? (node.role ?? 'path') : node.kind));
}

function pathOf(node: SceneNode | undefined) {
	if (node === undefined || node.kind !== 'path') throw new Error('a path node was expected');
	return node;
}

/** The alpha of one layer drawn alone, at the centre of module (x, y), 8 pixels a module. */
function inkAt(scene: Scene, layer: SceneNode, x: number, y: number, quiet = 4): number {
	const image = rasterise(
		{ ...scene, background: null, layers: [layer] },
		{ width: scene.width * 8 },
	);
	const px = (quiet + x) * 8 + 4;
	const py = (quiet + y) * 8 + 4;
	return image.data[(py * image.width + px) * 4 + 3] as number;
}

const circleEyes: RegionStyle = { outer: { id: 'circle' }, inner: { id: 'circle-centre' } };

describe('buildScene', () => {
	it('draws a classic code as one traced outline under three square finders', () => {
		const built = buildScene(v2, designWith({}), { registries });
		const { scene } = built;
		expect(scene.width).toBe(25 + 8);
		expect(scene.height).toBe(33);
		expect(scene.background).toEqual({ kind: 'solid', colour: { r: 255, g: 255, b: 255, a: 1 } });
		expect(scene.title).toBe('QR code');
		expect(scene).not.toHaveProperty('unitsPerMm');
		expect(roles(scene)).toEqual(['modules', 'region-outer', 'region-inner']);
		const { width } = v2.matrix;
		const expected = traceGrid(width, width, (x, y) => {
			const at = y * width + x;
			const role = v2.layout.roles[at] as number;
			const region = [ROLE_CODES.finder, ROLE_CODES.separator, ROLE_CODES.alignment].includes(role);
			return v2.matrix.data[at] === 1 && !region;
		});
		expect(pathOf(scene.layers[0]).path).toEqual(
			new PathBuilder().transform([1, 0, 0, 1, 4, 4]).append(expected).build(),
		);
		expect(built.inkFraction).toBe(1);
		expect(built.obscured).toEqual(new Uint8Array(25 * 25));
		expect(built.issues).toEqual([]);
	});

	it('lays the layers in order: frame, background, light modules, modules, rings, centres, plate, logo', () => {
		const design = designWith({
			modules: {
				shape: { id: 'dot' },
				paint: { kind: 'solid', ink: '#102030' },
				light: { shape: { id: 'dot' }, paint: { kind: 'solid', ink: '#ffffff' } },
			},
			logo: {
				source: { kind: 'icon', id: 'wifi' },
				size: 0.2,
				clear: 'box',
				padding: 1,
				plate: { paint: { kind: 'solid', ink: '#eeeeee' }, shape: 'rounded' },
			},
			frame: { ref: { id: 'rounded-card' } },
		});
		const { scene } = buildScene(v7, design, { registries });
		expect(scene.background).toBeNull();
		expect(roles(scene)).toEqual([
			'frame',
			'background',
			'light-modules',
			'light-regions',
			'modules',
			'region-outer',
			'region-inner',
			'logo-plate',
			'logo',
		]);
	});

	it('draws alignment patterns with the finder style, and nothing of theirs with the module shape', () => {
		const { scene } = buildScene(v7, designWith({ regions: { finder: circleEyes } }), {
			registries,
		});
		const modules = scene.layers[0] as SceneNode;
		const ring = scene.layers[1] as SceneNode;
		// v7 has an alignment pattern centred at 22, 22; its ring module at 20, 22.
		expect(inkAt(scene, modules, 20, 22)).toBe(0);
		expect(inkAt(scene, ring, 20, 22)).toBe(255);
		// The ring's corner module is left for the circle to round off.
		expect(inkAt(scene, ring, 20, 20)).toBeLessThan(255);
	});

	it('counts neighbours over the modules the module shape draws, never a finder', () => {
		const seen = new Map<string, number>();
		const spy: ModuleShape = {
			id: 'spy',
			labelKey: 'design.module.square',
			params: [],
			connects: true,
			path({ neighbours }, out) {
				out.rect(0, 0, 1, 1);
				seen.set(`${neighbours}`, (seen.get(`${neighbours}`) ?? 0) + 1);
			},
		};
		const own: DesignRegistries = {
			...registries,
			moduleShapes: new Registry('module-shape', [spy]),
		};
		buildScene(
			v2,
			designWith({
				modules: { shape: { id: 'spy' }, paint: { kind: 'solid', ink: '#000' }, light: null },
			}),
			{
				registries: own,
			},
		);
		// The timing module at 8, 6 sits beside the top left separator, and the
		// dark module at 8, 17 above the bottom left finder's separator. Neither
		// is told of a finder module as a neighbour: the masks the spy saw are
		// all masks of the module shape's own cells.
		const width = v2.matrix.width;
		const drawn = (x: number, y: number): boolean => {
			if (x < 0 || y < 0 || x >= width || y >= width) return false;
			const role = v2.layout.roles[y * width + x] as number;
			return (
				v2.matrix.data[y * width + x] === 1 &&
				![ROLE_CODES.finder, ROLE_CODES.separator, ROLE_CODES.alignment].includes(role)
			);
		};
		const expected = new Set<string>();
		for (let y = 0; y < width; y += 1) {
			for (let x = 0; x < width; x += 1) {
				if (!drawn(x, y)) continue;
				let mask = 0;
				const offsets = [
					[0, -1],
					[1, -1],
					[1, 0],
					[1, 1],
					[0, 1],
					[-1, 1],
					[-1, 0],
					[-1, -1],
				];
				offsets.forEach(([dx, dy], bit) => {
					if (drawn(x + (dx as number), y + (dy as number))) mask |= 1 << bit;
				});
				expected.add(`${mask}`);
			}
		}
		expect([...seen.keys()].sort()).toEqual([...expected].sort());
	});

	it('draws a shape that ignores its stream once per neighbour mask, and one that uses it every time', () => {
		let calls = 0;
		const counted: ModuleShape = {
			id: 'counted',
			labelKey: 'design.module.square',
			params: [],
			connects: false,
			path(_ctx, out) {
				calls += 1;
				out.rect(0.1, 0.1, 0.8, 0.8);
			},
		};
		const own: DesignRegistries = {
			...registries,
			moduleShapes: new Registry('module-shape', [counted]),
		};
		const built = buildScene(
			v7,
			designWith({
				modules: { shape: { id: 'counted' }, paint: { kind: 'solid', ink: '#000' }, light: null },
			}),
			{
				registries: own,
			},
		);
		expect(calls).toBeLessThanOrEqual(256);
		expect(built.inkFraction).toBeCloseTo(0.64, 3);

		const mosaic = buildScene(
			v7,
			designWith({
				modules: { shape: { id: 'mosaic' }, paint: { kind: 'solid', ink: '#000' }, light: null },
			}),
			{
				registries,
				seed: 4,
			},
		);
		const again = buildScene(
			v7,
			designWith({
				modules: { shape: { id: 'mosaic' }, paint: { kind: 'solid', ink: '#000' }, light: null },
			}),
			{
				registries,
				seed: 4,
			},
		);
		const other = buildScene(
			v7,
			designWith({
				modules: { shape: { id: 'mosaic' }, paint: { kind: 'solid', ink: '#000' }, light: null },
			}),
			{
				registries,
				seed: 5,
			},
		);
		expect(sceneToSvg(mosaic.scene)).toBe(sceneToSvg(again.scene));
		expect(sceneToSvg(mosaic.scene)).not.toBe(sceneToSvg(other.scene));
		expect(mosaic.inkFraction).toBeGreaterThan(0.45);
		expect(mosaic.inkFraction).toBeLessThan(1);
	});

	it('treats a shape that draws from its stream in any way as one to draw every time', () => {
		let calls = 0;
		const forked: ModuleShape = {
			id: 'forked',
			labelKey: 'design.module.square',
			params: [],
			connects: false,
			path({ prng }, out) {
				calls += 1;
				const inset = (prng.int(3) + prng.fork(1).next()) / 40;
				out.rect(inset, inset, 1 - 2 * inset, 1 - 2 * inset);
			},
		};
		const own: DesignRegistries = {
			...registries,
			moduleShapes: new Registry('module-shape', [forked]),
		};
		buildScene(
			v2,
			designWith({
				modules: { shape: { id: 'forked' }, paint: { kind: 'solid', ink: '#000' }, light: null },
			}),
			{ registries: own },
		);
		const dark = v2.matrix.data.filter(
			(value, i) =>
				value === 1 &&
				![ROLE_CODES.finder, ROLE_CODES.separator, ROLE_CODES.alignment].includes(
					v2.layout.roles[i] as number,
				),
		).length;
		expect(calls).toBe(dark);
	});

	it('measures the ink a dot leaves in its cell', () => {
		const built = buildScene(
			v7,
			designWith({
				modules: {
					shape: { id: 'dot', params: { size: 0.9 } },
					paint: { kind: 'solid', ink: '#000' },
					light: null,
				},
			}),
			{
				registries,
			},
		);
		expect(built.inkFraction).toBeCloseTo(Math.PI * 0.45 * 0.45, 2);
	});

	it('gives each module its own gradient in module space, and groups a palette by colour', () => {
		const stops = [
			{ offset: 0, ink: '#000000' },
			{ offset: 1, ink: '#333333' },
		];
		const perModule = buildScene(
			v2,
			designWith({
				modules: {
					shape: { id: 'square' },
					paint: { kind: 'linear', angle: 0, stops, space: 'module' },
					light: null,
				},
			}),
			{
				registries,
			},
		);
		const modules = perModule.scene.layers.filter(
			(node) => node.kind === 'path' && node.role === 'modules',
		);
		expect(modules.length).toBeGreaterThan(100);
		// Each module's gradient runs across that module alone.
		const first = pathOf(modules[0]).paint;
		if (first.kind !== 'linear') throw new Error('a linear paint was expected');
		expect(first.x2 - first.x1).toBe(1);
		expect(first.y1).toBe(first.y2);
		const palette = buildScene(
			v2,
			designWith({
				modules: {
					shape: { id: 'rounded' },
					paint: { kind: 'entry', ref: { id: 'palette-scatter', params: { count: 3 } } },
					light: null,
				},
			}),
			{ registries },
		);
		expect(
			palette.scene.layers.filter((node) => node.kind === 'path' && node.role === 'modules'),
		).toHaveLength(3);
	});

	it('gives the scene a physical size and a name, never the content', () => {
		const built = buildScene(
			v2,
			designWith({ output: { sizeMm: 33, colourSpace: 'srgb' }, name: 'Menu' }),
			{ registries },
		);
		expect(built.scene.unitsPerMm).toBe(1);
		expect(built.scene.title).toBe('Menu');
		expect(
			buildScene(microSymbol('12345'), designWith({ quietZone: 2 }), { registries }).scene.title,
		).toBe('Micro QR code');
		expect(
			buildScene(rmqrSymbol('HELLO', 'R7x43'), designWith({ quietZone: 2 }), { registries }).scene
				.title,
		).toBe('Rectangular Micro QR code');
		const unknown: BuiltSymbol = { ...v2, symbology: 'aztec' };
		const unusable = buildScene(unknown, designWith({ quietZone: 1.5 }), { registries });
		expect(unusable.scene.width).toBe(25 + 8);
		expect(unusable.issues.map((found) => found.code)).toEqual(['design.issue.quiet-zone']);
		expect(buildScene(unknown, designWith({}), { registries }).scene.title).toBe('Code');
		expect(sceneToSvg(built.scene)).not.toContain('example.com');
	});

	it('draws what it cannot draw as asked the plain way, and says so', () => {
		const design = designWith({
			quietZone: -1,
			background: { kind: 'entry', ref: { id: 'plaid' } },
			modules: {
				shape: { id: 'sparkle', params: { size: 1 } },
				paint: { kind: 'entry', ref: { id: 'plaid' } },
				light: {
					shape: { id: 'dot', params: { size: 7, other: 1 } },
					paint: { kind: 'entry', ref: { id: 'plaid' } },
				},
			},
			regions: { finder: { outer: { id: 'blob' }, inner: { id: 'circle-centre' } } },
			frame: { ref: { id: 'neon' } },
		});
		const built = buildScene(v2, design, { registries });
		expect(
			built.issues.map((found) => `${found.severity} ${found.code} ${found.path.join('.')}`),
		).toEqual([
			'warning design.issue.quiet-zone quietZone',
			'warning design.issue.unknown-entry frame.ref.id',
			'warning design.issue.unknown-entry background.ref.id',
			'warning design.issue.param-ignored modules.light.shape.params.size',
			'warning design.issue.param-ignored modules.light.shape.params.other',
			'warning design.issue.unknown-entry modules.light.paint.ref.id',
			'warning design.issue.unknown-entry modules.shape.id',
			'warning design.issue.unknown-entry modules.paint.ref.id',
			'warning design.issue.unknown-entry regions.finder.outer.id',
		]);
		expect(built.scene.width).toBe(25 + 8);
		expect(built.scene.background).toEqual({
			kind: 'solid',
			colour: { r: 255, g: 255, b: 255, a: 1 },
		});
		const modules = built.scene.layers.find(
			(node) => node.kind === 'path' && node.role === 'modules',
		);
		expect(pathOf(modules).paint).toEqual({ kind: 'solid', colour: { r: 0, g: 0, b: 0, a: 1 } });
	});

	it('reports a ring or centre that cannot draw the region, and a pair the strict reader would miss', () => {
		const kinds = buildScene(
			rmqrSymbol('HELLO', 'R11x43'),
			designWith({
				quietZone: 2,
				regions: {
					finder: { outer: { id: 'square' }, inner: { id: 'square-centre' } },
					'sub-finder': { outer: { id: 'square' }, inner: { id: 'star-centre' } },
					'corner-finder': { outer: { id: 'circle-centre' }, inner: { id: 'square-centre' } },
				},
			}),
			{ registries },
		);
		expect(
			kinds.issues.map((found) => `${found.severity} ${found.code} ${found.path.join('.')}`),
		).toEqual([
			'info design.issue.region-kind regions.sub-finder.inner',
			'warning design.issue.unknown-entry regions.corner-finder.outer.id',
		]);
		const kindShapes = createDesignRegistries();
		const sevenOnly = {
			...kindShapes.regionShapes.require('square'),
			id: 'seven-only',
			kinds: ['concentric-7', 'corner-l'] as const,
		};
		const withSeven: DesignRegistries = {
			...kindShapes,
			regionShapes: new Registry('region-shape', [...kindShapes.regionShapes.list(), sevenOnly]),
		};
		const outerKind = buildScene(
			rmqrSymbol('HELLO', 'R11x43'),
			designWith({
				quietZone: 2,
				regions: { 'sub-finder': { outer: { id: 'seven-only' }, inner: { id: 'square-centre' } } },
			}),
			{ registries: withSeven },
		);
		expect(outerKind.issues.map((found) => `${found.code} ${found.path.join('.')}`)).toEqual([
			'design.issue.region-kind regions.sub-finder.outer',
		]);
		const pair = buildScene(
			v2,
			designWith({
				regions: { finder: { outer: { id: 'circle' }, inner: { id: 'square-centre' } } },
			}),
			{ registries },
		);
		expect(pair.issues).toEqual([
			{
				code: 'design.issue.region-pair',
				path: ['regions', 'finder'],
				severity: 'warning',
				params: { kind: 'concentric-7' },
			},
		]);
		const kind = buildScene(
			v2,
			designWith({
				regions: { finder: { outer: { id: 'square' }, inner: { id: 'flower-centre' } } },
			}),
			{ registries },
		);
		expect(kind.issues).toEqual([]);
		// The flower has no one-module form, so v7's alignment patterns are drawn plainly, without a word.
		expect(
			buildScene(
				v7,
				designWith({
					regions: { finder: { outer: { id: 'square' }, inner: { id: 'flower-centre' } } },
				}),
				{ registries },
			).issues,
		).toEqual([]);
		const shapes = createDesignRegistries();
		const ringless: DesignRegistries = {
			...shapes,
			regionShapes: new Registry(
				'region-shape',
				shapes.regionShapes.list().filter((shape) => shape.part === 'inner'),
			),
		};
		const plain = buildScene(v7, designWith({}), { registries: ringless });
		expect(plain.issues.map((found) => found.code)).toEqual(['design.issue.unknown-entry']);
		expect(roles(plain.scene)).toEqual(['modules', 'region-outer']);
		// A design whose centre is missing draws each region plainly in its ring's paint.
		const centreless = buildScene(
			v2,
			designWith({ regions: { finder: { outer: { id: 'circle' }, inner: { id: 'gone' } } } }),
			{ registries },
		);
		expect(roles(centreless.scene)).toEqual(['modules', 'region-outer']);
	});

	it('keeps Micro QR and rMQR rings square and their small patterns plain', () => {
		const styled = designWith({
			quietZone: 2,
			regions: {
				finder: { outer: { id: 'circle' }, inner: { id: 'circle-centre' } },
				'sub-finder': { outer: { id: 'circle' }, inner: { id: 'circle-centre' } },
				'corner-finder': { outer: { id: 'rounded' }, inner: { id: 'square-centre' } },
			},
		});
		const symbol = rmqrSymbol('HELLO', 'R13x43');
		const built = buildScene(symbol, styled, { registries });
		expect(built.issues.map((found) => found.path.join('.'))).toEqual([
			'regions.finder',
			'regions.sub-finder',
			'regions.corner-finder',
		]);
		const ring = built.scene.layers.find(
			(node) => node.kind === 'path' && node.role === 'region-outer',
		) as SceneNode;
		// The finder's corner module and the corner pattern's are both inked whole.
		expect(inkAt(built.scene, ring, 0, 0, 2)).toBe(255);
		expect(inkAt(built.scene, ring, symbol.matrix.width - 1, 0, 2)).toBe(255);
		expect(inkAt(built.scene, ring, 0, symbol.matrix.height - 1, 2)).toBe(255);
		const micro = buildScene(microSymbol('12345'), styled, { registries });
		expect(micro.issues.map((found) => found.path.join('.'))).toEqual(['regions.finder']);
		const square = buildScene(microSymbol('12345'), designWith({ quietZone: 2 }), { registries });
		expect(square.issues).toEqual([]);
	});

	it('styles a corner pattern on a symbol with three finders, turned as its region says', () => {
		// No built-in symbology has both; a symbology added later might.
		const withCorner: BuiltSymbol = {
			...v2,
			layout: {
				...v2.layout,
				regions: [
					...v2.layout.regions,
					{
						role: 'corner-finder',
						kind: 'corner-l',
						x: 22,
						y: 22,
						width: 3,
						height: 3,
						rotation: 180,
					},
				],
			},
		};
		const built = buildScene(
			withCorner,
			designWith({
				regions: { 'corner-finder': { outer: { id: 'rounded' }, inner: { id: 'square-centre' } } },
			}),
			{ registries },
		);
		expect(built.issues).toEqual([]);
		const rings = built.scene.layers.filter(
			(node) => node.kind === 'path' && node.role === 'region-outer',
		);
		// Turned half a turn, the L's corner is at the bottom right of its box.
		expect(inkAt(built.scene, rings.at(-1) as SceneNode, 24, 24)).toBe(255);
		expect(inkAt(built.scene, rings.at(-1) as SceneNode, 22, 22)).toBe(0);
	});

	it('leaves a frame off rMQR, and keeps one round Micro QR', () => {
		const framed = designWith({ quietZone: 2, frame: { ref: { id: 'stamp' } } });
		const rmqr = buildScene(rmqrSymbol('HELLO', 'R7x43'), framed, { registries });
		expect(rmqr.issues.map((found) => found.code)).toEqual(['design.issue.frame-unsupported']);
		expect(rmqr.scene.width).toBe(43 + 4);
		expect(
			buildScene(
				rmqrSymbol('HELLO', 'R7x43'),
				designWith({ quietZone: 2, frame: { ref: { id: 'none' } } }),
				{ registries },
			).issues,
		).toEqual([]);
		const micro = buildScene(microSymbol('12345'), framed, { registries });
		expect(micro.issues).toEqual([]);
		expect(micro.scene.width).toBeGreaterThan(15);
	});

	it('lays the symbol into its frame, with the background on its quiet zone and the caption on top', () => {
		const built = buildScene(
			v2,
			designWith({
				frame: {
					ref: { id: 'banner-bottom', params: { border: 0.05 } },
					paint: {
						kind: 'linear',
						angle: 90,
						space: 'symbol',
						stops: [
							{ offset: 0, ink: '#000000' },
							{ offset: 1, ink: '#333333' },
						],
					},
					text: { content: 'Scan me', fontId: 'plex-sans-bold' },
				},
			}),
			{ registries },
		);
		expect(built.issues).toEqual([]);
		expect(roles(built.scene).at(-1)).toBe('caption');
		const frame = pathOf(built.scene.layers[0]);
		// The frame's gradient spans the whole artwork, top to bottom.
		expect(frame.paint).toMatchObject({ kind: 'linear', y1: 0, y2: built.scene.height });
		const plate = pathOf(built.scene.layers[1]);
		expect(plate.role).toBe('background');
		const border = 0.05 * 33;
		expect(plate.path.points.slice(0, 2)).toEqual(Float64Array.of(border, border));
		const empty = buildScene(
			v2,
			designWith({
				frame: { ref: { id: 'banner-bottom' }, text: { content: '', fontId: 'plex-sans-bold' } },
			}),
			{ registries },
		);
		expect(empty.issues).toEqual([]);
		const unsupported = buildScene(
			v2,
			designWith({
				frame: { ref: { id: 'none' }, text: { content: 'Scan me', fontId: 'plex-sans-bold' } },
			}),
			{ registries },
		);
		expect(unsupported.issues.map((found) => found.code)).toEqual([
			'design.issue.caption-unsupported',
		]);
		const transparent = buildScene(
			v2,
			designWith({ background: null, frame: { ref: { id: 'stamp' } } }),
			{ registries },
		);
		expect(roles(transparent.scene)[1]).toBe('modules');
	});

	it('draws frames that place nodes above the symbol last', () => {
		const shapes = createDesignRegistries();
		const over = shapes.frames.require('corner-brackets');
		const own: DesignRegistries = {
			...shapes,
			frames: new Registry('frame', [
				{
					...over,
					id: 'over',
					layout(ctx) {
						const layout = over.layout(ctx);
						return {
							...layout,
							over: layout.nodes.map((node) => ({ ...node, role: 'frame-over' })),
							nodes: [],
						};
					},
				},
			]),
		};
		const built = buildScene(v2, designWith({ frame: { ref: { id: 'over' } } }), {
			registries: own,
		});
		expect(roles(built.scene).at(-1)).toBe('frame-over');
	});

	it('is the same scene and the same SVG bytes twice', () => {
		const design = designWith({
			modules: {
				shape: { id: 'fluid' },
				paint: { kind: 'entry', ref: { id: 'two-tone-diagonal' } },
				light: null,
			},
			regions: { finder: circleEyes },
			logo: {
				source: { kind: 'icon', id: 'heart' },
				size: 0.2,
				clear: 'shape',
				padding: 1,
				plate: null,
			},
		});
		const first = buildScene(v7, design, { registries, seed: 9 });
		const second = buildScene(v7, design, { registries, seed: 9 });
		expect(second).toEqual(first);
		expect(sceneToSvg(second.scene)).toBe(sceneToSvg(first.scene));
	});

	it('measures no ink where the module shape draws nothing', () => {
		const empty: BuiltSymbol = {
			...v2,
			matrix: new BitMatrix(3, 3),
			layout: {
				width: 3,
				height: 3,
				roles: new Uint8Array(9),
				dataBits: new Int32Array(9).fill(-1),
				regions: [],
			},
		};
		const built = buildScene(
			empty,
			designWith({
				modules: { shape: { id: 'dot' }, paint: { kind: 'solid', ink: '#000' }, light: null },
			}),
			{
				registries,
			},
		);
		expect(built.inkFraction).toBe(0);
	});

	it('refuses a context or seed it cannot use', () => {
		expect(() => buildScene(v2, designWith({}), null as never)).toThrow(TypeError);
		expect(() => buildScene(v2, designWith({}), {} as never)).toThrow(TypeError);
		for (const seed of [-1, 1.5, 2 ** 32]) {
			expect(() => buildScene(v2, designWith({}), { registries, seed })).toThrow(TypeError);
		}
	});
});
