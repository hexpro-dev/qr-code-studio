/**
 * Content constraints over a design.
 *
 * Some content fixes parts of the code: an EPC payment code must be at level
 * M and no larger than version 13, and the Swiss QR-bill fixes everything (black
 * on white, square modules, level M, 46 mm). The content wins, always, so
 * the studio runs the design through this before every build and shows the
 * issues it returns beside the controls they disabled. Nothing here fails:
 * each constraint is applied, and each change it makes is reported.
 */

import { issue } from '../core/issue.js';
import type { Issue } from '../core/issue.js';
import type { EcLevel } from '../segment/types.js';
import { canonicalJson } from './canonical.js';
import { defaultDesign } from './document.js';
import type { DesignConstraints, DesignPaint, QrDesignV1, RegionStyle } from './types.js';

const LEVELS: readonly EcLevel[] = ['L', 'M', 'Q', 'H'];
const BLACK: DesignPaint = { kind: 'solid', ink: '#000000' };
const WHITE: DesignPaint = { kind: 'solid', ink: '#ffffff' };

function same(a: unknown, b: unknown): boolean {
	return canonicalJson(a) === canonicalJson(b);
}

/** The allowed level nearest `level`: the lowest allowed at or above it, else the highest allowed. */
function nearestLevel(level: EcLevel, allowed: readonly EcLevel[]): EcLevel {
	const rank = LEVELS.indexOf(level);
	const sorted = [...allowed].sort((a, b) => LEVELS.indexOf(a) - LEVELS.indexOf(b));
	return (
		sorted.find((candidate) => LEVELS.indexOf(candidate) >= rank) ??
		(sorted[sorted.length - 1] as EcLevel)
	);
}

/** The same design in black on white, its shapes and layout untouched. */
function blackOnWhite(design: QrDesignV1): QrDesignV1 {
	const regions: Partial<Record<keyof QrDesignV1['regions'], RegionStyle>> = {};
	for (const role of ['finder', 'sub-finder', 'corner-finder'] as const) {
		const style = design.regions[role];
		if (style !== undefined) regions[role] = { outer: style.outer, inner: style.inner };
	}
	return {
		...design,
		background: WHITE,
		modules: { shape: design.modules.shape, paint: BLACK, light: null },
		regions,
		logo:
			design.logo === null
				? null
				: {
						...design.logo,
						plate: design.logo.plate === null ? null : { ...design.logo.plate, paint: WHITE },
						...(design.logo.source.kind === 'icon' ? { paint: BLACK } : {}),
					},
		frame:
			design.frame === null
				? null
				: {
						...design.frame,
						paint: BLACK,
						...(design.frame.text === undefined
							? {}
							: { text: { ...design.frame.text, paint: WHITE } }),
					},
	};
}

export function applyConstraints(
	design: QrDesignV1,
	constraints: DesignConstraints | undefined,
): { readonly design: QrDesignV1; readonly issues: readonly Issue[] } {
	const issues: Issue[] = [];
	if (constraints === undefined) return { design, issues };
	let out = design;

	if (constraints.designLocked === true) {
		// The look is fixed: the default design's, with the quiet zone no
		// narrower than its. How the symbol is chosen beyond the level (version
		// limits, mask, segmentation) is left to the other constraints, the
		// output and the name to the person.
		const base = defaultDesign();
		const { boostEc: _boost, ecLevel: _level, symbology, ...choices } = design.symbol;
		// Version names and masks belong to their symbology; only the
		// segmentation carries over to another.
		const kept =
			symbology === base.symbol.symbology
				? choices
				: choices.segmentation === undefined
					? {}
					: { segmentation: choices.segmentation };
		const locked: QrDesignV1 = {
			...base,
			symbol: { ...base.symbol, ...kept },
			quietZone: Math.max(design.quietZone, base.quietZone),
			output: design.output,
			...(design.name === undefined ? {} : { name: design.name }),
		};
		if (!same({ ...locked, quietZone: 0 }, { ...design, quietZone: 0 })) {
			issues.push(issue('design.issue.design-locked', [], 'warning'));
		}
		out = locked;
	}

	if (constraints.colours === 'black-on-white') {
		const recoloured = blackOnWhite(out);
		if (!same(recoloured, out))
			issues.push(issue('design.issue.colours-constrained', [], 'warning'));
		out = recoloured;
	}

	if (constraints.symbologies !== undefined && constraints.symbologies.length > 0) {
		if (!constraints.symbologies.includes(out.symbol.symbology)) {
			const symbology = constraints.symbologies[0] as string;
			const { ecLevel, boostEc, segmentation } = out.symbol;
			out = {
				...out,
				symbol: {
					symbology,
					...(ecLevel === undefined ? {} : { ecLevel }),
					...(boostEc === undefined ? {} : { boostEc }),
					...(segmentation === undefined ? {} : { segmentation }),
				},
			};
			issues.push(issue('design.issue.symbology-constrained', ['symbol', 'symbology'], 'warning'));
		}
	}

	if (constraints.ecLevels !== undefined && constraints.ecLevels.length > 0) {
		const allowed = constraints.ecLevels;
		const level = out.symbol.ecLevel ?? 'M';
		const chosen = allowed.includes(level) ? level : nearestLevel(level, allowed);
		if (chosen !== out.symbol.ecLevel) {
			if (out.symbol.ecLevel !== undefined) {
				issues.push(
					issue('design.issue.ec-level-constrained', ['symbol', 'ecLevel'], 'warning', {
						level: chosen,
					}),
				);
			}
			out = { ...out, symbol: { ...out.symbol, ecLevel: chosen } };
		}
		// Raising the level as far as it fits could leave the allowed set.
		const above = LEVELS.slice(LEVELS.indexOf(chosen));
		if (out.symbol.boostEc === true && !above.every((candidate) => allowed.includes(candidate))) {
			out = { ...out, symbol: { ...out.symbol, boostEc: false } };
			issues.push(issue('design.issue.boost-constrained', ['symbol', 'boostEc'], 'warning'));
		}
	}

	if (constraints.maxVersion !== undefined && out.symbol.symbology === 'qr') {
		const limit = Number(constraints.maxVersion);
		const current = out.symbol.maxVersion === undefined ? undefined : Number(out.symbol.maxVersion);
		if (current === undefined || current > limit) {
			if (current !== undefined) {
				issues.push(
					issue('design.issue.version-constrained', ['symbol', 'maxVersion'], 'warning', {
						max: limit,
					}),
				);
			}
			const min = out.symbol.minVersion === undefined ? undefined : Number(out.symbol.minVersion);
			const symbol = { ...out.symbol, maxVersion: constraints.maxVersion };
			if (min !== undefined && min > limit) {
				delete (symbol as { minVersion?: string }).minVersion;
				issues.push(
					issue('design.issue.version-constrained', ['symbol', 'minVersion'], 'warning', {
						max: limit,
					}),
				);
			}
			out = { ...out, symbol };
		}
	}

	if (constraints.eci === 'never' && out.symbol.segmentation?.eci !== 'never') {
		if (out.symbol.segmentation?.eci !== undefined) {
			issues.push(
				issue('design.issue.eci-constrained', ['symbol', 'segmentation', 'eci'], 'warning'),
			);
		}
		out = {
			...out,
			symbol: { ...out.symbol, segmentation: { ...out.symbol.segmentation, eci: 'never' } },
		};
	}

	if (constraints.sizeMm !== undefined && out.output.sizeMm !== constraints.sizeMm) {
		if (out.output.sizeMm !== undefined) {
			issues.push(
				issue('design.issue.size-constrained', ['output', 'sizeMm'], 'warning', {
					size: constraints.sizeMm,
				}),
			);
		}
		out = { ...out, output: { ...out.output, sizeMm: constraints.sizeMm } };
	}

	if (constraints.overlay === 'swiss-cross') {
		// SEAM: the Swiss cross the QR-bill prints over its code is drawn by the
		// payment slip, not by a design entry; this layer says it is needed.
		issues.push(issue('design.issue.overlay-required', [], 'info', { overlay: 'swiss-cross' }));
	}
	return { design: out, issues };
}
