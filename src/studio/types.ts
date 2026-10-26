/**
 * The studio's public shape, as docs/CONTRACTS.md (`studio`) gives it, with
 * the types the contract only names written out.
 *
 * Additions to the contract, each listed in the branch report:
 *
 * - `design/patch` takes one patch or a list applied together as one step,
 *   because a logo picture is two changes (the asset and the logo that uses
 *   it) and the validator drops an asset nothing uses.
 * - The snapshot carries `design` (the design as drawn, after the content's
 *   constraints, with its issues), `refusal` (why the last action changed
 *   nothing), `presetThumbnails` (preset pictures drawn with the visitor's own
 *   code) and `preview.issues`.
 * - Verify has a `failed` state, and its running state says which capture
 *   axis it is on.
 * - The `library/remove` command, which `LibraryStore.remove` needs a way in,
 *   and the brand kit and library file commands beside it.
 * - createStudio takes the layers it drives as seams a caller can replace:
 *   `verifyRunner` and `verifyGenerator` (verify's `runVerifyJob` by default),
 *   `suggestFixes`, `inspector` (the inspect layer by default) and `printer`
 *   (render's writers), and the browser's encoders as `rasterEncoder`. Its
 *   live checks run at `liveCaptureSeeds` captures a level, and the running
 *   and done verify states say how many.
 */

import type { QrStudioErrorCode } from '../core/errors.js';
import type { Issue, MessageKey } from '../core/issue.js';
import type { RgbaImage } from '../core/image.js';
import type { Result } from '../core/result.js';
import type {
	DesignAsset,
	DesignOverlay,
	FontRegistry,
	Ink,
	ModuleFamily,
	ParamSchema,
	PresetCategory,
	QrDesignV1,
	RegionKind,
} from '../design/types.js';
import type {
	CompatibilityNote,
	FieldKind,
	FieldOption,
	FieldValue,
	PayloadCategory,
	SafetyFinding,
} from '../payload/types.js';
import type { Scene } from '../render/types.js';
import type { Registries } from '../registries.js';
import type { EcLevel, Mode } from '../segment/types.js';
import type {
	BatchMapping,
	BatchOutcome,
	BatchOutput,
	CaptureAxis,
	DesignPatch,
	Fix,
	FixSuggester,
	InspectReport,
	Inspector,
	Printer,
	VerifyConditions,
	VerifyGenerator,
	VerifyReport,
	VerifyRunner,
} from './seams.js';

export type StudioMode = 'create' | 'scan' | 'bulk';

export interface StudioDocument {
	readonly mode: StudioMode;
	readonly typeId: string;
	readonly fields: Readonly<Record<string, FieldValue>>;
	/** The person's own design. What is drawn is this after the content's constraints: `snapshot.design.effective`. */
	readonly design: QrDesignV1;
	readonly conditions: VerifyConditions;
}

export type StudioAction =
	| { readonly type: 'mode'; readonly mode: StudioMode }
	| { readonly type: 'payload/type'; readonly typeId: string }
	| { readonly type: 'payload/field'; readonly key: string; readonly value: FieldValue }
	| { readonly type: 'payload/raw'; readonly text: string }
	| {
			readonly type: 'design/patch';
			/** One change, or several applied together as one step. */
			readonly patch: DesignPatch | readonly DesignPatch[];
			readonly coalesce?: string;
	  }
	| { readonly type: 'design/preset'; readonly id: string }
	| { readonly type: 'design/replace'; readonly design: unknown }
	| { readonly type: 'design/shuffle'; readonly seed: number }
	| { readonly type: 'conditions'; readonly conditions: Partial<VerifyConditions> }
	| { readonly type: 'history/undo' }
	| { readonly type: 'history/redo' }
	| { readonly type: 'history/begin'; readonly key: string }
	| { readonly type: 'history/commit'; readonly key: string }
	| { readonly type: 'history/cancel' }
	| { readonly type: 'verify/request' }
	| { readonly type: 'verify/cancel' }
	| { readonly type: 'fix/apply'; readonly fixId: string };

export type ExportFormat = 'svg' | 'png' | 'pdf' | 'eps' | 'jpeg' | 'webp';

/**
 * How an export is drawn. Everything is optional: left out, the design's own
 * output settings and the studio's conditions decide.
 */
export interface ExportOptions {
	/** The width of a raster in pixels, the whole artwork included. Wins over a size and dpi. */
	readonly widthPx?: number;
	/**
	 * The printed size, in place of the design's `output.sizeMm` and measured
	 * the way it is. The millimetres of a result always come from the scene
	 * that size builds (`Scene.unitsPerMm`), never from this number alone.
	 */
	readonly sizeMm?: number;
	/** Pixels to the inch, for a raster drawn from a physical size and for PNG's own record of it. */
	readonly dpi?: number;
	/** PDF and EPS only. Defaults to the design's. */
	readonly colourSpace?: 'srgb' | 'cmyk';
	/** PDF only: background drawn this far past the trim. */
	readonly bleedMm?: number;
	/** PDF only. */
	readonly cropMarks?: boolean;
	/** Modules of quiet zone, in place of the design's. Below the symbology's minimum is allowed, with a warning. */
	readonly quietZone?: number;
	/** JPEG and WebP only, 0 to 1. */
	readonly quality?: number;
}

export interface ExportResult {
	/** A safe generic name, or one made from the design's name. Never the content. */
	readonly filename: string;
	readonly mime: string;
	readonly bytes: Uint8Array;
	/** The width drawn, in pixels for a raster and in millimetres for print. */
	readonly width: number;
	readonly height: number;
	readonly issues: readonly Issue[];
}

export interface DesignLinkResult {
	readonly link: string;
	readonly issues: readonly Issue[];
}

export type StudioCommand =
	| { readonly type: 'export'; readonly format: ExportFormat; readonly options: ExportOptions }
	| { readonly type: 'inspect/image'; readonly image: RgbaImage }
	| { readonly type: 'inspect/text'; readonly text: string }
	| {
			readonly type: 'batch';
			/** The spreadsheet as text, or as the file's bytes, whose encoding is worked out. */
			readonly csv: string | Uint8Array;
			readonly mapping: BatchMapping;
			readonly output: BatchOutput;
	  }
	| { readonly type: 'design-link' }
	| { readonly type: 'library/enable' }
	| { readonly type: 'library/disable' }
	| { readonly type: 'library/save'; readonly name: string }
	| { readonly type: 'library/load'; readonly id: string }
	| { readonly type: 'library/remove'; readonly id: string }
	| { readonly type: 'library/list-kits' }
	| { readonly type: 'library/save-kit'; readonly name: string; readonly kit: BrandKit }
	/** Applies the kit to the design (see kit.ts for the rule) and offers its presets. */
	| { readonly type: 'library/load-kit'; readonly id: string }
	| { readonly type: 'library/remove-kit'; readonly id: string }
	| { readonly type: 'library/save-file'; readonly name?: string }
	| { readonly type: 'library/open-file'; readonly file: Blob };

/** What each command resolves to. */
export interface CommandResults {
	readonly export: ExportResult;
	readonly 'inspect/image': InspectReport;
	readonly 'inspect/text': InspectReport;
	readonly batch: Uint8Array;
	readonly 'design-link': DesignLinkResult;
	readonly 'library/enable': readonly LibraryItemSummary[];
	readonly 'library/disable': null;
	readonly 'library/save': LibraryItemSummary;
	readonly 'library/load': LibraryItemSummary;
	readonly 'library/remove': readonly LibraryItemSummary[];
	readonly 'library/list-kits': readonly KitSummary[];
	readonly 'library/save-kit': KitSummary;
	readonly 'library/load-kit': KitItem;
	readonly 'library/remove-kit': readonly KitSummary[];
	readonly 'library/save-file': { readonly filename: string };
	readonly 'library/open-file': LibraryFileOpened;
}

export type CommandResult<C extends StudioCommand> = CommandResults[C['type']];

// The library.

export interface LibraryItemSummary {
	readonly id: string;
	/** What the person called it. Theirs, so it may be shown, but it never reaches an error. */
	readonly name: string;
	/** Milliseconds since 1970, as the store recorded it. */
	readonly savedAt: number;
	readonly typeId: string;
}

/**
 * A saved design as a store hands it back. Records never hold content, so
 * `document.fields` is always empty and `document.typeId` only says which
 * kind of content the design was made for: `library/load` takes the design
 * and the conditions from it and nothing else.
 */
export interface LibraryItem extends LibraryItemSummary {
	readonly document: StudioDocument;
}

/** A brand's own colours, logo and favourite presets, kept so new codes start from them. */
export interface BrandKit {
	readonly palette: readonly Ink[];
	/** A picture logo, as a design embeds one: a PNG this package encoded. */
	readonly logo: DesignAsset | null;
	/** Preset ids, in the order the person prefers them. */
	readonly presets: readonly string[];
}

export interface KitSummary {
	readonly id: string;
	/** What the person called it. Theirs, so it may be shown, but it never reaches an error. */
	readonly name: string;
	/** Milliseconds since 1970, as the store recorded it. */
	readonly savedAt: number;
}

export interface KitItem extends KitSummary {
	readonly kit: BrandKit;
}

/**
 * What a store says a view should offer:
 * - 'off': a switch to turn the library on;
 * - 'unknown': the browser cannot say whether there is a library without
 *   opening it, so the view offers "Open my library", and the click is the
 *   consent (`library/enable`);
 * - 'on': the library is there;
 * - 'file': the library is a file the person saves and opens (the offline
 *   app), so the view offers Save and Open rather than a switch;
 * - 'unavailable': nothing can be kept here.
 */
export type LibraryProbeState = 'unavailable' | 'off' | 'on' | 'unknown' | 'file';

/** Everything a library holds, and the records left out because they could not be used. */
export interface LibraryContents {
	readonly designs: readonly LibraryItemSummary[];
	readonly kits: readonly KitSummary[];
	/** One warning per record left out, at `['designs' | 'kits', id]`. */
	readonly skipped: readonly Issue[];
}

/** What opening a library file came to. */
export interface LibraryFileOpened {
	/** False when the file was refused, and nothing the page held was changed. */
	readonly opened: boolean;
	readonly issues: readonly Issue[];
}

/**
 * Where saved designs and brand kits live, when the person asks for that.
 * The offline app passes the file library (src/dom/file-library.ts), which
 * the person saves and opens as a file; the website passes IndexedDB
 * (src/dom/library). Records hold the look of a code and never its content.
 *
 * A store does nothing until `enable`, and `probe` never creates anything: it
 * only answers whether the store can work here, whether it was switched on
 * before, and, as `state`, which control to offer. `disable` switches it off
 * and deletes everything it holds. The file methods are the file library's
 * alone.
 */
export interface LibraryStore {
	probe(): Promise<
		Result<{
			readonly available: boolean;
			readonly enabled: boolean;
			/** Absent from an older store: then 'unavailable', 'on' or 'off' from the two flags. */
			readonly state?: LibraryProbeState;
		}>
	>;
	enable(): Promise<Result<null>>;
	disable(): Promise<Result<null>>;
	list(): Promise<Result<readonly LibraryItemSummary[]>>;
	contents(): Promise<Result<LibraryContents>>;
	save(item: {
		readonly name: string;
		readonly document: StudioDocument;
	}): Promise<Result<LibraryItemSummary>>;
	load(id: string): Promise<Result<LibraryItem>>;
	remove(id: string): Promise<Result<null>>;
	listKits(): Promise<Result<readonly KitSummary[]>>;
	saveKit(item: { readonly name: string; readonly kit: BrandKit }): Promise<Result<KitSummary>>;
	loadKit(id: string): Promise<Result<KitItem>>;
	removeKit(id: string): Promise<Result<null>>;
	/** The file library: hands everything to the person as `<name>.qrlibrary.json`. */
	saveFile?(name?: string): Result<{ readonly filename: string }>;
	/** The file library: puts the library in `file` in place of what the page holds. */
	openFile?(file: Blob): Promise<LibraryFileOpened>;
	/** The file library: whether anything changed since the file was last saved or opened. */
	hasUnsavedChanges?(): boolean;
}

/** What a library holds, as the snapshot shows it. */
export interface LibraryShelves {
	readonly items: readonly LibraryItemSummary[];
	readonly kits: readonly KitSummary[];
	/** Records left out because they could not be read: "2 saved designs could not be read". */
	readonly skipped: readonly Issue[];
	/** The brand kit last applied, whose presets a view offers first. Null until one is. */
	readonly kit: KitItem | null;
}

export type LibraryState =
	| { readonly status: 'unavailable' }
	| { readonly status: 'checking' }
	| { readonly status: 'off' }
	/** Offer "Open my library"; `library/enable` is the consent. */
	| { readonly status: 'unknown' }
	| ({ readonly status: 'on' } & LibraryShelves)
	/** Offer Save and Open; `unsaved` is for a warning before the page is left. */
	| ({ readonly status: 'file'; readonly unsaved: boolean } & LibraryShelves)
	| { readonly status: 'failed'; readonly error: StudioError };

// Inspect and batch.

export type InspectState =
	| { readonly status: 'idle' }
	| { readonly status: 'running'; readonly source: 'image' | 'text' }
	| { readonly status: 'done'; readonly source: 'image' | 'text'; readonly report: InspectReport }
	| { readonly status: 'failed'; readonly source: 'image' | 'text'; readonly error: StudioError };

/** A batch run: rows done of rows plus one (the manifest or the sheet), and what each row came to. */
export type BatchState =
	| { readonly status: 'idle' }
	| {
			readonly status: 'running';
			readonly done: number;
			readonly total: number;
			readonly written: number;
			readonly skipped: number;
			/** About the file as a whole: its encoding, rows it could not read. */
			readonly issues: readonly Issue[];
	  }
	| {
			readonly status: 'done';
			readonly outcomes: readonly BatchOutcome[];
			readonly written: number;
			readonly skipped: number;
			readonly issues: readonly Issue[];
	  }
	| { readonly status: 'failed'; readonly error: StudioError };

/** An error as a view shows it: the code, and the message key and params for its sentence. */
export interface StudioError {
	readonly code: QrStudioErrorCode;
	readonly messageKey: MessageKey;
	readonly params: Readonly<Record<string, number | string>>;
}

// The form.

export interface FieldView {
	readonly key: string;
	readonly kind: FieldKind;
	readonly labelKey: MessageKey;
	readonly hintKey: MessageKey | null;
	readonly required: boolean;
	readonly multiple: boolean;
	readonly maxItems: number | null;
	readonly maxLength: number | null;
	readonly min: number | null;
	readonly max: number | null;
	readonly options: readonly FieldOption[];
	readonly group: string | null;
	readonly advanced: boolean;
	/** Shown masked, never logged. */
	readonly secret: boolean;
	readonly value: FieldValue;
	/** Issues whose path starts at this field, items of a list included. */
	readonly issues: readonly Issue[];
}

export interface FieldGroupView {
	/** Null for the fields that belong to no group. */
	readonly id: string | null;
	readonly labelKey: MessageKey | null;
	/** True when every field in the group is behind the disclosure. */
	readonly advanced: boolean;
	/** Field keys, in schema order. */
	readonly fields: readonly string[];
}

export interface FormView {
	readonly typeId: string;
	readonly labelKey: MessageKey;
	readonly descriptionKey: MessageKey;
	readonly actionKey: MessageKey;
	readonly category: PayloadCategory;
	readonly fields: readonly FieldView[];
	/** The fields gathered for display: consecutive fields of one group together, in schema order. */
	readonly groups: readonly FieldGroupView[];
	readonly hasAdvanced: boolean;
	/** Issues about the value as a whole rather than one field. */
	readonly issues: readonly Issue[];
	readonly compatibility: readonly CompatibilityNote[];
	/** What a scanner should warn about, for a value with no errors. */
	readonly safety: readonly SafetyFinding[];
	/** True when the content fixes the whole design (the Swiss QR-bill). */
	readonly designLocked: boolean;
}

// The symbol.

export interface SegmentSummary {
	readonly mode: Mode;
	/** Characters as the bitstream counts them. */
	readonly chars: number;
	readonly eci: number | null;
}

export interface SymbolView {
	readonly symbology: string;
	readonly symbologyLabelKey: MessageKey;
	readonly phoneReadable: boolean;
	/** Said wherever a symbology most phones cannot read is shown. Null for QR. */
	readonly noteKey: MessageKey | null;
	readonly version: string;
	readonly ecLevel: EcLevel;
	readonly mask: number;
	/** Width and height in modules, without the quiet zone. */
	readonly modules: readonly [number, number];
	readonly quietZone: number;
	readonly capacity: {
		readonly usedBits: number;
		readonly totalBits: number;
		/** usedBits over totalBits: how full this symbol is. */
		readonly fraction: number;
		/** usedBits over what the largest symbol the design allows holds. */
		readonly ofLargest: number;
	};
	readonly segments: readonly SegmentSummary[];
}

export type SymbolState =
	| { readonly status: 'ok'; readonly view: SymbolView }
	| { readonly status: 'stale'; readonly view: SymbolView; readonly issue: Issue }
	| { readonly status: 'empty'; readonly issue: Issue | null };

export interface PreviewState {
	readonly svg: string;
	readonly scene: Scene;
	/** What the scene builder could not draw as asked. */
	readonly issues: readonly Issue[];
	/** Why this design cannot be saved as EPS (transparency), so a view can offer PDF instead. Empty when it can. */
	readonly epsIssues: readonly Issue[];
}

export interface DesignState {
	/** The design as drawn: the person's, after the content's constraints. */
	readonly effective: QrDesignV1;
	/** Validation warnings for the person's design and what the constraints changed. */
	readonly issues: readonly Issue[];
	/** True when the content fixes the whole look, so design changes are refused. */
	readonly locked: boolean;
	/** What the content prints over the code whatever the design (the Swiss QR-bill's cross). */
	readonly overlay: DesignOverlay | null;
}

export type VerifyState =
	| { readonly status: 'idle' }
	| {
			readonly status: 'running';
			/** 0 to 1. */
			readonly progress: number;
			readonly revision: number;
			readonly axis: CaptureAxis | 'static' | null;
			/** Captures per level: 8 for a check asked for, fewer for the one that follows typing. */
			readonly captureSeeds: number;
			readonly full: boolean;
	  }
	| {
			readonly status: 'done';
			readonly report: VerifyReport;
			readonly fixes: readonly Fix[];
			/** True once the document has changed since the report was made. */
			readonly stale: boolean;
			readonly revision: number;
			/** As for running: how thorough the check that made this report was. */
			readonly captureSeeds: number;
			readonly full: boolean;
	  }
	| { readonly status: 'failed'; readonly error: StudioError; readonly revision: number };

// The catalogue.

export interface CatalogueEntry {
	readonly id: string;
	readonly labelKey: MessageKey;
	readonly params: readonly ParamSchema[];
	/** A small SVG, drawn on first call and kept until the registry changes. */
	thumbnail(): string;
}

export interface RegionCatalogueEntry extends CatalogueEntry {
	readonly part: 'outer' | 'inner';
	readonly kinds: readonly RegionKind[];
	/** The other part's ids this makes a finder the strict reader finds with, at default params, among square modules. */
	readonly pairs: readonly string[];
	/** The same for each family of modules (`ModuleCatalogueEntry.family`). A contract addition. */
	readonly pairsByFamily: Readonly<Record<ModuleFamily, readonly string[]>>;
}

export interface ModuleCatalogueEntry extends CatalogueEntry {
	/** Which family of finder pairs the shape is drawn with. A contract addition. */
	readonly family: ModuleFamily;
}

export interface FrameCatalogueEntry extends CatalogueEntry {
	readonly text: { readonly maxLines: number; readonly maxChars: number } | null;
}

export interface PresetCatalogueEntry extends CatalogueEntry {
	readonly category: PresetCategory;
	/** The smallest printed width that scans, at the preset's own level. */
	readonly minSizeMm: number;
	readonly ecLevels: readonly EcLevel[];
	/**
	 * The smallest printed width at each level in `ecLevels`: show or suggest
	 * the one for the level the design will be built at. A contract addition.
	 */
	readonly sizesMm: Readonly<Partial<Record<EcLevel, number>>>;
}

export interface PayloadTypeEntry {
	readonly id: string;
	readonly labelKey: MessageKey;
	readonly descriptionKey: MessageKey;
	readonly actionKey: MessageKey;
	readonly category: PayloadCategory;
	/** False for a type that can be read and explained but not made. */
	readonly generate: boolean;
	readonly designLocked: boolean;
}

export interface SymbologyCatalogueEntry {
	readonly id: string;
	readonly labelKey: MessageKey;
	readonly phoneReadable: boolean;
	readonly noteKey: MessageKey | null;
	readonly ecLevels: readonly EcLevel[];
	readonly quietZone: number;
}

export interface Catalogue {
	readonly payloadTypes: readonly {
		readonly category: PayloadCategory;
		readonly labelKey: MessageKey;
		readonly types: readonly PayloadTypeEntry[];
	}[];
	readonly symbologies: readonly SymbologyCatalogueEntry[];
	readonly moduleShapes: readonly ModuleCatalogueEntry[];
	readonly rings: readonly RegionCatalogueEntry[];
	readonly centres: readonly RegionCatalogueEntry[];
	readonly fills: readonly CatalogueEntry[];
	readonly frames: readonly FrameCatalogueEntry[];
	readonly icons: readonly CatalogueEntry[];
	readonly presets: readonly {
		readonly category: PresetCategory;
		readonly labelKey: MessageKey;
		readonly presets: readonly PresetCatalogueEntry[];
	}[];
}

/** Preset pictures drawn with the visitor's own code, or the sample when there is none yet. */
export interface PresetThumbnails {
	get(id: string): string | null;
}

export interface Refusal {
	/** The action or command refused, or 'initial' for what the studio was opened with. */
	readonly action: StudioAction['type'] | StudioCommand['type'] | 'initial';
	readonly issues: readonly Issue[];
}

export interface StudioSnapshot {
	/** Counts document changes; async results carry the one they were made for. */
	readonly revision: number;
	readonly document: StudioDocument;
	readonly form: FormView;
	readonly payloadIssues: readonly Issue[];
	readonly symbol: SymbolState;
	/** Built on first read and kept for the revision. Null while there is no code to draw. */
	readonly preview: PreviewState | null;
	readonly design: DesignState;
	readonly verify: VerifyState;
	readonly history: { readonly canUndo: boolean; readonly canRedo: boolean };
	/** Identity changes only when a registry's version changes. */
	readonly catalogue: Catalogue;
	readonly presetThumbnails: PresetThumbnails;
	readonly inspect: InspectState;
	readonly batch: BatchState;
	readonly library: LibraryState;
	/** Why the last action changed nothing, until the next one that does. */
	readonly refusal: Refusal | null;
}

// Injected dependencies.

/** Where deferred work runs. The default is setTimeout. */
export interface Scheduler {
	/** Run `task` after at least `delayMs`. Returns a function that cancels it if it has not run. */
	later(task: () => void, delayMs: number): () => void;
	/** How long one slice of long work may hold the thread, in milliseconds. */
	readonly sliceMs: number;
}

/** jpeg and webp, which this package does not encode itself; the dom layer's canvas does. */
export interface RasterEncoder {
	encode(
		image: RgbaImage,
		format: 'jpeg' | 'webp',
		options: { readonly quality?: number },
	): Promise<Result<Uint8Array>>;
}

export interface StudioOptions {
	readonly registries?: Registries;
	/** Default: `verifyGenerator` in time slices on this thread. The website passes one that posts to a worker. */
	readonly verifyRunner?: VerifyRunner;
	/** Default: verify's `runVerifyJob`. Null, with no runner, leaves the scan check out (it reports itself unavailable). */
	readonly verifyGenerator?: VerifyGenerator | null;
	/**
	 * Captures per level for the check that runs again by itself after a change,
	 * 1 to 8. Default 2: a quarter of the work of the full check, which
	 * `verify/request` always runs at 8.
	 */
	readonly liveCaptureSeeds?: number;
	/** Default: setTimeout(0) slices of about 8 ms. */
	readonly scheduler?: Scheduler;
	/** Milliseconds, monotonic. Default performance.now. */
	readonly clock?: () => number;
	readonly library?: LibraryStore | null;
	/** Where a caption's font is found. Default: the text layer's built-in family. */
	readonly fonts?: FontRegistry;
	/** A design link fragment, or a document. */
	readonly initial?: string | StudioDocument;
	/** Undo steps kept. Default 200. */
	readonly historyLimit?: number;
	/** Default 250. */
	readonly verifyDebounceMs?: number;
	/** For jpeg and webp exports. */
	readonly rasterEncoder?: RasterEncoder | null;
	/** Default: inspect's `inspectImage` and `inspectText`. Null leaves reading codes out (unavailable). */
	readonly inspector?: Inspector | null;
	/** The PDF and EPS writers. Default: render's `sceneToPdf` and `sceneToEps`; null leaves both out. */
	readonly printer?: Printer | null;
	/** Default: verify's `suggestFixes`, over the studio's design registries. */
	readonly suggestFixes?: FixSuggester;
	/** The seed verify jobs and shuffles start from. Default 1. */
	readonly seed?: number;
}

export interface Studio {
	getSnapshot(): StudioSnapshot;
	subscribe(listener: () => void): () => void;
	dispatch(action: StudioAction): void;
	run<C extends StudioCommand>(command: C): Promise<Result<CommandResult<C>>>;
	dispose(): void;
}
