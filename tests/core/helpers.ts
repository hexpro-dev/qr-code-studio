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

export interface RasterShape {
	/** Modules per side of the pretend symbol. */
	readonly modules: number;
	/** Pixels per module. */
	readonly scale: number;
	/** 1 for grey, 4 for RGBA. */
	readonly channels: 1 | 4;
	/** PNG filter type written at the start of every row: 0 (none) or 2 (up). */
	readonly filter: 0 | 2;
	readonly seed: number;
}

/**
 * Scanlines shaped like a PNG of a QR code: a four module quiet zone, square
 * modules of random dark and light, a filter byte at the start of every row.
 * Not a real symbol (nothing here reads it), just the statistics of one: long
 * runs, and rows that repeat the row above `scale - 1` times in every `scale`.
 */
export function qrLikeRaster(shape: RasterShape): Uint8Array {
	const random = seeded(shape.seed);
	const { modules, scale, channels, filter } = shape;
	const quiet = 4;
	const side = (modules + 2 * quiet) * scale;
	const grid = Array.from({ length: modules * modules }, () => random.next() < 0.5);
	const stride = 1 + side * channels;
	const out = new Uint8Array(stride * side);
	const pixel = (x: number, y: number): number => {
		const mx = Math.floor(x / scale) - quiet;
		const my = Math.floor(y / scale) - quiet;
		const dark = mx >= 0 && my >= 0 && mx < modules && my < modules && grid[my * modules + mx];
		return dark ? 0 : 255;
	};
	for (let y = 0; y < side; y += 1) {
		out[y * stride] = filter;
		for (let x = 0; x < side; x += 1) {
			for (let c = 0; c < channels; c += 1) {
				const value = c === 3 ? 255 : pixel(x, y);
				const above = y > 0 ? (c === 3 ? 255 : pixel(x, y - 1)) : 0;
				out[y * stride + 1 + x * channels + c] = filter === 2 ? (value - above) & 0xff : value;
			}
		}
	}
	return out;
}

/** Seeded English-ish text: a small vocabulary, punctuation and line breaks. */
export function textLike(length: number, seed: number): Uint8Array {
	const random = seeded(seed);
	const words = [
		'the',
		'quick',
		'brown',
		'fox',
		'jumps',
		'over',
		'a',
		'lazy',
		'dog',
		'Example',
		'Network',
		'contact',
		'card',
		'phone',
		'address',
		'street',
		'link',
		'code',
		'scan',
		'print',
	];
	let text = '';
	while (text.length < length) {
		text += words[random.int(words.length)];
		const roll = random.next();
		text += roll < 0.05 ? '.\n' : roll < 0.12 ? ', ' : ' ';
	}
	return new TextEncoder().encode(text.slice(0, length));
}
