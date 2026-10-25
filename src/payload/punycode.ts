/**
 * Punycode decoding (RFC 3492), to show a person the host they are about to
 * visit in the letters it will be displayed in.
 *
 * `new URL()` already turns a Unicode host into its ASCII form, which is what
 * a browser connects to, but nobody reads `xn--pple-43d.com` as anything. The
 * Unicode form is what a lookalike attack relies on, so it is what the
 * mixed-script check looks at.
 */

const BASE = 36;
const T_MIN = 1;
const T_MAX = 26;
const SKEW = 38;
const DAMP = 700;
const INITIAL_BIAS = 72;
const INITIAL_N = 128;

function adapt(delta: number, points: number, first: boolean): number {
	let scaled = first ? Math.floor(delta / DAMP) : delta >> 1;
	scaled += Math.floor(scaled / points);
	let k = 0;
	while (scaled > ((BASE - T_MIN) * T_MAX) >> 1) {
		scaled = Math.floor(scaled / (BASE - T_MIN));
		k += BASE;
	}
	return Math.floor(k + ((BASE - T_MIN + 1) * scaled) / (scaled + SKEW));
}

function digitOf(code: number): number {
	if (code >= 0x30 && code <= 0x39) return code - 22; // '0' to '9' are 26 to 35
	if (code >= 0x41 && code <= 0x5a) return code - 0x41;
	if (code >= 0x61 && code <= 0x7a) return code - 0x61;
	return BASE;
}

/** Decode one label's punycode (without its `xn--`). Undefined when it is not valid punycode. */
export function punycodeDecode(input: string): string | undefined {
	const output: number[] = [];
	const delimiter = input.lastIndexOf('-');
	for (let j = 0; j < Math.max(delimiter, 0); j += 1) {
		const code = input.charCodeAt(j);
		if (code >= 0x80) return undefined;
		output.push(code);
	}
	let n = INITIAL_N;
	let i = 0;
	let bias = INITIAL_BIAS;
	let index = delimiter > 0 ? delimiter + 1 : 0;
	while (index < input.length) {
		const oldI = i;
		let w = 1;
		for (let k = BASE; ; k += BASE) {
			if (index >= input.length) return undefined;
			const digit = digitOf(input.charCodeAt(index));
			index += 1;
			if (digit >= BASE) return undefined;
			i += digit * w;
			const t = k <= bias ? T_MIN : k >= bias + T_MAX ? T_MAX : k - bias;
			if (digit < t) break;
			w *= BASE - t;
		}
		// RFC 3492's reference decoder checks for 32-bit overflow at three
		// places here. In doubles nothing wraps: a value that would have
		// overflowed only grows, and n grows with it, so the range check below
		// refuses everything the overflow checks would have. It is written as
		// "not within range" so that it also refuses NaN, which a few hundred
		// digits reach: w becomes Infinity, and a zero digit times Infinity is
		// NaN.
		const points = output.length + 1;
		bias = adapt(i - oldI, points, oldI === 0);
		n += Math.floor(i / points);
		i %= points;
		if (!(n <= 0x10ffff) || (n >= 0xd800 && n <= 0xdfff)) return undefined;
		output.splice(i, 0, n);
		i += 1;
	}
	return String.fromCodePoint(...output);
}

/**
 * A host with each `xn--` label decoded. A label that does not decode is
 * left as written, because the ASCII form is still the honest answer to
 * "where does this go".
 */
export function hostToUnicode(host: string): string {
	return host
		.split('.')
		.map((label) => {
			if (!/^xn--/i.test(label)) return label;
			return punycodeDecode(label.slice(4)) ?? label;
		})
		.join('.');
}
