/**
 * The headless studio: the one controller both interfaces render.
 *
 * Everything a person can do is an action (`dispatch`) or a command (`run`),
 * and everything a view shows is in the snapshot, so a view holds no document
 * state of its own. The website reads it through `useSyncExternalStore`; the
 * offline app subscribes and draws. Both see the same snapshot object until
 * something changes, and a part of it that did not change keeps its identity,
 * so either can skip drawing what is the same.
 *
 * The expensive parts of a snapshot (the form, the symbol, the preview, the
 * catalogue) are worked out when a view first reads them and are kept for as
 * long as what they depend on is the same object. Typing fast therefore
 * builds no scene for a keystroke nobody drew.
 *
 * Nothing a person can do makes this throw. An action that cannot be done
 * changes nothing and says why in `snapshot.refusal`; a command that cannot
 * be done resolves to a failed Result. Only a caller's mistake (an action of
 * no known type, an option of the wrong kind) throws, as a TypeError.
 */

import { CancelledError, QrStudioError } from '../core/errors.js';
import { issue } from '../core/issue.js';
import type { Issue } from '../core/issue.js';
import { err, ok } from '../core/result.js';
import type { Result } from '../core/result.js';
import { applyConstraints } from '../design/constraints.js';
import { designLink } from '../design/link.js';
import { buildScene } from '../design/scene.js';
import type { DesignOverlay, Preset, QrDesignV1, RegionShape } from '../design/types.js';
import { validateDesign } from '../design/validate.js';
import { detectPayload } from '../payload/detect.js';
import type { FieldValue, PayloadType } from '../payload/types.js';
import { epsIssues, sceneToEps } from '../render/eps.js';
import { sceneToPdf } from '../render/pdf.js';
import { sceneToSvg } from '../render/svg.js';
import { decodeCsvBytes } from '../batch/text-decoding.js';
import { parseCsv } from '../batch/csv.js';
import { planBatch } from '../batch/plan.js';
import { runBatch } from '../batch/run.js';
import { scanCheckVerifier } from '../batch/verify.js';
import type { BatchOutcome, BatchRow } from '../batch/types.js';
import { createRegistries } from '../registries.js';
import { createFontRegistry } from '../text/registry.js';
import type { Registries } from '../registries.js';
import type { BuiltSymbol } from '../symbology/types.js';
import { AssetCache } from './assets.js';
import { buildCatalogue, presetThumbnails, registryVersions } from './catalogue.js';
import {
	conditionsFrom,
	designFrom,
	documentFrom,
	documentFromLink,
	defaultDocument,
	fieldsFor,
	isFieldValue,
} from './document.js';
import { exportSymbol } from './export.js';
import { formView } from './form.js';
import {
	EMPTY_HISTORY,
	beginGroup,
	breakRun,
	cancelGroup,
	commitGroup,
	recordChange,
	redo,
	sameWork,
	undo,
} from './history.js';
import type { History, Work } from './history.js';
import { applyKit } from './kit.js';
import { STUDIO_KEYS, asStudioError, studioError } from './keys.js';
import { applyPatch, pathProblem } from './patch.js';
import type {
	DesignPatch,
	Fix,
	FixSuggester,
	Inspector,
	Printer,
	VerifyConditions,
	VerifyProgress,
} from './seams.js';
import { sameJson, share } from './share.js';
import { driveInSlices } from './slices.js';
import { trackedScheduler } from './timers.js';
import { conformingPairs, shuffleDesign } from './shuffle.js';
import { contentOf, encodeContent, optionsKey, symbolView } from './symbol.js';
import type { Content, Encoded } from './symbol.js';
import type {
	BatchState,
	Catalogue,
	CommandResult,
	DesignState,
	FormView,
	InspectState,
	KitItem,
	LibraryContents,
	LibraryProbeState,
	LibraryState,
	PresetThumbnails,
	PreviewState,
	Refusal,
	Scheduler,
	Studio,
	StudioAction,
	StudioCommand,
	StudioDocument,
	StudioMode,
	StudioOptions,
	StudioSnapshot,
	SymbolState,
	SymbolView,
	VerifyState,
} from './types.js';
import {
	FULL_CAPTURE_SEEDS,
	LIVE_CAPTURE_SEEDS,
	UNAVAILABLE_RUNNER,
	slicedVerifyRunner,
	verifyJob,
} from './verify.js';
import { inspectImage, inspectText } from '../inspect/inspect.js';
import { runVerifyJob } from '../verify/job.js';
import { applyDesignPatch, suggestFixes as suggestVerifyFixes } from '../verify/fixes.js';

const DEFAULT_HISTORY_LIMIT = 200;
const DEFAULT_DEBOUNCE_MS = 250;
/** Longer than any code holds, by a wide margin, and short enough that a pasted book is refused at once. */
export const MAX_RAW_TEXT = 16384;
/** A design file is a few kilobytes; one with four logos is a few hundred. */
export const MAX_DESIGN_FILE = 4 * 1024 * 1024;
const MODES: readonly StudioMode[] = ['create', 'scan', 'bulk'];

/** The inspect layer's own reader. */
const DEFAULT_INSPECTOR: Inspector = Object.freeze({ image: inspectImage, text: inspectText });

/** render's own print writers. */
const RENDER_PRINTER: Printer = Object.freeze({ pdf: sceneToPdf, eps: sceneToEps });

/** setTimeout, in slices of about 8 ms. */
export const DEFAULT_SCHEDULER: Scheduler = Object.freeze({
	later(task: () => void, delayMs: number): () => void {
		const handle = setTimeout(task, delayMs);
		return () => clearTimeout(handle);
	},
	sliceMs: 8,
});

function defaultClock(): number {
	return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/** A one-argument cache that remembers the last few results by the identity of their inputs. */
function memo<A extends readonly unknown[], R>(
	compute: (...args: A) => R,
	keep = 4,
): (...args: A) => R {
	const entries: { readonly args: A; readonly value: R }[] = [];
	return (...args: A): R => {
		for (const entry of entries) {
			if (entry.args.length === args.length && entry.args.every((arg, i) => arg === args[i])) {
				return entry.value;
			}
		}
		const value = compute(...args);
		entries.unshift({ args, value });
		if (entries.length > keep) entries.pop();
		return value;
	};
}

function frozen<T>(value: T): T {
	return Object.freeze(value);
}

/** What a symbol state draws, if anything. */
interface Shown {
	readonly state: SymbolState;
	readonly symbol: BuiltSymbol | null;
	readonly design: QrDesignV1;
}

export function createStudio(options: StudioOptions = {}): Studio {
	if (typeof options !== 'object' || options === null) {
		throw new TypeError('createStudio: options is an object.');
	}
	const registries: Registries = options.registries ?? createRegistries();
	const historyLimit = options.historyLimit ?? DEFAULT_HISTORY_LIMIT;
	if (!Number.isInteger(historyLimit) || historyLimit < 0) {
		throw new TypeError('createStudio: historyLimit is a whole number, 0 or more.');
	}
	const debounceMs = options.verifyDebounceMs ?? DEFAULT_DEBOUNCE_MS;
	if (typeof debounceMs !== 'number' || !Number.isFinite(debounceMs) || debounceMs < 0) {
		throw new TypeError('createStudio: verifyDebounceMs is a number of milliseconds, 0 or more.');
	}
	const liveSeeds = options.liveCaptureSeeds ?? LIVE_CAPTURE_SEEDS;
	if (!Number.isInteger(liveSeeds) || liveSeeds < 1 || liveSeeds > FULL_CAPTURE_SEEDS) {
		throw new TypeError('createStudio: liveCaptureSeeds is a whole number from 1 to 8.');
	}
	const seed = options.seed ?? 1;
	if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
		throw new TypeError('createStudio: seed is an integer from 0 to 2^32 - 1.');
	}
	const clock = options.clock ?? defaultClock;
	const suggestFixes: FixSuggester =
		options.suggestFixes ??
		((report, design) => suggestVerifyFixes(report, design, registries.design));
	// The inspector by default; null leaves reading codes out of this copy.
	const inspector: Inspector | null =
		options.inspector === undefined ? DEFAULT_INSPECTOR : options.inspector;
	const library = options.library ?? null;
	const assets = new AssetCache();
	// One registry for checking captions and for drawing them, so a font a
	// website registers at runtime is seen by both.
	const fonts = options.fonts ?? createFontRegistry();

	// Every timer this studio starts, so dispose can stop them all.
	const timers = trackedScheduler(options.scheduler ?? DEFAULT_SCHEDULER);
	const later = (task: () => void, delayMs: number): (() => void) => timers.later(task, delayMs);

	// The default runner steps verify's generator in slices on this thread,
	// through the tracked timers above so dispose stops it too.
	const generator = options.verifyGenerator === undefined ? runVerifyJob : options.verifyGenerator;
	const runner =
		options.verifyRunner ??
		(generator === null
			? UNAVAILABLE_RUNNER
			: slicedVerifyRunner(generator, {
					registries,
					scheduler: timers,
					clock,
				}));

	// The document and everything about it that is not derived.
	let initialIssues: readonly Issue[] = [];
	let document: StudioDocument;
	if (typeof options.initial === 'string') {
		const opened = documentFromLink(options.initial, registries);
		document = opened.document;
		initialIssues = opened.issues;
	} else if (options.initial !== undefined) {
		const opened = documentFrom(options.initial, registries, fonts);
		document = opened.document;
		initialIssues = opened.issues;
	} else {
		document = defaultDocument(registries);
	}
	let revision = 0;
	let history: History = EMPTY_HISTORY;
	let refusal: Refusal | null =
		initialIssues.length === 0
			? null
			: frozen({ action: 'initial', issues: frozen(initialIssues) });
	let verify: VerifyState = frozen({ status: 'idle' }) as VerifyState;
	let lastDone: Extract<VerifyState, { status: 'done' }> | null = null;
	let inspect: InspectState = frozen({ status: 'idle' });
	let batch: BatchState = frozen({ status: 'idle' });
	let batchRun: AbortController | null = null;
	let libraryState: LibraryState = frozen(
		library === null ? { status: 'unavailable' } : { status: 'checking' },
	);
	let disposed = false;
	const listeners = new Set<() => void>();

	// Derived state, each part kept for as long as its inputs are the same objects.

	// A document's type is always one the registry holds: every way in
	// (documentFrom, payload/type, payload/raw) checks, and a registry never
	// loses an entry.
	const typeOf = (id: string): PayloadType => registries.payloads.require(id);

	const constrained = memo((design: QrDesignV1, type: PayloadType): DesignState => {
		const applied = applyConstraints(design, type.constraints);
		const validated = validateDesign(design, registries.design, { fonts }).issues;
		return frozen({
			effective: share(design, applied.design),
			issues: frozen([...validated, ...applied.issues]),
			locked: type.constraints?.designLocked === true,
			overlay: applied.overlay,
		});
	});

	const contentFor = memo((type: PayloadType, fields: StudioDocument['fields']): Content =>
		contentOf(type, fields),
	);

	const encodeCache = new Map<string, Encoded>();
	const encodeCached = (text: string, design: QrDesignV1): Encoded => {
		const key = `${registries.symbologies.version}\u0000${optionsKey(design)}\u0000${text}`;
		let found = encodeCache.get(key);
		if (found === undefined) {
			found = encodeContent(text, design, registries.symbologies);
			encodeCache.set(key, found);
			while (encodeCache.size > 8) encodeCache.delete(encodeCache.keys().next().value as string);
		}
		return found;
	};

	// The last content that made a code, for the "never goes blank" rule.
	// Worked out with every snapshot rather than when a view reads one, so
	// the code that stays on screen is the last that worked whatever a view
	// happened to read; encoding is cheap beside drawing, which stays lazy.
	type LastGood = { readonly text: string; readonly symbol: BuiltSymbol };
	let lastGood: LastGood | null = null;

	const viewFor = memo((symbol: BuiltSymbol, text: string, design: QrDesignV1): SymbolView =>
		symbolView(symbol, text, design, registries.symbologies),
	);
	const okState = memo((view: SymbolView): SymbolState => frozen({ status: 'ok', view }));

	const shownFor = memo((content: Content, design: QrDesignV1, last: LastGood | null): Shown => {
		let reason: Issue;
		if (content.ok) {
			const encoded = encodeCached(content.text, design);
			if (encoded.ok) {
				if (last?.symbol !== encoded.symbol)
					lastGood = { text: content.text, symbol: encoded.symbol };
				const view = viewFor(encoded.symbol, content.text, design);
				return { state: okState(view), symbol: encoded.symbol, design };
			}
			reason = encoded.issue;
		} else {
			reason = content.reason;
		}
		if (last === null) {
			return { state: frozen({ status: 'empty', issue: reason }), symbol: null, design };
		}
		// The last content that worked, drawn with the design as it is now if it
		// still fits, and as it was if the design no longer allows it.
		const again = encodeCached(last.text, design);
		const symbol = again.ok ? again.symbol : last.symbol;
		const view = viewFor(symbol, last.text, design);
		return { state: frozen({ status: 'stale', view, issue: reason }), symbol, design };
	}, 2);

	const formFor = memo(
		(type: PayloadType, fields: StudioDocument['fields'], issues: readonly Issue[]): FormView =>
			formView(type, fields, issues),
	);

	const previewFor = memo(
		(
			symbol: BuiltSymbol | null,
			design: QrDesignV1,
			overlay: DesignOverlay | null,
		): PreviewState | null => {
			if (symbol === null) return null;
			try {
				const built = buildScene(symbol, design, {
					registries: registries.design,
					assets: assets.lookup(design),
					fonts,
					seed,
					overlay,
				});
				return frozen({
					svg: sceneToSvg(built.scene),
					scene: built.scene,
					issues: built.issues,
					epsIssues: frozen([...epsIssues(built.scene)]),
				});
			} catch {
				// A shape or frame of somebody else's that throws while it draws. The
				// symbol state still says what the code is; there is just no picture.
				return null;
			}
		},
		2,
	);

	let catalogueCache: { readonly key: string; readonly value: Catalogue } | null = null;
	const catalogue = (): Catalogue => {
		const key = registryVersions(registries);
		if (catalogueCache?.key !== key) {
			catalogueCache = { key, value: buildCatalogue(registries, fonts) };
		}
		return catalogueCache.value;
	};
	const thumbnailsFor = memo(
		(cat: Catalogue, symbol: BuiltSymbol | null, type: PayloadType): PresetThumbnails =>
			presetThumbnails(registries, cat, symbol, type.constraints, fonts),
		2,
	);
	let pairsCache: {
		readonly version: number;
		readonly pairs: readonly (readonly [RegionShape, RegionShape])[];
	} | null = null;
	const pairs = (): readonly (readonly [RegionShape, RegionShape])[] => {
		const version = registries.design.regionShapes.version;
		if (pairsCache?.version !== version)
			pairsCache = { version, pairs: conformingPairs(registries.design) };
		return pairsCache.pairs;
	};

	const historyView = memo((canUndo: boolean, canRedo: boolean) => frozen({ canUndo, canRedo }));

	// The snapshot.

	function makeSnapshot(): StudioSnapshot {
		const doc = document;
		const at = revision;
		const type = typeOf(doc.typeId);
		const content = (): Content => contentFor(type, doc.fields);
		const designState = (): DesignState => constrained(doc.design, type);
		const found = shownFor(content(), designState().effective, lastGood);
		const shown = (): Shown => found;
		const snapshot: StudioSnapshot = {
			revision: at,
			document: doc,
			get form() {
				return formFor(type, doc.fields, content().issues);
			},
			get payloadIssues() {
				return content().issues;
			},
			get symbol() {
				return shown().state;
			},
			get preview() {
				const found = shown();
				return previewFor(found.symbol, found.design, designState().overlay);
			},
			get design() {
				return designState();
			},
			verify,
			history: historyView(
				history.past.length > 0 ||
					(history.group !== null && !sameWork(history.group.base, work())),
				history.future.length > 0,
			),
			get catalogue() {
				return catalogue();
			},
			get presetThumbnails() {
				const found = shown();
				return thumbnailsFor(catalogue(), found.state.status === 'ok' ? found.symbol : null, type);
			},
			inspect,
			batch,
			library: libraryState,
			refusal,
		};
		return Object.freeze(snapshot);
	}

	let snapshot = makeSnapshot();
	let snapshotVersions = registryVersions(registries);

	function notify(): void {
		snapshot = makeSnapshot();
		snapshotVersions = registryVersions(registries);
		let first: unknown;
		let threw = false;
		for (const listener of [...listeners]) {
			try {
				listener();
			} catch (thrown) {
				// Every listener hears about the change; the first failure is
				// rethrown after, so one broken view does not starve the others.
				if (!threw) first = thrown;
				threw = true;
			}
		}
		if (threw) throw first;
	}

	// Verify.

	let verifyArmed = false;
	let verifyTimer: (() => void) | null = null;
	let verifyRun: { readonly id: number; readonly controller: AbortController } | null = null;
	let verifyRuns = 0;
	/** What the last job was made from, so a change that does not touch it starts nothing. */
	let verifyInputs: { content: Content; design: QrDesignV1; conditions: VerifyConditions } | null =
		null;

	function stopRun(): void {
		if (verifyRun !== null) {
			verifyRun.controller.abort();
			verifyRun = null;
		}
	}

	const IDLE: VerifyState = frozen({ status: 'idle' });
	const staleOf = memo(
		(done: Extract<VerifyState, { status: 'done' }>): VerifyState =>
			frozen({ ...done, stale: true }),
		1,
	);
	/** Not running: the last report, marked stale, or nothing. */
	function idleVerify(): VerifyState {
		return lastDone === null ? IDLE : staleOf(lastDone);
	}

	// How thorough the next check is: the full count when someone asks for it,
	// the live count when it runs again by itself after a change.
	let nextSeeds = FULL_CAPTURE_SEEDS;

	function scheduleVerify(seeds: number): void {
		nextSeeds = seeds;
		verifyTimer?.();
		verifyTimer = later(startVerify, debounceMs);
	}

	function startVerify(): void {
		verifyTimer = null;
		const type = typeOf(document.typeId);
		const content = contentFor(type, document.fields);
		const design = constrained(document.design, type).effective;
		verifyInputs = { content, design, conditions: document.conditions };
		stopRun();
		// No code to check: the content cannot be made, or is too long to fit.
		const encoded = content.ok ? encodeCached(content.text, design) : null;
		if (!content.ok || encoded === null || !encoded.ok) {
			verify = idleVerify();
			notify();
			return;
		}
		const id = (verifyRuns += 1);
		const controller = new AbortController();
		verifyRun = { id, controller };
		const at = revision;
		const { overlay } = constrained(document.design, type);
		const captureSeeds = nextSeeds;
		const full = captureSeeds === FULL_CAPTURE_SEEDS;
		const job = verifyJob({
			content: content.text,
			design,
			conditions: checkedConditions(encoded.symbol, design, overlay),
			seed,
			assets: assets.all(design),
			overlay,
			captureSeeds,
		});
		verify = frozen({
			status: 'running',
			progress: 0,
			revision: at,
			axis: null,
			captureSeeds,
			full,
		});
		notify();
		const current = (): boolean => !disposed && verifyRun?.id === id;
		const progress = (p: VerifyProgress): void => {
			if (!current()) return;
			const fraction = p.total > 0 ? Math.min(1, Math.max(0, p.done / p.total)) : 0;
			verify = frozen({
				status: 'running',
				progress: fraction,
				revision: at,
				axis: p.axis,
				captureSeeds,
				full,
			});
			notify();
		};
		const settle = (result: Result<unknown>): void => {
			if (!current()) return;
			verifyRun = null;
			if (result.ok) {
				const report = result.value as Extract<VerifyState, { status: 'done' }>['report'];
				let fixes: readonly Fix[] = [];
				try {
					fixes = suggestFixes(report, design);
				} catch {
					fixes = [];
				}
				lastDone = frozen({
					status: 'done',
					report,
					fixes: frozen([...fixes]),
					stale: false,
					revision: at,
					captureSeeds,
					full,
				});
				verify = lastDone;
			} else if (result.error.code === 'cancelled') {
				verify = idleVerify();
			} else {
				verify = frozen({ status: 'failed', error: studioError(result.error), revision: at });
			}
			notify();
		};
		let pending: Promise<Result<unknown>>;
		try {
			pending = runner.run(job, controller.signal, progress);
		} catch (thrown) {
			pending = Promise.resolve(err(asStudioError(thrown, 'platform/unavailable')));
		}
		pending.then(settle, (thrown: unknown) =>
			settle(err(asStudioError(thrown, 'platform/unavailable'))),
		);
	}

	/**
	 * The conditions a check runs at. When the design is printed at a size of
	 * its own, that is the size checked: the symbol with its quiet zone, read
	 * from the scene, since the design measures its size on its own basis (the
	 * whole artwork, or the Swiss QR-bill's symbol alone). Otherwise the size
	 * the person gave the conditions.
	 */
	function checkedConditions(
		symbol: BuiltSymbol,
		design: QrDesignV1,
		overlay: DesignOverlay | null,
	): VerifyConditions {
		const units = previewFor(symbol, design, overlay)?.scene.unitsPerMm;
		if (units === undefined) return document.conditions;
		const sizeMm = (symbol.matrix.width + 2 * design.quietZone) / units;
		return frozen({ ...document.conditions, sizeMm });
	}

	/** After a change: start the check again if what it checks has changed. */
	function verifyAfterChange(): void {
		if (!verifyArmed || verifyInputs === null) return;
		const type = typeOf(document.typeId);
		const content = contentFor(type, document.fields);
		const design = constrained(document.design, type).effective;
		const same =
			content === verifyInputs.content &&
			design === verifyInputs.design &&
			document.conditions === verifyInputs.conditions;
		if (same) return;
		verifyInputs = { content, design, conditions: document.conditions };
		if (verifyRun !== null) {
			stopRun();
			verify = idleVerify();
		} else if (verify.status === 'done' && !verify.stale) {
			verify = idleVerify();
		}
		scheduleVerify(liveSeeds);
	}

	// Changes.

	const work = (): Work => ({
		typeId: document.typeId,
		fields: document.fields,
		design: document.design,
	});

	function refuse(action: Refusal['action'], issues: readonly Issue[]): void {
		refusal = frozen({ action, issues: frozen([...issues]) });
		notify();
	}

	/** The document changed: a new revision, the refusal cleared, the check told. */
	function changed(next: StudioDocument): void {
		document = Object.freeze(next);
		revision += 1;
		refusal = null;
		verifyAfterChange();
		notify();
	}

	function changeWork(next: Partial<Work>, coalesce: string | null): void {
		history = recordChange(history, work(), coalesce, historyLimit);
		changed({ ...document, ...next });
	}

	function restore(target: Work): void {
		changed({ ...document, typeId: target.typeId, fields: target.fields, design: target.design });
	}

	/**
	 * A new design for the document, from anything: migrated, validated,
	 * shared with the old one where they agree, and refused if the content's
	 * constraints would undo it.
	 */
	/** What a new design for the document comes to: a change, a refusal, or nothing at all. */
	type Prepared =
		| { readonly kind: 'change'; readonly next: QrDesignV1 }
		| { readonly kind: 'refuse'; readonly issues: readonly Issue[] }
		| { readonly kind: 'same' };

	/**
	 * A new design for the document, from anything: migrated, validated,
	 * shared with the old one where they agree, and refused if the content's
	 * constraints would undo it.
	 */
	function prepareDesign(input: unknown, path: readonly (string | number)[]): Prepared {
		const checked = designFrom(input, registries, fonts);
		if (checked.design === null) return { kind: 'refuse', issues: checked.issues };
		const current = document.design;
		const next = share(current, checked.design);
		if (next === current) {
			// Nothing a design holds changed: an unknown key the validator
			// dropped, say. Said, so the view does not seem to ignore the person.
			const said = checked.issues.filter((found) => found.severity !== 'info');
			return said.length > 0 && !sameJson(input, current)
				? { kind: 'refuse', issues: said }
				: { kind: 'same' };
		}
		const type = typeOf(document.typeId);
		const { constraints } = type;
		if (
			constraints !== undefined &&
			sameJson(
				applyConstraints(current, constraints).design,
				applyConstraints(next, constraints).design,
			)
		) {
			const locked = constraints.designLocked === true;
			return {
				kind: 'refuse',
				issues: [
					issue(locked ? STUDIO_KEYS.designLocked : STUDIO_KEYS.constrained, path, 'warning', {
						type: type.id,
					}),
				],
			};
		}
		return { kind: 'change', next };
	}

	function changeDesign(
		action: Refusal['action'],
		input: unknown,
		coalesce: string | null,
		path: readonly (string | number)[],
	): void {
		const prepared = prepareDesign(input, path);
		if (prepared.kind === 'refuse') refuse(action, prepared.issues);
		else if (prepared.kind === 'change') changeWork({ design: prepared.next }, coalesce);
	}

	function presetDesign(preset: Preset, current: QrDesignV1): QrDesignV1 {
		const theirs = preset.design;
		// The person's own picture stays when the preset brings no logo of its own.
		const ownPicture = current.logo !== null && current.logo.source.kind === 'asset';
		const keepLogo = theirs.logo === null && ownPicture;
		const level = current.symbol.ecLevel;
		const ecLevel =
			level !== undefined && preset.ecLevels.includes(level)
				? level
				: (theirs.symbol.ecLevel ?? level);
		return {
			...theirs,
			symbol: { ...current.symbol, ...(ecLevel === undefined ? {} : { ecLevel }) },
			logo: keepLogo ? current.logo : theirs.logo,
			output: { ...current.output, colourSpace: theirs.output.colourSpace },
			...(keepLogo && current.assets !== undefined ? { assets: current.assets } : {}),
			...(current.name === undefined ? {} : { name: current.name }),
		};
	}

	function fieldsOf(type: PayloadType, text: string): StudioDocument['fields'] | null {
		try {
			const parsed = type.parse(text) as Readonly<Record<string, unknown>>;
			const given: Record<string, FieldValue> = {};
			for (const [key, value] of Object.entries(parsed))
				if (isFieldValue(value)) given[key] = value;
			return fieldsFor(type, given);
		} catch {
			return null;
		}
	}

	function remake(text: string): void {
		if (text.length > MAX_RAW_TEXT) {
			refuse('payload/raw', [
				issue(STUDIO_KEYS.rawTooLong, ['text'], 'error', {
					length: text.length,
					max: MAX_RAW_TEXT,
				}),
			]);
			return;
		}
		const detected = detectPayload(text, registries.payloads).type;
		// detectPayload falls back to the built-in text type even when the
		// registry has none, so only what the registry holds is taken.
		const candidates = [detected, registries.payloads.get('text')].filter(
			(type): type is PayloadType =>
				type !== undefined && type.generate !== false && registries.payloads.get(type.id) === type,
		);
		for (const type of candidates) {
			const fields = fieldsOf(type, text);
			if (fields !== null) {
				changeWork({ typeId: type.id, fields }, null);
				return;
			}
		}
		refuse('payload/raw', [issue(STUDIO_KEYS.unknownType, ['text'], 'error')]);
	}

	function patchDesign(
		action: Refusal['action'],
		patch: DesignPatch | readonly DesignPatch[],
		coalesce: string | null,
	): void {
		const list: readonly DesignPatch[] = Array.isArray(patch) ? patch : [patch as DesignPatch];
		if (list.length === 0) return;
		let raw: unknown = document.design;
		for (const one of list) {
			const problem = typeof one === 'object' && one !== null ? pathProblem(one.path) : 'shape';
			if (problem !== null) {
				refuse(action, [issue(STUDIO_KEYS.patchPath, [], 'error', { problem })]);
				return;
			}
			raw = applyPatch(raw, one.path, one.value);
		}
		const first = list[0] as DesignPatch;
		changeDesign(action, raw, coalesce, first.path);
	}

	function dispatch(action: StudioAction): void {
		if (typeof action !== 'object' || action === null || typeof action.type !== 'string') {
			throw new TypeError('dispatch: an action is an object with a type.');
		}
		if (disposed) return;
		switch (action.type) {
			case 'mode': {
				if (!MODES.includes(action.mode)) {
					throw new TypeError("dispatch: mode is 'create', 'scan' or 'bulk'.");
				}
				if (action.mode !== document.mode) changed({ ...document, mode: action.mode });
				return;
			}
			case 'payload/type': {
				const type =
					typeof action.typeId === 'string' ? registries.payloads.get(action.typeId) : undefined;
				if (type === undefined) {
					refuse(action.type, [issue(STUDIO_KEYS.unknownType, ['typeId'], 'error')]);
					return;
				}
				if (type.generate === false) {
					refuse(action.type, [
						issue(STUDIO_KEYS.readOnlyType, ['typeId'], 'error', { type: type.id }),
					]);
					return;
				}
				if (type.id === document.typeId) return;
				changeWork({ typeId: type.id, fields: fieldsFor(type, document.fields) }, null);
				return;
			}
			case 'payload/field': {
				const type = typeOf(document.typeId);
				const field = type.fields.find((candidate) => candidate.key === action.key);
				if (field === undefined) {
					refuse(action.type, [issue(STUDIO_KEYS.unknownField, ['fields'], 'error')]);
					return;
				}
				if (!isFieldValue(action.value)) {
					refuse(action.type, [issue(STUDIO_KEYS.fieldValue, ['fields', field.key], 'error')]);
					return;
				}
				if (sameJson(document.fields[field.key], action.value)) return;
				const value = Array.isArray(action.value) ? frozen([...action.value]) : action.value;
				changeWork(
					{ fields: frozen({ ...document.fields, [field.key]: value }) },
					`field:${field.key}`,
				);
				return;
			}
			case 'payload/raw': {
				if (typeof action.text !== 'string') {
					throw new TypeError('dispatch: payload/raw takes text.');
				}
				remake(action.text);
				return;
			}
			case 'design/patch':
				patchDesign(
					action.type,
					action.patch,
					typeof action.coalesce === 'string' ? `patch:${action.coalesce}` : null,
				);
				return;
			case 'design/preset': {
				const preset =
					typeof action.id === 'string' ? registries.design.presets.get(action.id) : undefined;
				if (preset === undefined) {
					refuse(action.type, [issue(STUDIO_KEYS.unknownPreset, ['id'], 'error')]);
					return;
				}
				changeDesign(action.type, presetDesign(preset, document.design), null, []);
				return;
			}
			case 'design/replace': {
				let input = action.design;
				if (typeof input === 'string') {
					if (input.length > MAX_DESIGN_FILE) {
						refuse(action.type, [
							issue(STUDIO_KEYS.designFile, [], 'error', {
								length: input.length,
								max: MAX_DESIGN_FILE,
							}),
						]);
						return;
					}
					try {
						input = JSON.parse(input) as unknown;
					} catch {
						refuse(action.type, [issue(STUDIO_KEYS.designFile, [], 'error')]);
						return;
					}
				}
				changeDesign(action.type, input, null, []);
				return;
			}
			case 'design/shuffle': {
				const raw = Number(action.seed);
				const seedValue = Number.isFinite(raw) ? Math.floor(Math.abs(raw)) % 0x100000000 : 0;
				changeDesign(
					action.type,
					shuffleDesign(document.design, seedValue, registries.design, pairs()),
					null,
					[],
				);
				return;
			}
			case 'conditions': {
				const { conditions, bad } = conditionsFrom(action.conditions, document.conditions);
				if (bad.length > 0) {
					refuse(
						action.type,
						bad.map((path) => issue(STUDIO_KEYS.conditions, path, 'error')),
					);
					return;
				}
				if (sameJson(conditions, document.conditions)) return;
				changed({ ...document, conditions: frozen(conditions) });
				return;
			}
			case 'history/undo': {
				if (history.group !== null)
					history = commitGroup(history, history.group.key, work(), historyLimit);
				const step = undo(history, work());
				if (step === null) return;
				history = step.history;
				restore(step.restore);
				return;
			}
			case 'history/redo': {
				const step = redo(history, work(), historyLimit);
				if (step === null) return;
				history = step.history;
				restore(step.restore);
				return;
			}
			case 'history/begin': {
				if (typeof action.key !== 'string')
					throw new TypeError('dispatch: history/begin takes a key.');
				const before = history;
				history = beginGroup(history, action.key, work(), historyLimit);
				if (history !== before) notify();
				return;
			}
			case 'history/commit': {
				if (typeof action.key !== 'string')
					throw new TypeError('dispatch: history/commit takes a key.');
				const before = history;
				history = commitGroup(history, action.key, work(), historyLimit);
				if (history !== before) notify();
				return;
			}
			case 'history/cancel': {
				const cancelled = cancelGroup(history);
				if (cancelled === null) return;
				history = cancelled.history;
				const target = cancelled.restore;
				if (
					target.typeId === document.typeId &&
					target.fields === document.fields &&
					target.design === document.design
				) {
					notify();
				} else {
					restore(target);
				}
				return;
			}
			case 'verify/request': {
				verifyArmed = true;
				const type = typeOf(document.typeId);
				verifyInputs = {
					content: contentFor(type, document.fields),
					design: constrained(document.design, type).effective,
					conditions: document.conditions,
				};
				scheduleVerify(FULL_CAPTURE_SEEDS);
				return;
			}
			case 'verify/cancel': {
				verifyArmed = false;
				verifyTimer?.();
				verifyTimer = null;
				const running = verifyRun !== null;
				stopRun();
				if (running) {
					verify = idleVerify();
					notify();
				}
				return;
			}
			case 'fix/apply': {
				const fixes = verify.status === 'done' ? verify.fixes : [];
				const fix = fixes.find((candidate) => candidate.id === action.fixId);
				if (fix === undefined) {
					refuse(action.type, [issue(STUDIO_KEYS.unknownFix, ['fixId'], 'error')]);
					return;
				}
				// A fix is one step: verify's patch read as verify reads it (an
				// empty path is the whole design), and a size change beside it for
				// 'print-larger', which as a condition is not undone with the design.
				let design: unknown;
				if (fix.patch !== null) {
					try {
						design = applyDesignPatch(document.design, fix.patch);
					} catch {
						refuse(action.type, [issue(STUDIO_KEYS.patchPath, [], 'error', { problem: 'shape' })]);
						return;
					}
				}
				const conditions =
					fix.conditions === undefined
						? null
						: frozen(conditionsFrom(fix.conditions, document.conditions).conditions);
				applyLook(action.type, design, conditions);
				return;
			}
			default:
				throw new TypeError('dispatch: that is not an action the studio knows.');
		}
	}

	// Commands.

	function setBatch(next: BatchState): void {
		batch = frozen(next);
		notify();
	}

	/**
	 * Many codes from a spreadsheet: read the file (its bytes' encoding worked
	 * out where it came as bytes), plan a row per code, then make them in time
	 * slices. A new run stops the one before; so does dispose. The design is
	 * the person's own, which runBatch constrains per content type itself.
	 */
	async function batchCommand(
		command: Extract<StudioCommand, { type: 'batch' }>,
	): Promise<Result<Uint8Array>> {
		batchRun?.abort();
		const controller = new AbortController();
		batchRun = controller;
		const current = (): boolean => !disposed && batchRun === controller;
		const failed = (error: QrStudioError): Result<Uint8Array> => {
			if (current()) {
				batchRun = null;
				setBatch({ status: 'failed', error: studioError(error) });
			}
			return err(error);
		};
		let issues: readonly Issue[];
		let rows: readonly BatchRow[];
		try {
			let text: string;
			let fileIssues: readonly Issue[] = [];
			if (typeof command.csv === 'string') text = command.csv;
			else {
				const decoded = decodeCsvBytes(command.csv);
				text = decoded.text;
				fileIssues = decoded.issues;
			}
			const table = parseCsv(text);
			issues = frozen([...fileIssues, ...table.issues]);
			rows = planBatch(table, command.mapping, registries);
		} catch (thrown) {
			if (thrown instanceof TypeError) throw thrown;
			return failed(asStudioError(thrown, 'batch/malformed-csv'));
		}
		const asked = command.output.verify;
		if (generator === null && asked !== undefined && asked !== 'off') {
			// Asked to check rows in a build without the scan check: the same
			// answer a single code gets from the unavailable runner.
			return failed(
				new QrStudioError('platform/unavailable', 'The scan check is not part of this build yet.', {
					feature: 'verify',
				}),
			);
		}
		let written = 0;
		let skipped = 0;
		const outcomes: BatchOutcome[] = [];
		setBatch({ status: 'running', done: 0, total: rows.length + 1, written, skipped, issues });
		const design = document.design;
		const result = await driveInSlices(
			() =>
				runBatch(rows, design, command.output, registries, {
					fonts,
					seed,
					// Rows are checked by whatever the studio checks its code with: the
					// real scan check by default, a test's stand-in, or nothing.
					...(generator === null ? {} : { verifyRow: scanCheckVerifier(registries, generator) }),
				}),
			{
				scheduler: timers,
				clock,
				signal: controller.signal,
				failure: 'platform/unavailable',
				progress: (p) => {
					if (p.row !== undefined) {
						outcomes.push(p.row);
						if (p.row.status === 'written') written += 1;
						else skipped += 1;
					}
					if (current()) {
						setBatch({ status: 'running', done: p.done, total: p.total, written, skipped, issues });
					}
				},
			},
		);
		if (!result.ok)
			return result.error.code === 'cancelled' ? err(result.error) : failed(result.error);
		if (current()) {
			batchRun = null;
			setBatch({ status: 'done', outcomes: frozen(outcomes), written, skipped, issues });
		}
		return result;
	}

	function setInspect(next: InspectState): void {
		inspect = frozen(next);
		notify();
	}

	function setLibrary(next: LibraryState): void {
		libraryState = frozen(next);
		notify();
	}

	async function guarded<T>(
		work: () => Promise<Result<T>>,
		fallback: QrStudioError['code'],
	): Promise<Result<T>> {
		try {
			return await work();
		} catch (thrown) {
			// A caller's mistake stays a TypeError; anything else a store or a
			// seam threw is reported, since a person may well have caused it.
			if (thrown instanceof TypeError) throw thrown;
			return err(asStudioError(thrown, fallback));
		}
	}

	// What the store is, from its probe: a library kept in the browser, or a
	// file the person saves and opens. The kit last applied, and the records
	// the last opened file had to leave out, are the studio's to remember.
	let libraryKind: 'on' | 'file' = 'on';
	let activeKit: KitItem | null = null;
	let openSkipped: readonly Issue[] = [];

	/** Reads the whole library back into the snapshot, after anything that may have changed it. */
	async function refreshLibrary(): Promise<Result<LibraryContents>> {
		const store = library as NonNullable<typeof library>;
		const contents = await store.contents();
		if (disposed) return err(new CancelledError());
		if (!contents.ok) {
			setLibrary({ status: 'failed', error: studioError(contents.error) });
			return contents;
		}
		const shelves = {
			items: frozen([...contents.value.designs]),
			kits: frozen([...contents.value.kits]),
			skipped: frozen([...contents.value.skipped, ...openSkipped]),
			kit: activeKit,
		};
		setLibrary(
			libraryKind === 'file'
				? { status: 'file', unsaved: store.hasUnsavedChanges?.() === true, ...shelves }
				: { status: 'on', ...shelves },
		);
		return contents;
	}

	/** The library's view of a probe, from its state, or from its two flags for an older store. */
	function probedState(probe: {
		readonly available: boolean;
		readonly enabled: boolean;
		readonly state?: LibraryProbeState;
	}): LibraryProbeState {
		if (probe.state !== undefined) return probe.state;
		if (!probe.available) return 'unavailable';
		return probe.enabled ? 'on' : 'off';
	}

	function notEnabled(): QrStudioError {
		return new QrStudioError(
			'library/not-enabled',
			'The library is switched off. Switch it on to save codes in this browser.',
		);
	}

	async function exportCommand(command: Extract<StudioCommand, { type: 'export' }>) {
		const type = typeOf(document.typeId);
		const content = contentFor(type, document.fields);
		const { effective: design, overlay } = constrained(document.design, type);
		if (!content.ok) {
			return err(
				new QrStudioError('payload/invalid', 'Fix the content before saving the code.', {
					count: content.issues.filter((found) => found.severity === 'error').length,
				}),
			);
		}
		const encoded = encodeCached(content.text, design);
		if (!encoded.ok) return err(encoded.error);
		return exportSymbol(
			{
				symbol: encoded.symbol,
				design,
				fixedSizeMm: type.constraints?.sizeMm,
				conditions: document.conditions,
				registries: registries.design,
				assets: assets.lookup(design),
				fonts,
				overlay,
				seed,
				rasterEncoder: options.rasterEncoder ?? null,
				printer: options.printer === undefined ? RENDER_PRINTER : options.printer,
			},
			command.format,
			command.options ?? {},
		);
	}

	type LibraryCommand = Extract<StudioCommand, { type: `library/${string}` }>;

	/** Applies a design from the library or a kit, with conditions beside it, as one change. */
	function applyLook(
		action: Refusal['action'],
		design: unknown,
		conditions: VerifyConditions | null,
	): void {
		const prepared: Prepared = design === undefined ? { kind: 'same' } : prepareDesign(design, []);
		const next: { -readonly [K in keyof StudioDocument]?: StudioDocument[K] } = {};
		if (prepared.kind === 'change') next.design = prepared.next;
		if (conditions !== null && !sameJson(conditions, document.conditions)) {
			next.conditions = conditions;
		}
		if (next.design !== undefined) {
			history = recordChange(breakRun(history), work(), null, historyLimit);
		}
		if (Object.keys(next).length > 0) changed({ ...document, ...next });
		if (prepared.kind === 'refuse') refuse(action, prepared.issues);
	}

	async function libraryCommand(command: LibraryCommand): Promise<Result<unknown>> {
		if (library === null) {
			return err(
				new QrStudioError('library/unavailable', 'This copy of the studio has no library.'),
			);
		}
		const cancelled = (): Result<never> => err(new CancelledError());
		switch (command.type) {
			case 'library/enable': {
				const enabled = await library.enable();
				if (disposed) return cancelled();
				if (!enabled.ok) {
					setLibrary({ status: 'failed', error: studioError(enabled.error) });
					return enabled;
				}
				const contents = await refreshLibrary();
				return contents.ok ? ok(contents.value.designs) : contents;
			}
			case 'library/disable': {
				const disabled = await library.disable();
				if (disposed) return cancelled();
				if (!disabled.ok) return disabled;
				activeKit = null;
				openSkipped = [];
				// The file library is always there; switching it off forgets what the page holds.
				if (libraryKind === 'file') await refreshLibrary();
				else setLibrary({ status: 'off' });
				return ok(null);
			}
			default:
				break;
		}
		if (libraryState.status !== 'on' && libraryState.status !== 'file') return err(notEnabled());
		switch (command.type) {
			case 'library/save': {
				const name = typeof command.name === 'string' ? command.name : '';
				const saved = await library.save({ name, document });
				if (disposed) return cancelled();
				if (saved.ok) await refreshLibrary();
				return saved;
			}
			case 'library/remove': {
				const removed = await library.remove(command.id);
				if (disposed) return cancelled();
				if (!removed.ok) return removed;
				const contents = await refreshLibrary();
				return contents.ok ? ok(contents.value.designs) : contents;
			}
			case 'library/load': {
				const loaded = await library.load(command.id);
				if (disposed) return cancelled();
				if (!loaded.ok) return loaded;
				// A record holds the look and the sizes, never the content: what the
				// person typed, and the kind of content it is, stay as they are.
				const saved = loaded.value.document;
				const { conditions } = conditionsFrom(saved.conditions, document.conditions);
				applyLook(command.type, saved.design, frozen(conditions));
				const { document: _document, ...summary } = loaded.value;
				return ok(frozen(summary));
			}
			case 'library/list-kits': {
				const contents = await refreshLibrary();
				return contents.ok ? ok(contents.value.kits) : contents;
			}
			case 'library/save-kit': {
				const name = typeof command.name === 'string' ? command.name : '';
				const saved = await library.saveKit({ name, kit: command.kit });
				if (disposed) return cancelled();
				if (saved.ok) await refreshLibrary();
				return saved;
			}
			case 'library/load-kit': {
				const loaded = await library.loadKit(command.id);
				if (disposed) return cancelled();
				if (!loaded.ok) return loaded;
				activeKit = loaded.value;
				applyLook(command.type, applyKit(document.design, loaded.value.kit), null);
				await refreshLibrary();
				return loaded;
			}
			case 'library/remove-kit': {
				const removed = await library.removeKit(command.id);
				if (disposed) return cancelled();
				if (!removed.ok) return removed;
				if (activeKit?.id === command.id) activeKit = null;
				const contents = await refreshLibrary();
				return contents.ok ? ok(contents.value.kits) : contents;
			}
			case 'library/save-file': {
				if (library.saveFile === undefined) return err(notAFile());
				const saved = library.saveFile(command.name);
				if (saved.ok) await refreshLibrary();
				return saved;
			}
			case 'library/open-file': {
				if (library.openFile === undefined) return err(notAFile());
				const opened = await library.openFile(command.file);
				if (disposed) return cancelled();
				if (opened.opened) {
					// The kits of the library this page held are gone with it.
					activeKit = null;
					openSkipped = frozen(opened.issues.filter((found) => found.severity !== 'error'));
					await refreshLibrary();
				}
				return ok(opened);
			}
		}
	}

	function notAFile(): QrStudioError {
		return new QrStudioError(
			'library/unavailable',
			'This library is kept in the browser, not in a file.',
			{ reason: 'not-a-file' },
		);
	}

	async function runCommand(command: StudioCommand): Promise<Result<unknown>> {
		switch (command.type) {
			case 'export':
				return exportCommand(command);
			case 'design-link':
				try {
					return ok(frozen(designLink(document.design)));
				} catch (thrown) {
					return err(asStudioError(thrown, 'design/invalid'));
				}
			case 'inspect/image':
			case 'inspect/text': {
				const source = command.type === 'inspect/image' ? 'image' : 'text';
				if (inspector === null) {
					const error = new QrStudioError(
						'platform/unavailable',
						'Reading codes is not part of this copy.',
						{
							feature: 'inspect',
						},
					);
					setInspect({ status: 'failed', source, error: studioError(error) });
					return err(error);
				}
				setInspect({ status: 'running', source });
				let result: Result<unknown>;
				try {
					result =
						command.type === 'inspect/image'
							? inspector.image(command.image, registries)
							: ok(inspector.text(command.text, registries));
				} catch (thrown) {
					result = err(asStudioError(thrown, 'decode/unreadable'));
				}
				if (disposed) return result;
				if (result.ok) {
					setInspect({
						status: 'done',
						source,
						report: result.value as Extract<InspectState, { status: 'done' }>['report'],
					});
				} else {
					setInspect({ status: 'failed', source, error: studioError(result.error) });
				}
				return result;
			}
			case 'batch':
				return batchCommand(command);
			case 'library/enable':
			case 'library/disable':
			case 'library/save':
			case 'library/load':
			case 'library/remove':
			case 'library/list-kits':
			case 'library/save-kit':
			case 'library/load-kit':
			case 'library/remove-kit':
			case 'library/save-file':
			case 'library/open-file':
				return libraryCommand(command);
			default:
				throw new TypeError('run: that is not a command the studio knows.');
		}
	}

	// Startup: ask the library, without creating anything, whether it is on.
	if (library !== null) {
		const answered = (state: LibraryState): void => {
			if (!disposed) setLibrary(state);
		};
		library.probe().then(
			async (probed) => {
				if (!probed.ok) return answered({ status: 'failed', error: studioError(probed.error) });
				const state = probedState(probed.value);
				if (state === 'unavailable' || state === 'off' || state === 'unknown') {
					return answered({ status: state });
				}
				libraryKind = state;
				if (!disposed) await refreshLibrary();
			},
			(thrown: unknown) =>
				answered({
					status: 'failed',
					error: studioError(asStudioError(thrown, 'library/unavailable')),
				}),
		);
	}

	return Object.freeze({
		getSnapshot(): StudioSnapshot {
			// A registry a caller added to since the last change is a change too:
			// the catalogue has to show the new entry.
			if (!disposed && registryVersions(registries) !== snapshotVersions) {
				snapshot = makeSnapshot();
				snapshotVersions = registryVersions(registries);
			}
			return snapshot;
		},
		subscribe(listener: () => void): () => void {
			if (typeof listener !== 'function') throw new TypeError('subscribe: listener is a function.');
			if (disposed) return () => undefined;
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		dispatch,
		run<C extends StudioCommand>(command: C): Promise<Result<CommandResult<C>>> {
			if (typeof command !== 'object' || command === null || typeof command.type !== 'string') {
				return Promise.reject(new TypeError('run: a command is an object with a type.'));
			}
			if (disposed) return Promise.resolve(err(new CancelledError()));
			return guarded(() => runCommand(command), 'platform/unavailable') as Promise<
				Result<CommandResult<C>>
			>;
		},
		dispose(): void {
			if (disposed) return;
			disposed = true;
			verifyArmed = false;
			batchRun?.abort();
			stopRun();
			timers.cancelAll();
			listeners.clear();
		},
	});
}
