/**
 * What `encode` and `encodeStructuredAppend` share: reading the options,
 * listing the versions a caller allows, segmenting per version, and building
 * a symbol once the version and segments are settled.
 *
 * Options are checked here, all of them, before any work. A wrong option is a
 * caller's bug (a version string that is not one, a mask past 7) and throws
 * TypeError; content that does not fit is a person's situation and throws
 * TooMuchDataError with the numbers they need.
 */

import { QrStudioError } from '../core/errors.js';
import type { Registry } from '../core/registry.js';
import { DEFAULT_SEGMENTATION, segmentBytes, segmentText } from '../segment/segment-text.js';
import type {
	BitstreamProfile,
	EcLevel,
	Segment,
	SegmentHeader,
	SegmentationPolicy,
} from '../segment/types.js';
import { headerBitLength, segmentsBitLength, validApplicationIndicator } from '../segment/write.js';
import { createSymbologyRegistry } from '../symbology/registry.js';
import type { BuiltSymbol, SymbologyEntry } from '../symbology/types.js';
import { dataCodewords } from './bitstream.js';

export interface EncodeOptions {
	/** Default 'qr'. */
	readonly symbology?: string;
	/** Default 'M'. */
	readonly ecLevel?: EcLevel;
	/** Raise the level as far as it goes without needing a larger symbol. Default false. */
	readonly boostEc?: boolean;
	readonly minVersion?: string;
	readonly maxVersion?: string;
	readonly mask?: number | 'auto';
	readonly segmentation?: Partial<SegmentationPolicy>;
	readonly fnc1?: 'gs1' | { applicationIndicator: number };
	/** rMQR only: prefer the shortest height that fits, or the shortest width. Default 'area'. */
	readonly rmqrPreference?: 'area' | 'height' | 'width';
}

export interface Plan {
	readonly entry: SymbologyEntry;
	readonly ecLevel: EcLevel;
	/** Allowed versions that offer the level, smallest first by the preference. */
	readonly versions: readonly string[];
	/** The largest allowed version, for reporting what did not fit. */
	readonly largest: string;
	readonly policy: SegmentationPolicy;
	readonly fnc1: SegmentHeader['fnc1'];
	readonly mask: number | 'auto';
	readonly boostEc: boolean;
}

const LEVELS: readonly EcLevel[] = ['L', 'M', 'Q', 'H'];

function unsupportedFeature(feature: 'fnc1' | 'structured-append'): QrStudioError {
	return new QrStudioError(
		'encode/unsupported-feature',
		feature === 'fnc1'
			? 'This kind of code cannot carry GS1 data. Choose a QR code.'
			: 'This kind of code cannot be split across several codes. Choose a QR code.',
		{ feature },
	);
}

export function resolvePlan(
	options: EncodeOptions,
	symbologies: Registry<SymbologyEntry> | undefined,
	needs: { readonly structuredAppend: boolean },
): Plan {
	if (typeof options !== 'object' || options === null)
		throw new TypeError('encode options are an object');
	const registry = symbologies ?? createSymbologyRegistry();
	const entry = registry.require(options.symbology ?? 'qr');
	const ecLevel = options.ecLevel ?? 'M';
	if (!LEVELS.includes(ecLevel)) throw new TypeError("ecLevel is 'L', 'M', 'Q' or 'H'");
	if (options.boostEc !== undefined && typeof options.boostEc !== 'boolean') {
		throw new TypeError('boostEc is true or false');
	}
	const preference = options.rmqrPreference ?? 'area';
	if (!['area', 'height', 'width'].includes(preference)) {
		throw new TypeError("rmqrPreference is 'area', 'height' or 'width'");
	}
	const { versions } = entry;
	const first = options.minVersion === undefined ? 0 : versions.indexOf(options.minVersion);
	const last =
		options.maxVersion === undefined ? versions.length - 1 : versions.indexOf(options.maxVersion);
	if (first < 0 || last < 0) throw new TypeError(`that is not a version of ${entry.id}`);
	if (first > last) throw new TypeError('minVersion is larger than maxVersion');
	const range = versions.slice(first, last + 1).filter((v) => entry.ecLevels(v).includes(ecLevel));
	if (range.length === 0) {
		throw new TypeError('no allowed version offers that error correction level');
	}

	const mask = options.mask ?? 'auto';
	if (mask !== 'auto' && !range.every((v) => entry.masks(v).includes(mask))) {
		throw new TypeError(`that mask is not one ${entry.id} has at every allowed version`);
	}
	const policy: SegmentationPolicy = { ...DEFAULT_SEGMENTATION, ...options.segmentation };
	// encode hands segmentText only 'never' or 'always' and decides
	// 'when-smaller' itself, so the policy is checked here, not there.
	if (!['never', 'when-smaller', 'always'].includes(policy.kanji)) {
		throw new TypeError("segmentation.kanji is 'never', 'when-smaller' or 'always'");
	}
	if (!['auto', 'never', 'utf-8'].includes(policy.eci)) {
		throw new TypeError("segmentation.eci is 'auto', 'never' or 'utf-8'");
	}
	const { fnc1 } = options;
	if (fnc1 !== undefined && fnc1 !== 'gs1') {
		if (
			typeof fnc1 !== 'object' ||
			fnc1 === null ||
			!validApplicationIndicator(fnc1.applicationIndicator)
		) {
			throw new TypeError(
				"fnc1 is 'gs1' or { applicationIndicator } with 00 to 99 or a letter plus 100",
			);
		}
	}

	let usable = range;
	if (fnc1 !== undefined) {
		usable = usable.filter((v) => entry.profile(v).fnc1);
		if (usable.length === 0) throw unsupportedFeature('fnc1');
	}
	if (needs.structuredAppend) {
		usable = usable.filter((v) => entry.profile(v).structuredAppend);
		if (usable.length === 0) throw unsupportedFeature('structured-append');
	}

	// Smallest first by the preference. For square symbols the three orders
	// agree; rMQR is where they differ. The sort is stable, so equal keys keep
	// the symbology's own order.
	const key = (v: string): readonly number[] => {
		const { width, height } = entry.size(v);
		return preference === 'height'
			? [height, width]
			: preference === 'width'
				? [width, height]
				: [width * height];
	};
	const ordered = [...usable].sort((a, b) => {
		const ka = key(a);
		const kb = key(b);
		for (let i = 0; i < ka.length; i += 1) {
			if (ka[i] !== kb[i]) return (ka[i] as number) - (kb[i] as number);
		}
		return 0;
	});
	return Object.freeze({
		entry,
		ecLevel,
		versions: Object.freeze(ordered),
		largest: usable[usable.length - 1] as string,
		policy,
		fnc1,
		mask,
		boostEc: options.boostEc === true,
	});
}

/** True for the one segmentation failure that means "not at this version" rather than "never". */
export function cannotCarry(error: unknown): error is QrStudioError {
	return (
		error instanceof QrStudioError &&
		error.code === 'encode/unsupported-content' &&
		error.params.reason === 'mode'
	);
}

/**
 * Segments for the input under one profile, cached per profile and kanji
 * choice: QR has three profiles for forty versions, so most of the work is
 * shared. A version whose modes cannot carry the content gets the error
 * instead of segments.
 */
export function segmenter(
	input: string | Uint8Array,
	plan: Plan,
): (profile: BitstreamProfile, kanji: 'never' | 'always') => Segment[] | QrStudioError {
	const cache = new Map<BitstreamProfile, Map<string, Segment[] | QrStudioError>>();
	const fnc1 = plan.fnc1 !== undefined;
	return (profile, kanji) => {
		let byKanji = cache.get(profile);
		if (byKanji === undefined) {
			byKanji = new Map();
			cache.set(profile, byKanji);
		}
		let found = byKanji.get(kanji);
		if (found === undefined) {
			try {
				found =
					typeof input === 'string'
						? segmentText(input, profile, { kanji, eci: plan.policy.eci }, { fnc1 })
						: segmentBytes(input, profile, { fnc1 });
			} catch (error) {
				if (!cannotCarry(error)) throw error;
				found = error;
			}
			byKanji.set(kanji, found);
		}
		return found;
	};
}

/** The strongest level at or above the plan's that still holds `bits` at this version, when boosting. */
export function boostedLevel(plan: Plan, version: string, bits: number): EcLevel {
	if (!plan.boostEc) return plan.ecLevel;
	const levels = plan.entry.ecLevels(version);
	let level = plan.ecLevel;
	for (let i = levels.indexOf(level) + 1; i < levels.length; i += 1) {
		const stronger = levels[i] as EcLevel;
		if (bits > plan.entry.blocks(version, stronger).dataBits) break;
		level = stronger;
	}
	return level;
}

/** Pad, add check codewords, place, mask: the symbol for settled segments. */
export function buildSymbol(
	plan: Plan,
	version: string,
	segments: readonly Segment[],
	header: SegmentHeader,
): BuiltSymbol {
	const profile = plan.entry.profile(version);
	const bits = headerBitLength(header, profile) + segmentsBitLength(segments, profile);
	const level = boostedLevel(plan, version, bits);
	const data = dataCodewords(segments, header, profile, plan.entry.blocks(version, level));
	return plan.entry.build(data, version, level, plan.mask);
}

export function inputKind(input: unknown): asserts input is string | Uint8Array {
	if (typeof input !== 'string' && !(input instanceof Uint8Array)) {
		throw new TypeError('encode takes a string or a Uint8Array');
	}
}
