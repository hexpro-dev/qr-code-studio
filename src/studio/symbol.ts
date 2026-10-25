/**
 * From content and a design to a symbol, and what a view says about it.
 *
 * The code on screen never goes blank while somebody types. If the content as
 * it stands cannot be made (a field is wrong, or it is too long for any
 * symbol the design allows), the last content that worked is drawn instead
 * with the current design, marked stale, with the reason beside it. Only
 * before anything has ever worked is there nothing to show.
 *
 * The view's numbers (how full the symbol is, which modes its segments use)
 * are read back from the symbol itself, so they describe what was built
 * rather than what the encoder was asked for.
 */

import { QrStudioError } from '../core/errors.js';
import { hasErrors, issue } from '../core/issue.js';
import type { Issue } from '../core/issue.js';
import type { Registry } from '../core/registry.js';
import { encode } from '../encode/encode.js';
import type { EncodeOptions } from '../encode/plan.js';
import type { QrDesignV1 } from '../design/types.js';
import type { FieldValue, PayloadType } from '../payload/types.js';
import { DEFAULT_SEGMENTATION, segmentText } from '../segment/segment-text.js';
import type { Segment } from '../segment/types.js';
import { segmentsBitLength } from '../segment/write.js';
import type { BuiltSymbol, SymbologyEntry } from '../symbology/types.js';
import { STUDIO_KEYS, asStudioError, errorIssue } from './keys.js';
import type { SegmentSummary, SymbolView } from './types.js';

/** The text a type makes from its fields, or why it cannot make any. */
export type Content =
	| { readonly ok: true; readonly text: string; readonly issues: readonly Issue[] }
	| { readonly ok: false; readonly issues: readonly Issue[]; readonly reason: Issue };

function isBlank(value: FieldValue | undefined): boolean {
	return (
		value === undefined ||
		value === null ||
		value === '' ||
		value === false ||
		(Array.isArray(value) && value.every((item) => item === ''))
	);
}

export function contentOf(
	type: PayloadType,
	fields: Readonly<Record<string, FieldValue>>,
): Content {
	let issues: readonly Issue[];
	try {
		issues = type.validate(fields);
	} catch (thrown) {
		const reason = errorIssue(asStudioError(thrown, 'payload/invalid'), ['fields']);
		return { ok: false, issues: [reason], reason };
	}
	if (hasErrors(issues)) {
		const blank = type.fields.every((field) => isBlank(fields[field.key]));
		const count = issues.filter((found) => found.severity === 'error').length;
		const reason = blank
			? issue(STUDIO_KEYS.contentEmpty, ['fields'], 'info')
			: issue(STUDIO_KEYS.contentInvalid, ['fields'], 'error', { count });
		return { ok: false, issues, reason };
	}
	try {
		return { ok: true, text: type.build(fields).text, issues };
	} catch (thrown) {
		// `build` refuses a value with errors, which `validate` just said this
		// is not; a third party's type that disagrees with itself lands here.
		const reason = errorIssue(asStudioError(thrown, 'payload/invalid'), ['fields']);
		return { ok: false, issues: [...issues, reason], reason };
	}
}

/** What the encoder is asked for: the design's symbol settings. */
export function encodeOptions(design: QrDesignV1): EncodeOptions {
	const { symbology, ecLevel, boostEc, minVersion, maxVersion, mask, segmentation } = design.symbol;
	return {
		symbology,
		...(ecLevel === undefined ? {} : { ecLevel }),
		...(boostEc === undefined ? {} : { boostEc }),
		...(minVersion === undefined ? {} : { minVersion }),
		...(maxVersion === undefined ? {} : { maxVersion }),
		...(mask === undefined ? {} : { mask }),
		...(segmentation === undefined ? {} : { segmentation }),
	};
}

/** A key for the encode options, so the same content and settings are encoded once. */
export function optionsKey(design: QrDesignV1): string {
	return JSON.stringify(encodeOptions(design));
}

export type Encoded =
	| { readonly ok: true; readonly symbol: BuiltSymbol }
	| { readonly ok: false; readonly issue: Issue; readonly error: QrStudioError };

export function encodeContent(
	text: string,
	design: QrDesignV1,
	symbologies: Registry<SymbologyEntry>,
): Encoded {
	try {
		return { ok: true, symbol: encode(text, encodeOptions(design), symbologies) };
	} catch (thrown) {
		// The encoder throws TypeError for options it was given wrongly, which
		// for a validated design means a third party's symbology disagreeing
		// with the validator; still not something to throw at a person.
		const error = asStudioError(thrown, 'encode/unsupported-content');
		return { ok: false, issue: errorIssue(error, ['symbol']), error };
	}
}

/** Segments read back out of the symbol, so the summary is what was written. */
function readSegments(
	symbol: BuiltSymbol,
	entry: SymbologyEntry,
	text: string,
): readonly Segment[] {
	try {
		const read = entry.read(symbol.matrix, { strict: false });
		return read.bitstream.segments.map((segment) => ({
			mode: segment.mode,
			chars: segment.length,
			data: new Uint8Array(0),
			...(segment.eci === null ? {} : { eci: segment.eci }),
		}));
	} catch {
		// A segment this build can write but not read back (kanji, where the
		// engine has no Shift_JIS decoder). The encoder's own segmentation is
		// close enough for a summary.
		try {
			return segmentText(text, entry.profile(symbol.version), {
				...DEFAULT_SEGMENTATION,
				kanji: 'never',
			});
		} catch {
			return [];
		}
	}
}

/** The largest version the design allows, for "how close to the limit" in the view. */
function largestVersion(entry: SymbologyEntry, design: QrDesignV1): string {
	const versions = entry.versions;
	const max = design.symbol.maxVersion;
	if (max !== undefined && versions.includes(max)) return max;
	return versions[versions.length - 1] as string;
}

export function symbolView(
	symbol: BuiltSymbol,
	text: string,
	design: QrDesignV1,
	symbologies: Registry<SymbologyEntry>,
): SymbolView {
	const entry = symbologies.require(symbol.symbology);
	const segments = readSegments(symbol, entry, text);
	let usedBits = 0;
	try {
		usedBits =
			segments.length === 0 ? 0 : segmentsBitLength(segments, entry.profile(symbol.version));
	} catch {
		// A third party's symbology with no profile for its own version: the
		// code is still drawn, and its fullness is not known.
	}
	const totalBits = symbol.blocks.dataBits;
	const largest = largestVersion(entry, design);
	let largestBits = totalBits;
	try {
		largestBits = Math.max(totalBits, entry.blocks(largest, symbol.ecLevel).dataBits);
	} catch {
		// A level the largest version does not offer; this symbol is the yardstick.
	}
	const summary: SegmentSummary[] = segments.map((segment) =>
		Object.freeze({ mode: segment.mode, chars: segment.chars, eci: segment.eci ?? null }),
	);
	return Object.freeze({
		symbology: entry.id,
		symbologyLabelKey: entry.labelKey,
		phoneReadable: entry.phoneReadable,
		noteKey: entry.phoneReadable ? null : `symbology.${entry.id}.not-phone-readable`,
		version: symbol.version,
		ecLevel: symbol.ecLevel,
		mask: symbol.mask,
		modules: Object.freeze([symbol.matrix.width, symbol.matrix.height] as const),
		quietZone: design.quietZone,
		capacity: Object.freeze({
			usedBits,
			totalBits,
			// Every symbol that holds content has data bits, so neither divides by zero.
			fraction: usedBits / totalBits,
			ofLargest: usedBits / largestBits,
		}),
		segments: Object.freeze(summary),
	});
}
