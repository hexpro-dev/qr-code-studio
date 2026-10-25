/**
 * Exporting the code as a file.
 *
 * Every format starts from the same scene the preview draws, so what is
 * saved is what was seen. SVG and PNG are this package's own writers and give
 * the same bytes in every browser. JPEG and WebP go through the browser's
 * encoders, which a caller passes in (the dom layer's canvas encoder); PDF and
 * EPS through the print layer.
 *
 * Sizes: a raster is as wide as asked in pixels, or as a physical size at a
 * dpi works out to, or a size picked so every module lands on whole pixels.
 * A print format always has a physical size, from the options, the design,
 * the scan conditions or 25 mm, in that order. The physical size is the
 * symbol with its quiet zone, as everywhere else in the studio; a frame adds
 * to it.
 *
 * A bad option never fails an export: it is left out and the result's issues
 * say which one. What a content type fixes (the Swiss QR-bill's 46 mm) cannot
 * be changed here either.
 */

import { QrStudioError } from '../core/errors.js';
import { issue } from '../core/issue.js';
import type { Issue } from '../core/issue.js';
import type { RgbaImage } from '../core/image.js';
import { err, ok } from '../core/result.js';
import type { Result } from '../core/result.js';
import { LIMITS, MIN_QUIET_ZONE } from '../design/document.js';
import { buildScene } from '../design/scene.js';
import type { DesignRegistries, FontRegistry, QrDesignV1 } from '../design/types.js';
import { encodePng } from '../render/png.js';
import { rasterise } from '../render/raster.js';
import { sceneToSvg } from '../render/svg.js';
import type { Scene } from '../render/types.js';
import type { BuiltSymbol } from '../symbology/types.js';
import { STUDIO_KEYS, asStudioError } from './keys.js';
import { exportName } from './names.js';
import type { Printer, VerifyConditions } from './seams.js';
import type { ExportFormat, ExportOptions, ExportResult, RasterEncoder } from './types.js';

/** The widest raster an export draws, in pixels a side. */
export const EXPORT_MAX_SIDE = 16384;
/** The most pixels an export draws: 64 megapixels, a quarter of a gigabyte of RGBA. */
export const EXPORT_MAX_PIXELS = 64 * 1024 * 1024;
/** What a raster is drawn at when nothing says otherwise: about a thousand pixels across. */
const DEFAULT_RASTER = 1024;
const DEFAULT_DPI = 300;
/** The printed size when nothing else gives one. */
export const DEFAULT_PRINT_MM = 25;

const MIME: Readonly<Record<ExportFormat, string>> = Object.freeze({
	svg: 'image/svg+xml',
	png: 'image/png',
	jpeg: 'image/jpeg',
	webp: 'image/webp',
	pdf: 'application/pdf',
	eps: 'application/postscript',
});

const EXTENSION: Readonly<Record<ExportFormat, string>> = Object.freeze({
	svg: 'svg',
	png: 'png',
	jpeg: 'jpg',
	webp: 'webp',
	pdf: 'pdf',
	eps: 'eps',
});

const WHITE = { r: 255, g: 255, b: 255, a: 1 };

export interface ExportInput {
	readonly symbol: BuiltSymbol;
	/** The design as drawn, after the content's constraints. */
	readonly design: QrDesignV1;
	/** The size the content fixes, if it fixes one. */
	readonly fixedSizeMm: number | undefined;
	readonly conditions: VerifyConditions;
	readonly registries: DesignRegistries;
	readonly assets: (id: string) => RgbaImage | undefined;
	readonly fonts: FontRegistry | undefined;
	readonly seed: number;
	readonly rasterEncoder: RasterEncoder | null;
	readonly printer: Printer | null;
}

function positive(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function within(value: unknown, min: number, max: number): value is number {
	return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

interface Checked {
	readonly design: QrDesignV1;
	readonly issues: Issue[];
	readonly options: {
		readonly widthPx?: number;
		readonly dpi?: number;
		readonly colourSpace?: 'srgb' | 'cmyk';
		readonly bleedMm?: number;
		readonly cropMarks?: boolean;
		readonly quality?: number;
	};
}

/** The options that fit, the design they change, and an issue for each that did not. */
function checkOptions(input: ExportInput, format: ExportFormat, options: ExportOptions): Checked {
	const issues: Issue[] = [];
	const bad = (option: string): void => {
		issues.push(issue(STUDIO_KEYS.exportOption, ['options', option], 'warning'));
	};
	const given = (typeof options === 'object' && options !== null ? options : {}) as Record<
		string,
		unknown
	>;
	let design = input.design;
	const out: { -readonly [K in keyof Checked['options']]: Checked['options'][K] } = {};

	if (given.quietZone !== undefined) {
		const zone = given.quietZone;
		if (
			typeof zone === 'number' &&
			Number.isInteger(zone) &&
			zone >= 0 &&
			zone <= LIMITS.quietZone
		) {
			design = { ...design, quietZone: zone };
			const minimum = MIN_QUIET_ZONE[input.symbol.symbology] ?? 4;
			if (zone < minimum) {
				issues.push(
					issue(STUDIO_KEYS.quietZoneBelowMinimum, ['options', 'quietZone'], 'warning', {
						min: minimum,
					}),
				);
			}
		} else bad('quietZone');
	}

	const print = format === 'pdf' || format === 'eps';
	let sizeMm = design.output.sizeMm;
	if (given.sizeMm !== undefined) {
		if (!within(given.sizeMm, LIMITS.sizeMm.min, LIMITS.sizeMm.max)) bad('sizeMm');
		else if (input.fixedSizeMm !== undefined && given.sizeMm !== input.fixedSizeMm) {
			issues.push(
				issue(STUDIO_KEYS.exportSizeConstrained, ['options', 'sizeMm'], 'warning', {
					size: input.fixedSizeMm,
				}),
			);
		} else sizeMm = given.sizeMm;
	}
	if (print && sizeMm === undefined) sizeMm = input.conditions.sizeMm ?? DEFAULT_PRINT_MM;
	// Only ever set to a number above, so a change is always to a size.
	if (sizeMm !== design.output.sizeMm) {
		design = { ...design, output: { ...design.output, sizeMm: sizeMm as number } };
	}

	if (given.widthPx !== undefined) {
		const width = given.widthPx;
		if (
			typeof width === 'number' &&
			Number.isInteger(width) &&
			width >= 1 &&
			width <= EXPORT_MAX_SIDE
		) {
			out.widthPx = width;
		} else bad('widthPx');
	}
	if (given.dpi !== undefined) {
		if (within(given.dpi, LIMITS.dpi.min, LIMITS.dpi.max)) out.dpi = given.dpi;
		else bad('dpi');
	} else if (design.output.dpi !== undefined) out.dpi = design.output.dpi;
	if (given.colourSpace !== undefined) {
		if (given.colourSpace === 'srgb' || given.colourSpace === 'cmyk')
			out.colourSpace = given.colourSpace;
		else bad('colourSpace');
	}
	if (given.bleedMm !== undefined) {
		if (within(given.bleedMm, 0, 50)) out.bleedMm = given.bleedMm;
		else bad('bleedMm');
	}
	if (given.cropMarks !== undefined) {
		if (typeof given.cropMarks === 'boolean') out.cropMarks = given.cropMarks;
		else bad('cropMarks');
	}
	if (given.quality !== undefined) {
		if (within(given.quality, 0, 1)) out.quality = given.quality;
		else bad('quality');
	}
	return { design, issues, options: out };
}

/** The scene's printed width and height in millimetres, when it has a physical size. */
function physical(scene: Scene): { readonly width: number; readonly height: number } | null {
	const units = scene.unitsPerMm;
	if (!positive(units)) return null;
	return { width: scene.width / units, height: scene.height / units };
}

/** Pixels across for a raster of `scene`. */
function rasterWidth(scene: Scene, widthPx: number | undefined, dpi: number | undefined): number {
	if (widthPx !== undefined) return widthPx;
	const size = physical(scene);
	if (size !== null) return Math.max(1, Math.round((size.width / 25.4) * (dpi ?? DEFAULT_DPI)));
	// Whole pixels a module, so no module's edge falls across a pixel.
	const perModule = Math.max(1, Math.ceil(DEFAULT_RASTER / scene.width));
	return Math.max(1, Math.round(scene.width * perModule));
}

function tooLarge(width: number, height: number): QrStudioError {
	return new QrStudioError(
		'render/surface-too-large',
		'That picture is too large to draw here. Choose a smaller size.',
		{ width, height, maxPixels: EXPORT_MAX_PIXELS },
	);
}

function unavailable(format: ExportFormat): QrStudioError {
	return new QrStudioError(
		'render/format-unavailable',
		'This browser cannot save in that format. Choose PNG or SVG.',
		{ format },
	);
}

async function raster(
	scene: Scene,
	format: 'png' | 'jpeg' | 'webp',
	checked: Checked,
	encoder: RasterEncoder | null,
): Promise<Result<{ bytes: Uint8Array; width: number; height: number }>> {
	if (format !== 'png' && encoder === null) return err(unavailable(format));
	const width = rasterWidth(scene, checked.options.widthPx, checked.options.dpi);
	const height = Math.max(1, Math.round((width * scene.height) / scene.width));
	if (width > EXPORT_MAX_SIDE || height > EXPORT_MAX_SIDE || width * height > EXPORT_MAX_PIXELS) {
		return err(tooLarge(width, height));
	}
	// JPEG has no transparency, and an encoder flattens onto black unasked.
	const image = rasterise(scene, {
		width,
		height,
		...(format === 'jpeg' && scene.background === null ? { background: WHITE } : {}),
	});
	if (format === 'png') {
		const size = physical(scene);
		const dpi = size === null ? checked.options.dpi : (width / size.width) * 25.4;
		return ok({ bytes: encodePng(image, dpi === undefined ? {} : { dpi }), width, height });
	}
	const encoded = await (encoder as RasterEncoder).encode(
		image,
		format,
		checked.options.quality === undefined ? {} : { quality: checked.options.quality },
	);
	return encoded.ok ? ok({ bytes: encoded.value, width, height }) : encoded;
}

export async function exportSymbol(
	input: ExportInput,
	format: ExportFormat,
	options: ExportOptions,
): Promise<Result<ExportResult>> {
	if (!Object.prototype.hasOwnProperty.call(MIME, format)) {
		throw new TypeError('export: format is svg, png, jpeg, webp, pdf or eps.');
	}
	if ((format === 'pdf' || format === 'eps') && input.printer === null)
		return err(unavailable(format));
	const checked = checkOptions(input, format, options);
	let built;
	try {
		built = buildScene(input.symbol, checked.design, {
			registries: input.registries,
			assets: input.assets,
			...(input.fonts === undefined ? {} : { fonts: input.fonts }),
			seed: input.seed,
		});
	} catch (thrown) {
		return err(asStudioError(thrown, 'render/format-unavailable'));
	}
	const { scene } = built;
	const issues = [...built.issues, ...checked.issues];
	const filename = exportName(checked.design.name, EXTENSION[format]);
	const done = (bytes: Uint8Array, width: number, height: number): Result<ExportResult> =>
		ok(Object.freeze({ filename, mime: MIME[format], bytes, width, height, issues }));
	try {
		switch (format) {
			case 'svg':
				return done(new TextEncoder().encode(sceneToSvg(scene)), scene.width, scene.height);
			case 'png':
			case 'jpeg':
			case 'webp': {
				const drawn = await raster(scene, format, checked, input.rasterEncoder);
				return drawn.ok ? done(drawn.value.bytes, drawn.value.width, drawn.value.height) : drawn;
			}
			case 'pdf':
			case 'eps': {
				const printer = input.printer as Printer;
				const size = physical(scene) as { width: number; height: number };
				const colour = checked.options.colourSpace ?? checked.design.output.colourSpace;
				if (format === 'pdf') {
					const bytes = printer.pdf(scene, {
						colour,
						widthMm: size.width,
						heightMm: size.height,
						...(checked.options.bleedMm === undefined ? {} : { bleedMm: checked.options.bleedMm }),
						...(checked.options.cropMarks === undefined
							? {}
							: { cropMarks: checked.options.cropMarks }),
					});
					return done(bytes, size.width, size.height);
				}
				const text = printer.eps(scene, { colour, widthMm: size.width });
				return done(new TextEncoder().encode(text), size.width, size.height);
			}
		}
	} catch (thrown) {
		return err(asStudioError(thrown, 'render/format-unavailable'));
	}
}
