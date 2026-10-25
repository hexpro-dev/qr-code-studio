/**
 * Scanning from the camera.
 *
 * Lifted from google-auth-secret-retriever's src/dom/camera.ts. What it keeps
 * from there is about trust as much as decoding: the camera is opened only
 * when a caller asks (so the permission prompt follows a click), and every
 * track is stopped on `stop()`, when the tab is hidden and when the track
 * ends, because a camera light still on after someone has moved on is a
 * broken promise on a tool whose claim is privacy.
 *
 * What changes here: frames are taken with requestVideoFrameCallback where
 * the browser has it, so each decode sees a new frame rather than the same
 * one twice; decoding goes through an injected function, which the website
 * runs in a worker, and only one decode is in flight at a time; and a start
 * resolves to a Result whose error is one of the camera codes, rather than
 * throwing.
 */

import { QrStudioError } from '../core/errors.js';
import type { RgbaImage } from '../core/image.js';
import type { Registry } from '../core/registry.js';
import { err, ok } from '../core/result.js';
import type { Result } from '../core/result.js';
import { decodeImage } from '../decode/decoder.js';
import type { DecodedSymbol, DecodeOptions } from '../decode/types.js';
import type { SymbologyEntry } from '../symbology/types.js';
import { MAX_CAMERA_PIXELS, videoReader } from './image.js';
import type { CanvasLike } from './types.js';

/**
 * Ladder rungs a frame gets by default. A failed lenient read of a large
 * frame otherwise runs all nine (one to two seconds); five reach both
 * polarities at the two cheap scales and the global threshold, which is what
 * a live frame that is going to read needs.
 */
export const CAMERA_ATTEMPTS = 5;

/** Fastest the loop attempts a decode, a ceiling and not a target: the gap after a decode is at least as long as the decode took. */
const DEFAULT_SCANS_PER_SECOND = 15;

export type CameraStatus =
	| { readonly state: 'requesting' }
	| { readonly state: 'live'; readonly settings: MediaTrackSettings | null }
	| { readonly state: 'stopped' };

/** Decodes one frame. The website's posts it to a worker; the default runs the reader here. */
export type FrameDecoder = (
	image: RgbaImage,
) => Result<readonly DecodedSymbol[]> | Promise<Result<readonly DecodedSymbol[]>>;

export interface VideoLike {
	srcObject: MediaProvider | null;
	readonly videoWidth: number;
	readonly videoHeight: number;
	play(): Promise<void>;
	requestVideoFrameCallback?(callback: () => void): number;
	cancelVideoFrameCallback?(handle: number): void;
}

export interface CameraDeps {
	readonly getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
	/** Used where the video has no requestVideoFrameCallback. */
	readonly requestFrame?: (callback: () => void) => number;
	readonly cancelFrame?: (handle: number) => void;
	readonly now?: () => number;
	readonly createCanvas?: (width: number, height: number) => CanvasLike;
	readonly isSecureContext?: boolean;
	readonly addVisibilityListener?: (listener: () => void) => () => void;
}

export interface CameraScanOptions {
	readonly video: VideoLike;
	readonly facingMode?: 'environment' | 'user';
	readonly deviceId?: string;
	/** Work ceiling for one frame. Default 2.1 megapixels: 1080p untouched. */
	readonly maxPixels?: number;
	readonly scansPerSecond?: number;
	/** Default: the lenient reader here, at `CAMERA_ATTEMPTS` rungs. */
	readonly decode?: FrameDecoder;
	/** For the default decoder. */
	readonly symbologies?: Registry<SymbologyEntry>;
	/** For the default decoder: telemetry, a time budget, the symbologies to look for. */
	readonly decodeOptions?: DecodeOptions;
	/** Called with every frame that read. A frame that did not is not news, thirty times a second. */
	readonly onResult: (symbols: readonly DecodedSymbol[]) => void;
	readonly onStatus?: (status: CameraStatus) => void;
	readonly deps?: CameraDeps;
}

export interface CameraScanHandle {
	stop(): void;
	readonly stopped: boolean;
	/**
	 * True when a later start won the race and this one holds no camera. Two
	 * starts in the same second (a re-render, a double tap) both reach
	 * getUserMedia; the later owns the camera, and the earlier comes back
	 * already stopped. Never keep a superseded handle in place of a live one.
	 */
	readonly superseded: boolean;
}

function cameraError(
	code:
		'camera/permission-denied' | 'camera/unavailable' | 'camera/in-use' | 'camera/insecure-context',
	reason: string,
	cause?: unknown,
): QrStudioError {
	const messages = {
		'camera/permission-denied':
			'The camera is not allowed for this page. Allow it in the browser settings, or choose a picture instead.',
		'camera/unavailable': 'No camera could be opened. Choose a picture instead.',
		'camera/in-use': 'The camera is in use by another app or tab. Close it there, then try again.',
		'camera/insecure-context':
			'The camera only works on a secure page. Open this page over https, or choose a picture instead.',
	} as const;
	return new QrStudioError(
		code,
		messages[code],
		{ reason },
		cause === undefined ? undefined : { cause },
	);
}

/** A getUserMedia rejection, as something a person can act on. */
export function mapCameraError(cause: unknown): QrStudioError {
	const name = (cause as { name?: unknown } | null)?.name;
	switch (name) {
		case 'NotAllowedError':
		case 'SecurityError':
		case 'PermissionDeniedError':
			return cameraError('camera/permission-denied', 'denied', cause);
		case 'NotFoundError':
		case 'DevicesNotFoundError':
			return cameraError('camera/unavailable', 'no-device', cause);
		case 'OverconstrainedError':
		case 'ConstraintNotSatisfiedError':
			return cameraError('camera/unavailable', 'constraints', cause);
		case 'NotReadableError':
		case 'TrackStartError':
		case 'AbortError':
			return cameraError('camera/in-use', 'in-use', cause);
		default:
			return cameraError('camera/unavailable', 'no-api', cause);
	}
}

/**
 * What the camera is asked for. `ideal` cannot overconstrain, so a 720p webcam
 * gives 720p and a phone 1080p; without it most engines give 640 by 480, where
 * a dense code is below two pixels a module however close it is held.
 * `facingMode` stays a bare value, an ideal, because `exact` fails outright on
 * a laptop with only a front camera.
 */
function videoConstraints(options: CameraScanOptions): MediaTrackConstraints {
	const ideal: MediaTrackConstraints = { width: { ideal: 1920 }, height: { ideal: 1080 } };
	if (options.deviceId !== undefined) return { deviceId: { exact: options.deviceId }, ...ideal };
	return { facingMode: options.facingMode ?? 'environment', ...ideal };
}

/** Ask for the good frame, then settle for whatever the camera gives. */
async function openStream(
	getUserMedia: (constraints: MediaStreamConstraints) => Promise<MediaStream>,
	options: CameraScanOptions,
): Promise<MediaStream> {
	try {
		return await getUserMedia({ video: videoConstraints(options), audio: false });
	} catch (cause) {
		const name = (cause as { name?: unknown } | null)?.name;
		if (name !== 'OverconstrainedError' && name !== 'ConstraintNotSatisfiedError') throw cause;
		return getUserMedia({ video: true, audio: false });
	}
}

/**
 * Bumped by each start, so a start that loses the race stops its own stream.
 * The one piece of module state here: the camera is one device, shared by
 * every studio on the page.
 */
let generation = 0;

function stopTracks(stream: MediaStream): void {
	for (const track of stream.getTracks()) track.stop();
}

/* v8 ignore start: the platform defaults, which a test replaces with fakes and only a browser has. */
function platformGetUserMedia():
	((constraints: MediaStreamConstraints) => Promise<MediaStream>) | undefined {
	return typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia !== undefined
		? (constraints) => navigator.mediaDevices.getUserMedia(constraints)
		: undefined;
}

function platformVisibility(): ((listener: () => void) => () => void) | undefined {
	if (typeof document === 'undefined') return undefined;
	return (listener) => {
		const handler = (): void => {
			if (document.visibilityState === 'hidden') listener();
		};
		document.addEventListener('visibilitychange', handler);
		return () => document.removeEventListener('visibilitychange', handler);
	};
}

function platformFrame(): {
	request: (callback: () => void) => number;
	cancel: (handle: number) => void;
} {
	if (typeof requestAnimationFrame === 'function') {
		return { request: requestAnimationFrame, cancel: cancelAnimationFrame };
	}
	return {
		request: (callback) => setTimeout(callback, 16) as unknown as number,
		cancel: (handle) => clearTimeout(handle as unknown as ReturnType<typeof setTimeout>),
	};
}
/* v8 ignore stop */

export async function startCameraScan(
	options: CameraScanOptions,
): Promise<Result<CameraScanHandle>> {
	const deps = options.deps ?? {};
	const secure =
		deps.isSecureContext ?? (typeof isSecureContext === 'boolean' ? isSecureContext : false);
	if (!secure) return err(cameraError('camera/insecure-context', 'insecure'));
	const getUserMedia = deps.getUserMedia ?? platformGetUserMedia();
	if (getUserMedia === undefined) return err(cameraError('camera/unavailable', 'no-api'));
	const now = deps.now ?? (() => Date.now());
	const fallbackFrame =
		deps.requestFrame === undefined || deps.cancelFrame === undefined ? platformFrame() : null;
	const requestFrame =
		deps.requestFrame ?? (fallbackFrame as NonNullable<typeof fallbackFrame>).request;
	const cancelFrame =
		deps.cancelFrame ?? (fallbackFrame as NonNullable<typeof fallbackFrame>).cancel;
	const decode: FrameDecoder =
		options.decode ??
		((image) =>
			decodeImage(
				image,
				{
					...options.decodeOptions,
					budget: { maxAttempts: CAMERA_ATTEMPTS, ...options.decodeOptions?.budget },
				},
				options.symbologies,
			));

	options.onStatus?.({ state: 'requesting' });
	const mine = (generation += 1);
	let stream: MediaStream;
	try {
		stream = await openStream(getUserMedia, options);
	} catch (cause) {
		options.onStatus?.({ state: 'stopped' });
		return err(mapCameraError(cause));
	}
	const superseded = (): Result<CameraScanHandle> => {
		stopTracks(stream);
		if (options.video.srcObject === stream) options.video.srcObject = null;
		// No status: this stream never went live, and a 'stopped' now would
		// arrive after the winner's 'live' and describe a camera that is on.
		return ok({ stop: () => undefined, stopped: true, superseded: true });
	};
	if (mine !== generation) return superseded();

	options.video.srcObject = stream;
	try {
		await options.video.play();
	} catch {
		// An autoplay refusal. The stream is live either way, and a caller's
		// markup carries playsinline and muted.
	}
	// play() was a second wait, and a later start can arrive inside it.
	if (mine !== generation) return superseded();

	const video = options.video;
	const track = stream.getVideoTracks()[0];
	const read = videoReader({
		maxPixels: options.maxPixels ?? MAX_CAMERA_PIXELS,
		...(deps.createCanvas === undefined ? {} : { createCanvas: deps.createCanvas }),
	});
	const interval = 1000 / (options.scansPerSecond ?? DEFAULT_SCANS_PER_SECOND);
	const useVideoFrames = typeof video.requestVideoFrameCallback === 'function';
	const teardown: (() => void)[] = [];
	let stopped = false;
	let handle: number | null = null;
	let decoding = false;
	// When the last decode finished, and what it cost: the next gap is at
	// least that long, which keeps the decoder to about half the thread on a
	// slow phone and leaves the other half for the preview.
	let lastFinished = Number.NEGATIVE_INFINITY;
	let lastDuration = 0;

	const cancelPending = (): void => {
		if (handle === null) return;
		if (useVideoFrames) video.cancelVideoFrameCallback?.(handle);
		else cancelFrame(handle);
		handle = null;
	};

	const stop = (): void => {
		if (stopped) return;
		stopped = true;
		cancelPending();
		// Stopping every track is what turns the camera light off.
		stopTracks(stream);
		if (video.srcObject === stream) video.srcObject = null;
		for (const undo of teardown) undo();
		options.onStatus?.({ state: 'stopped' });
	};

	// Called only while running: at the start, and from a frame that found the scan still on.
	const schedule = (): void => {
		handle = useVideoFrames
			? (video.requestVideoFrameCallback as (callback: () => void) => number).call(video, pump)
			: requestFrame(pump);
	};

	const finished = (startedAt: number, result: Result<readonly DecodedSymbol[]>): void => {
		decoding = false;
		lastFinished = now();
		lastDuration = lastFinished - startedAt;
		// A late answer after stop() is not delivered: the person has moved on.
		if (!stopped && result.ok && result.value.length > 0) options.onResult(result.value);
	};

	function pump(): void {
		handle = null;
		if (stopped) return;
		schedule();
		if (decoding || now() - lastFinished < Math.max(interval, lastDuration)) return;
		const startedAt = now();
		const frame = read(video);
		if (!frame.ok) return;
		decoding = true;
		let pending: Result<readonly DecodedSymbol[]> | Promise<Result<readonly DecodedSymbol[]>>;
		try {
			pending = decode(frame.value);
		} catch {
			// A decoder that throws on one frame is a frame that did not read.
			finished(startedAt, ok([]));
			return;
		}
		if (typeof (pending as Promise<unknown>).then === 'function') {
			(pending as Promise<Result<readonly DecodedSymbol[]>>).then(
				(result) => finished(startedAt, result),
				() => finished(startedAt, ok([])),
			);
		} else {
			finished(startedAt, pending as Result<readonly DecodedSymbol[]>);
		}
	}

	// A webcam unplugged, or the camera taken by another app: the stream dies
	// while the video may keep its size, and the loop would read one frozen
	// frame for ever.
	if (track !== undefined && typeof track.addEventListener === 'function') {
		track.addEventListener('ended', stop);
		teardown.push(() => track.removeEventListener('ended', stop));
	}
	const handleOf: CameraScanHandle = {
		stop,
		get stopped() {
			return stopped;
		},
		superseded: false,
	};
	const addVisibility = deps.addVisibilityListener ?? platformVisibility();
	const removeVisibility = addVisibility?.(stop);
	if (removeVisibility !== undefined) teardown.push(removeVisibility);
	// A listener may answer at once, for a tab already hidden when the camera
	// opened; then the camera is closed again before it ever went live.
	if (stopped) {
		removeVisibility?.();
		return ok(handleOf);
	}

	const settings =
		track !== undefined && typeof track.getSettings === 'function' ? track.getSettings() : null;
	options.onStatus?.({ state: 'live', settings });
	schedule();

	return ok(handleOf);
}

/** Whether a camera could be opened here at all, before asking for one. */
export function isCameraAvailable(deps: CameraDeps = {}): boolean {
	const secure =
		deps.isSecureContext ?? (typeof isSecureContext === 'boolean' ? isSecureContext : false);
	return secure && (deps.getUserMedia ?? platformGetUserMedia()) !== undefined;
}
