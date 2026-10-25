/**
 * Deciding which pixels are dark.
 *
 * The hardest and least glamorous part of reading a code from a photograph. A
 * screenshot is trivial; a phone photograph of a laptop screen has a
 * brightness gradient across it, a highlight somewhere and a colour cast, and
 * one global threshold shreds it.
 *
 * Three strategies, lifted from the authenticator package's reader
 * (google-auth-secret-retriever, `src/qr/decode/binarise.ts`), tried in order
 * by the lenient ladder rather than chosen cleverly. The strict profile uses
 * the first alone, which is the one phone readers use.
 *
 * Each keeps its thresholds as well as its decisions. A sampled module is
 * soft: how far its grey sits from the local threshold, as well as which side,
 * and the threshold that made the decision is the one it is measured against.
 */

import type { GreyImage } from './grey.js';

export type BinariserId = 'hybrid' | 'hybrid-mean' | 'otsu' | 'sauvola';

export interface Binarised {
	readonly width: number;
	readonly height: number;
	/** One byte per pixel, row major: 1 dark, 0 light. */
	readonly bits: Uint8Array;
	/** The threshold at a pixel: a grey at or below it is dark. */
	threshold(x: number, y: number): number;
}

const BLOCK = 8;
/** Below this range a block is judged flat and takes its threshold from its neighbours. */
const MIN_DYNAMIC_RANGE = 24;

/**
 * Otsu's method: the global split that minimises the variance within the two
 * groups it makes.
 *
 * Excellent on screenshots, which have two clean peaks, and useless under a
 * gradient, which is why it is not the first rung.
 */
export function otsuThreshold(image: GreyImage): number {
	const histogram = new Uint32Array(256);
	for (let i = 0; i < image.data.length; i += 1) histogram[image.data[i] as number] += 1;
	const total = image.data.length;
	let sum = 0;
	for (let i = 0; i < 256; i += 1) sum += i * (histogram[i] as number);

	let sumBackground = 0;
	let weightBackground = 0;
	let best = 0;
	let bestVariance = -1;
	for (let t = 0; t < 256; t += 1) {
		weightBackground += histogram[t] as number;
		if (weightBackground === 0) continue;
		const weightForeground = total - weightBackground;
		if (weightForeground === 0) break;
		sumBackground += t * (histogram[t] as number);
		const difference = sumBackground / weightBackground - (sum - sumBackground) / weightForeground;
		const variance = weightBackground * weightForeground * difference * difference;
		if (variance > bestVariance) {
			bestVariance = variance;
			best = t;
		}
	}
	return best;
}

export function binariseOtsu(image: GreyImage): Binarised {
	const threshold = otsuThreshold(image);
	const bits = new Uint8Array(image.data.length);
	for (let i = 0; i < bits.length; i += 1) bits[i] = (image.data[i] as number) <= threshold ? 1 : 0;
	return { width: image.width, height: image.height, bits, threshold: () => threshold };
}

/**
 * Local thresholds on an 8 by 8 grid, smoothed across neighbouring blocks.
 *
 * The workhorse, and the reason photographs read at all. Two details do the
 * work. A block whose range is tiny is judged flat, and takes the average of
 * its already-computed neighbours rather than inventing a threshold in the
 * middle of a uniform area, which would shred a plain quiet zone into noise.
 * And each block's threshold is averaged over its 3 by 3 neighbourhood, so the
 * block boundaries do not print themselves onto the result.
 */
export function binariseHybrid(image: GreyImage): Binarised {
	const { width, height, data } = image;
	// Too small for local statistics to mean anything.
	if (width < BLOCK * 3 || height < BLOCK * 3) return binariseOtsu(image);
	const blocksX = Math.ceil(width / BLOCK);
	const blocksY = Math.ceil(height / BLOCK);
	const raw = new Float64Array(blocksX * blocksY);

	for (let by = 0; by < blocksY; by += 1) {
		for (let bx = 0; bx < blocksX; bx += 1) {
			const x0 = bx * BLOCK;
			const y0 = by * BLOCK;
			const x1 = Math.min(x0 + BLOCK, width);
			const y1 = Math.min(y0 + BLOCK, height);
			let min = 255;
			let max = 0;
			for (let y = y0; y < y1; y += 1) {
				for (let x = x0; x < x1; x += 1) {
					const value = data[y * width + x] as number;
					if (value < min) min = value;
					if (value > max) max = value;
				}
			}
			let threshold: number;
			if (max - min > MIN_DYNAMIC_RANGE) {
				threshold = (min + max) >> 1;
			} else if (bx === 0 && by === 0) {
				// Nothing computed yet to borrow from. Biased dark so a uniformly light
				// corner does not come out solid black.
				threshold = min >> 1;
			} else {
				// Flat: inherit from the neighbours already computed, which is what
				// stops a plain quiet zone becoming noise. The first row and column
				// have one neighbour each; everything else has three, the diagonal one
				// counted twice, as the authenticator has it.
				const left = bx > 0 ? (raw[by * blocksX + bx - 1] as number) : 0;
				const above = by > 0 ? (raw[(by - 1) * blocksX + bx] as number) : 0;
				const aboveLeft = bx > 0 && by > 0 ? (raw[(by - 1) * blocksX + bx - 1] as number) : 0;
				const divisor = (bx > 0 ? 1 : 0) + (by > 0 ? 1 : 0) + (bx > 0 && by > 0 ? 2 : 0);
				threshold = Math.round((left + above + 2 * aboveLeft) / divisor);
			}
			raw[by * blocksX + bx] = threshold;
		}
	}

	const smoothed = new Float64Array(blocksX * blocksY);
	for (let by = 0; by < blocksY; by += 1) {
		for (let bx = 0; bx < blocksX; bx += 1) {
			let total = 0;
			let count = 0;
			for (let ny = Math.max(0, by - 1); ny <= Math.min(blocksY - 1, by + 1); ny += 1) {
				for (let nx = Math.max(0, bx - 1); nx <= Math.min(blocksX - 1, bx + 1); nx += 1) {
					total += raw[ny * blocksX + nx] as number;
					count += 1;
				}
			}
			smoothed[by * blocksX + bx] = total / count;
		}
	}

	const bits = new Uint8Array(width * height);
	for (let y = 0; y < height; y += 1) {
		const blockRow = (y >> 3) * blocksX;
		for (let x = 0; x < width; x += 1) {
			bits[y * width + x] =
				(data[y * width + x] as number) <= (smoothed[blockRow + (x >> 3)] as number) ? 1 : 0;
		}
	}
	return {
		width,
		height,
		bits,
		threshold: (x, y) => smoothed[(y >> 3) * blocksX + (x >> 3)] as number,
	};
}

/** Below this many pixels on a side, zxing's hybrid binariser hands over to a global one, and so does this. */
const MEAN_MINIMUM_DIMENSION = 40;

/**
 * The hybrid binariser the common readers use: zxing's HybridBinarizer, which
 * jsQR ports line for line.
 *
 * The same 8 by 8 grid as `binariseHybrid`, with three differences that
 * matter. A block's threshold is the mean of its pixels rather than the middle
 * of its range, which on a low-contrast or unevenly lit block lands somewhere
 * else entirely. A flat block assumes it is light ground (half its minimum)
 * and takes its neighbours' threshold only when its own pixels sit below it.
 * And the smoothing is over 5 by 5 blocks, clamped so the window stays inside
 * the grid at the edges.
 *
 * The strict profile thresholds this way because it is how the phone readers
 * it has to be at least as hard as see the picture: a module that lands on
 * the wrong side of their threshold is an error for them whatever a better
 * threshold would have made of it.
 */
export function binariseHybridMean(image: GreyImage): Binarised {
	const { width, height, data } = image;
	const blocksX = Math.ceil(width / BLOCK);
	const blocksY = Math.ceil(height / BLOCK);
	if (
		width < MEAN_MINIMUM_DIMENSION ||
		height < MEAN_MINIMUM_DIMENSION ||
		blocksX < 5 ||
		blocksY < 5
	) {
		return binariseOtsu(image);
	}
	const blackPoints = new Float64Array(blocksX * blocksY);
	for (let by = 0; by < blocksY; by += 1) {
		for (let bx = 0; bx < blocksX; bx += 1) {
			let sum = 0;
			let min = 255;
			let max = 0;
			let count = 0;
			for (let y = by * BLOCK; y < Math.min(height, by * BLOCK + BLOCK); y += 1) {
				for (let x = bx * BLOCK; x < Math.min(width, bx * BLOCK + BLOCK); x += 1) {
					const value = data[y * width + x] as number;
					sum += value;
					count += 1;
					if (value < min) min = value;
					if (value > max) max = value;
				}
			}
			let average = sum / count;
			if (max - min <= MIN_DYNAMIC_RANGE) {
				average = min / 2;
				if (by > 0 && bx > 0) {
					const neighbours =
						((blackPoints[(by - 1) * blocksX + bx] as number) +
							2 * (blackPoints[by * blocksX + bx - 1] as number) +
							(blackPoints[(by - 1) * blocksX + bx - 1] as number)) /
						4;
					if (min < neighbours) average = neighbours;
				}
			}
			blackPoints[by * blocksX + bx] = average;
		}
	}
	const thresholds = new Float64Array(blocksX * blocksY);
	for (let by = 0; by < blocksY; by += 1) {
		const top = Math.min(Math.max(by, 2), blocksY - 3);
		for (let bx = 0; bx < blocksX; bx += 1) {
			const left = Math.min(Math.max(bx, 2), blocksX - 3);
			let sum = 0;
			for (let dy = -2; dy <= 2; dy += 1) {
				for (let dx = -2; dx <= 2; dx += 1)
					sum += blackPoints[(top + dy) * blocksX + left + dx] as number;
			}
			thresholds[by * blocksX + bx] = sum / 25;
		}
	}
	const bits = new Uint8Array(width * height);
	for (let y = 0; y < height; y += 1) {
		const row = (y >> 3) * blocksX;
		for (let x = 0; x < width; x += 1) {
			bits[y * width + x] =
				(data[y * width + x] as number) <= (thresholds[row + (x >> 3)] as number) ? 1 : 0;
		}
	}
	return {
		width,
		height,
		bits,
		threshold: (x, y) => thresholds[(y >> 3) * blocksX + (x >> 3)] as number,
	};
}

/**
 * Sauvola: a windowed mean adjusted by the local standard deviation.
 *
 * Slow, and the right answer for glare. A highlight wrecks the local mean but
 * leaves the local variance alone, so a rule that leans on the variance keeps
 * reading modules where a mean-based one gives up. Integral images make the
 * window size free.
 */
export function binariseSauvola(image: GreyImage, window = 31, k = 0.2): Binarised {
	const { width, height, data } = image;
	const radius = window >> 1;
	const stride = width + 1;
	// Integral images of the values and their squares, with a row and column of
	// padding so the window arithmetic needs no bounds checks.
	const sums = new Float64Array(stride * (height + 1));
	const squares = new Float64Array(stride * (height + 1));
	for (let y = 0; y < height; y += 1) {
		let rowSum = 0;
		let rowSquare = 0;
		for (let x = 0; x < width; x += 1) {
			const value = data[y * width + x] as number;
			rowSum += value;
			rowSquare += value * value;
			sums[(y + 1) * stride + x + 1] = (sums[y * stride + x + 1] as number) + rowSum;
			squares[(y + 1) * stride + x + 1] = (squares[y * stride + x + 1] as number) + rowSquare;
		}
	}
	const area = (table: Float64Array, x0: number, y0: number, x1: number, y1: number): number =>
		(table[y1 * stride + x1] as number) -
		(table[y0 * stride + x1] as number) -
		(table[y1 * stride + x0] as number) +
		(table[y0 * stride + x0] as number);

	const threshold = (x: number, y: number): number => {
		const x0 = Math.max(0, x - radius);
		const y0 = Math.max(0, y - radius);
		const x1 = Math.min(width, x + radius + 1);
		const y1 = Math.min(height, y + radius + 1);
		const count = (x1 - x0) * (y1 - y0);
		const mean = area(sums, x0, y0, x1, y1) / count;
		const variance = Math.max(0, area(squares, x0, y0, x1, y1) / count - mean * mean);
		// R = 128, the usual choice for 8-bit input.
		return mean * (1 + k * (Math.sqrt(variance) / 128 - 1));
	};

	const bits = new Uint8Array(width * height);
	for (let y = 0; y < height; y += 1) {
		for (let x = 0; x < width; x += 1) {
			bits[y * width + x] = (data[y * width + x] as number) <= threshold(x, y) ? 1 : 0;
		}
	}
	return { width, height, bits, threshold };
}

export function binarise(image: GreyImage, which: BinariserId): Binarised {
	switch (which) {
		case 'hybrid':
			return binariseHybrid(image);
		case 'hybrid-mean':
			return binariseHybridMean(image);
		case 'otsu':
			return binariseOtsu(image);
		case 'sauvola':
			return binariseSauvola(image);
	}
}
