/**
 * Conformance for presets.
 *
 * A preset is a promise that a design works, so each one must validate with
 * no issue at all (no repairs, no warnings, which also means every finder
 * pair it uses is one the design layer's model of the strict reader accepts,
 * round a ring that is neither round nor dotted), have a finder the strict
 * reader's own search finds and whose ring it traces as cornered (see
 * finder.ts), build into a scene with no
 * warning on small and medium symbols (a note, such as a logo made smaller
 * to fit version 1, is allowed), ask for an error correction level its
 * own list allows, and keep its colours readable: dark on light, every dark
 * colour at least 4.5:1 against every ground colour by luminance (the WCAG
 * formula), which is the floor; the catalogue aims for 7:1.
 *
 * Whether it scans at `minSizeMm` is the scan check's question, which lives
 * in the verify layer above this one. It plugs in through `verify`.
 */

import { pow } from '../core/math.js';
import { resolveParams } from '../design/params.js';
import { createDesignRegistries } from '../design/registries.js';
import { buildScene } from '../design/scene.js';
import { inkColour } from '../design/paint.js';
import type { DesignPaint, DesignRegistries, Ink, Preset, QrDesignV1 } from '../design/types.js';
import { validateDesign } from '../design/validate.js';
import type { EcLevel } from '../segment/types.js';
import { createSymbologyRegistry } from '../symbology/registry.js';
import type { BuiltSymbol } from '../symbology/types.js';
import { strictFinderProblems } from './finder.js';
import type { Violation } from './types.js';

/** The floor every preset's colours must clear. */
export const MIN_CONTRAST = 4.5;

/** The strict scan check over a preset, supplied by the verify layer. */
export type PresetVerifier = (preset: Preset, registries: DesignRegistries) => readonly Violation[];

const CATEGORIES = [
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

/** WCAG relative luminance of an ink. */
export function luminance(ink: Ink): number {
	const { r, g, b } = inkColour(ink);
	const linear = (channel: number): number => {
		const c = channel / 255;
		return c <= 0.04045 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4);
	};
	return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** The WCAG contrast ratio between two inks, larger over smaller. */
export function contrast(a: Ink, b: Ink): number {
	const la = luminance(a);
	const lb = luminance(b);
	return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Every ink a paint can put down, including the colour parameters of an entry fill. */
export function paintInks(paint: DesignPaint, registries: DesignRegistries): Ink[] {
	switch (paint.kind) {
		case 'solid':
			return [paint.ink];
		case 'entry': {
			const fill = registries.fills.get(paint.ref.id);
			if (fill === undefined) return [];
			const inks: Ink[] = [];
			for (const schema of fill.params) {
				if (schema.kind !== 'colour') continue;
				const given = paint.ref.params?.[schema.key];
				inks.push(typeof given === 'string' ? given : (schema.default as string));
			}
			// The palette uses only its first `count` colours.
			const count = paint.ref.params?.count ?? fill.params.find((p) => p.key === 'count')?.default;
			return typeof count === 'number' ? inks.slice(0, count) : inks;
		}
		default:
			return paint.stops.map((stop) => stop.ink);
	}
}

/** The dark inks of a design: modules, finders and an icon logo. */
export function darkInks(design: QrDesignV1, registries: DesignRegistries): Ink[] {
	const inks = paintInks(design.modules.paint, registries);
	for (const style of Object.values(design.regions)) {
		if (style?.outerPaint !== undefined) inks.push(...paintInks(style.outerPaint, registries));
		if (style?.innerPaint !== undefined) inks.push(...paintInks(style.innerPaint, registries));
	}
	if (design.logo?.paint !== undefined) inks.push(...paintInks(design.logo.paint, registries));
	return inks;
}

/** A QR symbol holding nothing, for building a scene without the encoder. */
export function emptySymbol(version: string, ecLevel: 'L' | 'M' | 'Q' | 'H' = 'M'): BuiltSymbol {
	const qr = createSymbologyRegistry().require('qr');
	const blocks = qr.blocks(version, ecLevel);
	const total = blocks.blocks.reduce((sum, block) => sum + block.dataCount, 0);
	// A terminator, then the alternating pad codewords the standard fills with.
	const codewords = new Uint8Array(total);
	for (let i = 1; i < total; i += 1) codewords[i] = i % 2 === 1 ? 0xec : 0x11;
	return qr.build(codewords, version, ecLevel, 'auto');
}

export function checkPreset(
	preset: Preset,
	verify: PresetVerifier | null = null,
	registries: DesignRegistries = createDesignRegistries(),
): Violation[] {
	const violations: Violation[] = [];
	const report = (rule: string, detail: string): void => {
		violations.push({ entry: preset.id, rule, detail });
	};
	if (!CATEGORIES.includes(preset.category))
		report('category', 'the category is not one of the nine');
	if (!(preset.minSizeMm > 0) || !Number.isFinite(preset.minSizeMm)) {
		report('min-size', 'minSizeMm is not a positive number of millimetres');
	}
	const level = preset.design.symbol.ecLevel ?? 'M';
	for (const [at, size] of Object.entries(preset.sizesMm ?? {})) {
		if (!preset.ecLevels.includes(at as EcLevel)) {
			report('min-size', `there is a size for level ${at}, which the preset does not allow`);
		} else if (!(typeof size === 'number' && size > 0 && Number.isFinite(size))) {
			report('min-size', `the size for level ${at} is not a positive number of millimetres`);
		} else if (at === level && size !== preset.minSizeMm) {
			report('min-size', `the size for level ${at}, the design's own, is not minSizeMm`);
		}
	}
	if (preset.ecLevels.length === 0 || !preset.ecLevels.includes(level)) {
		report(
			'ec-levels',
			`the design asks for level ${level}, which its list of levels does not allow`,
		);
	}

	const { design, issues } = validateDesign(preset.design, registries);
	if (issues.length > 0 || design === null) {
		report(
			'validates',
			`validation reports ${issues.map((found) => `${found.code} at ${found.path.join('.')}`).join(', ')}`,
		);
		return violations;
	}

	// The finder pair, put to the strict reader's own tests as well as the
	// design layer's model of them, which validation has asked already (and
	// so has made sure both shapes exist and draw the finder).
	const finder = design.regions.finder;
	if (finder !== undefined) {
		const outer = registries.regionShapes.require(finder.outer.id);
		const inner = registries.regionShapes.require(finder.inner.id);
		const problems = strictFinderProblems(
			outer,
			resolveParams(outer.params, finder.outer.params),
			inner,
			resolveParams(inner.params, finder.inner.params),
		);
		for (const problem of problems) report('finder', problem.detail);
	}

	for (const version of ['1', '10']) {
		const built = buildScene(emptySymbol(version, level), design, { registries, seed: 1 });
		// A note (a logo made smaller to fit a small symbol) is not a fault.
		const faults = built.issues.filter((found) => found.severity !== 'info');
		if (faults.length > 0) {
			report(
				'scene',
				`version ${version}: building reports ${faults.map((found) => found.code).join(', ')}`,
			);
		}
	}

	if (design.background === null)
		report('contrast', 'a preset has a ground colour, so its contrast is known');
	else {
		const grounds = paintInks(design.background, registries);
		for (const dark of darkInks(design, registries)) {
			for (const ground of grounds) {
				if (luminance(dark) >= luminance(ground)) {
					report('contrast', 'a module colour is lighter than the ground');
				} else if (contrast(dark, ground) < MIN_CONTRAST) {
					report(
						'contrast',
						`a module colour has ${contrast(dark, ground).toFixed(2)}:1 against the ground`,
					);
				}
			}
		}
	}

	if (verify !== null) violations.push(...verify(preset, registries));
	return violations;
}
