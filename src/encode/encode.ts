/**
 * Content in, one symbol out: the smallest version that holds it, at the
 * level asked for, with the mask chosen or forced.
 *
 * Segmentation depends on the version only through the character count
 * widths, so content is segmented once per profile (three times for all of
 * QR) and each version is a comparison of bits against capacity. The version
 * is the smallest that fits by the symbology's own order (for QR, the version
 * number; for rMQR, the preference the caller gave).
 *
 * Kanji, under the default 'when-smaller', has to earn its place: the content
 * is fitted once without it and once with it, and kanji is used only when it
 * gets the content into a smaller symbol. Fewer bits in the same symbol is no
 * reason to take on the readers that mishandle kanji mode.
 */

import { TooMuchDataError } from '../core/errors.js';
import type { Registry } from '../core/registry.js';
import type { QrStudioError } from '../core/errors.js';
import type { Segment, SegmentHeader } from '../segment/types.js';
import { headerBitLength, segmentsBitLength } from '../segment/write.js';
import type { BuiltSymbol, SymbologyEntry } from '../symbology/types.js';
import type { EncodeOptions, Plan } from './plan.js';
import { buildSymbol, inputKind, resolvePlan, segmenter } from './plan.js';

interface Fit {
	readonly version: string;
	readonly rank: number;
	readonly segments: readonly Segment[];
}

/** The first version, in the plan's order, whose segments fit; or what stopped every one. */
function firstFit(
	plan: Plan,
	segments: ReturnType<typeof segmenter>,
	kanji: 'never' | 'always',
	header: SegmentHeader,
): Fit | { readonly bits: number | undefined; readonly error: QrStudioError | undefined } {
	let error: QrStudioError | undefined;
	for (let rank = 0; rank < plan.versions.length; rank += 1) {
		const version = plan.versions[rank] as string;
		const profile = plan.entry.profile(version);
		const found = segments(profile, kanji);
		if (!Array.isArray(found)) {
			error ??= found;
			continue;
		}
		const bits = headerBitLength(header, profile) + segmentsBitLength(found, profile);
		if (bits <= plan.entry.blocks(version, plan.ecLevel).dataBits)
			return { version, rank, segments: found };
	}
	const profile = plan.entry.profile(plan.largest);
	const found = segments(profile, kanji);
	const bits = Array.isArray(found)
		? headerBitLength(header, profile) + segmentsBitLength(found, profile)
		: undefined;
	return { bits, error };
}

/** Throws TooMuchDataError when nothing allowed fits. */
export function encode(
	input: string | Uint8Array,
	options: EncodeOptions = {},
	symbologies?: Registry<SymbologyEntry>,
): BuiltSymbol {
	inputKind(input);
	const plan = resolvePlan(options, symbologies, { structuredAppend: false });
	const segments = segmenter(input, plan);
	const header: SegmentHeader = plan.fnc1 === undefined ? {} : { fnc1: plan.fnc1 };

	const kanjiPolicy = typeof input === 'string' ? plan.policy.kanji : 'never';
	const plain = kanjiPolicy === 'always' ? undefined : firstFit(plan, segments, 'never', header);
	const kanji = kanjiPolicy === 'never' ? undefined : firstFit(plan, segments, 'always', header);
	const fits = [kanji, plain].filter((fit): fit is Fit => fit !== undefined && 'rank' in fit);
	// With both on the table ('when-smaller'), kanji is listed first and wins
	// only by being strictly smaller.
	fits.sort((a, b) => a.rank - b.rank);
	const best = fits.length === 2 && fits[0]?.rank === fits[1]?.rank ? fits[1] : fits[0];
	if (best !== undefined) return buildSymbol(plan, best.version, best.segments, header);

	// Nothing fits. Say how far off the largest allowed symbol is, using
	// whichever segmentation came closer.
	const failed = [plain, kanji].filter(
		(fit): fit is Exclude<ReturnType<typeof firstFit>, Fit> => fit !== undefined,
	);
	const needed = failed.map((fit) => fit.bits).filter((bits): bits is number => bits !== undefined);
	if (needed.length === 0) throw failed[0]?.error;
	throw new TooMuchDataError(
		Math.min(...needed),
		plan.entry.blocks(plan.largest, plan.ecLevel).dataBits,
	);
}
