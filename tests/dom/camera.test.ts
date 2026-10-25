/**
 * The camera loop, driven by fakes, after google-auth-secret-retriever's
 * tests/dom/camera.test.ts.
 *
 * What is pinned is not the decoding, which the decode suite covers, but
 * that failures are told apart precisely and that every track is stopped,
 * because a camera light still on after someone has moved on is a broken
 * promise on a tool whose claim is privacy.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { ok, err } from '../../src/core/result.js';
import { QrStudioError } from '../../src/core/errors.js';
import type { RgbaImage } from '../../src/core/image.js';
import {
	CAMERA_ATTEMPTS,
	isCameraAvailable,
	mapCameraError,
	startCameraScan,
} from '../../src/dom/camera.js';
import type { CameraDeps, CameraStatus, VideoLike } from '../../src/dom/camera.js';
import { encode } from '../../src/encode/encode.js';
import { buildScene } from '../../src/design/scene.js';
import { defaultDesign } from '../../src/design/document.js';
import { createDesignRegistries } from '../../src/design/registries.js';
import { rasterise } from '../../src/render/raster.js';
import type { DecodedSymbol } from '../../src/decode/types.js';
import { fakeCanvas } from './fakes.js';

afterEach(() => {
	vi.unstubAllGlobals();
});

interface FakeTrack extends MediaStreamTrack {
	stopped: boolean;
	fire(event: string): void;
	readonly listening: number;
}

function fakeTrack(settings: MediaTrackSettings | null = { width: 1920, height: 1080 }): FakeTrack {
	const listeners = new Map<string, Set<() => void>>();
	const track = {
		stopped: false,
		stop() {
			track.stopped = true;
		},
		addEventListener(event: string, listener: () => void) {
			const set = listeners.get(event) ?? new Set();
			set.add(listener);
			listeners.set(event, set);
		},
		removeEventListener(event: string, listener: () => void) {
			listeners.get(event)?.delete(listener);
		},
		fire(event: string) {
			for (const listener of [...(listeners.get(event) ?? [])]) listener();
		},
		get listening() {
			let count = 0;
			for (const set of listeners.values()) count += set.size;
			return count;
		},
		...(settings === null ? {} : { getSettings: () => settings }),
	};
	return track as unknown as FakeTrack;
}

function fakeStream(tracks: MediaStreamTrack[]): MediaStream {
	return { getTracks: () => tracks, getVideoTracks: () => tracks } as unknown as MediaStream;
}

/** A video with requestVideoFrameCallback, whose frames a test delivers. */
function fakeVideo(options: { frames?: boolean; width?: number } = {}) {
	const pending = new Map<number, () => void>();
	let next = 0;
	const video: VideoLike & { deliver(): void; readonly waiting: number } = {
		srcObject: null,
		videoWidth: options.width ?? 64,
		videoHeight: options.width ?? 64,
		play: async () => undefined,
		deliver() {
			const callbacks = [...pending.values()];
			pending.clear();
			for (const callback of callbacks) callback();
		},
		get waiting() {
			return pending.size;
		},
		...(options.frames === false
			? {}
			: {
					requestVideoFrameCallback(callback: () => void) {
						next += 1;
						pending.set(next, callback);
						return next;
					},
					cancelVideoFrameCallback(handle: number) {
						pending.delete(handle);
					},
				}),
	};
	return video;
}

function deps(
	stream: MediaStream,
	extra: Partial<CameraDeps> = {},
): CameraDeps & { now: () => number; tick(ms: number): void } {
	let time = 0;
	return {
		isSecureContext: true,
		getUserMedia: async () => stream,
		createCanvas: fakeCanvas().createCanvas,
		addVisibilityListener: () => () => undefined,
		now: () => time,
		tick(ms: number) {
			time += ms;
		},
		...extra,
	} as CameraDeps & { now: () => number; tick(ms: number): void };
}

const SYMBOL = { symbology: 'qr' } as unknown as DecodedSymbol;

describe('starting', () => {
	it('opens the camera, goes live, reads frames and stops every track', async () => {
		const track = fakeTrack();
		const video = fakeVideo();
		const statuses: CameraStatus[] = [];
		const results: (readonly DecodedSymbol[])[] = [];
		const d = deps(fakeStream([track]));
		const started = await startCameraScan({
			video,
			decode: () => ok([SYMBOL]),
			onResult: (symbols) => results.push(symbols),
			onStatus: (status) => statuses.push(status),
			deps: d,
		});
		if (!started.ok) throw started.error;
		const handle = started.value;
		expect(handle.superseded).toBe(false);
		expect(statuses).toEqual([
			{ state: 'requesting' },
			{ state: 'live', settings: { width: 1920, height: 1080 } },
		]);
		expect(video.srcObject).not.toBeNull();
		video.deliver();
		expect(results).toEqual([[SYMBOL]]);
		// The next frame within the rate's interval is not decoded.
		d.tick(10);
		video.deliver();
		expect(results).toHaveLength(1);
		d.tick(100);
		video.deliver();
		expect(results).toHaveLength(2);
		handle.stop();
		expect(handle.stopped).toBe(true);
		expect(track.stopped).toBe(true);
		expect(video.srcObject).toBeNull();
		expect(video.waiting).toBe(0);
		expect(track.listening).toBe(0);
		expect(statuses[statuses.length - 1]).toEqual({ state: 'stopped' });
		handle.stop();
		expect(statuses.filter((status) => status.state === 'stopped')).toHaveLength(1);
	});

	it('decodes with the reader at a capped ladder by default, and finds a real code', async () => {
		const registries = createDesignRegistries();
		const scene = buildScene(encode('https://example.com/'), defaultDesign(), { registries }).scene;
		const picture = rasterise(scene, { width: 264 });
		const canvas = fakeCanvas({ picture: () => picture });
		const results: (readonly DecodedSymbol[])[] = [];
		const video = fakeVideo({ width: 264 });
		const started = await startCameraScan({
			video,
			onResult: (symbols) => results.push(symbols),
			deps: deps(fakeStream([fakeTrack()]), { createCanvas: canvas.createCanvas }),
		});
		video.deliver();
		expect(results[0]?.[0]?.read.bitstream.text).toBe('https://example.com/');
		expect(CAMERA_ATTEMPTS).toBe(5);
		if (started.ok) started.value.stop();
	});

	it('runs one decode at a time, and drops an answer that arrives after stop', async () => {
		const video = fakeVideo();
		const pending: ((value: ReturnType<typeof ok<readonly DecodedSymbol[]>>) => void)[] = [];
		const results: unknown[] = [];
		const d = deps(fakeStream([fakeTrack()]));
		const started = await startCameraScan({
			video,
			decode: () => new Promise((resolve) => pending.push(resolve)),
			onResult: (symbols) => results.push(symbols),
			deps: d,
		});
		video.deliver();
		d.tick(1000);
		video.deliver();
		expect(pending).toHaveLength(1);
		pending[0]?.(ok([SYMBOL]));
		await Promise.resolve();
		expect(results).toHaveLength(1);
		d.tick(1000);
		video.deliver();
		expect(pending).toHaveLength(2);
		if (started.ok) started.value.stop();
		pending[1]?.(ok([SYMBOL]));
		await Promise.resolve();
		expect(results).toHaveLength(1);
	});

	it('treats a frame that does not read, a decoder that throws and one that rejects as frames with nothing', async () => {
		const video = fakeVideo();
		const results: unknown[] = [];
		let call = 0;
		const d = deps(fakeStream([fakeTrack()]));
		const started = await startCameraScan({
			video,
			decode: (): never => {
				call += 1;
				if (call === 1) return err(new QrStudioError('decode/not-found', 'none')) as never;
				if (call === 2) throw new Error('broken decoder');
				if (call === 3) return Promise.reject(new Error('worker died')) as never;
				return ok([]) as never;
			},
			onResult: (symbols) => results.push(symbols),
			deps: d,
		});
		for (let i = 0; i < 4; i += 1) {
			d.tick(1000);
			video.deliver();
			await Promise.resolve();
			await Promise.resolve();
		}
		expect(call).toBe(4);
		expect(results).toEqual([]);
		if (started.ok) started.value.stop();
	});

	it('waits for a frame with a size, and uses animation frames where there is no video frame callback', async () => {
		const frames: (() => void)[] = [];
		const cancelled: number[] = [];
		const video = fakeVideo({ frames: false, width: 0 });
		let decoded = 0;
		const started = await startCameraScan({
			video,
			decode: () => {
				decoded += 1;
				return ok([]);
			},
			onResult: () => undefined,
			deps: deps(fakeStream([fakeTrack(null)]), {
				requestFrame: (callback) => frames.push(callback),
				cancelFrame: (handle) => cancelled.push(handle),
			}),
		});
		expect(frames).toHaveLength(1);
		frames.shift()?.();
		expect(decoded).toBe(0);
		if (started.ok) started.value.stop();
		expect(cancelled).toHaveLength(1);
		expect(frames).toHaveLength(1);
	});

	it('stops when the tab is hidden, and when the track ends', async () => {
		let hide: (() => void) | null = null;
		let removed = 0;
		const track = fakeTrack();
		const started = await startCameraScan({
			video: fakeVideo(),
			decode: () => ok([]),
			onResult: () => undefined,
			deps: deps(fakeStream([track]), {
				addVisibilityListener: (listener) => {
					hide = listener;
					return () => (removed += 1);
				},
			}),
		});
		(hide as unknown as () => void)();
		expect(started.ok && started.value.stopped).toBe(true);
		expect(removed).toBe(1);
		expect(track.stopped).toBe(true);

		const ending = fakeTrack();
		const second = await startCameraScan({
			video: fakeVideo(),
			decode: () => ok([]),
			onResult: () => undefined,
			deps: deps(fakeStream([ending])),
		});
		ending.fire('ended');
		expect(second.ok && second.value.stopped).toBe(true);
	});

	it('goes live with a stream that has no video track, and says the settings are not known', async () => {
		const statuses: CameraStatus[] = [];
		const started = await startCameraScan({
			video: fakeVideo(),
			decode: () => ok([]),
			onResult: () => undefined,
			onStatus: (status) => statuses.push(status),
			deps: deps(fakeStream([])),
		});
		expect(statuses[1]).toEqual({ state: 'live', settings: null });
		if (started.ok) started.value.stop();
	});

	it('keeps going when play() is refused by autoplay rules', async () => {
		const video = { ...fakeVideo(), play: () => Promise.reject(new Error('NotAllowedError')) };
		const started = await startCameraScan({
			video,
			decode: () => ok([]),
			onResult: () => undefined,
			deps: deps(fakeStream([fakeTrack()])),
		});
		expect(started.ok).toBe(true);
	});
});

describe('the race', () => {
	it('hands back a superseded handle to the start that lost, its stream stopped and no status', async () => {
		const firstTrack = fakeTrack();
		const secondTrack = fakeTrack();
		let release: (stream: MediaStream) => void = () => undefined;
		const slow = new Promise<MediaStream>((resolve) => (release = resolve));
		const firstStatuses: CameraStatus[] = [];
		const first = startCameraScan({
			video: fakeVideo(),
			decode: () => ok([]),
			onResult: () => undefined,
			onStatus: (status) => firstStatuses.push(status),
			deps: deps(fakeStream([firstTrack]), { getUserMedia: () => slow }),
		});
		const second = await startCameraScan({
			video: fakeVideo(),
			decode: () => ok([]),
			onResult: () => undefined,
			deps: deps(fakeStream([secondTrack])),
		});
		release(fakeStream([firstTrack]));
		const lost = await first;
		expect(lost.ok && lost.value).toMatchObject({ superseded: true, stopped: true });
		if (lost.ok) lost.value.stop();
		expect(firstTrack.stopped).toBe(true);
		expect(firstStatuses).toEqual([{ state: 'requesting' }]);
		expect(second.ok && second.value.superseded).toBe(false);
		expect(secondTrack.stopped).toBe(false);
		if (second.ok) second.value.stop();
	});

	it('loses inside play() too, leaving the winner the video element', async () => {
		const track = fakeTrack();
		let releasePlay: () => void = () => undefined;
		const video = {
			...fakeVideo(),
			play: () => new Promise<void>((resolve) => (releasePlay = resolve)),
		};
		const first = startCameraScan({
			video,
			decode: () => ok([]),
			onResult: () => undefined,
			deps: deps(fakeStream([track])),
		});
		await Promise.resolve();
		await Promise.resolve();
		const winner = await startCameraScan({
			video: fakeVideo(),
			decode: () => ok([]),
			onResult: () => undefined,
			deps: deps(fakeStream([fakeTrack()])),
		});
		releasePlay();
		const lost = await first;
		expect(lost.ok && lost.value.superseded).toBe(true);
		expect(video.srcObject).toBeNull();
		expect(track.stopped).toBe(true);
		if (winner.ok) winner.value.stop();
	});
});

describe('failures', () => {
	it('tell apart a refusal, no camera, a camera in use and an insecure page', async () => {
		const failWith = async (name: string) => {
			const statuses: CameraStatus[] = [];
			const result = await startCameraScan({
				video: fakeVideo(),
				onResult: () => undefined,
				onStatus: (status) => statuses.push(status),
				deps: deps(fakeStream([]), {
					getUserMedia: () => Promise.reject(Object.assign(new Error(name), { name })),
				}),
			});
			expect(statuses[statuses.length - 1]).toEqual({ state: 'stopped' });
			return result.ok ? null : [result.error.code, result.error.params.reason];
		};
		expect(await failWith('NotAllowedError')).toEqual(['camera/permission-denied', 'denied']);
		expect(await failWith('SecurityError')).toEqual(['camera/permission-denied', 'denied']);
		expect(await failWith('NotFoundError')).toEqual(['camera/unavailable', 'no-device']);
		expect(await failWith('NotReadableError')).toEqual(['camera/in-use', 'in-use']);
		expect(await failWith('TypeError')).toEqual(['camera/unavailable', 'no-api']);
		const insecure = await startCameraScan({
			video: fakeVideo(),
			onResult: () => undefined,
			deps: { ...deps(fakeStream([])), isSecureContext: false },
		});
		expect(!insecure.ok && insecure.error.code).toBe('camera/insecure-context');
		const noApi = await startCameraScan({
			video: fakeVideo(),
			onResult: () => undefined,
			deps: { isSecureContext: true },
		});
		expect(!noApi.ok && noApi.error.code).toBe('camera/unavailable');
		expect(mapCameraError(null).code).toBe('camera/unavailable');
		expect(mapCameraError({ name: 'OverconstrainedError' }).params.reason).toBe('constraints');
	});

	it('settles for any camera when the asked-for one cannot be had', async () => {
		const asked: MediaStreamConstraints[] = [];
		const stream = fakeStream([fakeTrack()]);
		const started = await startCameraScan({
			video: fakeVideo(),
			deviceId: 'camera-2',
			decode: () => ok([]),
			onResult: () => undefined,
			deps: deps(stream, {
				getUserMedia: async (constraints) => {
					asked.push(constraints);
					if (asked.length === 1)
						throw Object.assign(new Error('x'), { name: 'OverconstrainedError' });
					return stream;
				},
			}),
		});
		expect(started.ok).toBe(true);
		expect(asked[0]?.video).toMatchObject({ deviceId: { exact: 'camera-2' } });
		expect(asked[1]).toEqual({ video: true, audio: false });
		if (started.ok) started.value.stop();
		const facing: MediaStreamConstraints[] = [];
		const user = await startCameraScan({
			video: fakeVideo(),
			facingMode: 'user',
			decode: () => ok([]),
			onResult: () => undefined,
			deps: deps(stream, { getUserMedia: async (c) => (facing.push(c), stream) }),
		});
		expect(facing[0]?.video).toMatchObject({ facingMode: 'user', width: { ideal: 1920 } });
		if (user.ok) user.value.stop();
	});
});

describe('isCameraAvailable', () => {
	it('needs a secure page and the API', () => {
		expect(
			isCameraAvailable({ isSecureContext: true, getUserMedia: async () => fakeStream([]) }),
		).toBe(true);
		expect(
			isCameraAvailable({ isSecureContext: false, getUserMedia: async () => fakeStream([]) }),
		).toBe(false);
		expect(isCameraAvailable()).toBe(false);
		vi.stubGlobal('isSecureContext', true);
		expect(isCameraAvailable({ getUserMedia: async () => fakeStream([]) })).toBe(true);
	});
});

export type { RgbaImage };

describe('the edges of the loop', () => {
	it('closes the camera again at once for a tab already hidden, never going live', async () => {
		const statuses: CameraStatus[] = [];
		const track = fakeTrack();
		let removed = 0;
		const started = await startCameraScan({
			video: fakeVideo(),
			decode: () => ok([]),
			onResult: () => undefined,
			onStatus: (status) => statuses.push(status),
			deps: deps(fakeStream([track]), {
				addVisibilityListener: (listener) => {
					listener();
					return () => (removed += 1);
				},
			}),
		});
		expect(started.ok && started.value.stopped).toBe(true);
		expect(track.stopped).toBe(true);
		expect(track.listening).toBe(0);
		expect(removed).toBe(1);
		expect(statuses.map((status) => status.state)).toEqual(['requesting', 'stopped']);
	});

	it('ignores a frame that arrives after stop, and a video that cannot cancel its callback', async () => {
		const frames: (() => void)[] = [];
		const video = fakeVideo({ frames: false });
		let decoded = 0;
		const started = await startCameraScan({
			video,
			decode: () => {
				decoded += 1;
				return ok([]);
			},
			onResult: () => undefined,
			deps: deps(fakeStream([fakeTrack()]), {
				requestFrame: (callback) => frames.push(callback),
				cancelFrame: () => undefined,
			}),
		});
		if (started.ok) started.value.stop();
		frames.shift()?.();
		expect(decoded).toBe(0);
		const halfVideo = { ...fakeVideo(), cancelVideoFrameCallback: undefined };
		const second = await startCameraScan({
			video: halfVideo,
			decode: () => ok([]),
			onResult: () => undefined,
			deps: deps(fakeStream([fakeTrack()])),
		});
		expect(() => second.ok && second.value.stop()).not.toThrow();
	});

	it('takes its defaults from the platform when the deps leave them out', async () => {
		vi.stubGlobal('isSecureContext', false);
		const insecure = await startCameraScan({ video: fakeVideo(), onResult: () => undefined });
		expect(!insecure.ok && insecure.error.code).toBe('camera/insecure-context');
		const stream = fakeStream([fakeTrack()]);
		// No clock, no canvas, no visibility listener: Date.now, the platform canvas
		// (none in Node, so no frame reads) and no tab to watch.
		const results: unknown[] = [];
		const video = fakeVideo();
		const started = await startCameraScan({
			video,
			onResult: (symbols) => results.push(symbols),
			decodeOptions: { budget: { maxPixels: 1000 } },
			deps: { isSecureContext: true, getUserMedia: async () => stream },
		});
		video.deliver();
		expect(results).toEqual([]);
		if (started.ok) started.value.stop();
		vi.stubGlobal('isSecureContext', true);
		expect(isCameraAvailable({})).toBe(false);
	});
});

describe('the platform defaults', () => {
	it('treat a page with no isSecureContext as insecure', async () => {
		const result = await startCameraScan({ video: fakeVideo(), onResult: () => undefined });
		expect(!result.ok && result.error.code).toBe('camera/insecure-context');
	});

	it("pass the caller's decode options to the default reader", async () => {
		const registries = createDesignRegistries();
		const scene = buildScene(encode('https://example.com/'), defaultDesign(), { registries }).scene;
		const picture = rasterise(scene, { width: 264 });
		const results: (readonly DecodedSymbol[])[] = [];
		const video = fakeVideo({ width: 264 });
		const started = await startCameraScan({
			video,
			decodeOptions: { maxSymbols: 1 },
			onResult: (symbols) => results.push(symbols),
			deps: deps(fakeStream([fakeTrack()]), {
				createCanvas: fakeCanvas({ picture: () => picture }).createCanvas,
			}),
		});
		video.deliver();
		expect(results).toHaveLength(1);
		if (started.ok) started.value.stop();
	});
});
