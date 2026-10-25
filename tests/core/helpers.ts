/**
 * Small things the core tests share.
 *
 * `seeded` is mulberry32, written out here rather than taken from
 * `src/core/prng.ts` so that the tests of every other module do not depend on
 * the generator they would otherwise be trusting to find their bugs. A failure
 * is reproducible from the seed in the test's name.
 */

export interface Seeded {
	/** [0, 1) */
	readonly next: () => number;
	/** An integer in [0, n). Slightly biased for large n, which no test here cares about. */
	readonly int: (n: number) => number;
	readonly bytes: (length: number) => Uint8Array;
}

export function seeded(seed: number): Seeded {
	let state = seed >>> 0;
	const next = (): number => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
	const int = (n: number): number => Math.floor(next() * n);
	const bytes = (length: number): Uint8Array => {
		const out = new Uint8Array(length);
		for (let i = 0; i < length; i += 1) out[i] = int(256);
		return out;
	};
	return { next, int, bytes };
}

/** `count` distinct positions in [0, n), in random order. */
export function distinctPositions(random: Seeded, n: number, count: number): number[] {
	const all = Array.from({ length: n }, (_, i) => i);
	for (let i = 0; i < count; i += 1) {
		const j = i + random.int(n - i);
		const swap = all[i] as number;
		all[i] = all[j] as number;
		all[j] = swap;
	}
	return all.slice(0, count);
}
