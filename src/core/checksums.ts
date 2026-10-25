/**
 * The two checksums the containers need: CRC-32 for PNG chunks and ZIP
 * entries, Adler-32 for the zlib wrapper inside PNG.
 *
 * Check digits for content (EMVCo CRC-16, IBAN MOD 97-10, the Swiss QR
 * reference, GS1, Luhn) belong to the content types that use them, in
 * payload/check-digits.ts.
 *
 * Lifted from the image converter's PNG writer, with the table built on first
 * use instead of at import.
 */

let crcTable: Uint32Array | undefined;

/** The reflected CRC-32 table for polynomial 0xedb88320 (ISO 3309, as PNG and ZIP use it). */
function table(): Uint32Array {
	if (crcTable !== undefined) return crcTable;
	const built = new Uint32Array(256);
	for (let n = 0; n < 256; n += 1) {
		let c = n;
		for (let k = 0; k < 8; k += 1) {
			c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		}
		built[n] = c >>> 0;
	}
	crcTable = built;
	return built;
}

/**
 * CRC-32 of `bytes`.
 *
 * `seed` is the CRC of whatever came before, so a value can be built up in
 * pieces: crc32(b, crc32(a)) equals crc32 of a followed by b. A PNG chunk's
 * CRC covers its type and its data, which live in different arrays.
 */
export function crc32(bytes: Uint8Array, seed = 0): number {
	if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
		throw new RangeError('a CRC-32 seed is an unsigned 32 bit integer');
	}
	const t = table();
	let c = (seed ^ 0xffffffff) >>> 0;
	for (let i = 0; i < bytes.length; i += 1) {
		c = (t[(c ^ (bytes[i] as number)) & 0xff] as number) ^ (c >>> 8);
	}
	return (c ^ 0xffffffff) >>> 0;
}

/** Adler-32 of `bytes`, as RFC 1950 defines it for the zlib wrapper. */
export function adler32(bytes: Uint8Array): number {
	let a = 1;
	let b = 0;
	// 5552 is the longest run that cannot overflow the sums before reducing
	// them (and they are doubles here, so the bound is generous), which keeps
	// the modulo to once per run rather than once per byte.
	for (let i = 0; i < bytes.length;) {
		const end = Math.min(i + 5552, bytes.length);
		for (; i < end; i += 1) {
			a += bytes[i] as number;
			b += a;
		}
		a %= 65521;
		b %= 65521;
	}
	return (b * 65536 + a) >>> 0;
}
