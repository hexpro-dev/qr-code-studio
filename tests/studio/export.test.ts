/**
 * Exports: the same bytes render writes for the same scene, sizes worked out
 * the way a print shop expects, names that are never the content, and every
 * refusal as a Result.
 */

import { describe, expect, it } from 'vitest';
import { PNG } from 'pngjs';
import { QrStudioError } from '../../src/core/errors.js';
import { err, ok } from '../../src/core/result.js';
import { applyConstraints } from '../../src/design/constraints.js';
import { buildScene } from '../../src/design/scene.js';
import { createDesignRegistries } from '../../src/design/registries.js';
import { encode } from '../../src/encode/encode.js';
import { sceneToEps } from '../../src/render/eps.js';
import { sceneToPdf } from '../../src/render/pdf.js';
import { encodePng } from '../../src/render/png.js';
import { rasterise } from '../../src/render/raster.js';
import { sceneToSvg } from '../../src/render/svg.js';
import type { RgbaImage } from '../../src/core/image.js';
import type { SceneNode } from '../../src/render/types.js';
import { exportName, fileStem } from '../../src/studio/names.js';
import { EXPORT_MAX_PIXELS } from '../../src/studio/export.js';
import type { RasterEncoder } from '../../src/studio/types.js';
import { studioWith, studioWithCode } from './helpers.js';

const SECRET = 'https://example.com/private-document-0451';
const registries = createDesignRegistries();

function sceneFor(
	content: string,
	design = studioWithCode().studio.getSnapshot().design.effective,
) {
	return buildScene(encode(content, { symbology: 'qr', ecLevel: 'M' }), design, {
		registries,
		seed: 1,
	}).scene;
}

describe('svg and png', () => {
	it('are byte for byte what render writes for the same scene', async () => {
		const { studio } = studioWithCode({}, SECRET);
		const svg = await studio.run({ type: 'export', format: 'svg', options: {} });
		expect(svg.ok).toBe(true);
		if (!svg.ok) return;
		const scene = sceneFor(SECRET);
		expect(svg.value.bytes).toEqual(new TextEncoder().encode(sceneToSvg(scene)));
		expect(svg.value).toMatchObject({
			filename: 'qr-code.svg',
			mime: 'image/svg+xml',
			width: scene.width,
		});

		const png = await studio.run({ type: 'export', format: 'png', options: { widthPx: 330 } });
		expect(png.ok).toBe(true);
		if (!png.ok) return;
		expect(png.value.bytes).toEqual(encodePng(rasterise(scene, { width: 330 })));
		expect(png.value).toMatchObject({
			filename: 'qr-code.png',
			mime: 'image/png',
			width: 330,
			height: 330,
		});
	});

	it('lands every module on whole pixels when no size is asked for', async () => {
		const { studio } = studioWithCode();
		const png = await studio.run({ type: 'export', format: 'png', options: {} });
		if (!png.ok) throw png.error;
		const modules = studio.getSnapshot().preview?.scene.width as number;
		expect(png.value.width % modules).toBe(0);
		expect(png.value.width).toBeGreaterThanOrEqual(1024);
	});

	it('draws a physical size at a dpi, and records the dpi in the PNG', async () => {
		const { studio } = studioWithCode();
		const png = await studio.run({
			type: 'export',
			format: 'png',
			options: { sizeMm: 25.4, dpi: 300 },
		});
		if (!png.ok) throw png.error;
		expect(png.value.width).toBe(300);
		const decoded = PNG.sync.read(Buffer.from(png.value.bytes));
		expect(decoded.width).toBe(300);
		// pHYs: 300 dpi is 11811 pixels a metre.
		const bytes = png.value.bytes;
		const at = Buffer.from(bytes).indexOf('pHYs');
		expect(at).toBeGreaterThan(0);
		expect(Buffer.from(bytes).readUInt32BE(at + 4)).toBe(11811);
		// A size in the design works the same way; the default dpi is 300.
		studio.dispatch({ type: 'design/patch', patch: { path: ['output', 'sizeMm'], value: 50.8 } });
		const fromDesign = await studio.run({ type: 'export', format: 'png', options: {} });
		expect(fromDesign.ok && fromDesign.value.width).toBe(600);
		// A dpi alone, with no size, is only recorded.
		studio.dispatch({
			type: 'design/patch',
			patch: { path: ['output', 'sizeMm'], value: undefined },
		});
		const dpiOnly = await studio.run({
			type: 'export',
			format: 'png',
			options: { dpi: 150, widthPx: 100 },
		});
		expect(
			dpiOnly.ok &&
				Buffer.from(dpiOnly.value.bytes).readUInt32BE(
					Buffer.from(dpiOnly.value.bytes).indexOf('pHYs') + 4,
				),
		).toBe(5906);
	});

	it("takes a quiet zone in place of the design's, warning below the minimum", async () => {
		const { studio } = studioWithCode();
		const wide = await studio.run({ type: 'export', format: 'svg', options: { quietZone: 8 } });
		const narrow = await studio.run({ type: 'export', format: 'svg', options: { quietZone: 1 } });
		if (!wide.ok || !narrow.ok) throw new Error('export failed');
		expect(wide.value.width).toBe(25 + 16);
		expect(wide.value.issues).toEqual([]);
		expect(narrow.value.width).toBe(25 + 2);
		expect(narrow.value.issues).toEqual([
			{
				code: 'studio.issue.quiet-zone-below-minimum',
				path: ['options', 'quietZone'],
				severity: 'warning',
				params: { min: 4 },
			},
		]);
	});

	it('leaves out an option that does not fit, saying which', async () => {
		const { studio } = studioWithCode();
		const result = await studio.run({
			type: 'export',
			format: 'png',
			options: {
				widthPx: -3,
				sizeMm: 0,
				dpi: 99999,
				colourSpace: 'rgb' as never,
				bleedMm: 100,
				cropMarks: 'yes' as never,
				quietZone: 2.5,
				quality: 2,
			},
		});
		if (!result.ok) throw result.error;
		expect(result.value.issues.map((found) => found.path[1]).sort()).toEqual(
			[
				'bleedMm',
				'colourSpace',
				'cropMarks',
				'dpi',
				'quality',
				'quietZone',
				'sizeMm',
				'widthPx',
			].sort(),
		);
		expect(result.value.issues.every((found) => found.code === 'studio.issue.export-option')).toBe(
			true,
		);
		const none = await studio.run({ type: 'export', format: 'svg', options: undefined as never });
		expect(none.ok).toBe(true);
	});

	it('refuses a raster larger than it will draw, with the numbers', async () => {
		const { studio } = studioWithCode();
		const result = await studio.run({
			type: 'export',
			format: 'png',
			options: { sizeMm: 2000, dpi: 2400 },
		});
		expect(result.ok).toBe(false);
		expect(!result.ok && result.error.code).toBe('render/surface-too-large');
		expect(!result.ok && result.error.params.maxPixels).toBe(EXPORT_MAX_PIXELS);
	});
});

describe('jpeg and webp', () => {
	function recording(answer: (format: string) => ReturnType<RasterEncoder['encode']>) {
		const calls: { image: RgbaImage; format: string; quality: number | undefined }[] = [];
		const encoder: RasterEncoder = {
			encode(image, format, options) {
				calls.push({ image, format, quality: options.quality });
				return answer(format);
			},
		};
		return { encoder, calls };
	}

	it('go through the injected encoder, JPEG onto white', async () => {
		const { encoder, calls } = recording(async () => ok(new Uint8Array([0xff, 0xd8, 0xff])));
		const { studio } = studioWithCode({ rasterEncoder: encoder });
		studio.dispatch({ type: 'design/patch', patch: { path: ['background'], value: null } });
		const jpeg = await studio.run({
			type: 'export',
			format: 'jpeg',
			options: { widthPx: 66, quality: 0.8 },
		});
		expect(jpeg.ok && jpeg.value).toMatchObject({
			filename: 'qr-code.jpg',
			mime: 'image/jpeg',
			width: 66,
		});
		expect(calls[0]?.quality).toBe(0.8);
		expect(Array.from(calls[0]?.image.data.slice(0, 4) ?? [])).toEqual([255, 255, 255, 255]);
		const webp = await studio.run({ type: 'export', format: 'webp', options: { widthPx: 66 } });
		expect(webp.ok && webp.value.mime).toBe('image/webp');
		expect(calls[1]?.image.data[3]).toBe(0);
	});

	it("pass on the encoder's refusal, and are unavailable without one", async () => {
		const refusal = new QrStudioError('render/format-unavailable', 'no', {
			format: 'webp',
			reason: 'substituted',
		});
		const { encoder } = recording(async () => err(refusal));
		const { studio } = studioWithCode({ rasterEncoder: encoder });
		const refused = await studio.run({ type: 'export', format: 'webp', options: {} });
		expect(!refused.ok && refused.error).toBe(refusal);
		const bare = studioWithCode().studio;
		const unavailable = await bare.run({ type: 'export', format: 'jpeg', options: {} });
		expect(!unavailable.ok && unavailable.error.code).toBe('render/format-unavailable');
	});
});

describe('pdf and eps', () => {
	it("are render's writers at the printed size, from the conditions when nothing else gives one", async () => {
		const { studio } = studioWithCode({}, SECRET);
		studio.dispatch({ type: 'conditions', conditions: { sizeMm: 30 } });
		const pdf = await studio.run({
			type: 'export',
			format: 'pdf',
			options: { bleedMm: 3, cropMarks: true },
		});
		if (!pdf.ok) throw pdf.error;
		expect(pdf.value).toMatchObject({
			filename: 'qr-code.pdf',
			mime: 'application/pdf',
			width: 30,
			height: 30,
		});
		const sized = {
			...studio.getSnapshot().design.effective,
			output: { colourSpace: 'srgb' as const, sizeMm: 30 },
		};
		const scene = sceneFor(SECRET, sized);
		expect(pdf.value.bytes).toEqual(
			sceneToPdf(scene, {
				colour: 'srgb',
				widthMm: 30,
				heightMm: 30,
				bleedMm: 3,
				cropMarks: true,
				title: 'QR code',
			}),
		);
		const eps = await studio.run({
			type: 'export',
			format: 'eps',
			options: { colourSpace: 'cmyk' },
		});
		if (!eps.ok) throw eps.error;
		expect(eps.value).toMatchObject({ filename: 'qr-code.eps', mime: 'application/postscript' });
		expect(new TextDecoder().decode(eps.value.bytes)).toBe(
			sceneToEps(scene, { colour: 'cmyk', widthMm: 30 }),
		);
		// With no conditions either, 25 mm.
		studio.dispatch({ type: 'conditions', conditions: { sizeMm: null } });
		const fallback = await studio.run({ type: 'export', format: 'pdf', options: {} });
		expect(fallback.ok && fallback.value.width).toBe(25);
	});

	it('say up front, and on export, that EPS cannot carry a translucent design', async () => {
		const { studio } = studioWithCode();
		expect(studio.getSnapshot().preview?.epsIssues).toEqual([]);
		studio.dispatch({
			type: 'design/patch',
			patch: { path: ['background'], value: { kind: 'solid', ink: '#ffffff80' } },
		});
		expect(studio.getSnapshot().preview?.epsIssues.map((found) => found.code)).toEqual([
			'render.eps.transparency',
		]);
		const eps = await studio.run({ type: 'export', format: 'eps', options: {} });
		expect(!eps.ok && eps.error.code).toBe('render/format-unavailable');
		expect(!eps.ok && eps.error.params).toMatchObject({ format: 'eps', reason: 'transparency' });
	});

	it('are left out when the printer is', async () => {
		const { studio } = studioWithCode({ printer: null });
		const pdf = await studio.run({ type: 'export', format: 'pdf', options: {} });
		expect(!pdf.ok && pdf.error.code).toBe('render/format-unavailable');
	});

	it('keep the size the content fixes: the Swiss QR-bill is 46 mm', async () => {
		const { studio } = studioWith();
		studio.dispatch({ type: 'payload/type', typeId: 'swiss-qr-bill' });
		const vector = (await import('../../src/payload/vectors/swiss-qr-bill.js'))
			.swissQrBillVectors[0];
		studio.dispatch({ type: 'payload/raw', text: vector?.text as string });
		expect(studio.getSnapshot().symbol.status).toBe('ok');
		const pdf = await studio.run({ type: 'export', format: 'pdf', options: { sizeMm: 30 } });
		if (!pdf.ok) throw pdf.error;
		// 46 mm is the symbol alone, without its quiet zone: the page is that and the zone.
		const { symbol } = studio.getSnapshot();
		const modules = symbol.status === 'ok' ? symbol.view.modules[0] : 0;
		expect(pdf.value.width).toBeCloseTo((46 * (modules + 8)) / modules);
		expect(pdf.value.issues.map((found) => found.code)).toContain(
			'studio.issue.export-size-constrained',
		);
		// Every picture of the bill carries its cross: the preview, the export and the scan check's job.
		const roles = (nodes: readonly SceneNode[]): string[] =>
			nodes.flatMap((node) =>
				node.kind === 'group'
					? roles(node.children)
					: node.kind === 'path'
						? [node.role ?? '']
						: [],
			);
		const preview = studio.getSnapshot().preview;
		expect(roles(preview?.scene.layers ?? [])).toContain('swiss-cross');
		const svg = await studio.run({ type: 'export', format: 'svg', options: {} });
		expect(svg.ok && new TextDecoder().decode(svg.value.bytes)).toBe(preview?.svg);
		const same = await studio.run({ type: 'export', format: 'pdf', options: { sizeMm: 46 } });
		expect(same.ok && same.value.issues.map((found) => found.code)).not.toContain(
			'studio.issue.export-size-constrained',
		);
		expect(applyConstraints).toBeTypeOf('function');
	});

	it('report a writer that throws as a failed export', async () => {
		const printer = {
			pdf: () => {
				throw new QrStudioError('render/surface-too-large', 'too big', { maxMm: 5080 });
			},
			eps: () => {
				throw new Error('broken writer');
			},
		};
		const { studio } = studioWithCode({ printer });
		const pdf = await studio.run({ type: 'export', format: 'pdf', options: {} });
		expect(!pdf.ok && pdf.error.code).toBe('render/surface-too-large');
		const eps = await studio.run({ type: 'export', format: 'eps', options: {} });
		expect(!eps.ok && eps.error.code).toBe('render/format-unavailable');
	});
});

describe('when there is no code to export', () => {
	it('fails with the reason rather than saving the stale code', async () => {
		const { studio } = studioWithCode();
		studio.dispatch({ type: 'payload/field', key: 'url', value: 'nope' });
		const invalid = await studio.run({ type: 'export', format: 'svg', options: {} });
		expect(!invalid.ok && invalid.error.code).toBe('payload/invalid');
		studio.dispatch({ type: 'payload/type', typeId: 'text' });
		studio.dispatch({ type: 'payload/field', key: 'text', value: 'x'.repeat(5000) });
		const long = await studio.run({ type: 'export', format: 'svg', options: {} });
		expect(!long.ok && long.error.code).toBe('encode/too-much-data');
	});

	it("refuses a format it does not know as a caller's mistake", async () => {
		const { studio } = studioWithCode();
		await expect(
			studio.run({ type: 'export', format: 'gif' as never, options: {} }),
		).rejects.toThrow(TypeError);
	});

	it('reports a scene that cannot be built', async () => {
		const reg = (await import('../../src/registries.js')).createRegistries();
		reg.design.moduleShapes.register({
			id: 'explodes',
			labelKey: 'design.module.square',
			params: [],
			connects: false,
			path() {
				throw new QrStudioError('design/invalid', 'boom');
			},
		});
		const { studio } = studioWithCode({ registries: reg });
		studio.dispatch({
			type: 'design/patch',
			patch: { path: ['modules', 'shape'], value: { id: 'explodes' } },
		});
		const result = await studio.run({ type: 'export', format: 'svg', options: {} });
		expect(!result.ok && result.error.code).toBe('design/invalid');
		// And the preview, rather than throwing out of a snapshot, has no picture.
		expect(studio.getSnapshot().preview).toBeNull();
		expect(studio.getSnapshot().symbol.status).toBe('ok');
	});
});

describe('file names', () => {
	it('are never the content', async () => {
		const { studio } = studioWithCode({}, SECRET);
		for (const format of ['svg', 'png', 'pdf', 'eps'] as const) {
			const result = await studio.run({ type: 'export', format, options: { widthPx: 100 } });
			if (!result.ok) throw result.error;
			expect(result.value.filename).toBe(`qr-code.${format}`);
			expect(result.value.filename).not.toContain('private');
		}
	});

	it("come from the design's name, cleaned of anything a file system reads as structure", async () => {
		const { studio } = studioWithCode();
		studio.dispatch({
			type: 'design/patch',
			patch: { path: ['name'], value: 'Shop / window: caf\u00e9' },
		});
		const result = await studio.run({ type: 'export', format: 'svg', options: {} });
		expect(result.ok && result.value.filename).toBe('Shop window caf\u00e9.svg');
		expect(fileStem('../../etc/passwd')).toBe('etc passwd');
		expect(fileStem('...')).toBe('qr-code');
		expect(fileStem('   ')).toBe('qr-code');
		expect(fileStem(undefined)).toBe('qr-code');
		expect(fileStem('a'.repeat(100))).toHaveLength(64);
		expect(fileStem('\u0007bell\u0000')).toBe('bell');
		expect(exportName('Menu', 'pdf')).toBe('Menu.pdf');
	});
});
