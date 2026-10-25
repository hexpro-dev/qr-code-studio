/**
 * Length-limited canonical Huffman codes, for the DEFLATE compressor.
 *
 * Internal to core: `deflate.ts` is the only caller, and the tests reach it
 * directly because a code that breaks the Kraft inequality is easier to catch
 * here than as a stream zlib refuses.
 *
 * Lengths come from package-merge, which is optimal under a length limit
 * (zlib's own construction is a heuristic that is usually but not always
 * optimal). Every choice that could go either way is fixed: leaves are
 * ordered by frequency and then by symbol, and a leaf sorts before a package
 * of equal weight. So the same frequencies give the same code in every
 * engine, which is the point of having this at all rather than the platform's
 * compressor.
 */

/**
 * Optimal code lengths no longer than `limit` bits.
 *
 * Symbols with a frequency of zero get length zero; a single used symbol gets
 * length one. `limit` must leave room for every used symbol (2^limit of them).
 */
export function codeLengths(frequencies: ArrayLike<number>, limit: number): Uint8Array {
	const size = frequencies.length;
	const lengths = new Uint8Array(size);
	const used: number[] = [];
	for (let symbol = 0; symbol < size; symbol += 1) {
		if ((frequencies[symbol] as number) > 0) used.push(symbol);
	}
	const n = used.length;
	if (!Number.isInteger(limit) || limit < 1 || limit > 30 || n > 1 << limit) {
		throw new RangeError(`${n} symbols do not fit in codes of at most ${limit} bits`);
	}
	if (n === 0) return lengths;
	if (n === 1) {
		lengths[used[0] as number] = 1;
		return lengths;
	}
	used.sort((a, b) => (frequencies[a] as number) - (frequencies[b] as number) || a - b);

	// Nodes 0..n-1 are the leaves in sorted order; later nodes are packages of
	// two items from the list before.
	const capacity = n + limit * n;
	const weight = new Float64Array(capacity);
	const left = new Int32Array(capacity).fill(-1);
	const right = new Int32Array(capacity);
	for (let i = 0; i < n; i += 1) weight[i] = frequencies[used[i] as number] as number;
	let nodes = n;

	// Only the 2n - 2 lightest items of any list can be chosen: every used
	// symbol's coin is chosen at the top level, so the top list's packages use
	// at most 2n - 4 items of the list below, and so on down.
	const keep = 2 * n - 2;
	let list = Array.from({ length: n }, (_, i) => i);
	for (let level = 1; level < limit; level += 1) {
		const merged: number[] = [];
		const pairs = list.length >>> 1;
		let leaf = 0;
		let pair = 0;
		let pending = -1;
		while (merged.length < keep && (leaf < n || pair < pairs)) {
			if (pending < 0 && pair < pairs) {
				const a = list[2 * pair] as number;
				const b = list[2 * pair + 1] as number;
				weight[nodes] = (weight[a] as number) + (weight[b] as number);
				left[nodes] = a;
				right[nodes] = b;
				pending = nodes;
				nodes += 1;
			}
			if (leaf < n && (pending < 0 || (weight[leaf] as number) <= (weight[pending] as number))) {
				merged.push(leaf);
				leaf += 1;
			} else {
				merged.push(pending);
				pending = -1;
				pair += 1;
			}
		}
		list = merged;
	}

	// Each appearance of a leaf among the chosen items, directly or inside a
	// package, is one bit of its code.
	const stack = list.slice(0, keep);
	while (stack.length > 0) {
		const node = stack.pop() as number;
		if ((left[node] as number) < 0) {
			const symbol = used[node] as number;
			lengths[symbol] = (lengths[symbol] as number) + 1;
		} else {
			stack.push(left[node] as number, right[node] as number);
		}
	}
	return lengths;
}

/** The low `length` bits of `code`, in the opposite order. */
export function reverseBits(code: number, length: number): number {
	let out = 0;
	for (let i = 0; i < length; i += 1) out = (out << 1) | ((code >>> i) & 1);
	return out;
}

/**
 * The canonical code for each symbol (RFC 1951 section 3.2.2), bit-reversed
 * because DEFLATE packs bits least significant first while Huffman codes are
 * sent most significant first. Lengths up to 15.
 */
export function canonicalCodes(lengths: Uint8Array): Uint16Array {
	const counts = new Uint16Array(16);
	for (const length of lengths) counts[length] = (counts[length] as number) + 1;
	counts[0] = 0;
	const next = new Uint16Array(16);
	let code = 0;
	for (let bits = 1; bits < 16; bits += 1) {
		code = (code + (counts[bits - 1] as number)) << 1;
		next[bits] = code;
	}
	const codes = new Uint16Array(lengths.length);
	for (let symbol = 0; symbol < lengths.length; symbol += 1) {
		const length = lengths[symbol] as number;
		if (length === 0) continue;
		codes[symbol] = reverseBits(next[length] as number, length);
		next[length] = (next[length] as number) + 1;
	}
	return codes;
}
