/**
 * Splitting content into the segments that need the fewest bits.
 *
 * Every mode has a header (mode indicator plus character count) and a rate:
 * numeric packs three digits into 10 bits, alphanumeric two characters into
 * 11, byte mode spends 8 bits a byte and kanji 13 bits a character. Switching
 * mode pays a header, so "ABC123456789" is cheaper as one alphanumeric
 * segment and one numeric than as either alone, while "A1B2" is cheapest as a
 * single alphanumeric segment. Heuristics get the common cases right and miss
 * by a version now and then; a missed version is a code a size larger than it
 * needed to be, printed on everything.
 *
 * So this is exact, by dynamic programming over (position, mode of the open
 * segment). Costs are kept in sixths of a bit, because 10/3 and 11/2 are
 * whole numbers of sixths: a numeric run of n digits costs ceil(10n / 3) bits
 * and an alphanumeric run ceil(11n / 2), which is the fractional cost rounded
 * up once, when the segment closes. Two partial solutions in the same mode at
 * the same position differ only in that unrounded cost, and the smaller one
 * stays smaller after any continuation and any rounding, so keeping the
 * cheapest per mode is enough for optimality. Splitting a run into two
 * segments of the same mode is never cheaper than keeping it whole (the
 * second header costs more than rounding can save), so the transitions are
 * only "continue" and "switch", with one exception under FNC1, described at
 * `AFTER_GS`. `tests/segment/segment-text.test.ts` checks
 * the result against a brute-force search over every string of up to eight
 * characters from a mode-spanning alphabet, in every count group.
 *
 * The one thing the optimum does not model is the character count limit: a
 * segment longer than its count field can record (255 bytes in versions 1 to
 * 9) is split into pieces that fit, which costs a header each. In QR that
 * only happens to content too long for any version of that group, so it
 * never changes which version is chosen.
 */

import { QrStudioError } from '../core/errors.js';
import { GS, PERCENT, alphanumericValue } from './alphanumeric.js';
import { ECI_UTF8, eciDesignatorBits } from './eci.js';
import { kanjiAvailable, kanjiCode } from './kanji.js';
import type { BitstreamProfile, Mode, Segment, SegmentationPolicy } from './types.js';
import { segmentsBitLength } from './write.js';

/** The default policy: kanji only when it helps, and no ECI (see `resolveEci`). */
export const DEFAULT_SEGMENTATION: SegmentationPolicy = Object.freeze({
	kanji: 'when-smaller',
	eci: 'auto',
});

export interface SegmentOptions {
	/**
	 * FNC1 is in force (GS1 or an application indicator). In alphanumeric mode
	 * `%` then stands for GS and a literal `%` is written `%%` (ISO/IEC 18004
	 * 7.4.8), which changes what both cost there.
	 */
	readonly fnc1?: boolean;
}

const MODE_ORDER: readonly Mode[] = ['numeric', 'alphanumeric', 'byte', 'kanji'];
const NUMERIC = 0;
const ALNUM = 1;
const BYTE = 2;
const KANJI = 3;

/**
 * The content as atoms: units that are never split, with what each costs in
 * each mode. An atom is one code point of text (so a UTF-8 sequence or a
 * Shift_JIS pair is never cut in two) or one byte of binary input.
 */
interface Atoms {
	readonly count: number;
	/** The ASCII code, or -1 for anything outside ASCII. */
	readonly ascii: Int16Array;
	/** Bytes in byte mode. */
	readonly byteLength: Uint8Array;
	/** Offset of each atom's first byte in `bytes`; one extra entry at the end. */
	readonly byteStart: Int32Array;
	readonly bytes: Uint8Array;
	/** Shift_JIS code, or -1 where kanji mode cannot carry it. */
	readonly kanji: Int32Array;
	/** True when some atom is outside ASCII. */
	readonly wide: boolean;
	/** True when every atom outside ASCII has a kanji code. */
	readonly kanjiCovers: boolean;
}

function unsupportedContent(reason: 'lone-surrogate' | 'mode', position: number): QrStudioError {
	return new QrStudioError(
		'encode/unsupported-content',
		reason === 'mode'
			? 'This code size cannot hold some of these characters. Choose a larger kind of code.'
			: 'This text has a broken character in it and cannot be put into a code as it is.',
		{ reason, position },
	);
}

function utf8Length(codePoint: number): number {
	return codePoint < 0x80 ? 1 : codePoint < 0x800 ? 2 : codePoint < 0x10000 ? 3 : 4;
}

function textAtoms(text: string, maxAtoms = Infinity): Atoms {
	const codePoints: number[] = [];
	let end = text.length;
	for (let i = 0; i < text.length; i += 1) {
		if (codePoints.length >= maxAtoms) {
			end = i;
			break;
		}
		const unit = text.charCodeAt(i);
		if (unit >= 0xd800 && unit <= 0xdfff) {
			const low = unit <= 0xdbff ? text.charCodeAt(i + 1) : NaN;
			if (!(low >= 0xdc00 && low <= 0xdfff)) {
				throw unsupportedContent('lone-surrogate', codePoints.length);
			}
			codePoints.push(0x10000 + ((unit - 0xd800) << 10) + (low - 0xdc00));
			i += 1;
		} else {
			codePoints.push(unit);
		}
	}
	const count = codePoints.length;
	const ascii = new Int16Array(count);
	const byteLength = new Uint8Array(count);
	const byteStart = new Int32Array(count + 1);
	const kanji = new Int32Array(count).fill(-1);
	let wide = false;
	let kanjiCovers = true;
	for (let i = 0; i < count; i += 1) {
		const codePoint = codePoints[i] as number;
		const length = utf8Length(codePoint);
		ascii[i] = codePoint < 0x80 ? codePoint : -1;
		byteLength[i] = length;
		byteStart[i + 1] = (byteStart[i] as number) + length;
		if (codePoint >= 0x80) {
			wide = true;
			// The table is only consulted when there is something it could hold,
			// so ASCII content never builds it.
			const code = kanjiCode(codePoint);
			if (code === undefined) kanjiCovers = false;
			else kanji[i] = code;
		}
	}
	return {
		count,
		ascii,
		byteLength,
		byteStart,
		bytes: new TextEncoder().encode(end === text.length ? text : text.slice(0, end)),
		kanji,
		wide,
		kanjiCovers,
	};
}

function byteAtoms(input: Uint8Array, maxAtoms = Infinity): Atoms {
	const bytes = input.length > maxAtoms ? input.subarray(0, maxAtoms) : input;
	const count = bytes.length;
	const ascii = new Int16Array(count);
	const byteStart = new Int32Array(count + 1);
	for (let i = 0; i < count; i += 1) {
		const byte = bytes[i] as number;
		ascii[i] = byte < 0x80 ? byte : -1;
		byteStart[i + 1] = i + 1;
	}
	return {
		count,
		ascii,
		byteLength: new Uint8Array(count).fill(1),
		byteStart,
		bytes: Uint8Array.from(bytes),
		kanji: new Int32Array(count).fill(-1),
		// Binary input never goes near kanji mode, so it never counts as text
		// outside ASCII either.
		wide: false,
		kanjiCovers: false,
	};
}

/** Alphanumeric characters an atom takes: 0 when it cannot go there, 2 for a literal `%` under FNC1. */
function alphanumericChars(code: number, fnc1: boolean): number {
	if (fnc1 && code === GS) return 1;
	if (code < 0 || alphanumericValue(code) < 0) return 0;
	return fnc1 && code === PERCENT ? 2 : 1;
}

/**
 * The programme's states: the mode of the open segment, with alphanumeric
 * split in two. Under FNC1 a GS is written `%` and a literal `%` is written
 * `%%`, and a reader pairs `%` characters left to right within a segment
 * (ISO/IEC 18004 7.4.8.1, and how zxing and BWIPP read it). So a GS followed
 * in the same segment by another GS or by a `%` would come back as a literal
 * `%`: "%%" is ambiguous. `AFTER_GS` is an alphanumeric segment whose last
 * character was a GS; from it, GS and `%` can only go on in a new segment.
 * Without FNC1 the state is never entered.
 */
const AFTER_GS = 4;
const STATES = 5;
const MODE_OF_STATE = [NUMERIC, ALNUM, BYTE, KANJI, ALNUM] as const;

/** `from` entries: the previous state, plus SWITCHED when a new segment starts at this atom. */
const SWITCHED = 8;
const START = -1;

interface Programme {
	/** Per atom and state: how the best solution reached it (see SWITCHED and START). */
	readonly from: Int8Array;
	/** Cost in sixths of a bit of the best solution ending in each state, its open segment unrounded. */
	readonly cost: readonly number[];
	/** Atoms processed: all of them, or the longest prefix within the limit. */
	readonly count: number;
}

/** Bits the cheapest solution so far takes: its open segment rounded up to a whole bit. */
function bestBits(cost: readonly number[]): number {
	return Math.min(...cost.map((sixths) => Math.ceil(sixths / 6)));
}

/**
 * The dynamic programme described at the top of this file. `allowKanji`
 * forces every atom outside ASCII into kanji mode: the caller has already
 * checked they all have a code, and byte mode is then closed to them because
 * kanji and non-ASCII bytes are never mixed. With `limitBits`, it stops at
 * the first atom that takes the cheapest solution past the limit; the optimum
 * never gets cheaper as atoms are added, so everything before that fits.
 */
function programme(
	atoms: Atoms,
	profile: BitstreamProfile,
	fnc1: boolean,
	allowKanji: boolean,
	limitBits = Infinity,
): Programme {
	const n = atoms.count;
	const allowed = MODE_ORDER.map((mode) => profile.modes.includes(mode));
	allowed[KANJI] = allowed[KANJI] === true && allowKanji;
	const head = MODE_ORDER.map((mode, m) =>
		allowed[m] ? (profile.modeIndicatorBits + profile.charCountBits(mode)) * 6 : 0,
	);
	const from = new Int8Array(n * STATES);
	let cost = new Array<number>(STATES).fill(Infinity);
	for (let i = 0; i < n; i += 1) {
		const code = atoms.ascii[i] as number;
		const steps = [Infinity, Infinity, Infinity, Infinity];
		if (allowed[NUMERIC] && code >= 0x30 && code <= 0x39) steps[NUMERIC] = 20;
		const alnum = allowed[ALNUM] ? alphanumericChars(code, fnc1) : 0;
		if (alnum > 0) steps[ALNUM] = 33 * alnum;
		if (allowed[BYTE] && !(allowKanji && code < 0)) {
			steps[BYTE] = 48 * (atoms.byteLength[i] as number);
		}
		if (allowed[KANJI] && (atoms.kanji[i] as number) >= 0) steps[KANJI] = 78;
		if (steps.every((step) => step === Infinity)) throw unsupportedContent('mode', i);
		const isGs = fnc1 && code === GS;
		// Neither may follow a GS inside one alphanumeric segment.
		const pairsWithGs = fnc1 && (code === GS || code === PERCENT);

		const next = new Array<number>(STATES).fill(Infinity);
		for (let mode = 0; mode < 4; mode += 1) {
			const step = steps[mode] as number;
			if (step === Infinity) continue;
			const state = mode === ALNUM && isGs ? AFTER_GS : mode;
			let best = Infinity;
			let source = START;
			if (i === 0) {
				best = (head[mode] as number) + step;
			} else {
				// Continuing wins ties, then the lowest-numbered state to come from,
				// so the result is the same on every run and in every engine.
				for (let k = 0; k < STATES; k += 1) {
					if (MODE_OF_STATE[k] !== mode || (k === AFTER_GS && pairsWithGs)) continue;
					const continued = (cost[k] as number) + step;
					if (continued < best) {
						best = continued;
						source = k;
					}
				}
				for (let k = 0; k < STATES; k += 1) {
					const before = cost[k] as number;
					// A new segment of the same mode only ever helps after a GS.
					if (before === Infinity || (MODE_OF_STATE[k] === mode && k !== AFTER_GS)) continue;
					const switched = Math.ceil(before / 6) * 6 + (head[mode] as number) + step;
					if (switched < best) {
						best = switched;
						source = k + SWITCHED;
					}
				}
			}
			next[state] = best;
			from[i * STATES + state] = source;
		}
		if (bestBits(next) > limitBits) return { from, cost, count: i };
		cost = next;
	}
	return { from, cost, count: n };
}

interface Plan {
	/** The mode of every atom. */
	readonly modes: Uint8Array;
	/** 1 where a new segment starts. */
	readonly starts: Uint8Array;
}

/** The optimal mode for every atom, and where each segment starts. */
function optimalModes(
	atoms: Atoms,
	profile: BitstreamProfile,
	fnc1: boolean,
	allowKanji: boolean,
): Plan {
	const { from, cost, count } = programme(atoms, profile, fnc1, allowKanji);
	const modes = new Uint8Array(count);
	const starts = new Uint8Array(count);
	if (count === 0) return { modes, starts };
	let state = 0;
	for (let k = 1; k < STATES; k += 1) {
		if (Math.ceil((cost[k] as number) / 6) < Math.ceil((cost[state] as number) / 6)) state = k;
	}
	for (let i = count - 1; i >= 0; i -= 1) {
		modes[i] = MODE_OF_STATE[state] as number;
		const source = from[i * STATES + state] as number;
		if (source === START || source >= SWITCHED) starts[i] = 1;
		if (source !== START) state = source % SWITCHED;
	}
	return { modes, starts };
}

/** Turn the plan into segments, splitting any run its count field cannot record. */
function toSegments(
	atoms: Atoms,
	{ modes, starts }: Plan,
	profile: BitstreamProfile,
	fnc1: boolean,
	eci: number | undefined,
): Segment[] {
	const segments: Segment[] = [];
	const push = (mode: number, data: number[] | Uint8Array, chars: number): void => {
		const segment: Segment = {
			mode: MODE_ORDER[mode] as Mode,
			chars,
			data: Uint8Array.from(data),
			...(eci === undefined ? {} : { eci }),
		};
		segments.push(Object.freeze(segment));
	};
	let start = 0;
	while (start < atoms.count) {
		const mode = modes[start] as number;
		const limit = (1 << profile.charCountBits(MODE_ORDER[mode] as Mode)) - 1;
		let data: number[] = [];
		let chars = 0;
		let end = start;
		for (; end < atoms.count && (end === start || starts[end] === 0); end += 1) {
			const code = atoms.ascii[end] as number;
			const cost =
				mode === BYTE
					? (atoms.byteLength[end] as number)
					: mode === ALNUM
						? alphanumericChars(code, fnc1)
						: 1;
			// Cutting a long run cannot leave a GS before a % in one piece: the
			// cut only ever separates characters.
			if (chars > 0 && chars + cost > limit) {
				push(mode, data, chars);
				data = [];
				chars = 0;
			}
			chars += cost;
			if (mode === BYTE) {
				const last = atoms.byteStart[end + 1] as number;
				for (let b = atoms.byteStart[end] as number; b < last; b += 1) {
					data.push(atoms.bytes[b] as number);
				}
			} else if (mode === KANJI) {
				const sjis = atoms.kanji[end] as number;
				data.push(sjis >>> 8, sjis & 0xff);
			} else if (fnc1 && code === GS) {
				data.push(PERCENT);
			} else if (fnc1 && code === PERCENT && mode === ALNUM) {
				data.push(PERCENT, PERCENT);
			} else {
				data.push(code);
			}
		}
		push(mode, data, chars);
		start = end;
	}
	return segments;
}

/**
 * The ECI designator a policy writes, or undefined for none.
 *
 * 'auto' writes none, and that is a decision rather than a gap. Almost every
 * reader in use treats a byte segment with no ECI as UTF-8, because that is
 * what almost every encoder writes, and some readers mishandle an ECI header
 * outright: older ones refuse the symbol, others print the designator as
 * text. So UTF-8 without an ECI is the form that reads correctly in the most
 * places, and an ECI is only worth its 12 bits when a caller has a reader in
 * mind that needs it, which is what 'utf-8' is for: it writes ECI 26 into
 * every symbol, whatever the content. 'never' refuses it even then.
 */
function resolveEci(policy: SegmentationPolicy, profile: BitstreamProfile): number | undefined {
	if (policy.eci !== 'utf-8') return undefined;
	if (!profile.eci) {
		throw new QrStudioError(
			'encode/unsupported-feature',
			'This kind of code cannot say which character set it uses. Choose a QR code, or turn that option off.',
			{ feature: 'eci' },
		);
	}
	return ECI_UTF8;
}

function checkPolicy(policy: SegmentationPolicy): void {
	if (!['never', 'when-smaller', 'always'].includes(policy.kanji)) {
		throw new TypeError("the kanji policy is 'never', 'when-smaller' or 'always'");
	}
	if (!['auto', 'never', 'utf-8'].includes(policy.eci)) {
		throw new TypeError("the ECI policy is 'auto', 'never' or 'utf-8'");
	}
}

/**
 * Split text into the segments that need the fewest bits. Exact, by dynamic
 * programming.
 *
 * Kanji follows the policy. 'never' leaves it out. 'always' uses it whenever
 * every character outside ASCII has a kanji code (`kanjiCode`), and then for
 * all of them; if any does not, or the runtime cannot decode Shift_JIS, the
 * text goes into byte mode as UTF-8, because kanji and non-ASCII bytes are
 * never mixed in one symbol: a reader that guesses the character set of a
 * byte segment from the rest of the symbol guesses Shift_JIS there. At this
 * level 'when-smaller' takes whichever of the two needs fewer bits, preferring
 * no kanji on a tie; `encode` narrows it further, to "only when it saves a
 * version", by comparing the versions the two need.
 *
 * Throws QrStudioError 'encode/unsupported-content' (params { reason,
 * position }) for a lone surrogate, or for a character no mode of this
 * profile can carry; 'encode/unsupported-feature' (params { feature: 'eci' })
 * when the ECI policy asks for one and the profile has none.
 */
export function segmentText(
	text: string,
	profile: BitstreamProfile,
	policy: SegmentationPolicy = DEFAULT_SEGMENTATION,
	options: SegmentOptions = {},
): Segment[] {
	if (typeof text !== 'string') throw new TypeError('segmentText takes a string');
	checkPolicy(policy);
	const fnc1 = options.fnc1 === true;
	const eci = resolveEci(policy, profile);
	const atoms = textAtoms(text);
	const plain = toSegments(atoms, optimalModes(atoms, profile, fnc1, false), profile, fnc1, eci);
	const kanjiPossible =
		policy.kanji !== 'never' &&
		atoms.wide &&
		atoms.kanjiCovers &&
		profile.modes.includes('kanji') &&
		kanjiAvailable();
	if (!kanjiPossible) return plain;
	const kanji = toSegments(atoms, optimalModes(atoms, profile, fnc1, true), profile, fnc1, eci);
	if (policy.kanji === 'always') return kanji;
	return segmentsBitLength(kanji, profile) < segmentsBitLength(plain, profile) ? kanji : plain;
}

/**
 * Segments for binary content, by the same dynamic programme: a run of bytes
 * that happen to be digits or alphanumeric characters is cheaper in those
 * modes, and reads back as the same bytes. Never kanji, never an ECI.
 */
export function segmentBytes(
	bytes: Uint8Array,
	profile: BitstreamProfile,
	options: SegmentOptions = {},
): Segment[] {
	if (!(bytes instanceof Uint8Array)) throw new TypeError('segmentBytes takes a Uint8Array');
	const fnc1 = options.fnc1 === true;
	const atoms = byteAtoms(bytes);
	return toSegments(atoms, optimalModes(atoms, profile, fnc1, false), profile, fnc1, undefined);
}

export interface PrefixOptions extends SegmentOptions {
	/** Kanji mode for every character outside ASCII; the caller has checked they all have a code. */
	readonly kanji?: boolean;
	/** An ECI designator written once in front, whose bits count against the limit. */
	readonly eci?: number;
}

/**
 * How many atoms (code points of text, bytes of binary) the longest prefix
 * has whose optimal segments fit in `limitBits`, ECI designator included.
 *
 * This is what splitting content over several symbols needs: one pass of the
 * same programme `segmentText` runs, stopped where the prefix outgrows a
 * symbol, rather than a fresh segmentation for every candidate split. It
 * agrees with `segmentsBitLength(segmentText(prefix))` wherever no segment
 * outruns its count field, which in QR is everywhere a prefix fits a symbol.
 */
export function fittingPrefix(
	input: string | Uint8Array,
	profile: BitstreamProfile,
	options: PrefixOptions,
	limitBits: number,
): number {
	const eciBits =
		options.eci === undefined ? 0 : profile.modeIndicatorBits + eciDesignatorBits(options.eci);
	const limit = limitBits - eciBits;
	if (limit < 0) return 0;
	// Every atom costs more than 10/3 bits, so no prefix within the limit is
	// longer than this; building atoms past it would be wasted work.
	const reach = Math.floor((limit * 3) / 10) + 1;
	const atoms = typeof input === 'string' ? textAtoms(input, reach) : byteAtoms(input, reach);
	return programme(atoms, profile, options.fnc1 === true, options.kanji === true, limit).count;
}
