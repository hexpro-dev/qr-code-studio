/**
 * Making the files: each row's code drawn in one design, written into a ZIP
 * with a manifest, or laid out on label sheets as one PDF.
 *
 * `runBatch` is a generator the caller drives in time slices, because this
 * package has no worker of its own (Chrome blocks blob workers under
 * `file://`) and a thousand codes is far too long for one slice. Each
 * `next()` makes one row, start to finish: encode, build the scene, draw it
 * into its format, compress it into its ZIP entry, and the scan check when
 * the row is one of those checked. So at most one row's pictures are alive
 * at a time, and what the batch holds between slices is only the compressed
 * entries (or, for a sheet, the scenes, which is what a sheet is made of).
 *
 * The same rows, design, output and options give the same bytes, every time
 * and in every engine. Nothing is read from a clock: the ZIP's date is core's
 * fixed 1980-01-01 unless one is passed, the design's seed is a parameter and
 * is the same for every row, and entries go in row order with the manifest
 * last.
 *
 * Content constraints win over the design, as they do in the studio: an EPC
 * payment code is made at level M whatever the design says, and the Swiss
 * QR-bill in black on white at 46 mm. The design is constrained once per
 * content type and every row of that type is drawn with the result.
 *
 * A row is skipped, and listed in the manifest with why, when it has error
 * issues from planning or when its content cannot be made into a code at
 * these settings (too long, most often). Nothing a row holds can stop the
 * others; a bug can, and does, as a TypeError.
 */

import { QrStudioError, UnknownEntryError } from '../core/errors.js';
import type { RgbaImage } from '../core/image.js';
import { hasErrors, issue } from '../core/issue.js';
import type { Issue } from '../core/issue.js';
import { attempt } from '../core/result.js';
import { base64Decode } from '../design/base64.js';
import { applyConstraints } from '../design/constraints.js';
import { LIMITS } from '../design/document.js';
import { buildScene } from '../design/scene.js';
import type { QrDesignV1 } from '../design/types.js';
import { validateDesign } from '../design/validate.js';
import { encode } from '../encode/encode.js';
import type { EncodeOptions } from '../encode/plan.js';
import { epsIssues, sceneToEps } from '../render/eps.js';
import { checkTemplate, imposeSheet } from '../render/impose.js';
import type { SheetTemplate } from '../render/impose.js';
import { sceneToPdf, sheetToPdf } from '../render/pdf.js';
import { decodePng } from '../render/png-decode.js';
import { encodePng } from '../render/png.js';
import { rasterise } from '../render/raster.js';
import { builtInSheets } from '../render/sheets.js';
import { sceneToSvg } from '../render/svg.js';
import type { Scene } from '../render/types.js';
import { createFontRegistry } from '../text/registry.js';
import type { FontRegistry } from '../text/types.js';
import { sanitiseFilename, uniqueFilenames } from './filename.js';
import { BATCH_ISSUES } from './issues.js';
import { MANIFEST_NAME, batchManifest } from './manifest.js';
import type {
	BatchOutcome,
	BatchOutput,
	BatchProgress,
	BatchRegistries,
	BatchRow,
	BatchVerifier,
	BatchVerifyMode,
	BatchVerifyResult,
	RunBatchOptions,
} from './types.js';
import { ZipWriter } from './zip.js';

/** A PNG's width when neither it nor a print size and resolution is given. */
export const DEFAULT_WIDTH_PX = 1024;
/** The widest PNG a batch makes. Wider is a poster, made one at a time. */
export const MAX_WIDTH_PX = 8192;
const MIN_WIDTH_PX = 16;
/** A PDF or EPS code's printed width, quiet zone included, when nothing says otherwise. */
export const DEFAULT_PRINT_SIZE_MM = 30;
/** For 'sampled': one row in this many is checked. */
export const DEFAULT_VERIFY_EVERY = 20;
/** Up to this many rows are checked in full when the output does not say; more are not checked. */
export const SMALL_BATCH = 10;

const MM_PER_INCH = 25.4;

type Format = 'svg' | 'png' | 'pdf' | 'eps';

interface Plan {
	readonly rows: readonly BatchRow[];
	readonly names: readonly string[];
	readonly design: QrDesignV1;
	readonly output: BatchOutput;
	readonly registries: BatchRegistries;
	readonly dpi: number | null;
	readonly colourSpace: 'srgb' | 'cmyk';
	readonly template: SheetTemplate | null;
	readonly checked: ReadonlySet<number>;
	readonly verifyRow: BatchVerifier | undefined;
	readonly assets: (id: string) => RgbaImage | undefined;
	readonly fonts: FontRegistry | undefined;
	readonly seed: number;
	/** Made before the first step, so a bad date is refused when the batch is asked for. */
	readonly zip: ZipWriter | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function optionalNumber(
	value: unknown,
	name: string,
	min: number,
	max: number,
	integer: boolean,
): number | undefined {
	if (value === undefined) return undefined;
	if (
		typeof value !== 'number' ||
		!Number.isFinite(value) ||
		value < min ||
		value > max ||
		(integer && !Number.isInteger(value))
	) {
		throw new TypeError(
			`runBatch: output.${name} is ${integer ? 'a whole number' : 'a number'} from ${min} to ${max}.`,
		);
	}
	return value;
}

function checkRows(rows: readonly BatchRow[]): void {
	if (!Array.isArray(rows)) throw new TypeError('runBatch: rows is what planBatch returns.');
	rows.forEach((row: unknown, i) => {
		if (
			!isRecord(row) ||
			!Number.isInteger(row.index) ||
			!Number.isInteger(row.rowNumber) ||
			typeof row.typeId !== 'string' ||
			typeof row.filename !== 'string' ||
			(row.content !== null && typeof row.content !== 'string') ||
			!Array.isArray(row.issues)
		) {
			throw new TypeError(`runBatch: row ${i} is not a row planBatch returns.`);
		}
	});
}

function checkOutput(output: BatchOutput): void {
	if (!isRecord(output)) throw new TypeError('runBatch: output is an object.');
	if (output.kind === 'zip') {
		if (!['svg', 'png', 'pdf', 'eps'].includes(output.format)) {
			throw new TypeError("runBatch: output.format is 'svg', 'png', 'pdf' or 'eps'.");
		}
		optionalNumber(output.widthPx, 'widthPx', MIN_WIDTH_PX, MAX_WIDTH_PX, true);
		optionalNumber(output.dpi, 'dpi', LIMITS.dpi.min, LIMITS.dpi.max, false);
		if (output.colourSpace !== undefined && !['srgb', 'cmyk'].includes(output.colourSpace)) {
			throw new TypeError("runBatch: output.colourSpace is 'srgb' or 'cmyk'.");
		}
		if (output.includeContent !== undefined && typeof output.includeContent !== 'boolean') {
			throw new TypeError('runBatch: output.includeContent is true or false.');
		}
	} else if (output.kind === 'sheet') {
		if (!['srgb', 'cmyk'].includes(output.colourSpace)) {
			throw new TypeError("runBatch: output.colourSpace is 'srgb' or 'cmyk'.");
		}
		optionalNumber(output.skip, 'skip', 0, Number.MAX_SAFE_INTEGER, true);
	} else {
		throw new TypeError("runBatch: output.kind is 'zip' or 'sheet'.");
	}
	optionalNumber(output.sizeMm, 'sizeMm', LIMITS.sizeMm.min, LIMITS.sizeMm.max, false);
	if (output.verify !== undefined && !['off', 'sampled', 'all'].includes(output.verify)) {
		throw new TypeError("runBatch: output.verify is 'off', 'sampled' or 'all'.");
	}
	optionalNumber(output.verifyEvery, 'verifyEvery', 1, Number.MAX_SAFE_INTEGER, true);
}

function sheetTemplate(output: BatchOutput): SheetTemplate | null {
	if (output.kind !== 'sheet') return null;
	const given = output.template;
	const template =
		typeof given === 'string' ? builtInSheets().find((sheet) => sheet.id === given) : given;
	if (template === undefined) throw new UnknownEntryError('sheet-template', String(given));
	checkTemplate(template);
	const skip = output.skip ?? 0;
	if (skip >= template.columns * template.rows) {
		throw new TypeError('runBatch: output.skip is fewer labels than a sheet holds.');
	}
	return template;
}

/** The design's embedded pictures, decoded once for every row. One that will not decode is left out, and the scene says so. */
function decodeAssets(design: QrDesignV1): (id: string) => RgbaImage | undefined {
	const decoded = new Map<string, RgbaImage>();
	for (const [id, asset] of Object.entries(design.assets ?? {})) {
		// validateDesign has checked the base64 and the PNG header, not the
		// pixels, so only decoding can still fail.
		const image = attempt(() => decodePng(base64Decode(asset.png) as Uint8Array));
		if (image.ok) decoded.set(id, image.value);
	}
	return (id) => decoded.get(id);
}

/** Which rows the scan check runs on, by their position in `rows`. */
function chooseChecked(
	rows: readonly BatchRow[],
	output: BatchOutput,
	verifyRow: BatchVerifier | undefined,
): Set<number> {
	const candidates: number[] = [];
	rows.forEach((row, position) => {
		if (row.content !== null && !hasErrors(row.issues)) candidates.push(position);
	});
	let mode: BatchVerifyMode =
		output.verify ?? (verifyRow !== undefined && candidates.length <= SMALL_BATCH ? 'all' : 'off');
	if (mode !== 'off' && verifyRow === undefined) {
		throw new TypeError('runBatch: checking rows needs options.verifyRow.');
	}
	if (candidates.length === 0) mode = 'off';
	if (mode === 'off') return new Set();
	if (mode === 'all') return new Set(candidates);
	const every = output.verifyEvery ?? DEFAULT_VERIFY_EVERY;
	const chosen = new Set(candidates.filter((_, k) => k % every === 0));
	// The longest content makes the densest code, which is the one most likely
	// to fail; the first of several equally long ones.
	let longest = candidates[0] as number;
	for (const position of candidates) {
		if (
			((rows[position] as BatchRow).content as string).length >
			((rows[longest] as BatchRow).content as string).length
		) {
			longest = position;
		}
	}
	chosen.add(longest);
	return chosen;
}

function prepare(
	rows: readonly BatchRow[],
	design: QrDesignV1,
	output: BatchOutput,
	registries: BatchRegistries,
	options: RunBatchOptions,
): Plan {
	checkRows(rows);
	checkOutput(output);
	if (
		!isRecord(registries) ||
		!isRecord(registries.symbologies) ||
		!isRecord(registries.payloads) ||
		!isRecord(registries.design)
	) {
		throw new TypeError(
			'runBatch: registries gives the symbologies, content types and design registries.',
		);
	}
	if (typeof options !== 'object' || options === null) {
		throw new TypeError('runBatch: options is an object.');
	}
	if (options.verifyRow !== undefined && typeof options.verifyRow !== 'function') {
		throw new TypeError('runBatch: options.verifyRow is a function.');
	}
	const seed = options.seed ?? 0;
	if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
		throw new TypeError('runBatch: options.seed is an integer from 0 to 2^32 - 1.');
	}
	const validated = validateDesign(design, registries.design);
	if (validated.design === null) {
		throw new QrStudioError(
			'design/invalid',
			'This design has problems to fix before it can be used.',
			{
				issues: validated.issues.length,
			},
		);
	}
	const valid = validated.design;
	registries.symbologies.require(valid.symbol.symbology);
	const template = sheetTemplate(output);

	const print = output.kind === 'zip' && (output.format === 'pdf' || output.format === 'eps');
	const sizeMm =
		output.sizeMm ?? valid.output.sizeMm ?? (print ? DEFAULT_PRINT_SIZE_MM : undefined) ?? null;
	const dpi = (output.kind === 'zip' ? output.dpi : undefined) ?? valid.output.dpi ?? null;
	const colourSpace =
		output.kind === 'sheet' ? output.colourSpace : (output.colourSpace ?? valid.output.colourSpace);
	const sized: QrDesignV1 = {
		...valid,
		output: {
			...valid.output,
			colourSpace,
			...(sizeMm === null ? {} : { sizeMm }),
			...(dpi === null ? {} : { dpi }),
		},
	};

	// Cleaned again, in case these rows did not come from planBatch. Cleaning
	// is idempotent and planBatch's names are already unique, so its rows keep
	// their names exactly.
	const names = uniqueFilenames(
		rows.map((row) => ({ name: sanitiseFilename(row.filename), fallback: `qr-${row.rowNumber}` })),
	).map((unique) => unique.name);

	const caption = valid.frame?.text?.content;
	return {
		rows,
		names,
		design: sized,
		output,
		registries,
		dpi,
		colourSpace,
		template,
		checked: chooseChecked(rows, output, options.verifyRow),
		verifyRow: options.verifyRow,
		assets: decodeAssets(valid),
		fonts:
			options.fonts ?? (caption !== undefined && caption !== '' ? createFontRegistry() : undefined),
		seed,
		zip: output.kind === 'zip' ? new ZipWriter(options.date) : null,
	};
}

function encodeOptions(design: QrDesignV1): EncodeOptions {
	const { symbol } = design;
	return {
		symbology: symbol.symbology,
		...(symbol.ecLevel === undefined ? {} : { ecLevel: symbol.ecLevel }),
		...(symbol.boostEc === undefined ? {} : { boostEc: symbol.boostEc }),
		...(symbol.minVersion === undefined ? {} : { minVersion: symbol.minVersion }),
		...(symbol.maxVersion === undefined ? {} : { maxVersion: symbol.maxVersion }),
		...(symbol.mask === undefined ? {} : { mask: symbol.mask }),
		...(symbol.segmentation === undefined ? {} : { segmentation: symbol.segmentation }),
	};
}

/** A refusal from a lower layer as an issue on the row, in that layer's own message key. */
export function errorIssue(error: QrStudioError): Issue {
	const { code, params } = error;
	if (code === 'encode/too-much-data') return issue('encode.too-much-data', [], 'error', params);
	if (code === 'encode/unsupported-feature') {
		return issue(`encode.unsupported-feature.${String(params.feature)}`, [], 'error');
	}
	if (code === 'encode/unsupported-content') {
		return issue(`encode.unsupported-content.${String(params.reason)}`, [], 'error');
	}
	if (code === 'render/surface-too-large' && params.maxMm !== undefined) {
		return issue('render.print.too-large', [], 'error', { maxMm: params.maxMm });
	}
	return issue(BATCH_ISSUES.failed, [], 'error', { code });
}

function isIterator(value: unknown): value is Iterator<unknown, BatchVerifyResult> {
	return isRecord(value) && typeof value.next === 'function';
}

function checkResult(result: unknown): BatchVerifyResult {
	if (
		!isRecord(result) ||
		!['pass', 'warn', 'fail'].includes(result.verdict as string) ||
		(result.issues !== undefined && !Array.isArray(result.issues))
	) {
		throw new TypeError('runBatch: verifyRow returns { verdict, issues? }.');
	}
	return result as unknown as BatchVerifyResult;
}

interface Drawn {
	readonly bytes: Uint8Array;
	readonly extension: Format;
	readonly compress: boolean;
	readonly issues: readonly Issue[];
}

/** One scene in the ZIP's format. */
function draw(scene: Scene, plan: Plan, format: Format): Drawn {
	if (format === 'svg') {
		return {
			bytes: new TextEncoder().encode(sceneToSvg(scene)),
			extension: 'svg',
			compress: true,
			issues: [],
		};
	}
	const widthMm = scene.unitsPerMm === undefined ? null : scene.width / scene.unitsPerMm;
	if (format === 'png') {
		const output = plan.output as Extract<BatchOutput, { kind: 'zip' }>;
		const width =
			output.widthPx ??
			(widthMm !== null && plan.dpi !== null
				? Math.min(
						MAX_WIDTH_PX,
						Math.max(MIN_WIDTH_PX, Math.round((widthMm * plan.dpi) / MM_PER_INCH)),
					)
				: DEFAULT_WIDTH_PX);
		const image = rasterise(scene, { width });
		return {
			bytes: encodePng(image, plan.dpi === null ? {} : { dpi: plan.dpi }),
			extension: 'png',
			compress: false,
			issues: [],
		};
	}
	// PDF and EPS always have a size: prepare gives them the default.
	const width = widthMm as number;
	if (format === 'eps') {
		if (epsIssues(scene).length === 0) {
			return {
				bytes: new TextEncoder().encode(
					sceneToEps(scene, { colour: plan.colourSpace, widthMm: width }),
				),
				extension: 'eps',
				compress: true,
				issues: [],
			};
		}
		const pdf = draw(scene, plan, 'pdf');
		return { ...pdf, issues: [issue(BATCH_ISSUES.epsFallback, [], 'warning')] };
	}
	return {
		bytes: sceneToPdf(scene, { colour: plan.colourSpace, widthMm: width }),
		extension: 'pdf',
		compress: false,
		issues: [],
	};
}

/** Only the issues worth repeating on every row: a design's notes are the design's, not the row's. */
function worthSaying(issues: readonly Issue[]): Issue[] {
	return issues.filter((found) => found.severity !== 'info');
}

function* checkRow(
	plan: Plan,
	row: BatchRow,
	design: QrDesignV1,
	sizeMm: number | null,
	progress: BatchProgress,
): Generator<BatchProgress, { check: BatchOutcome['check']; issues: Issue[] }> {
	const verifyRow = plan.verifyRow as BatchVerifier;
	let result: BatchVerifyResult;
	try {
		const answer = verifyRow({
			index: row.index,
			rowNumber: row.rowNumber,
			content: row.content as string,
			design,
			sizeMm,
			dpi: plan.dpi,
			seed: plan.seed,
		});
		if (isIterator(answer)) {
			for (;;) {
				const step = answer.next();
				if (step.done === true) {
					result = checkResult(step.value);
					break;
				}
				yield progress;
			}
		} else result = checkResult(answer);
	} catch (error) {
		if (!(error instanceof QrStudioError)) throw error;
		return {
			check: null,
			issues: [issue(BATCH_ISSUES.checkUnavailable, [], 'warning', { code: error.code })],
		};
	}
	const issues: Issue[] = [];
	if (result.verdict === 'fail') issues.push(issue(BATCH_ISSUES.checkFailed, [], 'warning'));
	if (result.verdict === 'warn') issues.push(issue(BATCH_ISSUES.checkWarned, [], 'info'));
	issues.push(...(result.issues ?? []));
	return { check: result.verdict, issues };
}

interface Run {
	readonly zip: ZipWriter | null;
	readonly scenes: Scene[];
	readonly constrained: Map<string, { design: QrDesignV1; issues: Issue[] }>;
	readonly total: number;
}

/** The design every row of a content type is drawn in: the content's constraints applied once. */
function designFor(plan: Plan, run: Run, typeId: string): { design: QrDesignV1; issues: Issue[] } {
	let entry = run.constrained.get(typeId);
	if (entry === undefined) {
		const type = plan.registries.payloads.require(typeId);
		const applied = applyConstraints(plan.design, type.constraints);
		entry = { design: applied.design, issues: worthSaying(applied.issues) };
		run.constrained.set(typeId, entry);
	}
	return entry;
}

/** One row, start to finish. */
function* makeRow(plan: Plan, run: Run, position: number): Generator<BatchProgress, BatchOutcome> {
	const row = plan.rows[position] as BatchRow;
	const base = { index: row.index, rowNumber: row.rowNumber, typeId: row.typeId };
	const skipped = (issues: readonly Issue[]): BatchOutcome =>
		Object.freeze({
			...base,
			filename: null,
			status: 'skipped' as const,
			check: null,
			sheet: null,
			issues: Object.freeze([...issues]),
		});
	if (row.content === null || hasErrors(row.issues)) return skipped(row.issues);
	const content = row.content;
	const entry = designFor(plan, run, row.typeId);
	const issues: Issue[] = [...row.issues, ...entry.issues];
	const made = attempt(() => {
		const symbol = encode(content, encodeOptions(entry.design), plan.registries.symbologies);
		return {
			symbol,
			built: buildScene(symbol, entry.design, {
				registries: plan.registries.design,
				assets: plan.assets,
				...(plan.fonts === undefined ? {} : { fonts: plan.fonts }),
				seed: plan.seed,
			}),
		};
	});
	if (!made.ok) return skipped([...issues, errorIssue(made.error)]);
	issues.push(...worthSaying(made.value.built.issues));
	let scene = made.value.built.scene;
	// The printed width of the symbol with its quiet zone, which the scan
	// check needs: the design's, or on a sheet with no size, what filling the
	// label makes it.
	let sizeMm = entry.design.output.sizeMm ?? null;

	let filename: string | null = null;
	let sheet: BatchOutcome['sheet'] = null;
	const { template } = plan;
	if (run.zip !== null) {
		const zip = run.zip;
		const format = (plan.output as Extract<BatchOutput, { kind: 'zip' }>).format;
		const drawn = attempt(() => {
			const file = draw(scene, plan, format);
			const name = `${plan.names[position] as string}.${file.extension}`;
			zip.add(name, file.bytes, file.compress);
			return { name, issues: file.issues };
		});
		if (!drawn.ok) return skipped([...issues, errorIssue(drawn.error)]);
		filename = drawn.value.name;
		issues.push(...drawn.value.issues);
	} else {
		const tpl = template as SheetTemplate;
		if (scene.unitsPerMm === undefined) {
			// No size anywhere: the code fills its label, as imposeSheet's
			// 'contain' would place it, but given as a true size so that every
			// row is placed by the same rule whatever its content type.
			const unitsPerMm = Math.max(scene.width / tpl.cell.widthMm, scene.height / tpl.cell.heightMm);
			scene = { ...scene, unitsPerMm };
			sizeMm = (made.value.symbol.matrix.width + 2 * entry.design.quietZone) / unitsPerMm;
		}
		const perPage = tpl.columns * tpl.rows;
		const slot =
			run.scenes.length + ((plan.output as Extract<BatchOutput, { kind: 'sheet' }>).skip ?? 0);
		sheet = { page: Math.floor(slot / perPage) + 1, label: (slot % perPage) + 1 };
		// The placement imposeSheet will make for the whole run, asked of this
		// scene alone, so a label too small for its code is reported while the
		// row is still the one being reported on.
		issues.push(...imposeSheet([scene], tpl).issues.map((found) => ({ ...found, path: [] })));
		run.scenes.push(scene);
	}

	let check: BatchOutcome['check'] = null;
	if (plan.checked.has(position)) {
		const design =
			sizeMm === null || sizeMm === entry.design.output.sizeMm
				? entry.design
				: { ...entry.design, output: { ...entry.design.output, sizeMm } };
		const checked = yield* checkRow(plan, row, design, sizeMm, {
			done: position,
			total: run.total,
		});
		check = checked.check;
		issues.push(...checked.issues);
	}
	return Object.freeze({
		...base,
		filename,
		status: 'written' as const,
		check,
		sheet,
		issues: Object.freeze(issues),
	});
}

function* drive(plan: Plan): Generator<BatchProgress, Uint8Array> {
	const { rows, output } = plan;
	const run: Run = {
		zip: plan.zip,
		scenes: [],
		constrained: new Map(),
		total: rows.length + 1,
	};
	const outcomes: BatchOutcome[] = [];
	for (let position = 0; position < rows.length; position += 1) {
		const outcome = yield* makeRow(plan, run, position);
		outcomes.push(outcome);
		yield { done: position + 1, total: run.total, row: outcome };
	}

	if (run.zip !== null) {
		const include = (output as Extract<BatchOutput, { kind: 'zip' }>).includeContent === true;
		const content = new Map(rows.map((row) => [row.index, row.content]));
		run.zip.add(
			MANIFEST_NAME,
			batchManifest(
				outcomes,
				include ? { content: (index) => content.get(index) as string | null } : {},
			),
			true,
		);
		return run.zip.finish();
	}
	const document = imposeSheet(run.scenes, plan.template as SheetTemplate, {
		skip: (output as Extract<BatchOutput, { kind: 'sheet' }>).skip ?? 0,
	});
	const title = plan.design.name;
	return sheetToPdf(document, {
		colour: plan.colourSpace,
		...(title === undefined ? {} : { title }),
	});
}

/**
 * Make a batch's files. Drive the generator to the end: each step makes one
 * row (or one step of a row's scan check), and the return value is the ZIP or
 * the sheet PDF. Everything is checked before the first step, so a mistake
 * throws here rather than partway through.
 */
export function runBatch(
	rows: readonly BatchRow[],
	design: QrDesignV1,
	output: BatchOutput,
	registries: BatchRegistries,
	options: RunBatchOptions = {},
): Generator<BatchProgress, Uint8Array> {
	return drive(prepare(rows, design, output, registries, options));
}
