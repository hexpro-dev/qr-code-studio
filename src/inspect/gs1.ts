/**
 * GS1 element strings: what a code that starts with FNC1 in the first
 * position holds.
 *
 * Such a code is a run of application identifiers, each followed by its
 * value: (01) a GTIN, (17) an expiry date, (10) a batch. Some identifiers
 * have a fixed length and need no separator; the rest run to a group
 * separator (GS, 0x1D, which the reader gives for FNC1 in the middle) or to
 * the end. The subset here is the identifiers seen on trade items, logistic
 * labels and coupons, from the GS1 General Specifications (release 24,
 * section 3.2), with the lengths from its figure 3.2-1. An identifier not in
 * it is still split out, by the rule for how long identifiers starting with
 * those digits are (figure 3.2-2), and read to the next separator.
 *
 * Nothing is validated beyond the shape: a check digit or a date that does
 * not exist is the content type's business, and an inspector shows what is
 * there.
 */

import type { Gs1Element } from './types.js';

const GS = '\u001d';

interface AiSpec {
	/** Digits in the identifier itself. */
	readonly length: 2 | 3 | 4;
	/** Characters in the value when fixed; undefined when variable. */
	readonly fixed?: number;
	/** The most characters in a variable value. */
	readonly max?: number;
}

/** The identifiers this reads by name, with their value lengths. */
export const GS1_AIS: Readonly<Record<string, AiSpec>> = Object.freeze({
	'00': { length: 2, fixed: 18 },
	'01': { length: 2, fixed: 14 },
	'02': { length: 2, fixed: 14 },
	'10': { length: 2, max: 20 },
	'11': { length: 2, fixed: 6 },
	'12': { length: 2, fixed: 6 },
	'13': { length: 2, fixed: 6 },
	'15': { length: 2, fixed: 6 },
	'16': { length: 2, fixed: 6 },
	'17': { length: 2, fixed: 6 },
	'20': { length: 2, fixed: 2 },
	'21': { length: 2, max: 20 },
	'22': { length: 2, max: 20 },
	'240': { length: 3, max: 30 },
	'241': { length: 3, max: 30 },
	'250': { length: 3, max: 30 },
	'251': { length: 3, max: 30 },
	'253': { length: 3, max: 30 },
	'254': { length: 3, max: 20 },
	'30': { length: 2, max: 8 },
	'37': { length: 2, max: 8 },
	'400': { length: 3, max: 30 },
	'401': { length: 3, max: 30 },
	'402': { length: 3, fixed: 17 },
	'403': { length: 3, max: 30 },
	'410': { length: 3, fixed: 13 },
	'411': { length: 3, fixed: 13 },
	'412': { length: 3, fixed: 13 },
	'413': { length: 3, fixed: 13 },
	'414': { length: 3, fixed: 13 },
	'415': { length: 3, fixed: 13 },
	'416': { length: 3, fixed: 13 },
	'420': { length: 3, max: 20 },
	'421': { length: 3, max: 12 },
	'422': { length: 3, fixed: 3 },
	'7003': { length: 4, fixed: 10 },
	'8003': { length: 4, max: 30 },
	'8004': { length: 4, max: 30 },
	'8020': { length: 4, max: 25 },
	'90': { length: 2, max: 30 },
});

/** Measures with the decimal point in the fourth digit: 310n net weight in kilograms, and the rest of 31 to 36. */
function measure(ai: string): AiSpec | undefined {
	return /^3[1-6]\d\d$/.test(ai) ? { length: 4, fixed: 6 } : undefined;
}

/** Amounts: 390n and 391n payable, 392n and 393n price, a decimal point in the fourth digit. */
function amount(ai: string): AiSpec | undefined {
	return /^39[0-3]\d$/.test(ai) ? { length: 4, max: 18 } : undefined;
}

/** Figure 3.2-2: how many digits an identifier starting with these two has. */
function lengthFor(prefix: string): 2 | 3 | 4 {
	const n = Number(prefix);
	if (n <= 22 || n === 30 || n === 37 || n >= 90) return 2;
	if ((n >= 23 && n <= 25) || (n >= 40 && n <= 42)) return 3;
	return 4;
}

/** The identifier at the start of `rest` and how its value is delimited. */
function specAt(rest: string): { readonly ai: string; readonly spec: AiSpec } | null {
	for (const length of [2, 3, 4] as const) {
		const ai = rest.slice(0, length);
		const spec = GS1_AIS[ai] ?? (length === 4 ? (measure(ai) ?? amount(ai)) : undefined);
		if (spec !== undefined && spec.length === length) return { ai, spec };
	}
	if (!/^\d\d/.test(rest)) return null;
	const length = lengthFor(rest.slice(0, 2));
	const ai = rest.slice(0, length);
	if (!/^\d+$/.test(ai) || ai.length < length) return null;
	// Internal company codes 91 to 99 run to 90 characters.
	return { ai, spec: { length, max: Number(ai.slice(0, 2)) >= 91 ? 90 : 70 } };
}

/**
 * The element strings of `text`, in order. Reading stops at the first
 * place the text stops being element strings (a value too short for its
 * fixed length, an identifier that is not digits), and what came before is
 * kept: an inspector shows as much as it can.
 */
export function parseGs1(text: string): Gs1Element[] {
	const out: Gs1Element[] = [];
	let at = text.startsWith(GS) ? 1 : 0;
	while (at < text.length) {
		const found = specAt(text.slice(at));
		if (found === null) break;
		const start = at + found.ai.length;
		let end: number;
		if (found.spec.fixed !== undefined) {
			end = start + found.spec.fixed;
			if (end > text.length || text.slice(start, end).includes(GS)) break;
		} else {
			const separator = text.indexOf(GS, start);
			end = separator < 0 ? text.length : separator;
			if (end - start > (found.spec.max as number)) break;
		}
		out.push({ ai: found.ai, value: text.slice(start, end) });
		at = end;
		if (text[at] === GS) at += 1;
	}
	return out;
}
