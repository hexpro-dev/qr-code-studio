/**
 * Everything a person can choose from, as a view lists it.
 *
 * Built from the registries, so a shape, frame, preset or content type a
 * caller registers appears in both interfaces with no view code. The
 * catalogue is rebuilt only when a registry's version moves, which keeps its
 * identity stable for a memoised view, and each entry draws its thumbnail on
 * the first call and keeps it: a gallery nobody opens costs nothing.
 *
 * Thumbnails are drawn from fixed samples (a small pattern for module shapes,
 * a finder for rings and centres, a sample code for frames and presets), so
 * the same registries give the same pictures. The sample code holds
 * `https://example.com/`; presets are drawn again with the visitor's own code
 * by `presetThumbnails`, once there is one.
 */

import { createPrng } from '../core/prng.js';
import { defaultDesign } from '../design/document.js';
import { regionPairConforms, regionPath } from '../design/finder.js';
import { neighbourMasks } from '../design/neighbours.js';
import { resolvePaint } from '../design/paint.js';
import { resolveParams } from '../design/params.js';
import { buildScene } from '../design/scene.js';
import { applyConstraints } from '../design/constraints.js';
import type {
	DesignConstraints,
	DesignRegistries,
	FontRegistry,
	PresetCategory,
	QrDesignV1,
	RegionKind,
	RegionShape,
} from '../design/types.js';
import { encode } from '../encode/encode.js';
import { translate } from '../geometry/matrix.js';
import { PathBuilder } from '../geometry/path.js';
import type { PayloadCategory } from '../payload/types.js';
import { sceneToSvg } from '../render/svg.js';
import type { Scene, SceneNode, ScenePaint } from '../render/types.js';
import type { Registries } from '../registries.js';
import type { EcLevel } from '../segment/types.js';
import type { BuiltSymbol } from '../symbology/types.js';
import { categoryKey, presetCategoryKey } from './keys.js';
import type {
	Catalogue,
	CatalogueEntry,
	FrameCatalogueEntry,
	PayloadTypeEntry,
	PresetCatalogueEntry,
	PresetThumbnails,
	RegionCatalogueEntry,
	SymbologyCatalogueEntry,
} from './types.js';

/** The content of every sample code. Reserved for examples by RFC 2606. */
export const SAMPLE_CONTENT = 'https://example.com/';

const PAYLOAD_CATEGORIES: readonly PayloadCategory[] = [
	'link',
	'contact',
	'message',
	'network',
	'event',
	'place',
	'payment',
	'commerce',
	'text',
];

const PRESET_CATEGORIES: readonly PresetCategory[] = [
	'classic',
	'rounded',
	'dots',
	'hex',
	'fluid',
	'bold',
	'minimal',
	'colour',
	'print',
];

const LEVELS: readonly EcLevel[] = ['L', 'M', 'Q', 'H'];

const INK: ScenePaint = { kind: 'solid', colour: { r: 0, g: 0, b: 0, a: 1 } };
const GROUND: ScenePaint = { kind: 'solid', colour: { r: 255, g: 255, b: 255, a: 1 } };

/** The module shape sample: five by five, with corners, runs, a lone module and holes. */
const PATTERN = ['11011', '10101', '01110', '10101', '11011'];

/** A key for the registries' versions together: the catalogue is rebuilt when it changes. */
export function registryVersions(registries: Registries): string {
	const { design } = registries;
	return [
		registries.symbologies.version,
		registries.payloads.version,
		design.moduleShapes.version,
		design.regionShapes.version,
		design.fills.version,
		design.frames.version,
		design.icons.version,
		design.presets.version,
	].join('.');
}

/** An empty SVG, for an entry of somebody else's that throws while it draws. */
function blank(): string {
	return sceneToSvg({ width: 1, height: 1, background: null, layers: [] });
}

/** A function that draws once, on first call, and hands back the same string after. */
function once(draw: () => string): () => string {
	let drawn: string | undefined;
	return () => {
		if (drawn === undefined) {
			try {
				drawn = draw();
			} catch {
				drawn = blank();
			}
		}
		return drawn;
	};
}

function svg(scene: Scene, kind: string, id: string): string {
	return sceneToSvg(scene, { idPrefix: `t-${kind}-${id}-` });
}

function moduleThumbnail(registries: DesignRegistries, id: string): string {
	const shape = registries.moduleShapes.require(id);
	const size = PATTERN.length;
	const drawn = new Uint8Array(size * size);
	PATTERN.forEach((row, y) => {
		for (let x = 0; x < size; x += 1) drawn[y * size + x] = row[x] === '1' ? 1 : 0;
	});
	const masks = neighbourMasks(size, size, drawn);
	const params = resolveParams(shape.params, undefined);
	const prng = createPrng(1);
	const out = new PathBuilder();
	for (let i = 0; i < drawn.length; i += 1) {
		if (drawn[i] !== 1) continue;
		out.transform(translate((i % size) + 1, Math.floor(i / size) + 1));
		shape.path({ neighbours: masks[i] as number, params, prng: prng.fork(i) }, out);
	}
	return svg(
		{
			width: size + 2,
			height: size + 2,
			background: GROUND,
			layers: [{ kind: 'path', path: out.build(), paint: INK }],
		},
		'module',
		id,
	);
}

/** The partner a part is drawn with: the plain square of the other part, when the registry has it. */
function partner(registries: DesignRegistries, part: 'outer' | 'inner'): RegionShape | undefined {
	const wanted = part === 'outer' ? 'square-centre' : 'square';
	const found = registries.regionShapes.get(wanted);
	return found !== undefined && found.part !== part ? found : undefined;
}

function regionThumbnail(registries: DesignRegistries, id: string): string {
	const shape = registries.regionShapes.require(id);
	const kind: RegionKind = shape.kinds.includes('concentric-7')
		? 'concentric-7'
		: (shape.kinds[0] ?? 'concentric-7');
	const out = new PathBuilder();
	regionPath(shape, kind, resolveParams(shape.params, undefined), 1, 1, out);
	const other = partner(registries, shape.part);
	if (other !== undefined && other.kinds.includes(kind)) {
		regionPath(other, kind, resolveParams(other.params, undefined), 1, 1, out);
	}
	return svg(
		{
			width: 9,
			height: 9,
			background: GROUND,
			layers: [{ kind: 'path', path: out.build(), paint: INK }],
		},
		'region',
		id,
	);
}

function fillThumbnail(registries: DesignRegistries, id: string): string {
	const fill = registries.fills.require(id);
	const paint = { kind: 'entry' as const, ref: { id } };
	const prng = createPrng(1);
	const layers: SceneNode[] = [];
	const cells = 4;
	if (fill.space === 'module') {
		for (let i = 0; i < cells * cells; i += 1) {
			const x = (i % cells) + 0.5;
			const y = Math.floor(i / cells) + 0.5;
			const box = { x, y, width: 1, height: 1 };
			layers.push({
				kind: 'path',
				path: new PathBuilder().rect(x, y, 1, 1).build(),
				paint: resolvePaint(paint, box, registries.fills, prng.fork(i)),
			});
		}
	} else {
		const box = { x: 0.5, y: 0.5, width: cells, height: cells };
		layers.push({
			kind: 'path',
			path: new PathBuilder().rect(box.x, box.y, box.width, box.height).build(),
			paint: resolvePaint(paint, box, registries.fills, prng),
		});
	}
	return svg({ width: cells + 1, height: cells + 1, background: GROUND, layers }, 'fill', id);
}

function iconThumbnail(registries: DesignRegistries, id: string): string {
	const icon = registries.icons.require(id);
	return svg(
		{
			width: 1,
			height: 1,
			background: null,
			layers: [{ kind: 'path', path: icon.path, paint: INK }],
		},
		'icon',
		id,
	);
}

function designThumbnail(
	registries: DesignRegistries,
	symbol: BuiltSymbol,
	design: QrDesignV1,
	kind: string,
	id: string,
	fonts: FontRegistry | undefined,
	constraints?: DesignConstraints,
): string {
	// Drawn as the code itself would be: the content's constraints applied,
	// and what it prints over the code with them.
	const applied = applyConstraints(design, constraints);
	return svg(
		buildScene(symbol, applied.design, {
			registries,
			seed: 1,
			overlay: applied.overlay,
			...(fonts === undefined ? {} : { fonts }),
		}).scene,
		kind,
		id,
	);
}

/** The sample code the thumbnails that need a whole code are drawn on. */
export function sampleSymbol(registries: Registries): BuiltSymbol {
	return encode(SAMPLE_CONTENT, { ecLevel: 'M' }, registries.symbologies);
}

function levelsOf(
	versions: readonly string[],
	ecLevels: (version: string) => readonly EcLevel[],
): EcLevel[] {
	const found = new Set<EcLevel>();
	for (const version of versions) for (const level of ecLevels(version)) found.add(level);
	return LEVELS.filter((level) => found.has(level));
}

function pairsOf(registries: DesignRegistries, shape: RegionShape): readonly string[] {
	const kind = 'concentric-7';
	if (!shape.kinds.includes(kind)) return Object.freeze([]);
	const ownParams = resolveParams(shape.params, undefined);
	const out: string[] = [];
	for (const other of registries.regionShapes.list()) {
		if (other.part === shape.part || !other.kinds.includes(kind)) continue;
		const otherParams = resolveParams(other.params, undefined);
		const [outer, outerParams, inner, innerParams] =
			shape.part === 'outer'
				? [shape, ownParams, other, otherParams]
				: [other, otherParams, shape, ownParams];
		try {
			if (regionPairConforms(outer, outerParams, inner, innerParams, kind)) out.push(other.id);
		} catch {
			// A shape of somebody else's that cannot draw is a pair with nothing.
		}
	}
	return Object.freeze(out);
}

/** The catalogue for these registries as they stand. */
export function buildCatalogue(registries: Registries, fonts?: FontRegistry): Catalogue {
	const { design } = registries;
	let sample: BuiltSymbol | undefined;
	const sampled = (): BuiltSymbol => (sample ??= sampleSymbol(registries));

	const payloadTypes = PAYLOAD_CATEGORIES.map((category) => ({
		category,
		labelKey: categoryKey(category),
		types: Object.freeze(
			registries.payloads
				.list()
				.filter((type) => type.category === category)
				.map((type): PayloadTypeEntry =>
					Object.freeze({
						id: type.id,
						labelKey: type.labelKey,
						descriptionKey: type.descriptionKey,
						actionKey: type.actionKey,
						category: type.category,
						generate: type.generate !== false,
						designLocked: type.constraints?.designLocked === true,
					}),
				),
		),
	})).filter((group) => group.types.length > 0);

	const symbologies = registries.symbologies.list().map((entry): SymbologyCatalogueEntry =>
		Object.freeze({
			id: entry.id,
			labelKey: entry.labelKey,
			phoneReadable: entry.phoneReadable,
			noteKey: entry.phoneReadable ? null : `symbology.${entry.id}.not-phone-readable`,
			ecLevels: Object.freeze(levelsOf(entry.versions, (v) => entry.ecLevels(v))),
			quietZone: entry.quietZone,
		}),
	);

	const moduleShapes = design.moduleShapes.list().map((shape): CatalogueEntry =>
		Object.freeze({
			id: shape.id,
			labelKey: shape.labelKey,
			params: shape.params,
			thumbnail: once(() => moduleThumbnail(design, shape.id)),
		}),
	);

	const region = (shape: RegionShape): RegionCatalogueEntry => {
		let pairs: readonly string[] | undefined;
		return Object.freeze({
			id: shape.id,
			labelKey: shape.labelKey,
			params: shape.params,
			part: shape.part,
			kinds: shape.kinds,
			get pairs() {
				return (pairs ??= pairsOf(design, shape));
			},
			thumbnail: once(() => regionThumbnail(design, shape.id)),
		});
	};
	const shapes = design.regionShapes.list();

	const fills = design.fills.list().map((fill): CatalogueEntry =>
		Object.freeze({
			id: fill.id,
			labelKey: fill.labelKey,
			params: fill.params,
			thumbnail: once(() => fillThumbnail(design, fill.id)),
		}),
	);

	const frames = design.frames.list().map((frame): FrameCatalogueEntry =>
		Object.freeze({
			id: frame.id,
			labelKey: frame.labelKey,
			params: frame.params,
			text: frame.text,
			thumbnail: once(() =>
				designThumbnail(
					design,
					sampled(),
					{ ...defaultDesign(), frame: { ref: { id: frame.id } } },
					'frame',
					frame.id,
					fonts,
				),
			),
		}),
	);

	const icons = design.icons.list().map((icon): CatalogueEntry =>
		Object.freeze({
			id: icon.id,
			labelKey: icon.labelKey,
			params: Object.freeze([]),
			thumbnail: once(() => iconThumbnail(design, icon.id)),
		}),
	);

	const presets = PRESET_CATEGORIES.map((category) => ({
		category,
		labelKey: presetCategoryKey(category),
		presets: Object.freeze(
			design.presets
				.list()
				.filter((preset) => preset.category === category)
				.map((preset): PresetCatalogueEntry =>
					Object.freeze({
						id: preset.id,
						labelKey: preset.labelKey,
						params: Object.freeze([]),
						category: preset.category,
						minSizeMm: preset.minSizeMm,
						ecLevels: preset.ecLevels,
						thumbnail: once(() =>
							designThumbnail(design, sampled(), preset.design, 'preset', preset.id, fonts),
						),
					}),
				),
		),
	})).filter((group) => group.presets.length > 0);

	return Object.freeze({
		payloadTypes: Object.freeze(payloadTypes.map((group) => Object.freeze(group))),
		symbologies: Object.freeze(symbologies),
		moduleShapes: Object.freeze(moduleShapes),
		rings: Object.freeze(shapes.filter((shape) => shape.part === 'outer').map(region)),
		centres: Object.freeze(shapes.filter((shape) => shape.part === 'inner').map(region)),
		fills: Object.freeze(fills),
		frames: Object.freeze(frames),
		icons: Object.freeze(icons),
		presets: Object.freeze(presets.map((group) => Object.freeze(group))),
	});
}

/**
 * Preset pictures drawn with `symbol`, the visitor's own code. Each is drawn
 * when first asked for and kept for as long as the code is the same; without
 * a code of their own, the catalogue's sample pictures stand in.
 */
export function presetThumbnails(
	registries: Registries,
	catalogue: Catalogue,
	symbol: BuiltSymbol | null,
	constraints?: DesignConstraints,
	fonts?: FontRegistry,
): PresetThumbnails {
	const drawn = new Map<string, string>();
	return Object.freeze({
		get(id: string): string | null {
			const preset = registries.design.presets.get(id);
			if (preset === undefined) return null;
			if (symbol === null) {
				for (const group of catalogue.presets) {
					for (const entry of group.presets) if (entry.id === id) return entry.thumbnail();
				}
				return null;
			}
			let found = drawn.get(id);
			if (found === undefined) {
				found = once(() =>
					designThumbnail(
						registries.design,
						symbol,
						preset.design,
						'preset',
						id,
						fonts,
						constraints,
					),
				)();
				drawn.set(id, found);
			}
			return found;
		},
	});
}
