/**
 * Getting pixels out of the browser: a file, a blob, a paste, a video frame.
 *
 * Lifted from google-auth-secret-retriever's src/dom/image-source.ts, with
 * two changes for this package: each entry point returns a Result rather
 * than throwing (reading a picture is attempt-shaped, and fails for ordinary
 * reasons such as an iPhone photo in a browser with no HEIC decoder), and a
 * JPEG whose Exif orientation the browser did not apply is turned here (see
 * orientation.ts).
 *
 * A large picture is reduced on the canvas, in steps of at most a half so
 * each step is an honest average whatever the engine's smoothing does, to at
 * most `maxPixels`. The reader reduces again by its own area averaging if it
 * needs to; this only keeps a 48 megapixel photograph from being copied out
 * of the canvas whole.
 */

import { QrStudioError } from '../core/errors.js';
import type { RgbaImage } from '../core/image.js';
import { err, ok } from '../core/result.js';
import type { Result } from '../core/result.js';
import { DEFAULT_MAX_PIXELS } from '../decode/decoder.js';
import { ORIENTATION_BYTES, applyOrientation, jpegFacts, swapsSides } from './orientation.js';
import type {
	CanvasContextLike,
	CanvasLike,
	ImageDecodeDeps,
	ImageLike,
	VideoFrameSource,
} from './types.js';

/**
 * A live camera frame's ceiling. A 1080p frame is 2.07 megapixels and passes
 * untouched; a 4K frame is reduced to about 1080p rather than to 720p, where
 * a dense code drops below two pixels a module.
 */
export const MAX_CAMERA_PIXELS = 2_100_000;

/** The most any one draw reduces by; at a half, a bilinear tap and a box average agree. */
const MAX_STEP = 2;

export interface ImageReadOptions {
	/** Reduce to at most this many pixels. Default: the reader's own ceiling, 2.5 megapixels. */
	readonly maxPixels?: number;
	readonly deps?: ImageDecodeDeps;
}

export function unreadable(reason: string): QrStudioError {
	return new QrStudioError(
		'image/unreadable',
		'This picture could not be opened. Try a PNG or JPEG, or take a screenshot of it.',
		{ reason },
	);
}

export function noCanvas(): QrStudioError {
	return new QrStudioError('platform/unavailable', 'This browser cannot read pictures here.', {
		feature: 'canvas',
	});
}

/** A canvas from the platform, or null where there is none. Read at call time, never at import. */
export function platformCanvas(width: number, height: number): CanvasLike | null {
	if (typeof OffscreenCanvas !== 'undefined') {
		return new OffscreenCanvas(width, height) as unknown as CanvasLike;
	}
	if (typeof document !== 'undefined') {
		const canvas = document.createElement('canvas');
		canvas.width = width;
		canvas.height = height;
		return canvas as unknown as CanvasLike;
	}
	return null;
}

/* v8 ignore start: an image element and an object URL need a browser; the fallback for engines without createImageBitmap. */
function loadViaElement(blob: Blob): Promise<ImageLike> {
	return new Promise((resolve, reject) => {
		const url = URL.createObjectURL(blob);
		const image = new Image();
		image.onload = () => {
			URL.revokeObjectURL(url);
			resolve(image);
		};
		image.onerror = () => {
			URL.revokeObjectURL(url);
			reject(unreadable('decode'));
		};
		image.src = url;
	});
}
/* v8 ignore stop */

/** The target size for a source, capped by area and never enlarged. */
export function targetSize(width: number, height: number, maxPixels: number): [number, number] {
	const pixels = width * height;
	if (pixels <= maxPixels) return [width, height];
	const scale = Math.sqrt(maxPixels / pixels);
	return [Math.max(1, Math.floor(width * scale)), Math.max(1, Math.floor(height * scale))];
}

/** The sizes a reduction passes through, none more than a half down; the last is the target. */
export function reductionSteps(
	sourceWidth: number,
	sourceHeight: number,
	width: number,
	height: number,
): (readonly [number, number])[] {
	const steps: (readonly [number, number])[] = [];
	let currentWidth = sourceWidth;
	let currentHeight = sourceHeight;
	for (;;) {
		const stepWidth = Math.max(width, Math.round(currentWidth / MAX_STEP));
		const stepHeight = Math.max(height, Math.round(currentHeight / MAX_STEP));
		if (stepWidth <= width && stepHeight <= height) {
			steps.push([width, height]);
			return steps;
		}
		steps.push([stepWidth, stepHeight]);
		currentWidth = stepWidth;
		currentHeight = stepHeight;
	}
}

function smoothed(canvas: CanvasLike, willReadFrequently: boolean): CanvasContextLike | null {
	const found = canvas.getContext(
		'2d',
		willReadFrequently ? { willReadFrequently: true } : undefined,
	);
	if (found === null) return null;
	found.imageSmoothingEnabled = true;
	found.imageSmoothingQuality = 'high';
	return found;
}

/** A chain of canvases from one source size to a target, kept while the sizes hold. */
interface Chain {
	readonly sourceWidth: number;
	readonly sourceHeight: number;
	readonly steps: readonly {
		readonly canvas: CanvasLike;
		readonly context: CanvasContextLike;
		readonly width: number;
		readonly height: number;
	}[];
}

function buildChain(
	sourceWidth: number,
	sourceHeight: number,
	maxPixels: number,
	create: (width: number, height: number) => CanvasLike | null,
	willReadFrequently: boolean,
): Chain | null {
	const [width, height] = targetSize(sourceWidth, sourceHeight, maxPixels);
	const steps: Chain['steps'][number][] = [];
	for (const [stepWidth, stepHeight] of reductionSteps(sourceWidth, sourceHeight, width, height)) {
		const canvas = create(stepWidth, stepHeight);
		if (canvas === null) return null;
		canvas.width = stepWidth;
		canvas.height = stepHeight;
		const context = smoothed(canvas, willReadFrequently);
		if (context === null) return null;
		steps.push({ canvas, context, width: stepWidth, height: stepHeight });
	}
	return { sourceWidth, sourceHeight, steps };
}

function drawThrough(chain: Chain, source: unknown): RgbaImage {
	let current = source;
	for (const step of chain.steps) {
		step.context.drawImage(current as never, 0, 0, step.width, step.height);
		current = step.canvas;
	}
	const last = chain.steps[chain.steps.length - 1] as Chain['steps'][number];
	return last.context.getImageData(0, 0, last.width, last.height);
}

/** The first bytes of a blob, where a JPEG keeps its orientation, or null where the blob cannot say. */
async function head(blob: Blob): Promise<Uint8Array | null> {
	try {
		return new Uint8Array(await blob.slice(0, ORIENTATION_BYTES).arrayBuffer());
	} catch {
		return null;
	}
}

export async function imageFromBlob(
	blob: Blob,
	options: ImageReadOptions = {},
): Promise<Result<RgbaImage>> {
	// SVG is refused rather than rasterised: it draws at whatever size the
	// browser likes, and it can carry script.
	if (blob.type === 'image/svg+xml') return err(unreadable('svg'));
	const deps = options.deps ?? {};
	const maxPixels = options.maxPixels ?? DEFAULT_MAX_PIXELS;
	const create = deps.createCanvas ?? platformCanvas;
	const bitmap =
		deps.createImageBitmap ??
		(typeof createImageBitmap === 'function'
			? (source: Blob, opts?: { readonly imageOrientation?: 'from-image' | 'none' | 'flipY' }) =>
					createImageBitmap(source, opts as ImageBitmapOptions) as Promise<ImageLike>
			: undefined);

	const bytes = await head(blob);
	const facts = bytes === null ? null : jpegFacts(bytes);

	let source: ImageLike;
	try {
		source = bitmap
			? await bitmap(blob, { imageOrientation: 'from-image' })
			: await (deps.loadImageElement ?? loadViaElement)(blob);
	} catch {
		// HEIC is the common case: iPhone photos, which only Safari opens.
		return err(unreadable('decode'));
	}
	try {
		if (source.width === 0 || source.height === 0) return err(unreadable('empty'));
		// A quarter turn the browser did not make shows as the stored size.
		const turn =
			facts !== null &&
			swapsSides(facts.orientation) &&
			facts.width !== facts.height &&
			source.width === facts.width &&
			source.height === facts.height;
		const chain = buildChain(source.width, source.height, maxPixels, create, false);
		if (chain === null) return err(noCanvas());
		const image = drawThrough(chain, source);
		return ok(
			turn ? applyOrientation(image, (facts as { orientation: number }).orientation) : image,
		);
	} finally {
		source.close?.();
	}
}

export function imageFromFile(
	file: File,
	options: ImageReadOptions = {},
): Promise<Result<RgbaImage>> {
	return imageFromBlob(file, options);
}

/** What a paste event carries, or what navigator.clipboard.read() resolves to. */
export type ClipboardSource =
	| {
			readonly clipboardData: {
				readonly files?: ArrayLike<Blob & { readonly type: string }>;
				readonly items?: ArrayLike<{
					readonly kind: string;
					readonly type: string;
					getAsFile(): Blob | null;
				}>;
			} | null;
	  }
	| readonly {
			readonly types: readonly string[];
			getType(type: string): Promise<Blob>;
	  }[];

/**
 * The picture in a paste, or null when the paste held none, which is an
 * ordinary outcome: people paste text into a scanner too.
 */
export async function imageFromClipboard(
	source: ClipboardSource,
	options: ImageReadOptions = {},
): Promise<Result<RgbaImage | null>> {
	if (Array.isArray(source)) {
		for (const item of source) {
			const type = item.types.find((candidate: string) => candidate.startsWith('image/'));
			if (type === undefined) continue;
			let blob: Blob;
			try {
				blob = await item.getType(type);
			} catch {
				return err(unreadable('clipboard'));
			}
			return imageFromBlob(blob, options);
		}
		return ok(null);
	}
	const data = (source as Exclude<ClipboardSource, readonly unknown[]>).clipboardData;
	if (data === null) return ok(null);
	const files = data.files;
	if (files !== undefined) {
		for (let i = 0; i < files.length; i += 1) {
			const file = files[i] as Blob;
			if (file.type.startsWith('image/')) return imageFromBlob(file, options);
		}
	}
	const items = data.items;
	if (items !== undefined) {
		for (let i = 0; i < items.length; i += 1) {
			const item = items[i] as { kind: string; type: string; getAsFile(): Blob | null };
			if (item.kind === 'file' && item.type.startsWith('image/')) {
				const file = item.getAsFile();
				if (file !== null) return imageFromBlob(file, options);
			}
		}
	}
	return ok(null);
}

/**
 * A reader of video frames that keeps its canvases while the frame size
 * holds: eight fresh canvases a second is garbage made on the thread that
 * paints the preview.
 */
export function videoReader(
	options: {
		readonly maxPixels?: number;
		readonly createCanvas?: (width: number, height: number) => CanvasLike;
	} = {},
): (video: VideoFrameSource) => Result<RgbaImage> {
	const maxPixels = options.maxPixels ?? MAX_CAMERA_PIXELS;
	const create = options.createCanvas ?? platformCanvas;
	let chain: Chain | null = null;
	return (video) => {
		const { videoWidth, videoHeight } = video;
		// No size yet is normal for the first frames after play() resolves.
		if (videoWidth === 0 || videoHeight === 0) return err(unreadable('no-frame'));
		if (chain === null || chain.sourceWidth !== videoWidth || chain.sourceHeight !== videoHeight) {
			// willReadFrequently keeps the canvas off the GPU, where every read
			// back would be a stall inside the frame's budget.
			chain = buildChain(videoWidth, videoHeight, maxPixels, create, true);
			if (chain === null) return err(noCanvas());
		}
		return ok(drawThrough(chain, video));
	};
}

/** The current frame of a playing video, reduced to at most `maxPixels`. */
export function imageFromVideo(
	video: VideoFrameSource,
	options: {
		readonly maxPixels?: number;
		readonly createCanvas?: (width: number, height: number) => CanvasLike;
	} = {},
): Result<RgbaImage> {
	return videoReader(options)(video);
}
