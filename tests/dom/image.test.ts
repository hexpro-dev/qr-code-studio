/**
 * Pictures in: files, blobs, pastes and video frames, through injected
 * fakes. What is pinned is the browser behaviour each line exists for: the
 * stepped reduction, the refusals, the orientation fix, the canvases kept
 * while a video's size holds.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	imageFromBlob,
	imageFromClipboard,
	imageFromFile,
	imageFromVideo,
	platformCanvas,
	reductionSteps,
	targetSize,
	videoReader,
} from '../../src/dom/image.js';
import { blobOf, fakeCanvas, fakeDecoding, pattern } from './fakes.js';

afterEach(() => {
	vi.unstubAllGlobals();
});

/** A JPEG head saying `orientation`, stored at `width` by `height`. */
function jpegHead(orientation: number, width: number, height: number): Uint8Array {
	const tiff = [
		0x4d,
		0x4d,
		0,
		42,
		0,
		0,
		0,
		8,
		0,
		1,
		0x01,
		0x12,
		0,
		3,
		0,
		0,
		0,
		1,
		0,
		orientation,
		0,
		0,
		0,
		0,
		0,
		0,
	];
	const body = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
	return new Uint8Array([
		0xff,
		0xd8,
		0xff,
		0xe1,
		0,
		body.length + 2,
		...body,
		0xff,
		0xc0,
		0,
		17,
		8,
		height >> 8,
		height & 0xff,
		width >> 8,
		width & 0xff,
		3,
		...new Array(9).fill(0),
	]);
}

describe('imageFromBlob', () => {
	it('reads a picture through createImageBitmap and a canvas, asking for its orientation', async () => {
		const fake = fakeDecoding(40, 30);
		const result = await imageFromBlob(blobOf('png bytes', 'image/png'), { deps: fake.deps });
		expect(result.ok && [result.value.width, result.value.height]).toEqual([40, 30]);
		expect(fake.requested()).toEqual([{ imageOrientation: 'from-image' }]);
		expect(fake.closed()).toBe(1);
		expect(fake.log.made).toEqual([[40, 30]]);
	});

	it('reduces a large picture in steps of at most a half, to the pixel ceiling', async () => {
		const fake = fakeDecoding(4000, 3000);
		const result = await imageFromBlob(blobOf('x', 'image/jpeg'), {
			deps: fake.deps,
			maxPixels: 120_000,
		});
		expect(result.ok && [result.value.width, result.value.height]).toEqual([400, 300]);
		expect(fake.log.draws).toEqual([
			[2000, 1500],
			[1000, 750],
			[500, 375],
			[400, 300],
		]);
	});

	it('turns a photograph the browser left on its side', async () => {
		const fake = fakeDecoding(4, 2);
		const sideways = await imageFromBlob(blobOf(jpegHead(6, 4, 2), 'image/jpeg'), {
			deps: fake.deps,
		});
		expect(sideways.ok && [sideways.value.width, sideways.value.height]).toEqual([2, 4]);
		// One the browser turned already comes back the other way round, and is left alone.
		const turned = fakeDecoding(2, 4);
		const done = await imageFromBlob(blobOf(jpegHead(6, 4, 2), 'image/jpeg'), {
			deps: turned.deps,
		});
		expect(done.ok && [done.value.width, done.value.height]).toEqual([2, 4]);
		// A square cannot be told apart, and upright needs nothing.
		const square = await imageFromBlob(blobOf(jpegHead(6, 3, 3), 'image/jpeg'), {
			deps: fakeDecoding(3, 3).deps,
		});
		expect(square.ok && square.value.width).toBe(3);
		const upright = await imageFromBlob(blobOf(jpegHead(1, 4, 2), 'image/jpeg'), {
			deps: fakeDecoding(4, 2).deps,
		});
		expect(upright.ok && upright.value.width).toBe(4);
	});

	it('refuses SVG, a picture the browser cannot decode, an empty one, and no canvas', async () => {
		const svg = await imageFromBlob(blobOf('<svg/>', 'image/svg+xml'), {
			deps: fakeDecoding(1, 1).deps,
		});
		expect(!svg.ok && svg.error).toMatchObject({
			code: 'image/unreadable',
			params: { reason: 'svg' },
		});
		const heic = await imageFromBlob(blobOf('x', 'image/heic'), {
			deps: fakeDecoding(1, 1, { fail: true }).deps,
		});
		expect(!heic.ok && heic.error.params).toEqual({ reason: 'decode' });
		const empty = fakeDecoding(0, 0);
		const nothing = await imageFromBlob(blobOf('x', 'image/png'), { deps: empty.deps });
		expect(!nothing.ok && nothing.error.params).toEqual({ reason: 'empty' });
		expect(empty.closed()).toBe(1);
		const noContext = await imageFromBlob(blobOf('x', 'image/png'), {
			deps: fakeDecoding(2, 2, { noContext: true }).deps,
		});
		expect(!noContext.ok && noContext.error).toMatchObject({
			code: 'platform/unavailable',
			params: { feature: 'canvas' },
		});
		const noCanvas = await imageFromBlob(blobOf('x', 'image/png'), {
			deps: { ...fakeDecoding(2, 2).deps, createCanvas: () => null as never },
		});
		expect(!noCanvas.ok && noCanvas.error.code).toBe('platform/unavailable');
	});

	it('uses an image element where there is no createImageBitmap, and reads a blob it cannot slice', async () => {
		const canvas = fakeCanvas();
		const result = await imageFromBlob(
			{
				type: 'image/png',
				slice: () => {
					throw new Error('no slice');
				},
			} as unknown as Blob,
			{
				deps: {
					createCanvas: canvas.createCanvas,
					loadImageElement: async () => ({ width: 5, height: 6 }),
				},
			},
		);
		expect(result.ok && [result.value.width, result.value.height]).toEqual([5, 6]);
	});

	it('falls back to the platform createImageBitmap when the deps leave it out', async () => {
		const bitmap = vi.fn(async () => ({ width: 3, height: 2, close: () => undefined }));
		vi.stubGlobal('createImageBitmap', bitmap);
		const result = await imageFromFile(blobOf('x', 'image/png') as File, {
			deps: { createCanvas: fakeCanvas().createCanvas },
		});
		expect(result.ok && result.value.width).toBe(3);
		expect(bitmap).toHaveBeenCalledOnce();
	});
});

describe('the platform canvas', () => {
	it('is OffscreenCanvas where there is one, a canvas element where there is a document, and nothing otherwise', () => {
		expect(platformCanvas(2, 2)).toBeNull();
		const element = { width: 0, height: 0 };
		vi.stubGlobal('document', { createElement: () => element });
		expect(platformCanvas(3, 4)).toBe(element);
		expect(element).toEqual({ width: 3, height: 4 });
		class Offscreen {
			constructor(
				readonly width: number,
				readonly height: number,
			) {}
		}
		vi.stubGlobal('OffscreenCanvas', Offscreen);
		expect(platformCanvas(5, 6)).toBeInstanceOf(Offscreen);
	});
});

describe('sizes', () => {
	it('cap by area and never enlarge', () => {
		expect(targetSize(100, 100, 20_000)).toEqual([100, 100]);
		expect(targetSize(4000, 3000, 1_200_000)).toEqual([1264, 948]);
		expect(targetSize(100_000, 1, 10)).toEqual([1000, 1]);
	});

	it('reduce in halves, the last step the target', () => {
		expect(reductionSteps(100, 100, 100, 100)).toEqual([[100, 100]]);
		expect(reductionSteps(100, 100, 60, 60)).toEqual([[60, 60]]);
		expect(reductionSteps(800, 100, 100, 50)).toEqual([
			[400, 50],
			[200, 50],
			[100, 50],
		]);
	});
});

describe('imageFromClipboard', () => {
	const picture = blobOf('x', 'image/png');
	const deps = fakeDecoding(8, 8).deps;

	it('finds the picture in a paste, from its files or its items, and nothing in a paste of text', async () => {
		const fromFiles = await imageFromClipboard(
			{ clipboardData: { files: [blobOf('t', 'text/plain'), picture] } },
			{ deps },
		);
		expect(fromFiles.ok && fromFiles.value?.width).toBe(8);
		const fromItems = await imageFromClipboard(
			{
				clipboardData: {
					files: [],
					items: [
						{ kind: 'string', type: 'text/plain', getAsFile: () => null },
						{ kind: 'file', type: 'image/png', getAsFile: () => null },
						{ kind: 'file', type: 'image/png', getAsFile: () => picture },
					],
				},
			},
			{ deps },
		);
		expect(fromItems.ok && fromItems.value?.width).toBe(8);
		expect(await imageFromClipboard({ clipboardData: null })).toEqual({ ok: true, value: null });
		expect(await imageFromClipboard({ clipboardData: {} })).toEqual({ ok: true, value: null });
	});

	it('reads what navigator.clipboard.read() gives', async () => {
		const items = [
			{ types: ['text/plain'], getType: async () => blobOf('t', 'text/plain') },
			{ types: ['text/html', 'image/png'], getType: async () => picture },
		];
		const read = await imageFromClipboard(items, { deps });
		expect(read.ok && read.value?.width).toBe(8);
		expect(await imageFromClipboard([], { deps })).toEqual({ ok: true, value: null });
		const refused = await imageFromClipboard(
			[{ types: ['image/png'], getType: () => Promise.reject(new Error('NotAllowedError')) }],
			{ deps },
		);
		expect(!refused.ok && refused.error.params).toEqual({ reason: 'clipboard' });
	});
});

describe('video frames', () => {
	it('keeps its canvases while the frame size holds, and builds new ones when it changes', () => {
		const canvas = fakeCanvas();
		const read = videoReader({ createCanvas: canvas.createCanvas, maxPixels: 2_100_000 });
		const video = { videoWidth: 1920, videoHeight: 1080 };
		expect(read(video).ok).toBe(true);
		expect(read(video).ok).toBe(true);
		expect(canvas.log.made).toEqual([[1920, 1080]]);
		expect(canvas.log.contexts).toEqual([{ willReadFrequently: true }]);
		const fourK = { videoWidth: 3840, videoHeight: 2160 };
		const frame = read(fourK);
		expect(frame.ok && frame.value.width).toBeLessThanOrEqual(1932);
		expect(canvas.log.made.length).toBe(2);
	});

	it('says there is no frame yet before the video has a size, and no canvas where there is none', () => {
		expect(
			imageFromVideo(
				{ videoWidth: 0, videoHeight: 0 },
				{ createCanvas: fakeCanvas().createCanvas },
			),
		).toMatchObject({
			ok: false,
			error: { params: { reason: 'no-frame' } },
		});
		expect(imageFromVideo({ videoWidth: 4, videoHeight: 4 })).toMatchObject({
			ok: false,
			error: { code: 'platform/unavailable' },
		});
		expect(
			imageFromVideo(
				{ videoWidth: 4, videoHeight: 4 },
				{ createCanvas: fakeCanvas().createCanvas },
			),
		).toMatchObject({
			ok: true,
			value: pattern(4, 4),
		});
	});
});

describe('a paste with no picture in it', () => {
	it('is nothing, whether it has files, items or both', async () => {
		const text = blobOf('t', 'text/plain');
		expect(
			await imageFromClipboard({
				clipboardData: {
					files: [text],
					items: [{ kind: 'string', type: 'text/plain', getAsFile: () => null }],
				},
			}),
		).toEqual({ ok: true, value: null });
	});
});
