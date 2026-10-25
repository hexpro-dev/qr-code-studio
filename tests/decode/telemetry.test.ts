/**
 * What the reader reports as it goes, for a scanner view that draws it: the
 * stages in order, a transform a consumer can rebuild the grid from, the
 * modules it sampled, and never the content.
 */

import { describe, expect, it } from 'vitest';
import type { RgbaImage } from '../../src/core/image.js';
import { decodeImage } from '../../src/decode/decoder.js';
import type { DecodeFrame, DecodeOptions } from '../../src/decode/types.js';
import { encode } from '../../src/encode/encode.js';
import { pad } from '../helpers/damage.js';
import { blankImage, drawGrid } from '../helpers/draw.js';

const TEXT = 'https://example.com/telemetry?visit=1';
const built = encode(TEXT, { ecLevel: 'M' });

function frames(image: RgbaImage, options: DecodeOptions = {}): DecodeFrame[] {
	const out: DecodeFrame[] = [];
	decodeImage(image, { ...options, onTelemetry: (frame) => out.push(frame) });
	return out;
}

function find<S extends DecodeFrame['stage']>(
	list: readonly DecodeFrame[],
	stage: S,
): Extract<DecodeFrame, { stage: S }> {
	const frame = list.find((candidate) => candidate.stage === stage);
	if (frame === undefined) throw new Error(`no ${stage} frame`);
	return frame as Extract<DecodeFrame, { stage: S }>;
}

describe('decode telemetry', () => {
	it('reports the stages in order for a successful read', () => {
		const stages = frames(drawGrid(built.matrix, { scale: 6 })).map((frame) => frame.stage);
		expect(stages).toEqual([
			'source',
			'binarised',
			'finders',
			'located',
			'sampled',
			'corrected',
			// The look again after the find, with it masked out.
			'finders',
			'decoded',
		]);
	});

	it('reports three finders, a grid a consumer can rebuild, and the modules it sampled', () => {
		const list = frames(drawGrid(built.matrix, { scale: 6 }));
		expect(find(list, 'finders').patterns).toHaveLength(3);
		const located = find(list, 'located');
		expect(located.width).toBe(built.matrix.width);
		const [a11, a21, a31, a12, a22, a32, a13, a23, a33] = located.transform as number[];
		const at = (x: number, y: number) => {
			const d = a13! * x + a23! * y + a33!;
			return { x: (a11! * x + a21! * y + a31!) / d, y: (a12! * x + a22! * y + a32!) / d };
		};
		const origin = at(0, 0);
		const far = at(located.width, located.height);
		expect(origin.x).toBeCloseTo(located.corners[0].x, 6);
		expect(origin.y).toBeCloseTo(located.corners[0].y, 6);
		expect(far.x).toBeCloseTo(located.corners[2].x, 6);
		const sampled = find(list, 'sampled');
		expect(Array.from(sampled.modules)).toEqual(Array.from(built.matrix.data));
		expect(sampled.uncertain.every((flag) => flag === 0)).toBe(true);
		const corrected = find(list, 'corrected');
		expect(corrected.version).toBe(built.version);
		expect(corrected.errorsPerBlock.every((errors) => errors === 0)).toBe(true);
		const decoded = find(list, 'decoded');
		expect(decoded).toEqual({ stage: 'decoded', symbols: 1, attempts: 1, ms: null });
	});

	it('puts no content in any frame', () => {
		const list = frames(drawGrid(built.matrix, { scale: 6 }));
		const serialised = JSON.stringify(list, (_, value) =>
			value instanceof Uint8Array ? Array.from(value) : value,
		);
		expect(serialised).not.toContain('example.com');
		expect(serialised).not.toContain('telemetry?visit');
	});

	it('reports where a failed read stopped, after every rung', () => {
		const list = frames(blankImage(120, 120), { clock: () => 5 });
		const failed = find(list, 'failed');
		expect(failed).toEqual({
			stage: 'failed',
			code: 'decode/not-found',
			reached: 'finders',
			attempts: 9,
			ms: 0,
		});
	});

	it('reports a symbol whose grid never landed as not found, at geometry', () => {
		const broken = built.matrix.clone();
		for (let i = 8; i < broken.width - 8; i += 1) {
			broken.set(i, 6, true);
			broken.set(6, i, true);
		}
		const failed = find(frames(drawGrid(broken, { scale: 6 }), { profile: 'strict-v1' }), 'failed');
		expect(failed.code).toBe('decode/not-found');
		expect(failed.reached).toBe('geometry');
	});

	it('reports the stage a found but unreadable symbol reached', () => {
		// Wipe both copies of the format information.
		const damaged = built.matrix.clone();
		for (let i = 0; i < 9; i += 1) {
			if (i !== 6) {
				damaged.set(i, 8, false);
				damaged.set(8, i, false);
			}
		}
		for (let i = 0; i < 8; i += 1) {
			damaged.set(damaged.width - 1 - i, 8, true);
			damaged.set(8, damaged.height - 1 - i, true);
		}
		const failed = find(frames(drawGrid(damaged, { scale: 6 })), 'failed');
		expect(failed.code).toBe('decode/unreadable');
		expect(failed.reached).toBe('format');
	});

	it('decimates the thresholded picture past a megapixel, by a whole stride', () => {
		const image = pad(drawGrid(built.matrix, { scale: 20 }), 300);
		const list = frames(image);
		const source = find(list, 'source');
		expect(source.width * source.height).toBeGreaterThan(1_000_000);
		const binarised = find(list, 'binarised');
		expect(binarised.width * binarised.height).toBeLessThanOrEqual(1_000_000);
		expect(binarised.bits.length).toBe(binarised.width * binarised.height);
		expect(binarised.rung).toEqual({
			binariser: 'hybrid',
			scale: 'one',
			inverted: false,
			majorityVote: false,
		});
	});
});
