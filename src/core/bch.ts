/**
 * The small BCH codes that protect format and version information.
 *
 * These are not the Reed-Solomon code that protects the data. They are tiny
 * and strong for their size, because a reader that cannot read the format
 * does not know the mask or the error correction level and cannot begin on the
 * data. QR's format information is BCH(15, 5) with generator 0x537, its
 * version information BCH(18, 6) with generator 0x1f25; Micro QR and rMQR use
 * the same two generators with different masks.
 *
 * Decoding is a nearest-codeword search over a table the symbology builds with
 * `bchEncode`, not syndrome algebra. There are 32 format codewords and 34
 * version codewords, so comparing against every one is simpler than the
 * algebra and is what the established readers do. The XOR masks are the
 * symbology's business and are not applied here.
 */

function degree(generator: number): number {
	return 31 - Math.clz32(generator);
}

/**
 * The codeword for `data`: the data bits followed by the remainder of
 * data * x^checkBits divided by `generator`, where checkBits is the
 * generator's degree.
 */
export function bchEncode(data: number, dataBits: number, generator: number): number {
	if (!Number.isInteger(generator) || generator < 2 || generator > 0x7fffffff) {
		throw new RangeError('a BCH generator is a polynomial of degree 1 or more, below 2^31');
	}
	const checkBits = degree(generator);
	if (!Number.isInteger(dataBits) || dataBits < 1 || dataBits + checkBits > 31) {
		throw new RangeError(
			`with ${checkBits} check bits, a codeword has 1 to ${31 - checkBits} data bits`,
		);
	}
	if (!Number.isInteger(data) || data < 0 || data >= 1 << dataBits) {
		throw new RangeError(`the data does not fit in ${dataBits} bits`);
	}
	const total = dataBits + checkBits;
	let remainder = data << checkBits;
	for (let bit = total - 1; bit >= checkBits; bit -= 1) {
		if ((remainder >>> bit) & 1) remainder ^= generator << (bit - checkBits);
	}
	return (data << checkBits) | remainder;
}

function popcount(value: number): number {
	let rest = value >>> 0;
	let count = 0;
	while (rest !== 0) {
		rest = (rest & (rest - 1)) >>> 0;
		count += 1;
	}
	return count;
}

function checkWord(value: number, what: string): void {
	if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
		throw new RangeError(`${what} is an unsigned 32 bit integer`);
	}
}

/**
 * The codeword in `table` nearest `received` by Hamming distance, if within
 * `maxDistance`.
 *
 * A tie at the nearest distance returns undefined rather than the first entry.
 * Within a code's correction radius a tie cannot happen; outside it, picking
 * one of two equally distant codewords is a guess, and a wrong guess at the
 * format turns the whole data region into noise that might still decode.
 */
export function bchNearest(
	received: number,
	table: readonly number[],
	maxDistance: number,
): { index: number; distance: number } | undefined {
	checkWord(received, 'a received word');
	if (!Number.isInteger(maxDistance) || maxDistance < 0) {
		throw new RangeError('a distance is a whole number of bits');
	}
	let best = -1;
	let bestDistance = Infinity;
	let tied = false;
	for (let i = 0; i < table.length; i += 1) {
		const candidate = table[i] as number;
		checkWord(candidate, 'a table entry');
		const distance = popcount(received ^ candidate);
		if (distance < bestDistance) {
			best = i;
			bestDistance = distance;
			tied = false;
		} else if (distance === bestDistance) {
			tied = true;
		}
	}
	if (best < 0 || tied || bestDistance > maxDistance) return undefined;
	return { index: best, distance: bestDistance };
}
