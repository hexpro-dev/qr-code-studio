/**
 * Conformance for finder pairs against captures, not sharp pictures.
 *
 * Every ring and centre the pair table offers on a family of modules
 * (`regionPairConforms` with that family, at default params) is put in a
 * whole code among the family's modules and read from the scan check's own
 * captures, clean and with ink spread or starved (see verify/region.ts,
 * which supplies the reader). A pair that misses one capture fails: the
 * ring must list the centre as `unpaired` for that family, so the studio no
 * longer offers it there. An entry that fails in every family is cut from
 * the catalogue rather than listed.
 *
 * The families are drawn with these shapes, at their defaults: square
 * modules, dots and hexagons.
 */

import { moduleFamilyOf, regionPairConforms, ringKindOf } from '../design/finder.js';
import { resolveParams } from '../design/params.js';
import type { DesignRegistries, ModuleFamily, RegionShape } from '../design/types.js';
import type { Violation } from './types.js';

/** What reads a pair among a family's modules: the verify layer's `regionCaptureReader`. */
export type RegionCaptureCheck = (
	module: { readonly id: string },
	ring: { readonly id: string },
	centre: { readonly id: string },
	registries: DesignRegistries,
) => { readonly captures: number; readonly missed: readonly string[] };

/** The module shape each family is captured with. */
export const FAMILY_MODULES: Readonly<Record<ModuleFamily, string>> = Object.freeze({
	square: 'square',
	dot: 'dot',
	hex: 'hex',
});

export interface RegionCaptureOptions {
	/** The families to read; default all three. */
	readonly families?: readonly ModuleFamily[];
	/** Only pairs with this ring or centre, for checking one entry; default every pair. */
	readonly only?: string;
}

/** The pairs the table offers on `family`: cornered or round rings and centres that draw the QR finder, at their defaults. */
export function familyPairs(
	registries: DesignRegistries,
	family: ModuleFamily,
): (readonly [RegionShape, RegionShape])[] {
	const shapes = registries.regionShapes.list();
	const rings = shapes.filter(
		(s) => s.part === 'outer' && s.kinds.includes('concentric-7') && ringKindOf(s) !== 'dotted',
	);
	const centres = shapes.filter((s) => s.part === 'inner' && s.kinds.includes('concentric-7'));
	const out: (readonly [RegionShape, RegionShape])[] = [];
	for (const ring of rings) {
		for (const centre of centres) {
			if (
				regionPairConforms(
					ring,
					resolveParams(ring.params, undefined),
					centre,
					resolveParams(centre.params, undefined),
					'concentric-7',
					family,
				)
			) {
				out.push([ring, centre]);
			}
		}
	}
	return out;
}

/** Every pair the table offers that a capture among its family's modules missed. */
export function checkRegionCaptures(
	registries: DesignRegistries,
	read: RegionCaptureCheck,
	options: RegionCaptureOptions = {},
): Violation[] {
	const violations: Violation[] = [];
	for (const family of options.families ?? (Object.keys(FAMILY_MODULES) as ModuleFamily[])) {
		const module = FAMILY_MODULES[family];
		const shape = registries.moduleShapes.get(module);
		if (shape === undefined || moduleFamilyOf(shape) !== family) {
			violations.push({
				entry: module,
				rule: 'family',
				detail: `the ${family} family is captured with ${module}, which these registries do not have in that family`,
			});
			continue;
		}
		for (const [ring, centre] of familyPairs(registries, family)) {
			if (options.only !== undefined && ring.id !== options.only && centre.id !== options.only) {
				continue;
			}
			const result = read({ id: module }, { id: ring.id }, { id: centre.id }, registries);
			if (result.missed.length > 0) {
				violations.push({
					entry: ring.id,
					rule: 'captures',
					detail: `with ${centre.id} among ${family} modules, of ${result.captures} captures the strict reader missed ${result.missed.join('; ')}`,
				});
			}
		}
	}
	return violations;
}
