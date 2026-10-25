/**
 * Files out: downloads, the clipboard, the browser's own JPEG and WebP
 * encoders, and printing at a physical size, each through injected fakes.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	REVOKE_AFTER_MS,
	copyImageToClipboard,
	copyText,
	downloadBlob,
	downloadBytes,
} from '../../src/dom/output.js';
import { canvasRasterEncoder, flattenOnWhite, looksLike } from '../../src/dom/raster-encoder.js';
import type { EncodingCanvas } from '../../src/dom/raster-encoder.js';
import { PRINT_CLEANUP_MS, printDocument, printScene } from '../../src/dom/print.js';
import type { PrintDeps } from '../../src/dom/print.js';

afterEach(() => {
	vi.unstubAllGlobals();
});

function fakeDocument() {
	const events: string[] = [];
	const anchor = {
		href: '',
		download: '',
		rel: '',
		style: { display: '' },
		click: () => events.push('click'),
		remove: () => events.push('remove'),
	};
	return {
		events,
		anchor,
		document: {
			createElement: () => anchor,
			body: { appendChild: () => events.push('append') },
		},
	};
}

describe('downloads', () => {
	it('hand the browser an object URL through a link in the document, and revoke it a minute later', () => {
		const page = fakeDocument();
		const revoked: string[] = [];
		const timers: [() => void, number][] = [];
		const result = downloadBytes(new Uint8Array([1, 2, 3]), 'qr-code.png', 'image/png', {
			document: page.document,
			url: { createObjectURL: () => 'blob:example', revokeObjectURL: (url) => revoked.push(url) },
			setTimeout: (task, ms) => timers.push([task, ms]),
		});
		expect(result).toEqual({ ok: true, value: null });
		expect(page.anchor).toMatchObject({
			href: 'blob:example',
			download: 'qr-code.png',
			rel: 'noopener',
			style: { display: 'none' },
		});
		expect(page.events).toEqual(['append', 'click', 'remove']);
		expect(timers[0]?.[1]).toBe(REVOKE_AFTER_MS);
		expect(revoked).toEqual([]);
		timers[0]?.[0]();
		expect(revoked).toEqual(['blob:example']);
	});

	it('say they cannot where there is no document, and use the platform where there is', () => {
		expect(downloadBlob(new Blob(['x']), 'x.svg')).toMatchObject({
			ok: false,
			error: { code: 'platform/unavailable' },
		});
		const page = fakeDocument();
		vi.stubGlobal('document', page.document);
		vi.useFakeTimers();
		const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:platform');
		const revoke = vi.spyOn(URL, 'revokeObjectURL').mockReturnValue(undefined);
		expect(downloadBlob(new Blob(['x']), 'x.svg').ok).toBe(true);
		vi.advanceTimersByTime(REVOKE_AFTER_MS);
		expect(revoke).toHaveBeenCalledWith('blob:platform');
		create.mockRestore();
		revoke.mockRestore();
		vi.useRealTimers();
	});
});

describe('the clipboard', () => {
	it('takes a PNG as a ClipboardItem, from bytes or a blob', async () => {
		const written: unknown[] = [];
		class Item {
			constructor(readonly items: Record<string, Blob | Promise<Blob>>) {}
		}
		const clipboard = { write: async (items: readonly unknown[]) => void written.push(...items) };
		expect(
			await copyImageToClipboard(new Uint8Array([0x89]), { clipboard, ClipboardItem: Item }),
		).toEqual({ ok: true, value: null });
		const item = written[0] as Item;
		expect(Object.keys(item.items)).toEqual(['image/png']);
		expect((item.items['image/png'] as Blob).type).toBe('image/png');
		const blob = new Blob(['png'], { type: 'image/png' });
		await copyImageToClipboard(blob, { clipboard, ClipboardItem: Item });
		expect((written[1] as Item).items['image/png']).toBe(blob);
	});

	it('says it could not copy when refused, or when the browser has no clipboard', async () => {
		const refusing = {
			write: () => Promise.reject(new Error('NotAllowedError')),
			writeText: () => Promise.reject(new Error('no')),
		};
		class Item {}
		expect(
			await copyImageToClipboard(new Uint8Array(), {
				clipboard: refusing,
				ClipboardItem: Item as never,
			}),
		).toMatchObject({
			ok: false,
			error: { code: 'platform/unavailable', params: { feature: 'clipboard' } },
		});
		expect(await copyImageToClipboard(new Uint8Array())).toMatchObject({ ok: false });
		expect(await copyText('x', { clipboard: refusing })).toMatchObject({ ok: false });
		expect(await copyText('x')).toMatchObject({ ok: false });
	});

	it('copies text, and finds the platform clipboard and ClipboardItem where they exist', async () => {
		const copied: string[] = [];
		const written: unknown[] = [];
		vi.stubGlobal('navigator', {
			clipboard: {
				writeText: async (text: string) => void copied.push(text),
				write: async (items: unknown[]) => void written.push(...items),
			},
		});
		vi.stubGlobal('ClipboardItem', class {});
		expect(await copyText('https://example.com/')).toEqual({ ok: true, value: null });
		expect(copied).toEqual(['https://example.com/']);
		expect((await copyImageToClipboard(new Uint8Array())).ok).toBe(true);
		expect(written).toHaveLength(1);
	});
});

/** A canvas whose encoder hands back `bytes`, by convertToBlob or by toBlob. */
function encodingCanvas(
	bytes: Uint8Array | null,
	how: 'convert' | 'toBlob' | 'neither' = 'convert',
) {
	const put: unknown[] = [];
	const asked: unknown[] = [];
	const canvas: EncodingCanvas = {
		width: 0,
		height: 0,
		getContext: () => ({ putImageData: (data: never) => void put.push(data) }),
		...(how === 'convert'
			? {
					convertToBlob: async (options: { type: string; quality?: number }) => {
						asked.push(options);
						if (bytes === null) throw new Error('encoding failed');
						return new Blob([bytes as BlobPart]);
					},
				}
			: {}),
		...(how === 'toBlob'
			? {
					toBlob: (callback: (blob: Blob | null) => void, type: string, quality?: number) => {
						asked.push({ type, quality });
						callback(bytes === null ? null : new Blob([bytes as BlobPart]));
					},
				}
			: {}),
	};
	return { canvas, put, asked };
}

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const IMAGE = { width: 1, height: 1, data: new Uint8ClampedArray([0, 0, 0, 0]) };

describe('the canvas encoder', () => {
	it('encodes JPEG onto white and WebP as it is, with the quality asked for', async () => {
		const jpeg = encodingCanvas(JPEG);
		const encoder = canvasRasterEncoder({
			createCanvas: () => jpeg.canvas,
			createImageData: (image) => image,
		});
		expect(await encoder.encode(IMAGE, 'jpeg', { quality: 0.7 })).toEqual({
			ok: true,
			value: JPEG,
		});
		expect(jpeg.asked).toEqual([{ type: 'image/jpeg', quality: 0.7 }]);
		expect(Array.from((jpeg.put[0] as typeof IMAGE).data)).toEqual([255, 255, 255, 255]);
		const webp = encodingCanvas(WEBP, 'toBlob');
		const second = canvasRasterEncoder({
			createCanvas: () => webp.canvas,
			createImageData: (image) => image,
		});
		expect(await second.encode(IMAGE, 'webp', {})).toEqual({ ok: true, value: WEBP });
		expect((webp.put[0] as typeof IMAGE).data).toBe(IMAGE.data);
		expect(webp.asked).toEqual([{ type: 'image/webp', quality: undefined }]);
	});

	it('refuses a PNG handed back in place of WebP, as Safari does', async () => {
		const substituted = encodingCanvas(PNG);
		const encoder = canvasRasterEncoder({
			createCanvas: () => substituted.canvas,
			createImageData: (image) => image,
		});
		expect(await encoder.encode(IMAGE, 'webp', {})).toMatchObject({
			ok: false,
			error: {
				code: 'render/format-unavailable',
				params: { format: 'webp', reason: 'substituted' },
			},
		});
	});

	it('refuses when there is no canvas, no context, or no blob', async () => {
		const none = canvasRasterEncoder({
			createCanvas: () => null,
			createImageData: (image) => image,
		});
		expect(await none.encode(IMAGE, 'jpeg', {})).toMatchObject({
			ok: false,
			error: { params: { reason: 'canvas' } },
		});
		const noContext = canvasRasterEncoder({
			createCanvas: () => ({ width: 0, height: 0, getContext: () => null }),
			createImageData: (image) => image,
		});
		expect(await noContext.encode(IMAGE, 'jpeg', {})).toMatchObject({
			ok: false,
			error: { params: { reason: 'canvas' } },
		});
		for (const how of ['convert', 'toBlob', 'neither'] as const) {
			const empty = encodingCanvas(null, how);
			const encoder = canvasRasterEncoder({
				createCanvas: () => empty.canvas,
				createImageData: (image) => image,
			});
			expect(await encoder.encode(IMAGE, 'jpeg', {}), how).toMatchObject({
				ok: false,
				error: { params: { reason: 'nothing' } },
			});
		}
		// The platform canvas, where there is none in Node.
		expect(await canvasRasterEncoder().encode(IMAGE, 'jpeg', {})).toMatchObject({ ok: false });
	});

	it('knows each format by its first bytes', () => {
		expect(looksLike(PNG, 'png')).toBe(true);
		expect(looksLike(JPEG, 'png')).toBe(false);
		expect(looksLike(JPEG, 'jpeg')).toBe(true);
		expect(looksLike(WEBP, 'webp')).toBe(true);
		expect(looksLike(WEBP.slice(0, 8), 'webp')).toBe(false);
		expect(
			looksLike(
				new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x41, 0x56, 0x49, 0x20]),
				'webp',
			),
		).toBe(false);
	});

	it('flattens onto white only what is not already opaque', () => {
		const opaque = { width: 1, height: 1, data: new Uint8ClampedArray([10, 20, 30, 255]) };
		expect(flattenOnWhite(opaque)).toBe(opaque);
		const half = { width: 1, height: 1, data: new Uint8ClampedArray([0, 0, 0, 128]) };
		expect(Array.from(flattenOnWhite(half).data)).toEqual([127, 127, 127, 255]);
	});
});

/** A window whose iframe loads when appended, and records what it was asked. */
function fakeWindow(options: { noView?: boolean; printThrows?: boolean } = {}) {
	const log: string[] = [];
	const timers: [() => void, number][] = [];
	let afterprint: (() => void) | null = null;
	const frame = {
		srcdoc: '',
		style: { cssText: '' },
		attributes: {} as Record<string, string>,
		setAttribute(name: string, value: string) {
			frame.attributes[name] = value;
		},
		load: null as (() => void) | null,
		addEventListener(_type: 'load', listener: () => void) {
			frame.load = listener;
		},
		contentWindow:
			options.noView === true
				? null
				: {
						focus: () => log.push('focus'),
						print: () => {
							if (options.printThrows === true) throw new Error('blocked');
							log.push('print');
						},
						addEventListener: (_type: 'afterprint', listener: () => void) => {
							afterprint = listener;
						},
					},
		remove: () => log.push('remove'),
	};
	const window: PrintDeps['window'] = {
		document: {
			createElement: () => frame,
			body: {
				appendChild: () => {
					log.push('append');
					frame.load?.();
				},
			},
		},
		setTimeout: (task, ms) => timers.push([task, ms]),
	};
	return { window, frame, log, timers, afterprint: () => afterprint?.() };
}

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 33 41" role="img"></svg>';

describe('printing', () => {
	it('prints from a sandboxed frame sized to the code, then takes the frame away', async () => {
		const fake = fakeWindow();
		expect(await printScene(SVG, 33, { window: fake.window })).toEqual({ ok: true, value: null });
		expect(fake.log).toEqual(['append', 'focus', 'print']);
		expect(fake.frame.attributes.sandbox).toBe('allow-modals allow-same-origin');
		expect(fake.frame.srcdoc).toContain('@page{size:33mm 41mm;margin:0}');
		expect(fake.frame.srcdoc).toContain(SVG);
		fake.afterprint();
		expect(fake.log).toEqual(['append', 'focus', 'print', 'remove']);
		// The fallback cleanup after that removes nothing twice.
		expect(fake.timers[0]?.[1]).toBe(PRINT_CLEANUP_MS);
		fake.timers[0]?.[0]();
		expect(fake.log.filter((entry) => entry === 'remove')).toHaveLength(1);
	});

	it('takes both sides, and writes millimetres to three places', () => {
		expect(printDocument(SVG, 25.12345, 30)).toContain(
			'svg{display:block;width:25.123mm;height:30mm}',
		);
		const square = '<svg viewBox="nonsense"></svg>';
		const fake = fakeWindow();
		void printScene(square, 20, { window: fake.window });
		expect(fake.frame.srcdoc).toContain('size:20mm 20mm');
		const both = fakeWindow();
		void printScene(SVG, { widthMm: 50, heightMm: 70 }, { window: both.window });
		expect(both.frame.srcdoc).toContain('size:50mm 70mm');
		const flat = fakeWindow();
		void printScene('<svg viewBox="0 0 0 5"></svg>', 10, { window: flat.window });
		expect(flat.frame.srcdoc).toContain('size:10mm 10mm');
	});

	it('says it cannot when the frame has no window or printing is blocked', async () => {
		const noView = fakeWindow({ noView: true });
		expect(await printScene(SVG, 25, { window: noView.window })).toMatchObject({
			ok: false,
			error: { code: 'platform/unavailable' },
		});
		expect(noView.log).toContain('remove');
		const blocked = fakeWindow({ printThrows: true });
		expect(await printScene(SVG, 25, { window: blocked.window })).toMatchObject({ ok: false });
		expect(blocked.log).toContain('remove');
	});

	it("refuses anything that is not the studio's own SVG, and sizes that are not sizes", () => {
		const { window } = fakeWindow();
		expect(() => printScene('<html></html>', 25, { window })).toThrow(TypeError);
		expect(() => printScene('<svg><script>x</script></svg>', 25, { window })).toThrow(TypeError);
		expect(() => printScene(5 as never, 25, { window })).toThrow(TypeError);
		expect(() => printScene(SVG, 0, { window })).toThrow(TypeError);
		expect(() => printScene(SVG, Number.POSITIVE_INFINITY, { window })).toThrow(TypeError);
		expect(() => printScene(SVG, { widthMm: 5, heightMm: -1 }, { window })).toThrow(TypeError);
	});
});

describe('the platform, where it is missing', () => {
	it('says a download cannot happen with no object URLs, and a copy with no navigator', async () => {
		const page = fakeDocument();
		vi.stubGlobal('document', page.document);
		vi.stubGlobal('URL', {});
		expect(downloadBlob(new Blob(['x']), 'x.svg')).toMatchObject({ ok: false });
		vi.stubGlobal('navigator', undefined);
		expect(await copyText('x')).toMatchObject({ ok: false });
	});
});
