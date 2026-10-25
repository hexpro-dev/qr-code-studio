/**
 * Running a batch: the ZIP reads back in yauzl with every entry the bytes of
 * that row drawn on its own, PNGs decode in pngjs and read in zxing-cpp, PDFs
 * and label sheets render in Poppler and read (skipped without it), EPS falls
 * back to PDF for transparency, the manifest says what happened, the bytes
 * are the same every time, and per-row verification runs as asked through an
 * injected checker.
 */

import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { parseCsv } from '../../src/batch/csv.js';
import { planBatch } from '../../src/batch/plan.js';
import {
	DEFAULT_PRINT_SIZE_MM,
	DEFAULT_WIDTH_PX,
	SMALL_BATCH,
	errorIssue,
	runBatch,
} from '../../src/batch/run.js';
import type {
	BatchMapping,
	BatchOutput,
	BatchRow,
	BatchVerifier,
	BatchVerifyRequest,
} from '../../src/batch/types.js';
import { QrStudioError, TooMuchDataError } from '../../src/core/errors.js';
import { Registry } from '../../src/core/registry.js';
import { writeZip } from '../../src/core/zip.js';
import { base64Encode } from '../../src/design/base64.js';
import { applyConstraints } from '../../src/design/constraints.js';
import { defaultDesign } from '../../src/design/document.js';
import { buildScene } from '../../src/design/scene.js';
import type { FrameEntry, QrDesignV1 } from '../../src/design/types.js';
import { encode } from '../../src/encode/encode.js';
import { sceneToEps } from '../../src/render/eps.js';
import { sceneToPdf } from '../../src/render/pdf.js';
import { encodePng } from '../../src/render/png.js';
import { rasterise } from '../../src/render/raster.js';
import { builtInSheets } from '../../src/render/sheets.js';
import { sceneToSvg } from '../../src/render/svg.js';
import { createFontRegistry } from '../../src/text/registry.js';
import type { Scene } from '../../src/render/types.js';
import type { SymbologyEntry } from '../../src/symbology/types.js';
import { assetOf, designWith, discImage } from '../design/helpers.js';
import { zxingTexts } from '../helpers/oracles.js';
import {
	NEEDS_PDFTOPPM,
	PDFTOPPM,
	contentStreams,
	popplerRender,
	readPdf,
} from '../render/pdf-tools.js';
import { drain, readZip, registries, utf8Text } from './helpers.js';

const reg = registries();

const CSV =
	'sku,name\r\n' +
	'EX-001,Example Mug\r\n' +
	'EX-002,Example Plate\r\n' +
	',\r\n' +
	'EX-003,"=HYPERLINK(""https://example.com"")"\r\n' +
	'EX-001,Example Mug again\r\n';

const LINKS: BatchMapping = {
	typeId: 'url',
	fields: { url: { template: 'https://example.com/p/{sku}' } },
	filename: 'label-{sku}',
};

function rows(csv = CSV, mapping = LINKS): readonly BatchRow[] {
	return planBatch(parseCsv(csv), mapping, reg);
}

function run(
	batch: readonly BatchRow[],
	output: BatchOutput,
	design: QrDesignV1 = defaultDesign(),
	options: Parameters<typeof runBatch>[4] = {},
	registriesBag = reg,
) {
	return drain(runBatch(batch, design, output, registriesBag, options));
}

/** The scene for one content in one design, drawn as the studio draws a single code. */
function sceneAlone(content: string, design: QrDesignV1, seed = 0): Scene {
	const symbol = encode(content, {
		symbology: design.symbol.symbology,
		...(design.symbol.ecLevel === undefined ? {} : { ecLevel: design.symbol.ecLevel }),
		...(design.symbol.maxVersion === undefined ? {} : { maxVersion: design.symbol.maxVersion }),
		...(design.symbol.segmentation === undefined
			? {}
			: { segmentation: design.symbol.segmentation }),
	});
	return buildScene(symbol, design, { registries: reg.design, seed }).scene;
}

function sized(
	design: QrDesignV1,
	sizeMm: number,
	extra: Partial<QrDesignV1['output']> = {},
): QrDesignV1 {
	return { ...design, output: { ...design.output, sizeMm, ...extra } };
}

function widthMm(scene: Scene): number {
	return scene.width / (scene.unitsPerMm as number);
}

describe('a ZIP of SVGs', () => {
	const batch = rows();
	const { bytes, outcomes, progress } = run(batch, { kind: 'zip', format: 'svg' });

	it('reads back in yauzl, one entry a written row and the manifest last', async () => {
		const entries = await readZip(bytes);
		expect(entries.map((entry) => entry.name)).toEqual([
			'label-EX-001.svg',
			'label-EX-002.svg',
			'label-EX-003.svg',
			'label-EX-001-2.svg',
			'manifest.csv',
		]);
		expect(entries.every((entry) => entry.compressed)).toBe(true);
	});

	it('holds each row exactly as that code drawn on its own', async () => {
		const entries = await readZip(bytes);
		const contents = batch
			.filter((row) => row.content !== null)
			.map((row) => row.content as string);
		contents.forEach((content, i) => {
			const alone = new TextEncoder().encode(sceneToSvg(sceneAlone(content, defaultDesign())));
			expect(entries[i]?.bytes).toEqual(alone);
		});
	});

	it('writes the manifest: every row, no content, the skipped one with why', async () => {
		const entries = await readZip(bytes);
		const manifest = parseCsv(utf8Text(entries[4]?.bytes as Uint8Array));
		expect(manifest.headers).toEqual(['row', 'file', 'type', 'status', 'check', 'issues']);
		expect(manifest.rows).toEqual([
			['2', 'label-EX-001.svg', 'url', 'written', '', ''],
			['3', 'label-EX-002.svg', 'url', 'written', '', ''],
			['4', '', 'url', 'skipped', '', 'batch.issue.empty-row'],
			['5', 'label-EX-003.svg', 'url', 'written', '', ''],
			['6', 'label-EX-001-2.svg', 'url', 'written', '', ''],
		]);
		expect(utf8Text(entries[4]?.bytes as Uint8Array)).not.toContain('example.com');
	});

	it('reports progress one row at a time, with the outcome of each', () => {
		expect(progress.map((event) => [event.done, event.total])).toEqual([
			[1, 6],
			[2, 6],
			[3, 6],
			[4, 6],
			[5, 6],
		]);
		expect(outcomes.map((outcome) => outcome.status)).toEqual([
			'written',
			'written',
			'skipped',
			'written',
			'written',
		]);
		expect(outcomes[2]).toEqual({
			index: 2,
			rowNumber: 4,
			typeId: 'url',
			filename: null,
			status: 'skipped',
			check: null,
			sheet: null,
			issues: batch[2]?.issues,
		});
		expect(Object.isFrozen(outcomes[0])).toBe(true);
	});

	it("gives the same bytes every time, and core's ZIP for the same entries", async () => {
		expect(run(batch, { kind: 'zip', format: 'svg' }).bytes).toEqual(bytes);
		const entries = await readZip(bytes);
		expect(
			writeZip(entries.map((entry) => ({ name: entry.name, bytes: entry.bytes, compress: true }))),
		).toEqual(bytes);
		const dated = run(batch, { kind: 'zip', format: 'svg' }, defaultDesign(), {
			date: { year: 2026, month: 10, day: 26 },
		});
		expect(dated.bytes).not.toEqual(bytes);
		expect(dated.bytes.length).toBe(bytes.length);
	});

	it('writes the content into the manifest only when asked, formulas neutralised', async () => {
		const table = parseCsv('sku,name\nEX-1,=1+1\n');
		const textRows = planBatch(
			table,
			{ typeId: 'text', fields: { text: { column: 'name' } }, filename: '{name}' },
			reg,
		);
		const { bytes: zipped } = run(textRows, { kind: 'zip', format: 'svg', includeContent: true });
		const entries = await readZip(zipped);
		expect(entries.map((entry) => entry.name)).toEqual(['=1+1.svg', 'manifest.csv']);
		const manifest = parseCsv(utf8Text(entries[1]?.bytes as Uint8Array));
		expect(manifest.rows[0]).toEqual(['2', "'=1+1.svg", 'text', 'written', '', '', "'=1+1"]);
	});
});

describe('a ZIP of PNGs', () => {
	const batch = rows();

	it('decodes in pngjs, reads in zxing-cpp, and matches each code drawn alone', async () => {
		const { bytes } = run(batch, { kind: 'zip', format: 'png', widthPx: 300 });
		const entries = (await readZip(bytes)).filter((entry) => entry.name.endsWith('.png'));
		expect(entries).toHaveLength(4);
		const contents = batch
			.filter((row) => row.content !== null)
			.map((row) => row.content as string);
		for (const [i, entry] of entries.entries()) {
			const content = contents[i] as string;
			expect(entry.compressed).toBe(false);
			const image = rasterise(sceneAlone(content, defaultDesign()), { width: 300 });
			expect(entry.bytes).toEqual(encodePng(image));
			const decoded = PNG.sync.read(Buffer.from(entry.bytes));
			expect([decoded.width, decoded.height]).toEqual([300, 300]);
			const texts = await zxingTexts({
				width: decoded.width,
				height: decoded.height,
				data: new Uint8ClampedArray(decoded.data),
			});
			expect(texts).toEqual([content]);
		}
	});

	it('sizes a PNG from the print size and resolution, and writes the resolution', async () => {
		const [first] = rows();
		const { bytes } = run([first as BatchRow], {
			kind: 'zip',
			format: 'png',
			sizeMm: 30,
			dpi: 300,
		});
		const [entry] = await readZip(bytes);
		const decoded = PNG.sync.read(Buffer.from(entry?.bytes as Uint8Array));
		expect(decoded.width).toBe(Math.round((30 * 300) / 25.4));
		const alone = sceneAlone(first?.content as string, sized(defaultDesign(), 30, { dpi: 300 }));
		expect(entry?.bytes).toEqual(
			encodePng(rasterise(alone, { width: decoded.width }), { dpi: 300 }),
		);
		// The resolution can come from the design, and a tiny size still makes a usable file.
		const small = run(
			[first as BatchRow],
			{ kind: 'zip', format: 'png', sizeMm: 5 },
			sized(defaultDesign(), 30, { dpi: 72 }),
		);
		const tiny = PNG.sync.read(Buffer.from((await readZip(small.bytes))[0]?.bytes as Uint8Array));
		expect(tiny.width).toBe(16);
	});

	it('is 1024 pixels wide when nothing says otherwise', async () => {
		const [first] = rows();
		const { bytes } = run([first as BatchRow], { kind: 'zip', format: 'png' });
		const decoded = PNG.sync.read(Buffer.from((await readZip(bytes))[0]?.bytes as Uint8Array));
		expect(decoded.width).toBe(DEFAULT_WIDTH_PX);
	});
});

describe('a ZIP of PDFs and EPS files', () => {
	const batch = rows();
	const contents = batch.filter((row) => row.content !== null).map((row) => row.content as string);

	it('writes each PDF as the code alone at its true size, 30 mm by default', async () => {
		const { bytes } = run(batch, { kind: 'zip', format: 'pdf' });
		const entries = (await readZip(bytes)).filter((entry) => entry.name.endsWith('.pdf'));
		expect(entries).toHaveLength(4);
		entries.forEach((entry, i) => {
			const scene = sceneAlone(
				contents[i] as string,
				sized(defaultDesign(), DEFAULT_PRINT_SIZE_MM),
			);
			expect(entry.bytes).toEqual(sceneToPdf(scene, { colour: 'srgb', widthMm: widthMm(scene) }));
			readPdf(entry.bytes);
		});
	});

	it.skipIf(PDFTOPPM === null)(
		`renders each PDF in Poppler, and the render reads${NEEDS_PDFTOPPM}`,
		async () => {
			const { bytes } = run(batch, { kind: 'zip', format: 'pdf', sizeMm: 40, colourSpace: 'cmyk' });
			const entries = (await readZip(bytes)).filter((entry) => entry.name.endsWith('.pdf'));
			for (const [i, entry] of entries.entries()) {
				const { image } = popplerRender(entry.bytes, 200);
				expect(await zxingTexts(image)).toEqual([contents[i]]);
			}
			expect(contentStreams(readPdf(entries[0]?.bytes as Uint8Array)).join('\n')).toContain(
				'0 0 0 1 k',
			);
		},
	);

	it('writes EPS for an opaque design, compressed', async () => {
		const { bytes } = run(batch, { kind: 'zip', format: 'eps', sizeMm: 25 });
		const entries = (await readZip(bytes)).filter((entry) => entry.name.endsWith('.eps'));
		expect(entries).toHaveLength(4);
		const scene = sceneAlone(contents[0] as string, sized(defaultDesign(), 25));
		expect(utf8Text(entries[0]?.bytes as Uint8Array)).toBe(
			sceneToEps(scene, { colour: 'srgb', widthMm: widthMm(scene) }),
		);
		expect(entries[0]?.compressed).toBe(true);
	});

	it('falls back to PDF for a design with transparency, saying so on each row', async () => {
		const clear = designWith({ background: { kind: 'solid', ink: '#ffffff80' } });
		const { bytes, outcomes } = run(batch, { kind: 'zip', format: 'eps' }, clear);
		const entries = await readZip(bytes);
		expect(entries.map((entry) => entry.name)).toEqual([
			'label-EX-001.pdf',
			'label-EX-002.pdf',
			'label-EX-003.pdf',
			'label-EX-001-2.pdf',
			'manifest.csv',
		]);
		const written = outcomes.filter((outcome) => outcome.status === 'written');
		for (const outcome of written) {
			expect(outcome.issues.map((found) => found.code)).toContain('batch.issue.eps-fallback');
		}
		const manifest = parseCsv(utf8Text(entries[4]?.bytes as Uint8Array));
		expect(manifest.rows[0]?.[5]).toBe('batch.issue.eps-fallback');
	});
});

describe('label sheets', () => {
	const batch = rows();
	const contents = batch.filter((row) => row.content !== null).map((row) => row.content as string);

	it('lays codes out at their true size and numbers each label', () => {
		const { bytes, outcomes } = run(batch, {
			kind: 'sheet',
			template: 'a4-21-63x38',
			colourSpace: 'srgb',
			sizeMm: 30,
		});
		const pdf = readPdf(bytes);
		expect(pdf.version).toBeDefined();
		expect(outcomes.map((outcome) => outcome.sheet)).toEqual([
			{ page: 1, label: 1 },
			{ page: 1, label: 2 },
			null,
			{ page: 1, label: 3 },
			{ page: 1, label: 4 },
		]);
		expect(outcomes.every((outcome) => outcome.filename === null)).toBe(true);
		expect(
			run(batch, { kind: 'sheet', template: 'a4-21-63x38', colourSpace: 'srgb', sizeMm: 30 }).bytes,
		).toEqual(bytes);
	});

	it.skipIf(PDFTOPPM === null)(
		`renders in Poppler, and every code on the sheet reads${NEEDS_PDFTOPPM}`,
		async () => {
			const { bytes } = run(batch, {
				kind: 'sheet',
				template: 'a4-21-63x38',
				colourSpace: 'cmyk',
				sizeMm: 30,
			});
			const { image } = popplerRender(bytes, 150);
			const texts = await zxingTexts(image);
			expect([...texts].sort()).toEqual([...contents].sort());
			expect(contentStreams(readPdf(bytes)).join('\n')).toContain('0 0 0 1 k');
		},
	);

	it('carries a label too small for its code onto the row', () => {
		const { outcomes } = run(batch, {
			kind: 'sheet',
			template: 'a4-21-63x38',
			colourSpace: 'srgb',
			sizeMm: 40,
		});
		const written = outcomes.filter((outcome) => outcome.status === 'written');
		for (const outcome of written) {
			expect(outcome.issues).toContainEqual({
				code: 'sheet.cell-too-small',
				path: [],
				severity: 'warning',
				params: { widthMm: 40, heightMm: 40 },
			});
		}
	});

	it("titles the sheet with the design's name", () => {
		const named = designWith({ name: 'Example labels' });
		const { bytes } = run(
			batch,
			{ kind: 'sheet', template: 'a4-21-63x38', colourSpace: 'srgb', sizeMm: 30 },
			named,
		);
		const pdf = readPdf(bytes);
		expect(pdf.objects.get(pdf.info)?.text).toContain('(Example labels)');
	});

	it('starts after labels already used, onto the next sheet', () => {
		const { bytes, outcomes } = run(batch, {
			kind: 'sheet',
			template: 'a4-21-63x38',
			colourSpace: 'srgb',
			sizeMm: 30,
			skip: 19,
		});
		expect(outcomes.flatMap((outcome) => (outcome.sheet === null ? [] : [outcome.sheet]))).toEqual([
			{ page: 1, label: 20 },
			{ page: 1, label: 21 },
			{ page: 2, label: 1 },
			{ page: 2, label: 2 },
		]);
		const pages = [...readPdf(bytes).objects.values()].filter((object) =>
			/\/Type \/Page\b/.test(object.text),
		);
		expect(pages).toHaveLength(2);
	});

	it("fills each label when there is no size, and takes a template of the caller's own", () => {
		const template = builtInSheets().find((sheet) => sheet.id === 'a4-8-99x68');
		const requests: BatchVerifyRequest[] = [];
		const verifyRow: BatchVerifier = (request) => {
			requests.push(request);
			return { verdict: 'pass' };
		};
		const { outcomes } = run(
			batch,
			{
				kind: 'sheet',
				template: template as NonNullable<typeof template>,
				colourSpace: 'srgb',
				verify: 'all',
			},
			defaultDesign(),
			{ verifyRow },
		);
		expect(outcomes.filter((outcome) => outcome.status === 'written')).toHaveLength(4);
		// A square code fills the label's height: 67.7 mm.
		for (const request of requests) {
			expect(request.sizeMm).toBeCloseTo(67.7, 9);
			expect(request.design.output.sizeMm).toBeCloseTo(67.7, 9);
		}
		expect(requests).toHaveLength(4);
	});

	it('refuses a template it does not have, and a skip as long as a sheet', () => {
		expect(() =>
			runBatch(
				batch,
				defaultDesign(),
				{ kind: 'sheet', template: 'a4-1-huge', colourSpace: 'srgb' },
				reg,
			),
		).toThrow(QrStudioError);
		expect(() =>
			runBatch(
				batch,
				defaultDesign(),
				{ kind: 'sheet', template: 'a4-21-63x38', colourSpace: 'srgb', skip: 21 },
				reg,
			),
		).toThrow(TypeError);
		expect(() =>
			runBatch(
				batch,
				defaultDesign(),
				{ kind: 'sheet', template: { id: 'Bad' } as never, colourSpace: 'srgb' },
				reg,
			),
		).toThrow(TypeError);
	});
});

describe('content and designs', () => {
	it('draws each content type in its constrained design, and says what the constraint changed', async () => {
		const table = parseCsv('name,iban,amount\nExample,DE89370400440532013000,12.30\n');
		const epc = planBatch(
			table,
			{
				typeId: 'epc',
				fields: {
					name: { column: 'name' },
					iban: { column: 'iban' },
					amount: { column: 'amount' },
				},
				filename: 'pay-{name}',
			},
			reg,
		);
		const high = designWith({ symbol: { symbology: 'qr', ecLevel: 'H' } });
		const { bytes, outcomes } = run(epc, { kind: 'zip', format: 'svg' }, high);
		expect(outcomes[0]?.issues.map((found) => found.code)).toContain(
			'design.issue.ec-level-constrained',
		);
		const [entry] = await readZip(bytes);
		const constrained = applyConstraints(high, reg.payloads.require('epc').constraints).design;
		expect(constrained.symbol.ecLevel).toBe('M');
		expect(entry?.bytes).toEqual(
			new TextEncoder().encode(sceneToSvg(sceneAlone(epc[0]?.content as string, constrained))),
		);
	});

	it("encodes with every symbol setting the design gives, and the encoder's defaults for the rest", async () => {
		const [first] = rows();
		const settings = {
			symbology: 'qr',
			ecLevel: 'L',
			boostEc: true,
			minVersion: '3',
			maxVersion: '10',
			mask: 5,
			segmentation: { eci: 'never' },
		} as const;
		const tuned = designWith({ symbol: settings });
		const { bytes } = run([first as BatchRow], { kind: 'zip', format: 'svg' }, tuned);
		const symbol = encode(first?.content as string, settings);
		expect([symbol.version, symbol.mask, symbol.ecLevel]).toEqual(['3', 5, 'Q']);
		const alone = buildScene(symbol, tuned, { registries: reg.design }).scene;
		expect((await readZip(bytes))[0]?.bytes).toEqual(new TextEncoder().encode(sceneToSvg(alone)));
		const bare = designWith({ symbol: { symbology: 'qr' } });
		const plain = run([first as BatchRow], { kind: 'zip', format: 'svg' }, bare);
		const defaults = buildScene(encode(first?.content as string), bare, {
			registries: reg.design,
		}).scene;
		expect((await readZip(plain.bytes))[0]?.bytes).toEqual(
			new TextEncoder().encode(sceneToSvg(defaults)),
		);
	});

	it("skips a row too long for the design, with the encoder's own key", () => {
		const long = `sku\nEX-1\n${'X'.repeat(200)}\n`;
		const batch = rows(long, { ...LINKS, filename: 'f' });
		const small = designWith({ symbol: { symbology: 'qr', ecLevel: 'M', maxVersion: '2' } });
		const { outcomes } = run(batch, { kind: 'zip', format: 'svg' }, small);
		expect(outcomes.map((outcome) => outcome.status)).toEqual(['written', 'skipped']);
		const found = outcomes[1]?.issues.find((i) => i.code === 'encode.too-much-data');
		expect(found?.severity).toBe('error');
		expect(Object.keys(found?.params ?? {}).sort()).toEqual(['bitsAvailable', 'bitsNeeded']);
	});

	it("draws a logo from the design's own picture, and goes on without one that will not decode", async () => {
		const [first] = rows();
		const asset = assetOf(discImage(16));
		const logo: QrDesignV1['logo'] = {
			source: { kind: 'asset', id: 'mark' },
			size: 0.2,
			clear: 'box',
			padding: 1,
			plate: null,
		};
		const withLogo = designWith({
			symbol: { symbology: 'qr', ecLevel: 'H' },
			logo,
			assets: { mark: asset },
		});
		const good = run([first as BatchRow], { kind: 'zip', format: 'svg' }, withLogo);
		expect(good.outcomes[0]?.issues).toEqual([]);
		// A PNG whose header is sound and whose pixels are not: validation passes it, decoding does not.
		const png = Buffer.from(asset.png, 'base64');
		png[png.length - 20] = (png[png.length - 20] as number) ^ 0xff;
		const broken = designWith({
			symbol: { symbology: 'qr', ecLevel: 'H' },
			logo,
			assets: { mark: { ...asset, png: base64Encode(new Uint8Array(png)) } },
		});
		const bad = run([first as BatchRow], { kind: 'zip', format: 'svg' }, broken);
		expect(bad.outcomes[0]?.status).toBe('written');
		expect(bad.outcomes[0]?.issues.map((found) => found.code)).toContain(
			'design.issue.asset-unavailable',
		);
	});

	it("sets a frame's caption with the built-in fonts, or the ones given", async () => {
		const [first] = rows();
		const framed = designWith({
			frame: {
				ref: { id: 'rounded-card' },
				text: { content: 'Scan me', fontId: 'plex-sans-bold' },
			},
		});
		const plain = run([first as BatchRow], { kind: 'zip', format: 'svg' }, framed);
		expect(plain.outcomes[0]?.issues).toEqual([]);
		const symbol = encode(first?.content as string, { ecLevel: 'M' });
		const alone = buildScene(symbol, framed, {
			registries: reg.design,
			fonts: createFontRegistry(),
		});
		expect((await readZip(plain.bytes))[0]?.bytes).toEqual(
			new TextEncoder().encode(sceneToSvg(alone.scene)),
		);
		const given = run([first as BatchRow], { kind: 'zip', format: 'svg' }, framed, {
			fonts: new Registry('font'),
		});
		expect(given.outcomes[0]?.status).toBe('written');
		expect(given.outcomes[0]?.issues.map((found) => found.code)).toEqual([
			'design.issue.font-unavailable',
		]);
	});

	it("draws the Swiss QR-bill's cross over every code, as the content requires", async () => {
		const table = parseCsv(
			'iban,name,street,building,postcode,town,amount,reference\n' +
				'CH4431999123000889012,Example AG,Musterstrasse,1,8000,Seldwyla,10.00,210000000003139471430009017\n',
		);
		const bills = planBatch(
			table,
			{
				typeId: 'swiss-qr-bill',
				fields: {
					iban: { column: 'iban' },
					creditorName: { column: 'name' },
					creditorStreet: { column: 'street' },
					creditorBuilding: { column: 'building' },
					creditorPostcode: { column: 'postcode' },
					creditorTown: { column: 'town' },
					creditorCountry: { template: 'CH' },
					amount: { column: 'amount' },
					referenceType: { template: 'QRR' },
					reference: { column: 'reference' },
				},
				filename: 'bill-{reference}',
			},
			reg,
		);
		expect(bills[0]?.issues.filter((found) => found.severity === 'error')).toEqual([]);
		const seen: BatchVerifyRequest[] = [];
		const checker: BatchVerifier = (request) => {
			seen.push(request);
			return { verdict: 'pass' };
		};
		const { bytes, outcomes } = run(bills, { kind: 'zip', format: 'svg' }, defaultDesign(), {
			verifyRow: checker,
		});
		expect(outcomes[0]?.status).toBe('written');
		const applied = applyConstraints(
			defaultDesign(),
			reg.payloads.require('swiss-qr-bill').constraints,
		);
		expect(applied.overlay).toBe('swiss-cross');
		const symbol = encode(bills[0]?.content as string, {
			ecLevel: 'M',
			...(applied.design.symbol.segmentation === undefined
				? {}
				: { segmentation: applied.design.symbol.segmentation }),
			...(applied.design.symbol.maxVersion === undefined
				? {}
				: { maxVersion: applied.design.symbol.maxVersion }),
		});
		const alone = buildScene(symbol, applied.design, {
			registries: reg.design,
			overlay: 'swiss-cross',
		});
		const without = buildScene(symbol, applied.design, { registries: reg.design });
		const entry = (await readZip(bytes))[0]?.bytes;
		expect(entry).toEqual(new TextEncoder().encode(sceneToSvg(alone.scene)));
		expect(entry).not.toEqual(new TextEncoder().encode(sceneToSvg(without.scene)));
		expect(seen[0]?.overlay).toBe('swiss-cross');
		expect(seen[0]?.sizeMm).toBe(46);
	});

	it('cleans names on rows that did not come from planBatch', async () => {
		const handMade: BatchRow[] = [
			{
				index: 0,
				rowNumber: 2,
				typeId: 'text',
				filename: '../../evil',
				content: 'one',
				issues: [],
			},
			{ index: 1, rowNumber: 3, typeId: 'text', filename: 'EVIL', content: 'two', issues: [] },
			{ index: 2, rowNumber: 4, typeId: 'text', filename: '///', content: 'three', issues: [] },
		];
		const { bytes } = run(handMade, { kind: 'zip', format: 'svg' });
		expect((await readZip(bytes)).map((entry) => entry.name)).toEqual([
			'evil.svg',
			'EVIL-2.svg',
			'qr-4.svg',
			'manifest.csv',
		]);
	});

	it('skips a row whose file cannot be drawn, and goes on', () => {
		// A frame of the caller's own, far wider and taller than any built-in.
		const huge: FrameEntry = {
			id: 'huge-test',
			labelKey: 'design.frame.huge-test',
			params: [],
			text: null,
			layout: ({ symbolSize, quietZone }) => {
				const side = symbolSize.width + 2 * quietZone;
				return {
					width: side * 3,
					height: side * 40,
					symbol: { x: side, y: side },
					nodes: [],
					textBox: null,
				};
			},
		};
		const bag = registries();
		bag.design.frames.register(huge);
		const framed = designWith({ frame: { ref: { id: 'huge-test' } } });
		const [first] = rows();
		const pdf = run(
			[first as BatchRow],
			{ kind: 'zip', format: 'pdf', sizeMm: 2000 },
			framed,
			{},
			bag,
		);
		expect(pdf.outcomes[0]?.status).toBe('skipped');
		expect(pdf.outcomes[0]?.issues.at(-1)).toEqual({
			code: 'render.print.too-large',
			path: [],
			severity: 'error',
			params: { maxMm: 5080 },
		});
		const png = run(
			[first as BatchRow],
			{ kind: 'zip', format: 'png', widthPx: 8192 },
			framed,
			{},
			bag,
		);
		expect(png.outcomes[0]?.issues.at(-1)).toEqual({
			code: 'batch.issue.failed',
			path: [],
			severity: 'error',
			params: { code: 'render/surface-too-large' },
		});
	});
});

describe('errorIssue', () => {
	it("gives each lower layer's refusal in that layer's message key", () => {
		expect(errorIssue(new TooMuchDataError(100, 50))).toEqual({
			code: 'encode.too-much-data',
			path: [],
			severity: 'error',
			params: { bitsNeeded: 100, bitsAvailable: 50 },
		});
		expect(
			errorIssue(new QrStudioError('encode/unsupported-feature', 'x', { feature: 'eci' })).code,
		).toBe('encode.unsupported-feature.eci');
		expect(
			errorIssue(new QrStudioError('encode/unsupported-content', 'x', { reason: 'mode' })).code,
		).toBe('encode.unsupported-content.mode');
		expect(
			errorIssue(new QrStudioError('render/surface-too-large', 'x', { maxPixels: 1 })).code,
		).toBe('batch.issue.failed');
	});

	it('makes a micro QR row the symbology cannot hold into an issue', () => {
		const table = parseCsv('t\nabc\n');
		const textRows = planBatch(
			table,
			{ typeId: 'text', fields: { text: { column: 't' } }, filename: 'x' },
			reg,
		);
		const micro = designWith({
			symbol: { symbology: 'micro', ecLevel: 'L', maxVersion: 'M1' },
			quietZone: 2,
		});
		const { outcomes } = run(textRows, { kind: 'zip', format: 'svg' }, micro);
		expect(outcomes[0]?.status).toBe('skipped');
		expect(outcomes[0]?.issues.at(-1)?.code).toMatch(/^encode\./);
	});
});

describe('verification', () => {
	const many = `sku\n${Array.from({ length: 12 }, (_, i) => `EX-${String(i).padStart(3, '0')}`).join('\n')}\nEX-LONGEST-ONE\n`;

	function recorder(verdict: 'pass' | 'warn' | 'fail' = 'pass') {
		const seen: BatchVerifyRequest[] = [];
		const verifyRow: BatchVerifier = (request) => {
			seen.push(request);
			return { verdict };
		};
		return { seen, verifyRow };
	}

	it('is off without a checker, and refuses to be asked for without one', () => {
		const batch = rows();
		expect(run(batch, { kind: 'zip', format: 'svg' }).outcomes.every((o) => o.check === null)).toBe(
			true,
		);
		for (const verify of ['sampled', 'all'] as const) {
			expect(() =>
				runBatch(batch, defaultDesign(), { kind: 'zip', format: 'svg', verify }, reg),
			).toThrow(TypeError);
		}
	});

	it(`checks a batch of up to ${SMALL_BATCH} rows in full by default, and a larger one not at all`, () => {
		const small = recorder();
		run(rows(), { kind: 'zip', format: 'svg' }, defaultDesign(), { verifyRow: small.verifyRow });
		expect(small.seen.map((request) => request.rowNumber)).toEqual([2, 3, 5, 6]);
		const large = recorder();
		const { outcomes } = run(rows(many), { kind: 'zip', format: 'svg' }, defaultDesign(), {
			verifyRow: large.verifyRow,
		});
		expect(large.seen).toEqual([]);
		expect(outcomes.every((outcome) => outcome.check === null)).toBe(true);
	});

	it('samples every Nth row written and the longest content', () => {
		const sampled = recorder();
		const { outcomes } = run(
			rows(many),
			{ kind: 'zip', format: 'svg', verify: 'sampled', verifyEvery: 5 },
			defaultDesign(),
			{ verifyRow: sampled.verifyRow },
		);
		expect(sampled.seen.map((request) => request.rowNumber)).toEqual([2, 7, 12, 14]);
		expect(outcomes.filter((outcome) => outcome.check === 'pass')).toHaveLength(4);
		const byDefault = recorder();
		run(rows(many), { kind: 'zip', format: 'svg', verify: 'sampled' }, defaultDesign(), {
			verifyRow: byDefault.verifyRow,
		});
		// One in twenty: the first row, then the longest.
		expect(byDefault.seen.map((request) => request.rowNumber)).toEqual([2, 14]);
	});

	it('checks every row when asked, and none when there is nothing to check', () => {
		const all = recorder();
		run(rows(many), { kind: 'zip', format: 'svg', verify: 'all' }, defaultDesign(), {
			verifyRow: all.verifyRow,
		});
		expect(all.seen).toHaveLength(13);
		const none = recorder();
		run(rows('sku\n,\n'), { kind: 'zip', format: 'svg', verify: 'all' }, defaultDesign(), {
			verifyRow: none.verifyRow,
		});
		expect(none.seen).toEqual([]);
		const off = recorder();
		run(rows(), { kind: 'zip', format: 'svg', verify: 'off' }, defaultDesign(), {
			verifyRow: off.verifyRow,
		});
		expect(off.seen).toEqual([]);
	});

	it('asks about the design as drawn, at the size and resolution of the output', () => {
		const { seen, verifyRow } = recorder();
		const high = designWith({ symbol: { symbology: 'qr', ecLevel: 'Q' } });
		const [first] = rows();
		run([first as BatchRow], { kind: 'zip', format: 'png', sizeMm: 20, dpi: 600 }, high, {
			verifyRow,
			seed: 7,
		});
		expect(seen[0]).toEqual({
			index: 0,
			rowNumber: 2,
			content: 'https://example.com/p/EX-001',
			design: { ...high, output: { colourSpace: 'srgb', sizeMm: 20, dpi: 600 } },
			overlay: null,
			sizeMm: 20,
			dpi: 600,
			seed: 7,
		});
		const unsized = recorder();
		run([first as BatchRow], { kind: 'zip', format: 'svg' }, high, {
			verifyRow: unsized.verifyRow,
		});
		expect(unsized.seen[0]?.sizeMm).toBeNull();
		expect(unsized.seen[0]?.design.output).toEqual({ colourSpace: 'srgb' });
	});

	it("turns each verdict into the row's check, and a failure into an issue", () => {
		const [first] = rows();
		const verdicts = {
			pass: [],
			warn: ['batch.issue.check-warned'],
			fail: ['batch.issue.check-failed'],
		};
		for (const [verdict, codes] of Object.entries(verdicts)) {
			const { verifyRow } = recorder(verdict as 'pass');
			const { outcomes } = run(
				[first as BatchRow],
				{ kind: 'zip', format: 'svg' },
				defaultDesign(),
				{ verifyRow },
			);
			expect(outcomes[0]?.check).toBe(verdict);
			expect(outcomes[0]?.status).toBe('written');
			expect(outcomes[0]?.issues.map((found) => found.code)).toEqual(codes);
		}
		const extra = run([first as BatchRow], { kind: 'zip', format: 'svg' }, defaultDesign(), {
			verifyRow: () => ({
				verdict: 'fail',
				issues: [{ code: 'verify.check.contrast', path: [], severity: 'warning' }],
			}),
		});
		expect(extra.outcomes[0]?.issues.map((found) => found.code)).toEqual([
			'batch.issue.check-failed',
			'verify.check.contrast',
		]);
	});

	it('drives a checker that works in steps, one step a slice', () => {
		const [first, second] = rows();
		function* stepped(): Generator<number, { verdict: 'pass' }> {
			yield 1;
			yield 2;
			yield 3;
			return { verdict: 'pass' };
		}
		const { progress, outcomes } = run(
			[first as BatchRow, second as BatchRow],
			{ kind: 'zip', format: 'svg' },
			defaultDesign(),
			{
				verifyRow: () => stepped(),
			},
		);
		expect(progress.map((event) => [event.done, event.row === undefined])).toEqual([
			[0, true],
			[0, true],
			[0, true],
			[1, false],
			[1, true],
			[1, true],
			[1, true],
			[2, false],
		]);
		expect(outcomes.map((outcome) => outcome.check)).toEqual(['pass', 'pass']);
	});

	it('notes a check that could not run, and lets a bug through', () => {
		const [first] = rows();
		const unavailable = run([first as BatchRow], { kind: 'zip', format: 'svg' }, defaultDesign(), {
			verifyRow: () => {
				throw new QrStudioError('verify/missing-entry', 'x', { kind: 'frame' });
			},
		});
		expect(unavailable.outcomes[0]?.check).toBeNull();
		expect(unavailable.outcomes[0]?.issues).toEqual([
			{
				code: 'batch.issue.check-unavailable',
				path: [],
				severity: 'warning',
				params: { code: 'verify/missing-entry' },
			},
		]);
		expect(() =>
			run([first as BatchRow], { kind: 'zip', format: 'svg' }, defaultDesign(), {
				verifyRow: () => {
					throw new RangeError('a bug');
				},
			}),
		).toThrow(RangeError);
		for (const answer of [null, { verdict: 'maybe' }, { verdict: 'pass', issues: 'x' }]) {
			expect(() =>
				run([first as BatchRow], { kind: 'zip', format: 'svg' }, defaultDesign(), {
					verifyRow: () => answer as never,
				}),
			).toThrow(TypeError);
		}
	});
});

describe('refusals', () => {
	const batch = rows();
	const zip: BatchOutput = { kind: 'zip', format: 'svg' };

	it('a design that is not valid', () => {
		try {
			runBatch(batch, { schema: 'nope' } as unknown as QrDesignV1, zip, reg);
			expect.unreachable();
		} catch (error) {
			expect((error as QrStudioError).code).toBe('design/invalid');
			expect((error as QrStudioError).params.issues).toBeGreaterThan(0);
		}
	});

	it('a symbology these registries do not have', () => {
		const bag = { ...reg, symbologies: new Registry<SymbologyEntry>('symbology') };
		expect(() => runBatch(batch, defaultDesign(), zip, bag)).toThrow(QrStudioError);
	});

	it('caller mistakes, before the first step', () => {
		const design = defaultDesign();
		const bad: (() => unknown)[] = [
			() => runBatch(null as unknown as BatchRow[], design, zip, reg),
			() => runBatch([{ ...batch[0], index: 'x' } as unknown as BatchRow], design, zip, reg),
			() => runBatch([null as unknown as BatchRow], design, zip, reg),
			() => runBatch([{ ...batch[0], content: 1 } as unknown as BatchRow], design, zip, reg),
			() => runBatch(batch, design, null as unknown as BatchOutput, reg),
			() => runBatch(batch, design, { kind: 'tar' } as unknown as BatchOutput, reg),
			() => runBatch(batch, design, { kind: 'zip', format: 'gif' } as unknown as BatchOutput, reg),
			() => runBatch(batch, design, { kind: 'zip', format: 'png', widthPx: 8193 }, reg),
			() => runBatch(batch, design, { kind: 'zip', format: 'png', widthPx: 100.5 }, reg),
			() => runBatch(batch, design, { kind: 'zip', format: 'png', dpi: 10 }, reg),
			() => runBatch(batch, design, { kind: 'zip', format: 'pdf', sizeMm: 1 }, reg),
			() => runBatch(batch, design, { kind: 'zip', format: 'pdf', sizeMm: Number.NaN }, reg),
			() =>
				runBatch(batch, design, { kind: 'zip', format: 'pdf', colourSpace: 'rgb' as never }, reg),
			() =>
				runBatch(
					batch,
					design,
					{ kind: 'zip', format: 'svg', includeContent: 'yes' as never },
					reg,
				),
			() =>
				runBatch(
					batch,
					design,
					{ kind: 'sheet', template: 'a4-21-63x38', colourSpace: 'p3' as never },
					reg,
				),
			() =>
				runBatch(
					batch,
					design,
					{ kind: 'sheet', template: 'a4-21-63x38', colourSpace: 'srgb', skip: -1 },
					reg,
				),
			() => runBatch(batch, design, { kind: 'zip', format: 'svg', verify: 'some' as never }, reg),
			() => runBatch(batch, design, { kind: 'zip', format: 'svg', verifyEvery: 0 }, reg),
			() => runBatch(batch, design, zip, null as unknown as typeof reg),
			() => runBatch(batch, design, zip, { ...reg, payloads: null } as unknown as typeof reg),
			() => runBatch(batch, design, zip, reg, null as unknown as object),
			() => runBatch(batch, design, zip, reg, { verifyRow: 'yes' as never }),
			() => runBatch(batch, design, zip, reg, { seed: -1 }),
			() => runBatch(batch, design, zip, reg, { seed: 0.5 }),
		];
		for (const call of bad) expect(call).toThrow(TypeError);
		expect(() =>
			runBatch(batch, design, zip, reg, { date: { year: 1970, month: 1, day: 1 } }),
		).toThrow(RangeError);
	});
});
