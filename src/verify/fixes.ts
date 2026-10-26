/**
 * One-click fixes for what the scan check found.
 *
 * Each fix answers one finding and changes as little as it can: raise the
 * error correction a level, make the logo a quarter smaller, clear the logo
 * to its outline rather than its box, use the design's darkest ink, widen
 * the quiet zone to the minimum, draw square modules or square finders,
 * swap light on dark round, or print the code larger (which changes the
 * conditions rather than the design). A fix is offered only where it can
 * help: no raise past H, no shrink below the smallest logo, no darkest ink
 * that is the ink already in use. tests/verify/fixes.test.ts applies each
 * one and checks the finding it answers really improves.
 *
 * A fix that changes several settings at once is one patch with an empty
 * path, carrying the whole new design: `applyDesignPatch` replaces the
 * design with it.
 */

import { LIMITS } from '../design/document.js';
import { CAMERA } from './camera.js';
import { inkColour } from '../design/paint.js';
import type {
	DesignPaint,
	DesignRegistries,
	Ink,
	QrDesignV1,
	RegionStyle,
} from '../design/types.js';
import type { EcLevel } from '../segment/types.js';
import { luma, paintInks, redReflectance } from './inks.js';
import { RED_CONTRAST_WARN } from './static.js';
import type { CaptureAxis, CheckId, DesignPatch, Fix, VerifyReport } from './types.js';

const LEVELS: readonly EcLevel[] = ['L', 'M', 'Q', 'H'];

const AXES: readonly CaptureAxis[] = [
	'distance',
	'focus',
	'motion',
	'noise',
	'angle',
	'light',
	'glare',
	'ink',
	'contrast',
];

/** Below this share of its cell inked, a module shape counts as thin. */
const THIN_INK = 0.6;

/** Make a copy of `design` with `patch` applied. Objects along the path are copied, never changed. */
export function applyDesignPatch(design: QrDesignV1, patch: DesignPatch): QrDesignV1 {
	if (!Array.isArray(patch.path)) throw new TypeError('applyDesignPatch: patch.path is a list.');
	if (patch.path.length === 0) return patch.value as QrDesignV1;
	const set = (node: unknown, depth: number): unknown => {
		const key = patch.path[depth] as string | number;
		if (depth === patch.path.length - 1) {
			if (Array.isArray(node)) {
				const copy = [...node];
				copy[key as number] = patch.value;
				return copy;
			}
			return { ...(node as object), [key]: patch.value };
		}
		const child = (node as Record<string | number, unknown> | null)?.[key];
		if (typeof child !== 'object' || child === null) {
			throw new TypeError(
				'applyDesignPatch: the path goes through something that is not an object.',
			);
		}
		if (Array.isArray(node)) {
			const copy = [...node];
			copy[key as number] = set(child, depth + 1);
			return copy;
		}
		return { ...(node as object), [key]: set(child, depth + 1) };
	};
	return set(design, 0) as QrDesignV1;
}

function solid(ink: Ink): DesignPaint {
	return { kind: 'solid', ink };
}

/** The design with every module and finder drawn in one paint. */
function withInk(design: QrDesignV1, paint: DesignPaint): QrDesignV1 {
	const regions: Partial<Record<'finder' | 'sub-finder' | 'corner-finder', RegionStyle>> = {};
	for (const role of ['finder', 'sub-finder', 'corner-finder'] as const) {
		const style = design.regions[role];
		if (style === undefined) continue;
		regions[role] = { outer: style.outer, inner: style.inner };
	}
	return { ...design, modules: { ...design.modules, paint }, regions };
}

function failing(report: VerifyReport, id: CheckId): boolean {
	return report.checks.some((check) => check.id === id && check.status !== 'pass');
}

/** An axis that gave out before its everyday level. */
function short(report: VerifyReport, axis: CaptureAxis): boolean {
	const capture = report.captures.find((found) => found.axis === axis);
	if (capture === undefined || capture.firstFailed === null) return false;
	return capture.firstFailed <= capture.typical;
}

/** Every dark ink of a design, in the order it uses them. */
function darkInks(design: QrDesignV1, registries: DesignRegistries | undefined): Ink[] {
	const inks: Ink[] = [];
	const add = (paint: DesignPaint | undefined): void => {
		if (paint === undefined) return;
		if (paint.kind === 'entry') {
			if (registries !== undefined) inks.push(...paintInks(paint, registries));
			return;
		}
		inks.push(...(paint.kind === 'solid' ? [paint.ink] : paint.stops.map((stop) => stop.ink)));
	};
	add(design.modules.paint);
	for (const style of Object.values(design.regions) as RegionStyle[]) {
		add(style.outerPaint);
		add(style.innerPaint);
	}
	return inks;
}

function inkLuma(ink: Ink): number {
	return luma(inkColour(ink));
}

/**
 * What to change, for each finding of `report` on `design`. `registries`
 * lets the colours of an entry fill be compared; without it they are left
 * out of the choice of darkest ink.
 */
export function suggestFixes(
	report: VerifyReport,
	design: QrDesignV1,
	registries?: DesignRegistries,
): readonly Fix[] {
	const fixes: Fix[] = [];
	const offer = (fix: Fix): void => {
		if (!fixes.some((found) => found.id === fix.id)) fixes.push(fix);
	};
	const lightOnDark = report.checks.some(
		(check) => check.id === 'polarity' && check.status !== 'pass',
	);

	// The logo.
	const logoCosts = failing(report, 'logo-budget');
	const logoInTheWay =
		design.logo !== null &&
		report.checks.some(
			(check) =>
				check.id === 'function-patterns' &&
				check.status !== 'pass' &&
				check.messageKey !== 'verify.check.function-patterns.finder',
		);
	const level = report.symbol.ecLevel;
	const higher = LEVELS[LEVELS.indexOf(level) + 1];
	// More error correction repairs what a logo hides and what glare washes
	// out. Measured with the strict reader, it moves nothing on the other
	// axes, so it is not offered for them.
	const glare = short(report, 'glare');
	if (higher !== undefined && report.symbol.symbology === 'qr' && (logoCosts || glare)) {
		offer({
			id: 'raise-ec',
			labelKey: 'verify.fix.raise-ec',
			patch: { path: ['symbol', 'ecLevel'], value: higher },
			params: { level: higher },
			targets: logoCosts ? 'logo-budget' : 'glare',
		});
	}
	if (design.logo !== null && (logoCosts || logoInTheWay)) {
		const smaller = Math.max(LIMITS.logoSize.min, Math.round(design.logo.size * 75) / 100);
		if (smaller < design.logo.size) {
			offer({
				id: 'shrink-logo',
				labelKey: 'verify.fix.shrink-logo',
				patch: { path: ['logo', 'size'], value: smaller },
				params: { percent: Math.round(smaller * 100) },
				targets: logoCosts ? 'logo-budget' : 'function-patterns',
			});
		}
		// A plate hides its whole area whatever is cleared under it, so clearing
		// to the outline helps only a logo drawn without one.
		if (logoCosts && design.logo.clear === 'box' && design.logo.plate === null) {
			offer({
				id: 'logo-clear-shape',
				labelKey: 'verify.fix.logo-clear-shape',
				patch: { path: ['logo', 'clear'], value: 'shape' },
				targets: 'logo-budget',
			});
		}
	}

	// Colour.
	if (lightOnDark && design.background !== null) {
		offer({
			id: 'dark-on-light',
			labelKey: 'verify.fix.dark-on-light',
			patch: {
				path: [],
				value: { ...withInk(design, design.background), background: design.modules.paint },
			},
			targets: 'polarity',
		});
	}
	const weakContrast =
		failing(report, 'contrast') || short(report, 'contrast') || short(report, 'light');
	if (weakContrast && !lightOnDark) {
		const inks = darkInks(design, registries);
		const darkest = inks.reduce<Ink | null>(
			(best, ink) => (best === null || inkLuma(ink) < inkLuma(best) ? ink : best),
			null,
		);
		const lightest = inks.reduce((worst, ink) => Math.max(worst, inkLuma(ink)), 0);
		// The darkest ink the design already has, if using it everywhere is a
		// change; black otherwise.
		const choice = darkest !== null && inkLuma(darkest) < lightest ? darkest : '#000000';
		if (inks.length === 0 || inkLuma(choice) < lightest) {
			offer({
				id: 'darken-modules',
				labelKey: choice === '#000000' ? 'verify.fix.black-modules' : 'verify.fix.darken-modules',
				patch: { path: [], value: withInk(design, solid(choice)) },
				targets: failing(report, 'contrast')
					? 'contrast'
					: short(report, 'contrast')
						? 'contrast'
						: 'light',
			});
		}
	}
	if (failing(report, 'colour-red-channel') && !lightOnDark) {
		const inks = darkInks(design, registries);
		// Under red light only the red channel counts: the ink with least red.
		const leastRed = inks.reduce<Ink | null>(
			(best, ink) =>
				best === null || redReflectance(inkColour(ink)) < redReflectance(inkColour(best))
					? ink
					: best,
			null,
		);
		const choice =
			leastRed !== null && redReflectance(inkColour(leastRed)) < 1 - RED_CONTRAST_WARN
				? leastRed
				: '#000000';
		offer({
			id: 'low-red-ink',
			labelKey: choice === '#000000' ? 'verify.fix.black-modules' : 'verify.fix.low-red-ink',
			patch: { path: [], value: withInk(design, solid(choice)) },
			targets: 'colour-red-channel',
		});
	}

	// Layout.
	const quiet = report.checks.find((check) => check.id === 'quiet-zone' && check.status === 'fail');
	if (quiet !== undefined && design.quietZone < quiet.threshold) {
		offer({
			id: 'widen-quiet-zone',
			labelKey: 'verify.fix.widen-quiet-zone',
			patch: { path: ['quietZone'], value: quiet.threshold },
			params: { modules: quiet.threshold },
			targets: 'quiet-zone',
		});
	}
	const finders = failing(report, 'finder-shape');
	const roundFinders = (Object.values(design.regions) as RegionStyle[]).some(
		(style) => style.outer.id !== 'square' || style.inner.id !== 'square-centre',
	);
	// Styled finders put some of their own module centres on an edge, where
	// the strict reader's two thresholds disagree, so a styled design falls
	// short across the axes; square finders take that away.
	const fallsShort = AXES.find((axis) => short(report, axis));
	if (roundFinders && (finders || fallsShort !== undefined || !report.baseline.passed)) {
		offer({
			id: 'square-finders',
			labelKey: 'verify.fix.square-finders',
			patch: { path: ['regions'], value: {} },
			targets: finders ? 'finder-shape' : (fallsShort ?? 'finder-shape'),
		});
	}
	// A shape that inks little of its cell loses its modules first to blur
	// and to distance.
	const thin = design.modules.shape.id !== 'square' && report.limits.inkFraction < THIN_INK;
	const blurry = (['focus', 'distance', 'motion'] as const).find((axis) => short(report, axis));
	if (thin && blurry !== undefined) {
		offer({
			id: 'solid-modules',
			labelKey: 'verify.fix.solid-modules',
			patch: { path: ['modules', 'shape'], value: { id: 'square' } },
			targets: blurry,
		});
	}

	// Conditions.
	const size = report.checks.find((check) => check.id === 'module-size' && check.status !== 'pass');
	if (size?.params !== undefined && report.conditions.sizeMm !== null) {
		const current = report.conditions.sizeMm;
		const maxDistance = report.limits.maxDistanceMm;
		const minimum =
			typeof size.params.minimumMm === 'number'
				? size.params.minimumMm
				: maxDistance !== null && maxDistance > 0
					? Math.ceil((current * CAMERA.comfortMm) / maxDistance)
					: null;
		if (minimum !== null && minimum > current) {
			offer({
				id: 'print-larger',
				labelKey: 'verify.fix.print-larger',
				patch: null,
				conditions: { sizeMm: minimum },
				params: { sizeMm: minimum },
				targets: 'module-size',
			});
		}
	}
	return Object.freeze(fixes);
}
