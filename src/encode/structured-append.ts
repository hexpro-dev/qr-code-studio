/**
 * One message over up to sixteen symbols (ISO/IEC 18004 8).
 *
 * Each symbol carries a structured append header: its position, the count,
 * and a parity byte, the XOR of every byte of the whole message as encoded,
 * which is how a reader tells two sets apart. The split is chosen in three
 * steps, each a minimum:
 *
 *   1. the fewest symbols the largest allowed version needs;
 *   2. the smallest version at which that many still suffice, so every
 *      symbol in the set is the same size, and as small as it can be;
 *   3. the smallest per-symbol budget at which that many still suffice, so
 *      the parts come out balanced rather than full, full, full, and a scrap.
 *
 * Parts are cut between code points, never inside one, so no symbol holds
 * half a UTF-8 sequence or half a Shift_JIS pair, and each part's text is
 * whole on its own. Whether the message uses kanji is decided once for all of
 * it, because kanji changes the bytes the parity is taken over: either every
 * symbol carries its kanji-eligible characters as kanji, or none does.
 *
 * Content that fits one symbol comes back as one ordinary symbol with no
 * header. A one-of-one set says nothing a plain code does not, and plain
 * codes are what every reader handles.
 */

import { TooMuchDataError } from '../core/errors.js';
import type { Registry } from '../core/registry.js';
import { ECI_UTF8 } from '../segment/eci.js';
import { kanjiCode } from '../segment/kanji.js';
import { fittingPrefix, segmentBytes, segmentText } from '../segment/segment-text.js';
import type { SegmentHeader } from '../segment/types.js';
import { headerBitLength, segmentsBitLength } from '../segment/write.js';
import type { BuiltSymbol, SymbologyEntry } from '../symbology/types.js';
import { encode } from './encode.js';
import type { EncodeOptions } from './plan.js';
import { buildSymbol, inputKind, resolvePlan } from './plan.js';

const MAX_SYMBOLS = 16;

/** The message as atoms (code points or bytes), with their code unit offsets for slicing. */
interface Message {
	readonly count: number;
	slice(start: number, end: number): string | Uint8Array;
	/** The bytes the parity is taken over. */
	bytes(kanji: boolean): readonly number[];
}

function message(input: string | Uint8Array): Message {
	if (typeof input !== 'string') {
		return {
			count: input.length,
			slice: (start, end) => input.subarray(start, end),
			bytes: () => Array.from(input),
		};
	}
	const offsets: number[] = [];
	const codePoints: number[] = [];
	for (let i = 0; i < input.length;) {
		const codePoint = input.codePointAt(i) as number;
		offsets.push(i);
		codePoints.push(codePoint);
		i += codePoint > 0xffff ? 2 : 1;
	}
	offsets.push(input.length);
	return {
		count: codePoints.length,
		slice: (start, end) => input.slice(offsets[start], offsets[end]),
		bytes: (kanji) => {
			if (!kanji) return Array.from(new TextEncoder().encode(input));
			// Under kanji every character outside ASCII has a code, or the whole
			// message would not have been segmented with kanji.
			const out: number[] = [];
			for (const codePoint of codePoints) {
				if (codePoint < 0x80) {
					out.push(codePoint);
				} else {
					const code = kanjiCode(codePoint) as number;
					out.push(code >>> 8, code & 0xff);
				}
			}
			return out;
		},
	};
}

/**
 * Up to 16 symbols with a shared parity byte. Throws TooMuchDataError past
 * `maxSymbols` (default and most 16).
 */
export function encodeStructuredAppend(
	input: string | Uint8Array,
	options: EncodeOptions & { maxSymbols?: number } = {},
	symbologies?: Registry<SymbologyEntry>,
): BuiltSymbol[] {
	inputKind(input);
	const maxSymbols = options.maxSymbols ?? MAX_SYMBOLS;
	if (!Number.isInteger(maxSymbols) || maxSymbols < 1 || maxSymbols > MAX_SYMBOLS) {
		throw new TypeError('maxSymbols is 1 to 16');
	}
	const plan = resolvePlan(options, symbologies, { structuredAppend: true });
	const text = message(input);
	const fnc1 = plan.fnc1 !== undefined;
	const eci = typeof input === 'string' && plan.policy.eci === 'utf-8' ? ECI_UTF8 : undefined;
	const header = (index: number, total: number, parity: number): SegmentHeader => ({
		structuredAppend: { index, total, parity },
		...(plan.fnc1 === undefined ? {} : { fnc1: plan.fnc1 }),
	});

	// Decide kanji for the whole message, on the largest allowed version. This
	// also surfaces every content error (a lone surrogate, a character no mode
	// carries) once, before any splitting.
	const largestProfile = plan.entry.profile(plan.largest);
	const whole =
		typeof input === 'string'
			? segmentText(
					input,
					largestProfile,
					{ kanji: plan.policy.kanji, eci: plan.policy.eci },
					{ fnc1 },
				)
			: segmentBytes(input, largestProfile, { fnc1 });
	const kanji = whole.some((segment) => segment.mode === 'kanji');

	/** Greedy parts at a version and budget: as many atoms as fit, then the next part. */
	const split = (version: string, budget: number, limit: number): number[] | undefined => {
		const profile = plan.entry.profile(version);
		const parts: number[] = [];
		for (let start = 0; start < text.count;) {
			if (parts.length === limit) return undefined;
			const taken = fittingPrefix(
				text.slice(start, text.count),
				profile,
				{ kanji, fnc1, ...(eci === undefined ? {} : { eci }) },
				budget,
			);
			if (taken === 0) return undefined;
			parts.push(taken);
			start += taken;
		}
		return parts;
	};
	const room = (version: string): number =>
		plan.entry.blocks(version, plan.ecLevel).dataBits -
		headerBitLength(header(0, 1, 0), plan.entry.profile(version));

	const fewest = split(plan.largest, room(plan.largest), maxSymbols);
	if (fewest === undefined) {
		const bits = segmentsBitLength(whole, largestProfile);
		const perSymbol = headerBitLength(header(0, 1, 0), largestProfile);
		throw new TooMuchDataError(
			bits + maxSymbols * perSymbol,
			maxSymbols * plan.entry.blocks(plan.largest, plan.ecLevel).dataBits,
		);
	}
	if (fewest.length <= 1) return [encode(input, options, symbologies)];
	const total = fewest.length;

	const version = plan.versions.find((v) => split(v, room(v), total) !== undefined) as string;
	// The smallest budget at which `total` parts still suffice. Greedy needs
	// no more parts as the budget grows, so this is a binary search.
	let low = 1;
	let high = room(version);
	while (low < high) {
		const middle = Math.floor((low + high) / 2);
		if (split(version, middle, total) === undefined) low = middle + 1;
		else high = middle;
	}
	const parts = split(version, low, total) as number[];

	let parity = 0;
	for (const byte of text.bytes(kanji)) parity ^= byte;
	const profile = plan.entry.profile(version);
	const symbols: BuiltSymbol[] = [];
	let start = 0;
	parts.forEach((length, index) => {
		const part = text.slice(start, start + length);
		start += length;
		const segments =
			typeof part === 'string'
				? segmentText(
						part,
						profile,
						{ kanji: kanji ? 'always' : 'never', eci: plan.policy.eci },
						{ fnc1 },
					)
				: segmentBytes(part, profile, { fnc1 });
		symbols.push(buildSymbol(plan, version, segments, header(index, parts.length, parity)));
	});
	return symbols;
}
