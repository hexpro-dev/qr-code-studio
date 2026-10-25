/**
 * A brand kit applied to a design, and a kit made from one.
 *
 * A kit is a palette, perhaps a logo, and the presets the brand prefers. The
 * palette is a set of colours with no roles, so applying it has to decide
 * which colour goes where, and has to keep the code readable while it does.
 * The rule, in order:
 *
 * 1. The ground. The kit's lightest ink becomes the background when it is
 *    pale enough to be one (relative luminance 0.8 or more, about the
 *    lightness of a pale tint). Otherwise the design keeps its own ground.
 * 2. The modules. The kit's darkest ink becomes the module colour when it
 *    stands at 4.5:1 or more against the ground, the floor every preset is
 *    held to. Otherwise the modules keep their own colour, because a brand
 *    colour that does not read is worse than no brand colour.
 * 3. The finder rings. The next darkest ink that also clears 4.5:1 becomes
 *    the colour of the three corner rings, the one place a second brand
 *    colour shows without costing the data modules anything. Without one the
 *    rings follow the modules. A design with no finder style of its own gets
 *    the plain square ring and centre, the pair every reader finds.
 * 4. The logo. A kit with a picture logo puts it in the middle, keeping the
 *    size and clearing the design already had.
 *
 * Contrast is judged against the ground's own colour when it is a solid
 * ink, and against white otherwise (a gradient, a fill, or no ground, which
 * is paper). The kit's presets are not applied: they are offered, first,
 * beside the rest (`snapshot.library.kit`).
 */

import type { DesignPaint, Ink, QrDesignV1, RegionStyle } from '../design/types.js';
import { contrastRatio, luminance } from './contrast.js';
import { LOGO_ASSET_ID } from './logo.js';
import type { BrandKit } from './types.js';

/** The luminance at or above which a kit ink can be a ground. */
export const KIT_GROUND_LUMINANCE = 0.8;
/** The contrast a kit ink needs against the ground to draw modules or rings. */
export const KIT_CONTRAST = 4.5;
/** The most inks a kit holds, as both library stores allow. */
export const KIT_PALETTE_MAX = 32;

const WHITE: Ink = '#ffffff';

function solid(ink: Ink): DesignPaint {
	return { kind: 'solid', ink };
}

/** The ink a paint is judged against: its own when it is solid, white otherwise. */
function groundInk(paint: DesignPaint | null): Ink {
	return paint !== null && paint.kind === 'solid' ? paint.ink : WHITE;
}

/** The design with `kit` applied by the rule above. The person's own logo stays when the kit has none. */
export function applyKit(design: QrDesignV1, kit: BrandKit): QrDesignV1 {
	const inks = [...kit.palette].sort((a, b) => luminance(a) - luminance(b));
	let out: QrDesignV1 = design;

	const lightest = inks[inks.length - 1];
	if (lightest !== undefined && luminance(lightest) >= KIT_GROUND_LUMINANCE) {
		out = { ...out, background: solid(lightest) };
	}
	const ground = groundInk(out.background);
	const readable = inks.filter(
		(ink) => luminance(ink) < luminance(ground) && contrastRatio(ink, ground) >= KIT_CONTRAST,
	);
	const [modules, rings] = readable;
	if (modules !== undefined) {
		out = { ...out, modules: { ...out.modules, paint: solid(modules) } };
	}
	if (rings !== undefined) {
		const style: RegionStyle = out.regions.finder ?? {
			outer: { id: 'square' },
			inner: { id: 'square-centre' },
		};
		out = { ...out, regions: { ...out.regions, finder: { ...style, outerPaint: solid(rings) } } };
	}
	if (kit.logo !== null) {
		const current = out.logo;
		out = {
			...out,
			logo: {
				size: current?.size ?? 0.2,
				clear: current?.clear ?? 'box',
				padding: current?.padding ?? 1,
				plate: current?.plate ?? null,
				source: { kind: 'asset', id: LOGO_ASSET_ID },
			},
			assets: { [LOGO_ASSET_ID]: kit.logo },
		};
	}
	return out;
}

/** Every solid ink a paint puts down, gradient stops included; an entry fill's are its own business. */
function inksOf(paint: DesignPaint | null | undefined): Ink[] {
	if (paint === null || paint === undefined || paint.kind === 'entry') return [];
	if (paint.kind === 'solid') return [paint.ink];
	return paint.stops.map((stop) => stop.ink);
}

function sameInk(a: Ink, b: Ink): boolean {
	return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * A kit made from a design, for "Save as brand kit": its inks, its picture
 * logo, and no presets, which the person chooses.
 */
export function kitFromDesign(design: QrDesignV1): BrandKit {
	const found = [
		...inksOf(design.modules.paint),
		...inksOf(design.regions.finder?.outerPaint),
		...inksOf(design.regions.finder?.innerPaint),
		...inksOf(design.background),
	];
	const palette: Ink[] = [];
	for (const ink of found) {
		if (palette.length < KIT_PALETTE_MAX && !palette.some((kept) => sameInk(kept, ink))) {
			palette.push(ink);
		}
	}
	const source = design.logo?.source;
	const logo = source?.kind === 'asset' ? (design.assets?.[source.id] ?? null) : null;
	return Object.freeze({ palette: Object.freeze(palette), logo, presets: Object.freeze([]) });
}
