/**
 * A built symbol and a design, to a scene.
 *
 * The layers go down in this order: the frame's own artwork (beneath
 * everything), the background, light modules when the design draws them,
 * dark modules, finder rings, finder centres, the logo's plate, the logo, and
 * whatever the frame draws on top. Units are modules, the quiet zone
 * included, so a module is one unit wide whatever the export's size.
 *
 * Finder, separator and the rMQR sub-finder and corner modules are drawn by
 * the region shapes, and so are QR's 5 by 5 alignment patterns, in the
 * finder's style (see `alignmentRegions` for why). Every other dark module
 * (data, timing, format and version information, the dark module, rMQR's
 * small alignment patterns) is drawn by the module shape. A connecting
 * shape's neighbours are counted over the modules the module shape draws, so
 * a bar never reaches into a finder and a fluid blob never bulges towards
 * one.
 *
 * Micro QR and rMQR, read by one finder rather than three, keep their rings
 * square and their small patterns plain, and rMQR is drawn without a frame:
 * each is measured below where it is done.
 *
 * The same symbol, design and seed always give the same scene, and so the
 * same SVG bytes: every random choice comes from a stream forked off the
 * seed by a fixed label, and nothing iterates a structure whose order could
 * vary.
 *
 * Anything that cannot be drawn as asked (an entry this registry lacks, a
 * parameter out of its range, a ring that does not support the region's
 * kind) is drawn the plain way instead, with an issue saying so; the scene
 * is never refused. `validateDesign` reports the same problems up front.
 */

import { issue } from '../core/issue.js';
import type { Issue } from '../core/issue.js';
import { createPrng } from '../core/prng.js';
import type { Prng } from '../core/prng.js';
import { multiply, rotateQuarter, translate } from '../geometry/matrix.js';
import { PathBuilder } from '../geometry/path.js';
import type { Path } from '../geometry/path.js';
import { traceGrid } from '../geometry/trace.js';
import { rasterise } from '../render/raster.js';
import type { Scene, SceneNode, ScenePaint } from '../render/types.js';
import { ROLE_CODES } from '../symbology/roles.js';
import type { BuiltSymbol, StyleableRegion } from '../symbology/types.js';
import { squareModule } from './catalogue/module-shapes.js';
import { LIMITS, MIN_QUIET_ZONE } from './document.js';
import { regionPairConforms } from './finder.js';
import { placeLogo } from './logo.js';
import { neighbourMasks } from './neighbours.js';
import { paintSpace, resolvePaint } from './paint.js';
import { paramProblem, resolveParams } from './params.js';
import type {
	Box,
	BuildContext,
	BuiltScene,
	DesignPaint,
	DesignRegistries,
	EntryRef,
	FrameLayout,
	ModuleShape,
	ParamSchema,
	QrDesignV1,
	RegionShape,
	RegionStyle,
	ResolvedParams,
} from './types.js';

/** Pixels a module the ink fraction is sampled at. */
const INK_PIXELS = 16;
/** The most modules sampled one by one for a shape whose draw depends on its stream. */
const INK_SAMPLE_LIMIT = 512;

const BLACK: DesignPaint = { kind: 'solid', ink: '#000000' };

/** The plain square cell, for when a shape is missing and for the light behind a finder. */
const PLAIN_CELL: ModuleShape = squareModule;

/** The names a scene is given when a design has none. Never the content. */
const GENERIC_TITLES: Readonly<Record<string, string>> = Object.freeze({
	qr: 'QR code',
	micro: 'Micro QR code',
	rmqr: 'Rectangular Micro QR code',
});

const REGION_ROLES = new Set<number>([
	ROLE_CODES.finder,
	ROLE_CODES.separator,
	ROLE_CODES['sub-finder'],
	ROLE_CODES['corner-finder'],
]);

/** A stream that remembers whether anything drew from it. */
class WatchedPrng implements Prng {
	used = false;
	constructor(private readonly inner: Prng) {}
	next(): number {
		this.used = true;
		return this.inner.next();
	}
	int(maxExclusive: number): number {
		this.used = true;
		return this.inner.int(maxExclusive);
	}
	fork(label: number): Prng {
		this.used = true;
		return this.inner.fork(label);
	}
}

/** The issues of building one scene, and the checks every entry reference goes through. */
class Builder {
	readonly issues: Issue[] = [];

	constructor(readonly registries: DesignRegistries) {}

	/** Given params checked against the schema; anything that does not fit is reported and left at its default. */
	params(
		schema: readonly ParamSchema[],
		given: EntryRef['params'],
		path: readonly (string | number)[],
	): ResolvedParams {
		if (given !== undefined && given !== null && typeof given === 'object') {
			for (const key of Object.keys(given)) {
				const entry = schema.find((candidate) => candidate.key === key);
				if (entry === undefined || paramProblem(entry, given[key]) !== null) {
					this.issues.push(
						issue('design.issue.param-ignored', [...path, 'params', key], 'warning'),
					);
				}
			}
		}
		return resolveParams(schema, given);
	}

	/** An entry paint whose fill exists, or the stand-in, with an issue. */
	paint(paint: DesignPaint, path: readonly (string | number)[], fallback = BLACK): DesignPaint {
		if (paint.kind !== 'entry') return paint;
		if (this.registries.fills.has(paint.ref.id)) return paint;
		this.issues.push(
			issue('design.issue.unknown-entry', [...path, 'ref', 'id'], 'warning', { kind: 'fill' }),
		);
		return fallback;
	}
}

interface CellJob {
	readonly cells: readonly number[];
	readonly shape: ModuleShape;
	readonly params: ResolvedParams;
	readonly masks: Uint8Array;
	readonly paint: DesignPaint;
	readonly role: string;
	readonly prng: Prng;
	readonly paints: Prng;
	/** Whether to measure the ink fraction, which only the dark modules need. */
	readonly measure: boolean;
}

interface Geometry {
	readonly width: number;
	readonly height: number;
	readonly sx: number;
	readonly sy: number;
	readonly symbolBox: Box;
}

/** The fraction of the unit cell a path inks, sampled at INK_PIXELS a module. */
function cellInk(path: Path): number {
	const image = rasterise(
		{
			width: 1,
			height: 1,
			background: null,
			layers: [
				{ kind: 'path', path, paint: { kind: 'solid', colour: { r: 0, g: 0, b: 0, a: 1 } } },
			],
		},
		{ width: INK_PIXELS },
	);
	let sum = 0;
	for (let i = 3; i < image.data.length; i += 4) sum += image.data[i] as number;
	return sum / 255 / (INK_PIXELS * INK_PIXELS);
}

/**
 * Cells drawn with one shape, grouped by the paint each resolves to so that
 * every group is one path: a run of square cells is traced into one outline,
 * and anything else is drawn cell by cell into the group's path. Shapes that
 * do not touch their stream are drawn once per neighbour mask.
 */
function drawCells(
	job: CellJob,
	geometry: Geometry,
	builder: Builder,
): { nodes: SceneNode[]; ink: { sum: number; count: number } } {
	const { cells, shape, params, masks, role } = job;
	const { width, height, sx, sy } = geometry;
	const fills = builder.registries.fills;
	const groups = new Map<string, { paint: ScenePaint; cells: number[] }>();
	const whole =
		paintSpace(job.paint, fills) === 'symbol'
			? resolvePaint(job.paint, geometry.symbolBox, fills, job.paints)
			: null;
	for (const index of cells) {
		const x = index % width;
		const y = (index - x) / width;
		const paint =
			whole ??
			resolvePaint(
				job.paint,
				{ x: sx + x, y: sy + y, width: 1, height: 1 },
				fills,
				job.paints.fork(index),
			);
		const key = JSON.stringify(paint);
		let group = groups.get(key);
		if (group === undefined) {
			group = { paint, cells: [] };
			groups.set(key, group);
		}
		group.cells.push(index);
	}

	const tiles = shape.fillsCell?.(params) === true;
	const cache = new Map<number, Path>();
	const inkByMask = new Map<number, number>();
	let inkSum = 0;
	let inkCount = 0;
	let sampled = 0;
	const step = Math.max(1, Math.ceil(cells.length / INK_SAMPLE_LIMIT));
	const nodes: SceneNode[] = [];
	for (const group of groups.values()) {
		let path: Path;
		if (tiles) {
			const inGroup = new Uint8Array(width * height);
			for (const index of group.cells) inGroup[index] = 1;
			path = new PathBuilder()
				.transform([1, 0, 0, 1, sx, sy])
				.append(traceGrid(width, height, (x, y) => inGroup[y * width + x] === 1))
				.build();
			inkSum += group.cells.length;
			inkCount += group.cells.length;
		} else {
			const out = new PathBuilder();
			for (const index of group.cells) {
				const mask = masks[index] as number;
				let cell = cache.get(mask);
				if (cell === undefined) {
					const prng = new WatchedPrng(job.prng.fork(index));
					const own = new PathBuilder();
					shape.path({ neighbours: mask, params, prng }, own);
					cell = own.build();
					if (!prng.used) cache.set(mask, cell);
				}
				const x = index % width;
				const y = (index - x) / width;
				out.transform([1, 0, 0, 1, sx + x, sy + y]).append(cell);
				if (!job.measure) continue;
				if (cache.has(mask)) {
					// A shape that ignores its stream inks the same for every module
					// with this mask, so each mask is measured once.
					let fraction = inkByMask.get(mask);
					if (fraction === undefined) {
						fraction = cellInk(cell);
						inkByMask.set(mask, fraction);
					}
					inkSum += fraction;
					inkCount += 1;
				} else {
					// One that draws from its stream differs module to module, so a
					// fixed share of its modules is measured, in order.
					if (sampled % step === 0) {
						inkSum += cellInk(cell);
						inkCount += 1;
					}
					sampled += 1;
				}
			}
			path = out.build();
		}
		nodes.push({ kind: 'path', path, paint: group.paint, role });
	}
	return { nodes, ink: { sum: inkSum, count: inkCount } };
}

const DEFAULT_STYLE: RegionStyle = Object.freeze({
	outer: Object.freeze({ id: 'square' }),
	inner: Object.freeze({ id: 'square-centre' }),
});

/** The matrix that puts a region shape's own box onto the region, turned as the region says. */
function regionMatrix(region: StyleableRegion, sx: number, sy: number) {
	return multiply(
		translate(sx + region.x, sy + region.y),
		rotateQuarter(region.rotation / 90, region.width / 2, region.height / 2),
	);
}

/**
 * The 5 by 5 alignment patterns of a symbol, found in its role map, as
 * concentric-5 regions.
 *
 * An alignment pattern is the same bullseye as rMQR's sub-finder, and it is
 * drawn the same way, with the finder's ring and centre, rather than with
 * the module shape. Measured: jsQR misread 9 symbols in 10 from version 2 up
 * when alignment patterns were drawn with dots, hexagons, diamonds, stars or
 * thin crosses (it takes the best bullseye near where the pattern should be,
 * and a gappy ring makes every lone dot a better one), and read all 10 when
 * the pattern was solid. rMQR's 3 by 3 alignment patterns are not
 * bullseyes and stay with the module shape.
 */
function alignmentRegions(layout: BuiltSymbol['layout']): StyleableRegion[] {
	const { width, height, roles } = layout;
	const role = (x: number, y: number): number =>
		x >= 0 && y >= 0 && x < width && y < height ? (roles[y * width + x] as number) : -1;
	const out: StyleableRegion[] = [];
	for (let y = 0; y + 5 <= height; y += 1) {
		for (let x = 0; x + 5 <= width; x += 1) {
			if (role(x, y) !== ROLE_CODES.alignment) continue;
			if (role(x - 1, y) === ROLE_CODES.alignment || role(x, y - 1) === ROLE_CODES.alignment)
				continue;
			let whole = true;
			for (let dy = 0; dy < 5 && whole; dy += 1) {
				for (let dx = 0; dx < 5; dx += 1) {
					if (role(x + dx, y + dy) !== ROLE_CODES.alignment) {
						whole = false;
						break;
					}
				}
			}
			if (whole) {
				out.push({
					role: 'sub-finder',
					kind: 'concentric-5',
					x,
					y,
					width: 5,
					height: 5,
					rotation: 0,
				});
			}
		}
	}
	return out;
}

export function buildScene(
	symbol: BuiltSymbol,
	design: QrDesignV1,
	context: BuildContext,
): BuiltScene {
	if (typeof context !== 'object' || context === null || typeof context.registries !== 'object') {
		throw new TypeError('buildScene: context gives at least the design registries.');
	}
	const seed = context.seed ?? 0;
	if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
		throw new TypeError('buildScene: seed is an integer from 0 to 2^32 - 1.');
	}
	const builder = new Builder(context.registries);
	const { registries } = context;
	const { issues } = builder;
	const { matrix, layout } = symbol;
	const width = matrix.width;
	const height = matrix.height;
	const count = width * height;

	let quiet = design.quietZone;
	if (!Number.isInteger(quiet) || quiet < 0 || quiet > LIMITS.quietZone) {
		quiet = MIN_QUIET_ZONE[symbol.symbology] ?? 4;
		issues.push(issue('design.issue.quiet-zone', ['quietZone'], 'warning'));
	}
	const root = createPrng(seed);
	const streams = {
		modules: root.fork(1),
		light: root.fork(2),
		paints: root.fork(3),
		regions: root.fork(4),
		frame: root.fork(5),
		logo: root.fork(6),
	};

	// The frame first: it decides where the symbol sits in the artwork.
	let frameLayout: FrameLayout | null = null;
	// rMQR is read by its sub-finder and corner patterns as well as its
	// finder, and zxing-cpp loses rMQR symbols inside a frame's dark border
	// erratically: at one quiet zone width it reads, at the next it does not,
	// with no width that is safe for every size. So frames are left out of
	// rMQR, and said so.
	const frameless = layout.regions.some((region) => region.kind === 'concentric-5');
	if (design.frame !== null && frameless && design.frame.ref.id !== 'none') {
		issues.push(issue('design.issue.frame-unsupported', ['frame'], 'warning'));
	} else if (design.frame !== null) {
		const entry = registries.frames.get(design.frame.ref.id);
		if (entry === undefined) {
			issues.push(
				issue('design.issue.unknown-entry', ['frame', 'ref', 'id'], 'warning', { kind: 'frame' }),
			);
		} else {
			const params = builder.params(entry.params, design.frame.ref.params, ['frame', 'ref']);
			const ctx = {
				symbolSize: { width, height },
				quietZone: quiet,
				params,
			};
			// Laid out once to learn the artwork's size, then again with the
			// paint resolved over it, so a gradient spans the whole frame.
			const first = entry.layout({
				...ctx,
				paint: { kind: 'solid', colour: { r: 0, g: 0, b: 0, a: 1 } },
			});
			const paint = builder.paint(design.frame.paint ?? design.modules.paint, ['frame', 'paint']);
			frameLayout = entry.layout({
				...ctx,
				paint: resolvePaint(
					paint,
					{ x: 0, y: 0, width: first.width, height: first.height },
					registries.fills,
					streams.frame,
				),
			});
			const text = design.frame.text;
			if (text !== undefined && text.content.length > 0) {
				// SEAM(M9): the caption is set by the text layer into
				// `frameLayout.textBox` with `context.fonts`, as path nodes in the
				// frame's `over` layer. Until that lands it is left out, and said.
				issues.push(
					issue(
						entry.text === null || frameLayout.textBox === null
							? 'design.issue.caption-unsupported'
							: 'design.issue.caption-pending',
						['frame', 'text'],
						entry.text === null || frameLayout.textBox === null ? 'warning' : 'info',
					),
				);
			}
		}
	}
	const ox = frameLayout?.symbol.x ?? 0;
	const oy = frameLayout?.symbol.y ?? 0;
	const sx = ox + quiet;
	const sy = oy + quiet;
	const sceneWidth = frameLayout?.width ?? width + 2 * quiet;
	const sceneHeight = frameLayout?.height ?? height + 2 * quiet;
	const quietBox: Box = { x: ox, y: oy, width: width + 2 * quiet, height: height + 2 * quiet };
	const geometry: Geometry = {
		width,
		height,
		sx,
		sy,
		symbolBox: { x: sx, y: sy, width, height },
	};

	// Which modules belong to a region and which the logo takes.
	const regionModule = new Uint8Array(count);
	for (let i = 0; i < count; i += 1) {
		if (REGION_ROLES.has(layout.roles[i] as number)) regionModule[i] = 1;
	}
	const alignments = alignmentRegions(layout);
	for (const region of alignments) {
		for (let dy = 0; dy < 5; dy += 1) {
			for (let dx = 0; dx < 5; dx += 1) regionModule[(region.y + dy) * width + region.x + dx] = 1;
		}
	}
	const logo = placeLogo(design, {
		width,
		height,
		roles: layout.roles,
		sx,
		sy,
		registries,
		assets: context.assets,
		prng: streams.logo,
		paint: (paint, path) => builder.paint(paint, path),
		modulesPaint: design.modules.paint,
	});
	issues.push(...logo.issues);
	const dark = new Uint8Array(count);
	const darkCells: number[] = [];
	for (let i = 0; i < count; i += 1) {
		if (matrix.data[i] === 1 && regionModule[i] === 0 && logo.removed[i] === 0) {
			dark[i] = 1;
			darkCells.push(i);
		}
	}

	const shapeFor = (
		ref: EntryRef,
		path: readonly (string | number)[],
	): { shape: ModuleShape; params: ResolvedParams } => {
		const shape = registries.moduleShapes.get(ref.id);
		if (shape === undefined) {
			issues.push(
				issue('design.issue.unknown-entry', [...path, 'id'], 'warning', { kind: 'module-shape' }),
			);
			return { shape: PLAIN_CELL, params: Object.freeze({}) };
		}
		return { shape, params: builder.params(shape.params, ref.params, path) };
	};

	const layers: SceneNode[] = [];
	if (frameLayout !== null) layers.push(...frameLayout.nodes);
	let background: ScenePaint | null = null;
	if (design.background !== null) {
		const paint = builder.paint(design.background, ['background'], {
			kind: 'solid',
			ink: '#ffffff',
		});
		const resolved = resolvePaint(paint, quietBox, registries.fills, streams.paints.fork(0));
		if (frameLayout === null) background = resolved;
		else {
			layers.push({
				kind: 'path',
				path: new PathBuilder()
					.rect(quietBox.x, quietBox.y, quietBox.width, quietBox.height)
					.build(),
				paint: resolved,
				role: 'background',
			});
		}
	}

	if (design.modules.light !== null) {
		const light = design.modules.light;
		const lit = new Uint8Array(count);
		const litCells: number[] = [];
		const behind: number[] = [];
		for (let i = 0; i < count; i += 1) {
			if (logo.removed[i] === 1) continue;
			if (regionModule[i] === 1) behind.push(i);
			else if (matrix.data[i] === 0) {
				lit[i] = 1;
				litCells.push(i);
			}
		}
		const { shape, params } = shapeFor(light.shape, ['modules', 'light', 'shape']);
		const paint = builder.paint(light.paint, ['modules', 'light', 'paint'], {
			kind: 'solid',
			ink: '#ffffff',
		});
		layers.push(
			...drawCells(
				{
					cells: litCells,
					shape,
					params,
					masks: neighbourMasks(width, height, lit),
					paint,
					role: 'light-modules',
					measure: false,
					prng: streams.light.fork(1),
					paints: streams.paints.fork(2),
				},
				geometry,
				builder,
			).nodes,
			// Behind every finder, whole light squares, so a finder on a busy
			// background still has its light ring and separator.
			...drawCells(
				{
					cells: behind,
					shape: PLAIN_CELL,
					params: Object.freeze({}),
					masks: new Uint8Array(count),
					paint,
					role: 'light-regions',
					measure: false,
					prng: streams.light.fork(2),
					paints: streams.paints.fork(2),
				},
				geometry,
				builder,
			).nodes,
		);
	}

	const modules = shapeFor(design.modules.shape, ['modules', 'shape']);
	const modulesPaint = builder.paint(design.modules.paint, ['modules', 'paint']);
	const drawn = drawCells(
		{
			cells: darkCells,
			shape: modules.shape,
			params: modules.params,
			masks: neighbourMasks(width, height, dark),
			paint: modulesPaint,
			role: 'modules',
			measure: true,
			prng: streams.modules,
			paints: streams.paints.fork(1),
		},
		geometry,
		builder,
	);
	layers.push(...drawn.nodes);

	layers.push(
		...drawRegions(symbol, alignments, design, geometry, builder, streams.regions, modulesPaint),
	);
	layers.push(...logo.nodes);
	if (frameLayout?.over !== undefined) layers.push(...frameLayout.over);

	const sizeMm = design.output.sizeMm;
	const scene: Scene = {
		width: sceneWidth,
		height: sceneHeight,
		...(typeof sizeMm === 'number' && Number.isFinite(sizeMm) && sizeMm > 0
			? { unitsPerMm: (width + 2 * quiet) / sizeMm }
			: {}),
		background,
		layers,
		title:
			typeof design.name === 'string' && design.name.length > 0
				? design.name
				: (GENERIC_TITLES[symbol.symbology] ?? 'Code'),
	};
	return {
		scene,
		obscured: logo.obscured,
		inkFraction: drawn.ink.count === 0 ? 0 : drawn.ink.sum / drawn.ink.count,
		issues,
	};
}

/** A square ring one module thick round a concentric region, in scene units. */
function squareRing(region: StyleableRegion, geometry: Geometry): Path {
	const x = geometry.sx + region.x;
	const y = geometry.sy + region.y;
	const size = region.width;
	return new PathBuilder()
		.rect(x, y, size, size)
		.rect(x + size - 1, y + 1, -(size - 2), size - 2)
		.build();
}

/** The finder rings, then the finder centres, each grouped by paint. */
function drawRegions(
	symbol: BuiltSymbol,
	alignments: readonly StyleableRegion[],
	design: QrDesignV1,
	geometry: Geometry,
	builder: Builder,
	prng: Prng,
	modulesPaint: DesignPaint,
): SceneNode[] {
	const { registries, issues } = builder;
	const { layout, matrix } = symbol;
	const outers = new Map<string, { paint: ScenePaint; out: PathBuilder; role: string }>();
	const inners = new Map<string, { paint: ScenePaint; out: PathBuilder; role: string }>();
	const reported = new Set<string>();
	const add = (
		into: Map<string, { paint: ScenePaint; out: PathBuilder; role: string }>,
		paint: ScenePaint,
		path: Path,
		role: string,
	): void => {
		const key = JSON.stringify(paint);
		let group = into.get(key);
		if (group === undefined) {
			group = { paint, out: new PathBuilder(), role };
			into.set(key, group);
		}
		group.out.append(path);
	};
	const once = (key: string, found: Issue): void => {
		if (reported.has(key)) return;
		reported.add(key);
		issues.push(found);
	};
	const shapeOf = (
		ref: EntryRef,
		part: 'outer' | 'inner',
		role: string,
	): { shape: RegionShape; params: ResolvedParams } | null => {
		const shape = registries.regionShapes.get(ref.id);
		if (shape === undefined || shape.part !== part) {
			once(
				`${role}.${part}.entry`,
				issue('design.issue.unknown-entry', ['regions', role, part, 'id'], 'warning', {
					kind: 'region-shape',
				}),
			);
			return null;
		}
		return { shape, params: builder.params(shape.params, ref.params, ['regions', role, part]) };
	};

	// Micro QR and rMQR have one finder; QR has three.
	const single = layout.regions.filter((region) => region.kind === 'concentric-7').length === 1;
	const targets = [
		...layout.regions.map((region) => ({ region, styleRole: region.role, alignment: false })),
		// Alignment patterns take the finder's style.
		...alignments.map((region) => ({ region, styleRole: 'finder' as const, alignment: true })),
	];
	targets.forEach(({ region, styleRole, alignment }, index) => {
		const style = design.regions[styleRole] ?? DEFAULT_STYLE;
		const box: Box = {
			x: geometry.sx + region.x,
			y: geometry.sy + region.y,
			width: region.width,
			height: region.height,
		};
		const paintFor = (paint: DesignPaint | undefined, part: string, label: number): ScenePaint => {
			const chosen = builder.paint(paint ?? modulesPaint, ['regions', styleRole, `${part}Paint`]);
			const space = paintSpace(chosen, registries.fills);
			return resolvePaint(
				chosen,
				space === 'symbol' ? geometry.symbolBox : box,
				registries.fills,
				prng.fork(index * 2 + label),
			);
		};
		const transform = regionMatrix(region, geometry.sx, geometry.sy);
		const place = (shape: RegionShape, params: ResolvedParams): Path => {
			const own = new PathBuilder();
			shape.path({ kind: region.kind, params }, own);
			return new PathBuilder().transform(transform).append(own.build()).build();
		};
		// The plain way: this region's own dark modules as squares.
		const plain = (): Path => {
			const inside = (x: number, y: number): boolean => {
				const mx = region.x + x;
				const my = region.y + y;
				const at = my * geometry.width + mx;
				const role = layout.roles[at] as number;
				return (
					matrix.data[at] === 1 &&
					(alignment ? role === ROLE_CODES.alignment : REGION_ROLES.has(role)) &&
					role !== ROLE_CODES.separator
				);
			};
			return new PathBuilder()
				.transform([1, 0, 0, 1, box.x, box.y])
				.append(traceGrid(region.width, region.height, inside))
				.build();
		};

		const outer = shapeOf(style.outer, 'outer', styleRole);
		const inner = region.kind === 'corner-l' ? null : shapeOf(style.inner, 'inner', styleRole);
		const outerFits = outer !== null && outer.shape.kinds.includes(region.kind);
		const innerFits =
			region.kind === 'corner-l' || (inner !== null && inner.shape.kinds.includes(region.kind));
		// An alignment pattern a finder style cannot draw is drawn plainly
		// without a word: the finder itself is what the person chose and sees.
		if (outer !== null && !outerFits && !alignment) {
			once(
				`${styleRole}.outer.${region.kind}`,
				issue('design.issue.region-kind', ['regions', styleRole, 'outer'], 'info', {
					kind: region.kind,
				}),
			);
		}
		if (inner !== null && !innerFits && !alignment) {
			once(
				`${styleRole}.inner.${region.kind}`,
				issue('design.issue.region-kind', ['regions', styleRole, 'inner'], 'info', {
					kind: region.kind,
				}),
			);
		}
		if (
			outer === null ||
			(inner === null && region.kind !== 'corner-l') ||
			!outerFits ||
			!innerFits
		) {
			// One of the pair is missing or cannot draw this kind, so the whole
			// region is drawn plainly: half a styled finder is no finder.
			add(outers, paintFor(style.outerPaint, 'outer', 0), plain(), 'region-outer');
			return;
		}
		// A symbol with one finder is found by the corners of its rings and by
		// its smaller patterns, so on Micro QR and rMQR every ring is drawn
		// square, the sub-finder and corner patterns are drawn plainly, and
		// only the finder's centre takes the style. Measured with zxing-cpp:
		// rounded, round and cut rings, and any styled one-module centre in
		// the sub-finder, lose rMQR symbols that plain ones read.
		const styled =
			outer.shape.id !== 'square' ||
			(region.kind === 'concentric-5' && inner !== null && inner.shape.id !== 'square-centre');
		if (single && !alignment && styled) {
			once(
				`${styleRole}.corners`,
				issue('design.issue.region-corners', ['regions', styleRole], 'info'),
			);
		}
		if (single && region.kind !== 'concentric-7') {
			add(outers, paintFor(style.outerPaint, 'outer', 0), plain(), 'region-outer');
			return;
		}
		add(
			outers,
			paintFor(style.outerPaint, 'outer', 0),
			single ? squareRing(region, geometry) : place(outer.shape, outer.params),
			'region-outer',
		);
		// The corner pattern has no centre; every other kind reached here has one.
		if (region.kind === 'corner-l') return;
		const centre = inner as { shape: RegionShape; params: ResolvedParams };
		if (
			!alignment &&
			!regionPairConforms(outer.shape, outer.params, centre.shape, centre.params, region.kind)
		) {
			once(
				`${styleRole}.pair.${region.kind}`,
				issue('design.issue.region-pair', ['regions', styleRole], 'warning', { kind: region.kind }),
			);
		}
		add(
			inners,
			paintFor(style.innerPaint, 'inner', 1),
			place(centre.shape, centre.params),
			'region-inner',
		);
	});

	const nodes: SceneNode[] = [];
	for (const group of [...outers.values(), ...inners.values()]) {
		nodes.push({ kind: 'path', path: group.out.build(), paint: group.paint, role: group.role });
	}
	return nodes;
}
