/**
 * From a job to everything the checks and captures look at: the symbol
 * re-encoded from the content, the scene built from the design, where the
 * symbol sits in it, the conditions with the design's own output settings
 * filled in, and the clean reading every capture is compared with.
 *
 * The job is plain data posted from somewhere else, so it is checked here
 * before any work starts, and a job naming a registry entry this copy lacks
 * is refused outright. Verifying a design drawn with stand-ins (a square
 * where it asked for a shape this build does not have) would answer a
 * question nobody asked, and a pass on it would be a lie about the real one.
 */

import { QrStudioError } from '../core/errors.js';
import type { RgbaImage } from '../core/image.js';
import { resolveParams } from '../design/params.js';
import { buildScene } from '../design/scene.js';
import type { BuiltScene, DesignPaint, QrDesignV1 } from '../design/types.js';
import { validateDesign } from '../design/validate.js';
import { encode } from '../encode/encode.js';
import { rasterise } from '../render/raster.js';
import type { BuiltSymbol, MatrixRead, SymbologyEntry } from '../symbology/types.js';
import type { GreyPlane } from './degrade.js';
import { fromRgba } from './degrade.js';
import type { DesignInks } from './inks.js';
import { designInks, polarityOf } from './inks.js';
import type { Polarity, VerifyConditions, VerifyJob, VerifyRegistries } from './types.js';

/** The registry kinds a requirement may name, as `kind:id`. */
export const REQUIREMENT_KINDS = Object.freeze([
	'symbology',
	'module-shape',
	'region-shape',
	'fill',
	'frame',
	'icon',
	'asset',
] as const);

export type RequirementKind = (typeof REQUIREMENT_KINDS)[number];

function paintFills(paint: DesignPaint | null | undefined, add: Add): void {
	if (paint !== null && paint !== undefined && paint.kind === 'entry') add('fill', paint.ref.id);
}

type Add = (kind: RequirementKind, id: unknown) => void;

/**
 * Every registry entry a design uses, as `kind:id`, sorted: what a job's
 * `requires` should hold so a worker without one of them refuses rather
 * than drawing something else. An id that is not a string is skipped, so
 * this can walk a design before it has been validated.
 */
export function designRequirements(design: QrDesignV1): readonly string[] {
	const out = new Set<string>();
	const add: Add = (kind, id) => {
		if (typeof id === 'string') out.add(`${kind}:${id}`);
	};
	add('symbology', design.symbol.symbology);
	add('module-shape', design.modules.shape.id);
	paintFills(design.modules.paint, add);
	paintFills(design.background, add);
	if (design.modules.light !== null && design.modules.light !== undefined) {
		add('module-shape', design.modules.light.shape.id);
		paintFills(design.modules.light.paint, add);
	}
	for (const role of ['finder', 'sub-finder', 'corner-finder'] as const) {
		const style = design.regions?.[role];
		if (style === undefined) continue;
		add('region-shape', style.outer.id);
		add('region-shape', style.inner.id);
		paintFills(style.outerPaint, add);
		paintFills(style.innerPaint, add);
	}
	if (design.logo !== null && design.logo !== undefined) {
		const { source } = design.logo;
		add(source.kind === 'icon' ? 'icon' : 'asset', source.id);
		paintFills(design.logo.paint, add);
		paintFills(design.logo.plate?.paint, add);
	}
	if (design.frame !== null && design.frame !== undefined) {
		add('frame', design.frame.ref.id);
		paintFills(design.frame.paint, add);
		paintFills(design.frame.text?.paint, add);
	}
	return Object.freeze([...out].sort());
}

const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * The refusal. The kind and id are registry identifiers and go in params;
 * anything that does not look like one (a requirement from a hostile job, an
 * asset's own name) is left out, because params end up in bug reports.
 */
function missing(kind: string, id: string | null): QrStudioError {
	const known = (REQUIREMENT_KINDS as readonly string[]).includes(kind) ? kind : 'entry';
	return new QrStudioError(
		'verify/missing-entry',
		'This check needs a style or picture this copy of the studio does not have, so it was not run.',
		id !== null && id.length <= 64 && KEBAB.test(id) ? { kind: known, id } : { kind: known },
	);
}

/** Throws 'verify/missing-entry' for the first requirement this copy cannot meet. */
function checkRequirements(
	requires: readonly string[],
	registries: VerifyRegistries,
	assets: Readonly<Record<string, RgbaImage>> | undefined,
	designAssets: unknown,
): void {
	const { design: d, symbologies } = registries;
	const lookup: Readonly<Record<Exclude<RequirementKind, 'asset'>, (id: string) => boolean>> = {
		symbology: (id) => symbologies.has(id),
		'module-shape': (id) => d.moduleShapes.has(id),
		'region-shape': (id) => d.regionShapes.has(id),
		fill: (id) => d.fills.has(id),
		frame: (id) => d.frames.has(id),
		icon: (id) => d.icons.has(id),
	};
	for (const requirement of requires) {
		const colon = requirement.indexOf(':');
		const kind = colon < 0 ? '' : requirement.slice(0, colon);
		const id = colon < 0 ? requirement : requirement.slice(colon + 1);
		if (kind === 'asset') {
			// An asset's name is the design's own, not a registry identifier, so
			// it stays out of the error.
			const held =
				typeof designAssets === 'object' &&
				designAssets !== null &&
				Object.prototype.hasOwnProperty.call(designAssets, id);
			const decoded =
				assets !== undefined && Object.prototype.hasOwnProperty.call(assets, id)
					? assets[id]
					: undefined;
			if (!held || decoded === undefined) throw missing('asset', null);
			continue;
		}
		if (kind === '') {
			if (!Object.values(lookup).some((has) => has(id))) throw missing('entry', id);
			continue;
		}
		const has = lookup[kind as Exclude<RequirementKind, 'asset'>];
		if (has === undefined) throw missing(kind, id);
		if (!has(id)) throw missing(kind, id);
	}
}

function finiteOrNull(value: unknown, what: string): number | null {
	if (value === null || value === undefined) return null;
	if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
		throw new TypeError(`verify: conditions.${what} is a positive number or null.`);
	}
	return value;
}

/** Checks the shape of a job, which may have been posted from anywhere. */
function checkJob(job: VerifyJob): void {
	if (typeof job !== 'object' || job === null) throw new TypeError('verify: the job is an object.');
	if (typeof job.content !== 'string') throw new TypeError('verify: job.content is a string.');
	if (!Number.isInteger(job.seed) || job.seed < 0 || job.seed > 0xffffffff) {
		throw new TypeError('verify: job.seed is an integer from 0 to 2^32 - 1.');
	}
	if (!Array.isArray(job.requires) || job.requires.some((r) => typeof r !== 'string')) {
		throw new TypeError('verify: job.requires is a list of registry ids.');
	}
	if (typeof job.conditions !== 'object' || job.conditions === null) {
		throw new TypeError('verify: job.conditions is an object.');
	}
	if (job.overlay !== undefined && job.overlay !== null && job.overlay !== 'swiss-cross') {
		throw new TypeError('verify: job.overlay is swiss-cross, or null for none.');
	}
	if (
		job.captureSeeds !== undefined &&
		(!Number.isInteger(job.captureSeeds) || job.captureSeeds < 1 || job.captureSeeds > 8)
	) {
		throw new TypeError('verify: job.captureSeeds is a whole number from 1 to 8.');
	}
}

export interface Prepared {
	readonly job: VerifyJob;
	readonly registries: VerifyRegistries;
	readonly design: QrDesignV1;
	readonly entry: SymbologyEntry;
	readonly symbol: BuiltSymbol;
	readonly built: BuiltScene;
	/** The symbol's first module in scene units, and the quiet zone it was drawn with. */
	readonly origin: { readonly x: number; readonly y: number };
	readonly quietZone: number;
	/** The job's conditions, with the design's output size and resolution where the job gave none. */
	readonly conditions: VerifyConditions;
	/** Millimetres a module, when the printed size is known: one scene unit, by the scene's own scale. */
	readonly moduleMm: number | null;
	/** The reading of the clean matrix: every capture must give the same bytes. */
	readonly reference: MatrixRead;
	readonly seeds: number;
	readonly inks: DesignInks;
	/** The polarity the strict reader reads in, and no other. */
	readonly polarity: Polarity;
}

/**
 * Where the symbol sits in the scene, worked out as `buildScene` works it
 * out: the frame first (which rMQR is drawn without), then the quiet zone.
 */
function placement(
	symbol: BuiltSymbol,
	design: QrDesignV1,
	registries: VerifyRegistries,
): { readonly x: number; readonly y: number; readonly quiet: number } {
	// The design has been validated, so its quiet zone is a whole number in
	// range, and its requirements met, so its frame is registered.
	const quiet = design.quietZone;
	const frameless = symbol.layout.regions.some((region) => region.kind === 'concentric-5');
	if (design.frame === null || (frameless && design.frame.ref.id !== 'none')) {
		return { x: quiet, y: quiet, quiet };
	}
	const entry = registries.design.frames.require(design.frame.ref.id);
	const layout = entry.layout({
		symbolSize: { width: symbol.matrix.width, height: symbol.matrix.height },
		quietZone: quiet,
		params: resolveParams(entry.params, design.frame.ref.params),
		paint: { kind: 'solid', colour: { r: 0, g: 0, b: 0, a: 1 } },
	});
	return { x: layout.symbol.x + quiet, y: layout.symbol.y + quiet, quiet };
}

export function prepare(job: VerifyJob, registries: VerifyRegistries): Prepared {
	checkJob(job);
	if (
		typeof registries !== 'object' ||
		registries === null ||
		typeof registries.symbologies !== 'object' ||
		typeof registries.design !== 'object'
	) {
		throw new TypeError('verify: registries gives the symbologies and the design registries.');
	}
	// Requirements first, from the design as posted: validation would refuse
	// an unknown entry as an invalid design, and the honest answer is that
	// this copy lacks it.
	let derived: readonly string[] = [];
	try {
		derived = designRequirements(job.design);
	} catch {
		// A design too malformed to walk is reported by validation below.
	}
	checkRequirements(
		[...job.requires, ...derived],
		registries,
		job.assets,
		(job.design as { assets?: unknown } | null)?.assets,
	);
	const validated = validateDesign(job.design, registries.design);
	if (validated.design === null) {
		throw new QrStudioError('design/invalid', 'This design cannot be checked until it is fixed.', {
			issues: validated.issues.length,
		});
	}
	const design = validated.design;
	const sizeMm = finiteOrNull(job.conditions.sizeMm, 'sizeMm') ?? design.output.sizeMm ?? null;
	const dpi = finiteOrNull(job.conditions.dpi, 'dpi') ?? design.output.dpi ?? null;
	const distanceMm = finiteOrNull(job.conditions.distanceMm, 'distanceMm');

	const entry = registries.symbologies.require(design.symbol.symbology);
	const symbol = encode(
		job.content,
		{
			symbology: design.symbol.symbology,
			...(design.symbol.ecLevel === undefined ? {} : { ecLevel: design.symbol.ecLevel }),
			...(design.symbol.boostEc === undefined ? {} : { boostEc: design.symbol.boostEc }),
			...(design.symbol.minVersion === undefined ? {} : { minVersion: design.symbol.minVersion }),
			...(design.symbol.maxVersion === undefined ? {} : { maxVersion: design.symbol.maxVersion }),
			...(design.symbol.mask === undefined ? {} : { mask: design.symbol.mask }),
			...(design.symbol.segmentation === undefined
				? {}
				: { segmentation: design.symbol.segmentation }),
		},
		registries.symbologies,
	);
	// The scene is drawn at the job's size, measured as the design measures
	// it (the whole artwork unless the design says the symbol), so its units
	// per millimetre say how wide a module prints whatever the basis.
	const sized = sizeMm === null ? design : { ...design, output: { ...design.output, sizeMm } };
	const assets = job.assets;
	const built = buildScene(symbol, sized, {
		registries: registries.design,
		...(assets === undefined ? {} : { assets: (id: string) => assets[id] }),
		seed: job.seed,
		overlay: job.overlay ?? null,
	});
	const where = placement(symbol, design, registries);
	const unitsPerMm = built.scene.unitsPerMm;
	const inks = designInks(design, registries.design);

	return {
		job,
		registries,
		design,
		entry,
		symbol,
		built,
		origin: { x: where.x, y: where.y },
		quietZone: where.quiet,
		conditions: { sizeMm, dpi, distanceMm },
		moduleMm: unitsPerMm === undefined ? null : 1 / unitsPerMm,
		reference: entry.read(symbol.matrix, { strict: true }),
		seeds: job.captureSeeds ?? 8,
		inks,
		polarity: polarityOf(inks),
	};
}

/**
 * Pixels a module the clean picture the static checks measure is drawn at:
 * module edges fall on pixel edges, and a module centre is four pixels from
 * any edge of its own cell.
 */
export const MASTER_PX_PER_MODULE = 10;
/** The finest master: half as fine again as the finest capture. */
export const MAX_MASTER_PX_PER_MODULE = 18;

export interface Master {
	readonly plane: GreyPlane;
	/** Master pixels a scene unit (a module), on each axis. */
	readonly scaleX: number;
	readonly scaleY: number;
}

const WHITE = Object.freeze({ r: 255, g: 255, b: 255, a: 1 });

/**
 * The scene as printed, in grey, at `pxPerModule` (a whole number), from
 * which every capture is sampled.
 *
 * With a print size and a resolution the design is first drawn as the
 * raster export would be, at its own pixels, and then enlarged by whole
 * pixels so each export pixel stays a hard edged square, which is what a
 * printer does with a bitmap. A coarse export (two pixels a module, say)
 * shows up as the uneven modules it really prints with.
 */
export function renderMaster(
	prepared: Prepared,
	pxPerModule = MASTER_PX_PER_MODULE,
	asExported = true,
): Master {
	const { scene } = prepared.built;
	const { dpi } = prepared.conditions;
	const { moduleMm } = prepared;
	if (asExported && moduleMm !== null && dpi !== null) {
		const exportWidth = Math.max(1, Math.round(((scene.width * moduleMm) / 25.4) * dpi));
		const exported = fromRgba(rasterise(scene, { width: exportWidth, background: WHITE }));
		const factor = Math.max(1, Math.ceil((pxPerModule * scene.width) / exportWidth));
		const width = exported.width * factor;
		const height = exported.height * factor;
		const data = new Float32Array(width * height);
		for (let y = 0; y < height; y += 1) {
			const row = Math.floor(y / factor) * exported.width;
			for (let x = 0; x < width; x += 1) {
				data[y * width + x] = exported.data[row + Math.floor(x / factor)] as number;
			}
		}
		return {
			plane: { width, height, data },
			scaleX: width / scene.width,
			scaleY: height / scene.height,
		};
	}
	const width = Math.max(1, Math.round(scene.width * pxPerModule));
	const height = Math.max(1, Math.round(scene.height * pxPerModule));
	const plane = fromRgba(rasterise(scene, { width, height, background: WHITE }));
	return { plane, scaleX: width / scene.width, scaleY: height / scene.height };
}
