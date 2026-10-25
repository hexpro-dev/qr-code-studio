/**
 * The library as a file, and the rules every library record follows.
 *
 * The offline app runs from `file://`, and storage there is not something to
 * trust: WebKit refuses it outright, and Chromium may give every HTML file
 * opened from disk one shared storage partition, so a design kept by one
 * downloaded page could be read by any other. So the offline app keeps
 * nothing in the browser. Its library lives in memory while the page is open;
 * the person saves it as a `.qrlibrary.json` file and opens it again next
 * time, the way they would any document. Nothing is written anywhere they did
 * not choose, and closing the tab forgets everything the file did not take.
 *
 * The website's library (src/dom/library/indexeddb.ts) keeps the same records
 * in IndexedDB. The rules for a record live here rather than there because
 * the offline build may not reach into src/dom/library/ at all
 * (tests/build/no-network.test.ts checks the metafile), and both stores have
 * to agree on what a record is.
 *
 * A record holds a design or a brand kit, and never the content of a code.
 * The content is the reason a code is private (a Wi-Fi password, a phone
 * number, a link to a private document), and a library is for the look of a
 * code, which a person reuses across many contents. So a record is built
 * field by field from what a design needs, never by copying a document, its
 * type has no room for a content field, and a record that arrives with one
 * (from a file, or written into the database by something else) is refused.
 *
 * Every record is checked on the way in and again on the way out, with the
 * design layer's own migration and validator, because the way out is where a
 * file someone else wrote, or a database a newer build wrote, comes back in.
 * A record that fails is left out and reported, never thrown: one damaged
 * entry must not cost a person the other forty.
 */

import { QrStudioError } from '../core/errors.js';
import { issue } from '../core/issue.js';
import type { Issue, MessageKey } from '../core/issue.js';
import { err, ok } from '../core/result.js';
import type { Result } from '../core/result.js';
import type { Registries } from '../registries.js';
import {
	DEFAULT_CONDITIONS,
	conditionsFrom,
	defaultDocument,
	designFrom,
} from '../studio/document.js';
import { errorKey } from '../studio/keys.js';
import { fileStem } from '../studio/names.js';
import type {
	DesignAsset,
	LibraryItem,
	LibraryItemSummary,
	LibraryStore,
	QrDesignV1,
	StudioDocument,
	StudioOptions,
	VerifyConditions,
} from '../studio/index.js';
import { downloadBytes } from './output.js';

export const LIBRARY_SCHEMA = 'qr-library';
export const LIBRARY_VERSION = 1;
export const LIBRARY_EXTENSION = '.qrlibrary.json';
export const LIBRARY_MIME = 'application/json';

export const LIBRARY_LIMITS = Object.freeze({
	/**
	 * Bytes in a library file. Room for forty designs that each carry the
	 * largest logo the design layer allows, and thousands that carry none,
	 * while staying a size JSON.parse reads in a moment on a phone.
	 */
	fileBytes: 32 * 1024 * 1024,
	/** Designs in one library file. */
	designs: 500,
	/** Brand kits in one library file. */
	kits: 100,
	/** Characters (code points) in the name a person gives a saved item. */
	name: 80,
	/** Inks in one brand kit's palette. */
	palette: 32,
	/** Preferred presets in one brand kit. */
	presets: 32,
	/**
	 * How deep a library file may nest before it is refused unread. A design
	 * sits three levels down and the design layer allows it 32 of its own.
	 */
	depth: 40,
});

/** Everything the library says in its own words. Issues and the errors' specific sentences. */
export const LIBRARY_KEYS = Object.freeze({
	tooLarge: 'dom.library.issue.too-large',
	tooDeep: 'dom.library.issue.too-deep',
	notJson: 'dom.library.issue.not-json',
	notLibrary: 'dom.library.issue.not-a-library',
	version: 'dom.library.issue.version',
	unknownKey: 'dom.library.issue.unknown-key',
	tooMany: 'dom.library.issue.too-many',
	unreadable: 'dom.library.issue.unreadable',
	content: 'dom.library.issue.content',
	corrupt: 'dom.library.issue.corrupt',
	blocked: 'dom.library.error.blocked',
	missing: 'dom.library.error.missing',
	fileFull: 'dom.library.error.file-full',
	kit: 'dom.library.error.kit',
} as const);

/**
 * The names content goes by elsewhere in this package: a studio document's
 * `fields`, a verify job's `content`, raw `text`, a `payload`. No record may
 * have one. As a type, so code that tried to store one does not compile, and
 * as a list, so a record that arrives carrying one is refused.
 */
export const CONTENT_KEYS = Object.freeze(['fields', 'content', 'text', 'payload'] as const);
type NoContent = { readonly [K in (typeof CONTENT_KEYS)[number]]?: never };

type FontRegistry = NonNullable<StudioOptions['fonts']>;

/** One ink as a design holds it: a CSS colour, or a screen colour with its CMYK. */
export type LibraryInk = Extract<QrDesignV1['modules']['paint'], { readonly kind: 'solid' }>['ink'];

/** A brand's own colours, logo and favourite presets, kept so new codes start from them. */
export interface BrandKit {
	readonly palette: readonly LibraryInk[];
	/** A picture logo, as a design embeds one: a PNG this package encoded. */
	readonly logo: DesignAsset | null;
	/** Preset ids, in the order the person prefers them. */
	readonly presets: readonly string[];
}

/** A saved design, as a library file and the database hold it. */
export interface DesignEntry extends NoContent {
	readonly name: string;
	readonly savedAt: number;
	/** Which kind of content the design was made for, so a view can group it. Never the content. */
	readonly typeId: string;
	readonly design: QrDesignV1;
	readonly conditions: VerifyConditions;
}

/** A saved brand kit, as a library file and the database hold it. */
export interface KitEntry extends BrandKit, NoContent {
	readonly name: string;
	readonly savedAt: number;
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

/** What `probe` says a view should offer. */
export type LibraryProbeState = 'unavailable' | 'off' | 'on' | 'unknown' | 'file';

/**
 * The studio's probe answer, with the one thing it cannot say: what kind of
 * control to show.
 *
 * - 'off': a switch to turn the library on.
 * - 'unknown': this browser cannot say whether there is a library without
 *   opening it, so the view offers "Open my library", and the click is the
 *   consent. `enabled` is false.
 * - 'on': the library is there.
 * - 'file': the library is a file the person saves and opens, so the view
 *   offers Save and Open rather than a switch. `enabled` is true.
 * - 'unavailable': nothing can be kept here.
 */
export interface LibraryProbe {
	readonly available: boolean;
	readonly enabled: boolean;
	readonly state: LibraryProbeState;
}

/** Everything a library holds, and which records were left out because they could not be used. */
export interface LibraryContents {
	readonly designs: readonly LibraryItemSummary[];
	readonly kits: readonly KitSummary[];
	/**
	 * One warning per record left out, at `['designs' | 'kits', id]`:
	 * `dom.library.issue.content` for one that held what a library never
	 * keeps, `dom.library.issue.corrupt` for anything else.
	 */
	readonly skipped: readonly Issue[];
}

/** The studio's LibraryStore, and brand kits beside the designs. Both stores are one of these. */
export interface DesignLibrary extends LibraryStore {
	probe(): Promise<Result<LibraryProbe>>;
	contents(): Promise<Result<LibraryContents>>;
	listKits(): Promise<Result<readonly KitSummary[]>>;
	saveKit(item: { readonly name: string; readonly kit: BrandKit }): Promise<Result<KitSummary>>;
	loadKit(id: string): Promise<Result<KitItem>>;
	removeKit(id: string): Promise<Result<null>>;
}

/** What a record is checked against: the registries and fonts the studio was given. */
export interface RecordRules {
	/** The same registries the studio uses, so a design that uses an entry the website added is not refused. */
	readonly registries: Registries;
	readonly fonts?: FontRegistry;
}

/** A record checked on its way out of a store or a file: the record, or the key that says why it was left out. */
export type CheckedEntry<E> =
	| { readonly entry: E; readonly problem: null }
	| { readonly entry: null; readonly problem: MessageKey };

/** How each store reads one kind of record. */
export interface Collection<E, S, I> {
	readonly store: 'designs' | 'kits';
	/** The most one library file holds. */
	readonly max: number;
	check(value: unknown): CheckedEntry<E>;
	summary(id: string, entry: E): S;
	item(id: string, entry: E): I;
}

export interface LibraryRecords {
	readonly designs: Collection<DesignEntry, LibraryItemSummary, LibraryItem>;
	readonly kits: Collection<KitEntry, KitSummary, KitItem>;
	/** A design ready to keep, built from what a design needs and nothing else. Throws TypeError for a caller's mistake. */
	designIn(item: unknown, savedAt: number): Result<DesignEntry>;
	kitIn(item: unknown, savedAt: number): Result<KitEntry>;
}

const DESIGN_KEYS = ['name', 'savedAt', 'typeId', 'design', 'conditions'];
const KIT_KEYS = ['palette', 'logo', 'presets'];
const KIT_ENTRY_KEYS = ['name', 'savedAt', ...KIT_KEYS];
const CONDITION_KEYS = ['sizeMm', 'dpi', 'distanceMm'];
const TOP_KEYS = ['schema', 'version', 'designs', 'kits'];
const KEBAB = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
/** Keys from a file that may appear in an issue's path: short and plain. */
const PLAIN_KEY = /^[A-Za-z][A-Za-z0-9_-]{0,31}$/;
/** Ids are the store's own counters, so a well-formed one is a positive integer well inside 2^53. */
const ID = /^[1-9][0-9]{0,14}$/;
/** The asset id the kit's logo is checked under. */
const PROBE_ASSET = 'logo';

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function own(record: Record<string, unknown>, key: string): boolean {
	return Object.prototype.hasOwnProperty.call(record, key);
}

function freeze<T>(value: T): T {
	return Object.freeze(value);
}

/** Whether `key` is one of the names content goes by. */
function isContentKey(key: string): boolean {
	return (CONTENT_KEYS as readonly string[]).includes(key);
}

/**
 * Why a record's keys rule it out, or null when they are exactly what a record
 * may have. Content is named on its own so a view can say what was refused.
 */
function keyProblem(
	record: Record<string, unknown>,
	allowed: readonly string[],
): MessageKey | null {
	const keys = Object.keys(record);
	if (keys.some(isContentKey)) return LIBRARY_KEYS.content;
	if (keys.some((key) => !allowed.includes(key))) return LIBRARY_KEYS.corrupt;
	return allowed.every((key) => own(record, key)) ? null : LIBRARY_KEYS.corrupt;
}

function isControl(point: number): boolean {
	return (
		point < 0x20 ||
		(point >= 0x7f && point < 0xa0) ||
		point === 0x2028 ||
		point === 0x2029 ||
		// A lone surrogate: half a character, which no file system or font shows.
		(point >= 0xd800 && point <= 0xdfff)
	);
}

/**
 * The name a person gave a saved item, made safe to show and to keep: control
 * characters and runs of white space become one space, the ends are trimmed,
 * and it stops at LIBRARY_LIMITS.name code points without splitting one.
 */
export function cleanName(name: string): string {
	let out = '';
	let count = 0;
	let gap = false;
	for (const char of name) {
		if (isControl(char.codePointAt(0) as number) || /\s/.test(char)) {
			gap = count > 0;
			continue;
		}
		if (gap) {
			// A space is written only with a character after it, so a name never
			// ends in one, even when the limit falls between the two.
			if (count + 1 >= LIBRARY_LIMITS.name) break;
			out += ' ';
			count += 1;
			gap = false;
		}
		out += char;
		count += 1;
		if (count >= LIBRARY_LIMITS.name) break;
	}
	return out;
}

function isName(value: unknown): value is string {
	// Twice the limit in UTF-16 units is the most 80 code points can take, so
	// a megabyte of name is refused before it is walked.
	return (
		typeof value === 'string' &&
		value.length <= LIBRARY_LIMITS.name * 2 &&
		cleanName(value) === value
	);
}

function isTime(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isTypeId(value: unknown): value is string {
	return typeof value === 'string' && value.length <= 64 && KEBAB.test(value);
}

/** Milliseconds now, from the store's clock. A clock that gives anything else is a caller's mistake. */
export function stamp(now: () => number): number {
	const at = now();
	if (!isTime(at)) throw new TypeError('now: a clock gives milliseconds since 1970.');
	return Math.floor(at);
}

/** The store key an id names, or null when no store could have given it out. */
export function recordKey(id: string): number | null {
	return ID.test(id) ? Number(id) : null;
}

export function missingError(): QrStudioError {
	return new QrStudioError('library/corrupt', 'That saved item is no longer in the library.', {
		reason: 'missing',
	});
}

export function corruptError(): QrStudioError {
	return new QrStudioError('library/corrupt', 'A saved item is damaged and cannot be opened.');
}

function kitError(): QrStudioError {
	return new QrStudioError(
		'design/invalid',
		'This brand kit has a colour, logo or preset the studio cannot use.',
		{ reason: 'kit' },
	);
}

function fileFull(): QrStudioError {
	return new QrStudioError(
		'library/quota',
		'This library holds as much as one file can. Remove something, or save it and start another.',
		{ reason: 'file-full' },
	);
}

/** The sentence each error's reason has, by code and reason, so a reason another layer uses means nothing here. */
const REASON_KEYS: Readonly<Record<string, MessageKey>> = Object.freeze({
	'library/unavailable:blocked': LIBRARY_KEYS.blocked,
	'library/corrupt:missing': LIBRARY_KEYS.missing,
	'library/quota:file-full': LIBRARY_KEYS.fileFull,
	'design/invalid:kit': LIBRARY_KEYS.kit,
});

/**
 * The most specific sentence for an error from either library: the library's
 * own for a blocked delete, a missing item, a full file or a kit it cannot
 * keep, and the studio's for the rest.
 */
export function libraryErrorKey(error: QrStudioError): MessageKey {
	const found = `${error.code}:${String(error.params.reason)}`;
	return Object.prototype.hasOwnProperty.call(REASON_KEYS, found)
		? (REASON_KEYS[found] as MessageKey)
		: errorKey(error);
}

function rulesOf(deps: unknown, who: string): RecordRules {
	if (!isRecord(deps) || !isRecord(deps.registries)) {
		throw new TypeError(`${who}: deps.registries is the registries the studio was given.`);
	}
	return deps as unknown as RecordRules;
}

/** The record rules for one store, over the registries and fonts it was given. */
export function libraryRecords(rules: RecordRules): LibraryRecords {
	const { registries, fonts } = rulesOf(rules, 'libraryRecords');
	let base: QrDesignV1 | null = null;
	const probeBase = (): QrDesignV1 => (base ??= defaultDocument(registries).design);

	const designOf = (value: unknown): QrDesignV1 | null =>
		designFrom(value, registries, fonts).design;

	// An ink or a logo is checked by the design layer, inside a design built
	// to hold it, so a kit accepts exactly what a design will: a colour the
	// SVG writer's allow-list takes, a PNG this package can decode, within the
	// same limits.
	function checkInk(ink: unknown): LibraryInk | null {
		const start = probeBase();
		const checked = designOf({
			...start,
			modules: { ...start.modules, paint: { kind: 'solid', ink } },
		});
		return checked === null ? null : (checked.modules.paint as { readonly ink: LibraryInk }).ink;
	}

	function checkAsset(asset: unknown): DesignAsset | null {
		const checked = designOf({
			...probeBase(),
			logo: {
				source: { kind: 'asset', id: PROBE_ASSET },
				size: 0.2,
				clear: 'box',
				padding: 1,
				plate: null,
			},
			assets: { [PROBE_ASSET]: asset },
		});
		return checked === null
			? null
			: ((checked.assets as Readonly<Record<string, DesignAsset>>)[PROBE_ASSET] as DesignAsset);
	}

	/**
	 * A kit's parts, checked. A preset this build does not have is refused on
	 * the way in, where it can only be a caller's mistake, and left out on the
	 * way out, where it is a kit a newer build saved.
	 */
	function kitParts(value: Record<string, unknown>, incoming: boolean): BrandKit | null {
		const { palette, logo, presets } = value;
		if (!Array.isArray(palette) || palette.length > LIBRARY_LIMITS.palette) return null;
		if (!Array.isArray(presets) || presets.length > LIBRARY_LIMITS.presets) return null;
		const inks: LibraryInk[] = [];
		for (const ink of palette) {
			const checked = checkInk(ink);
			if (checked === null) return null;
			inks.push(checked);
		}
		const picture = logo === null ? null : checkAsset(logo);
		if (logo !== null && picture === null) return null;
		const kept: string[] = [];
		for (const id of presets) {
			if (!isTypeId(id)) return null;
			if (!registries.design.presets.has(id)) {
				if (incoming) return null;
				continue;
			}
			if (!kept.includes(id)) kept.push(id);
		}
		return freeze({ palette: freeze(inks), logo: picture, presets: freeze(kept) });
	}

	const designs: Collection<DesignEntry, LibraryItemSummary, LibraryItem> = freeze({
		store: 'designs' as const,
		max: LIBRARY_LIMITS.designs,
		check(value: unknown): CheckedEntry<DesignEntry> {
			const corrupt = { entry: null, problem: LIBRARY_KEYS.corrupt } as const;
			if (!isRecord(value)) return corrupt;
			const problem = keyProblem(value, DESIGN_KEYS);
			if (problem !== null) return { entry: null, problem };
			const { name, savedAt, typeId, conditions } = value;
			if (!isName(name) || !isTime(savedAt) || !isTypeId(typeId)) return corrupt;
			if (
				!isRecord(conditions) ||
				!Object.keys(conditions).every((key) => CONDITION_KEYS.includes(key))
			)
				return corrupt;
			const read = conditionsFrom(conditions, DEFAULT_CONDITIONS);
			if (read.bad.length > 0) return corrupt;
			const design = designOf(value.design);
			if (design === null) return corrupt;
			return {
				entry: freeze({ name, savedAt, typeId, design, conditions: read.conditions }),
				problem: null,
			};
		},
		summary(id: string, entry: DesignEntry): LibraryItemSummary {
			return freeze({ id, name: entry.name, savedAt: entry.savedAt, typeId: entry.typeId });
		},
		item(id: string, entry: DesignEntry): LibraryItem {
			// A document with no content in it: the studio fills each field with its
			// empty value, as it does for a design link.
			const document: StudioDocument = freeze({
				mode: 'create' as const,
				typeId: entry.typeId,
				fields: freeze({}),
				design: entry.design,
				conditions: entry.conditions,
			});
			return freeze({ ...designs.summary(id, entry), document });
		},
	});

	const kits: Collection<KitEntry, KitSummary, KitItem> = freeze({
		store: 'kits' as const,
		max: LIBRARY_LIMITS.kits,
		check(value: unknown): CheckedEntry<KitEntry> {
			const corrupt = { entry: null, problem: LIBRARY_KEYS.corrupt } as const;
			if (!isRecord(value)) return corrupt;
			const problem = keyProblem(value, KIT_ENTRY_KEYS);
			if (problem !== null) return { entry: null, problem };
			const { name, savedAt } = value;
			if (!isName(name) || !isTime(savedAt)) return corrupt;
			const parts = kitParts(value, false);
			if (parts === null) return corrupt;
			return { entry: freeze({ name, savedAt, ...parts }), problem: null };
		},
		summary(id: string, entry: KitEntry): KitSummary {
			return freeze({ id, name: entry.name, savedAt: entry.savedAt });
		},
		item(id: string, entry: KitEntry): KitItem {
			const kit: BrandKit = freeze({
				palette: entry.palette,
				logo: entry.logo,
				presets: entry.presets,
			});
			return freeze({ ...kits.summary(id, entry), kit });
		},
	});

	return freeze({
		designs,
		kits,
		designIn(item: unknown, savedAt: number): Result<DesignEntry> {
			if (!isRecord(item) || !isRecord(item.document)) {
				throw new TypeError('save: the item is { name, document }.');
			}
			if (typeof item.name !== 'string') throw new TypeError('save: name is a string.');
			const document = item.document;
			if (!isTypeId(document.typeId)) {
				throw new TypeError("save: the document's typeId is a content type id.");
			}
			const checked = designFrom(document.design, registries, fonts);
			if (checked.design === null) {
				return err(
					new QrStudioError(
						'design/invalid',
						'This design has problems to fix before it can be saved.',
						{ count: checked.issues.filter((found) => found.severity === 'error').length },
					),
				);
			}
			const { conditions } = conditionsFrom(document.conditions, DEFAULT_CONDITIONS);
			// Field by field, never a spread of the document: its `fields` are the
			// content of the code, and a record has no room for them.
			return ok(
				freeze({
					name: cleanName(item.name),
					savedAt,
					typeId: document.typeId,
					design: checked.design,
					conditions,
				}),
			);
		},
		kitIn(item: unknown, savedAt: number): Result<KitEntry> {
			if (!isRecord(item) || !isRecord(item.kit)) {
				throw new TypeError('saveKit: the item is { name, kit }.');
			}
			if (typeof item.name !== 'string') throw new TypeError('saveKit: name is a string.');
			if (keyProblem(item.kit, KIT_KEYS) !== null) return err(kitError());
			const parts = kitParts(item.kit, true);
			if (parts === null) return err(kitError());
			return ok(freeze({ name: cleanName(item.name), savedAt, ...parts }));
		},
	});
}

/** The warning a store gives for a record it left out. */
export function skippedIssue(
	store: 'designs' | 'kits',
	at: string | number,
	problem: MessageKey,
): Issue {
	return issue(problem, [store, at], 'warning');
}

// The file.

/** A library file, as `serialiseLibrary` writes it and `parseLibraryFile` reads it. */
export interface LibraryFileV1 {
	readonly schema: typeof LIBRARY_SCHEMA;
	readonly version: typeof LIBRARY_VERSION;
	readonly designs: readonly DesignEntry[];
	readonly kits: readonly KitEntry[];
}

export interface LibraryFileParse {
	/** The entries that passed, in the file's order, or null when the file was refused. */
	readonly library: {
		readonly designs: readonly DesignEntry[];
		readonly kits: readonly KitEntry[];
	} | null;
	/** Why the file was refused (errors), or which entries were left out (warnings). */
	readonly issues: readonly Issue[];
}

/**
 * The library file's text. Indented, so a person who opens it in an editor
 * can see what they are keeping, and ending in a newline as text files do.
 * Ids are not written: they are the page's own counters, given out again
 * when the file is opened.
 */
export function serialiseLibrary(library: {
	readonly designs: readonly DesignEntry[];
	readonly kits: readonly KitEntry[];
}): string {
	const file: LibraryFileV1 = {
		schema: LIBRARY_SCHEMA,
		version: LIBRARY_VERSION,
		designs: library.designs,
		kits: library.kits,
	};
	return `${JSON.stringify(file, null, '\t')}\n`;
}

/**
 * Whether JSON text nests deeper than `limit`, found by counting brackets
 * outside strings. Done before JSON.parse so a file of a million opening
 * brackets is refused at the cost of reading it once, rather than handed to a
 * parser and then to checks that walk what it built.
 */
function nestsDeeper(text: string, limit: number): boolean {
	let depth = 0;
	let quoted = false;
	for (let i = 0; i < text.length; i += 1) {
		const unit = text.charCodeAt(i);
		if (quoted) {
			if (unit === 0x5c) i += 1;
			else if (unit === 0x22) quoted = false;
		} else if (unit === 0x22) quoted = true;
		else if (unit === 0x5b || unit === 0x7b) {
			depth += 1;
			if (depth > limit) return true;
		} else if (unit === 0x5d || unit === 0x7d) depth -= 1;
	}
	return false;
}

function refused(
	code: MessageKey,
	path: readonly (string | number)[] = [],
	params?: Readonly<Record<string, number | string>>,
): LibraryFileParse {
	return { library: null, issues: [issue(code, path, 'error', params)] };
}

function entriesOf<E, S, I>(
	value: unknown,
	collection: Collection<E, S, I>,
	issues: Issue[],
): E[] | Issue {
	const at = collection.store;
	if (!Array.isArray(value)) return issue(LIBRARY_KEYS.notLibrary, [at], 'error');
	if (value.length > collection.max) {
		return issue(LIBRARY_KEYS.tooMany, [at], 'error', {
			count: value.length,
			max: collection.max,
		});
	}
	const out: E[] = [];
	value.forEach((item: unknown, index) => {
		const checked = collection.check(item);
		if (checked.problem !== null) issues.push(skippedIssue(at, index, checked.problem));
		else out.push(checked.entry);
	});
	return out;
}

/**
 * Read a library file a person chose. Never throws for anything in the file:
 * a file that is not a library, is too large, nests too deeply or comes from
 * a different version is refused with an issue saying which, and an entry
 * that cannot be used is left out with a warning, the rest kept.
 *
 * Strict where strictness costs nothing: a key the format does not have, at
 * the top or in an entry, refuses that thing rather than being carried along
 * unseen, and an entry holding content is refused by name.
 */
export function parseLibraryFile(text: string, rules: RecordRules): LibraryFileParse {
	if (typeof text !== 'string')
		throw new TypeError('parseLibraryFile: text is the file as a string.');
	const records = libraryRecords(rules);
	// Length in UTF-16 units is never more than the UTF-8 bytes it came from,
	// so this holds a string to at least the limit the file's size was held to.
	if (text.length > LIBRARY_LIMITS.fileBytes) {
		return refused(LIBRARY_KEYS.tooLarge, [], { max: LIBRARY_LIMITS.fileBytes });
	}
	const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
	if (nestsDeeper(body, LIBRARY_LIMITS.depth)) {
		return refused(LIBRARY_KEYS.tooDeep, [], { limit: LIBRARY_LIMITS.depth });
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(body);
	} catch {
		return refused(LIBRARY_KEYS.notJson);
	}
	if (!isRecord(parsed) || parsed.schema !== LIBRARY_SCHEMA)
		return refused(LIBRARY_KEYS.notLibrary);
	if (parsed.version !== LIBRARY_VERSION) {
		return refused(LIBRARY_KEYS.version, ['version'], { supported: LIBRARY_VERSION });
	}
	for (const key of Object.keys(parsed)) {
		if (isContentKey(key)) return refused(LIBRARY_KEYS.content, [key]);
		if (!TOP_KEYS.includes(key)) {
			return refused(LIBRARY_KEYS.unknownKey, PLAIN_KEY.test(key) ? [key] : []);
		}
	}
	const issues: Issue[] = [];
	const designs = entriesOf(parsed.designs, records.designs, issues);
	if (!Array.isArray(designs)) return { library: null, issues: [designs] };
	const kits = entriesOf(parsed.kits, records.kits, issues);
	if (!Array.isArray(kits)) return { library: null, issues: [kits] };
	return { library: { designs, kits }, issues };
}

// The store.

/** Hands a finished file to the person. downloadBytes is the browser's way. */
export type LibraryDownload = (bytes: Uint8Array, filename: string, type: string) => Result<null>;

export interface FileLibraryDeps extends RecordRules {
	/** Milliseconds since 1970. Default Date.now. */
	readonly now?: () => number;
	/** Default: downloadBytes from this layer's output adapter. */
	readonly download?: LibraryDownload;
	/** Reads the file the person chose. Default: the file's own text(). */
	readonly readText?: (file: Blob) => Promise<string>;
}

export interface LibraryFileOpened {
	/** False when the file was refused, and nothing this page held was changed. */
	readonly opened: boolean;
	readonly issues: readonly Issue[];
}

export interface FileLibrary extends DesignLibrary {
	/** Hands everything this page holds to the person as `<name>.qrlibrary.json`. */
	saveFile(name?: string): Result<{ readonly filename: string }>;
	/** Puts the library in `file` in place of what this page holds, or changes nothing and says why. */
	openFile(file: Blob): Promise<LibraryFileOpened>;
	/** Whether anything was saved or removed since the library was last saved to a file or opened from one. */
	hasUnsavedChanges(): boolean;
}

interface Shelf<E> {
	entries: Map<string, E>;
	next: number;
}

function shelfOf<E>(entries: readonly E[] = []): Shelf<E> {
	return {
		entries: new Map(entries.map((entry, index) => [String(index + 1), entry])),
		next: entries.length + 1,
	};
}

function idOf(id: unknown, who: string): string {
	if (typeof id !== 'string') throw new TypeError(`${who}: id is a string.`);
	return id;
}

/**
 * The offline app's library: the studio's LibraryStore over what this page
 * holds in memory, saved and opened as a file the person keeps.
 *
 * It is always on, because switching it on stores nothing: `probe` says
 * 'file' so the view shows Save and Open rather than a switch, `enable` does
 * nothing, and `disable` forgets what the page holds (the person's file is
 * theirs and is not touched).
 */
export function createFileLibrary(deps: FileLibraryDeps): FileLibrary {
	const rules = rulesOf(deps, 'createFileLibrary');
	const records = libraryRecords(rules);
	const now = deps.now ?? Date.now;
	const download = deps.download ?? downloadBytes;
	const readText = deps.readText ?? ((file: Blob) => file.text());
	let designs = shelfOf<DesignEntry>();
	let kits = shelfOf<KitEntry>();
	let unsaved = false;

	// Everything on a shelf came through `designIn`, `kitIn` or a checked file,
	// and nothing else can reach one, so what is read back off a shelf is not
	// checked a second time.

	function summaries<E, S, I>(shelf: Shelf<E>, collection: Collection<E, S, I>): S[] {
		return [...shelf.entries].map(([id, entry]) => collection.summary(id, entry));
	}

	function put<E, S, I>(shelf: Shelf<E>, collection: Collection<E, S, I>, entry: E): Result<S> {
		if (shelf.entries.size >= collection.max) return err(fileFull());
		const id = String(shelf.next);
		shelf.next += 1;
		shelf.entries.set(id, entry);
		unsaved = true;
		return ok(collection.summary(id, entry));
	}

	function take<E, S, I>(shelf: Shelf<E>, collection: Collection<E, S, I>, id: string): Result<I> {
		const entry = shelf.entries.get(id);
		return entry === undefined ? err(missingError()) : ok(collection.item(id, entry));
	}

	function drop<E>(shelf: Shelf<E>, id: string): Result<null> {
		if (shelf.entries.delete(id)) unsaved = true;
		return ok(null);
	}

	return Object.freeze({
		async probe(): Promise<Result<LibraryProbe>> {
			return ok(freeze({ available: true, enabled: true, state: 'file' as const }));
		},
		async enable(): Promise<Result<null>> {
			return ok(null);
		},
		async disable(): Promise<Result<null>> {
			designs = shelfOf();
			kits = shelfOf();
			unsaved = false;
			return ok(null);
		},
		async list(): Promise<Result<readonly LibraryItemSummary[]>> {
			return ok(freeze(summaries(designs, records.designs)));
		},
		async contents(): Promise<Result<LibraryContents>> {
			return ok(
				freeze({
					designs: freeze(summaries(designs, records.designs)),
					kits: freeze(summaries(kits, records.kits)),
					skipped: freeze([]),
				}),
			);
		},
		async save(item: { readonly name: string; readonly document: StudioDocument }) {
			const entry = records.designIn(item, stamp(now));
			return entry.ok ? put(designs, records.designs, entry.value) : entry;
		},
		async load(id: string): Promise<Result<LibraryItem>> {
			return take(designs, records.designs, idOf(id, 'load'));
		},
		async remove(id: string): Promise<Result<null>> {
			return drop(designs, idOf(id, 'remove'));
		},
		async listKits(): Promise<Result<readonly KitSummary[]>> {
			return ok(freeze(summaries(kits, records.kits)));
		},
		async saveKit(item: { readonly name: string; readonly kit: BrandKit }) {
			const entry = records.kitIn(item, stamp(now));
			return entry.ok ? put(kits, records.kits, entry.value) : entry;
		},
		async loadKit(id: string): Promise<Result<KitItem>> {
			return take(kits, records.kits, idOf(id, 'loadKit'));
		},
		async removeKit(id: string): Promise<Result<null>> {
			return drop(kits, idOf(id, 'removeKit'));
		},
		saveFile(name?: string): Result<{ readonly filename: string }> {
			const text = serialiseLibrary({
				designs: [...designs.entries.values()],
				kits: [...kits.entries.values()],
			});
			const bytes = new TextEncoder().encode(text);
			// A file this page writes must be one it can open again.
			if (bytes.length > LIBRARY_LIMITS.fileBytes) return err(fileFull());
			const filename = `${fileStem(name ?? 'qr-library')}${LIBRARY_EXTENSION}`;
			const handed = download(bytes, filename, LIBRARY_MIME);
			if (!handed.ok) return handed;
			unsaved = false;
			return ok(freeze({ filename }));
		},
		async openFile(file: Blob): Promise<LibraryFileOpened> {
			if (typeof file !== 'object' || file === null || typeof file.size !== 'number') {
				throw new TypeError('openFile: file is the Blob or File the person chose.');
			}
			// Refused by its size before a byte is read, so a file built to be
			// enormous costs nothing.
			if (file.size > LIBRARY_LIMITS.fileBytes) {
				return freeze({
					opened: false,
					issues: freeze([
						issue(LIBRARY_KEYS.tooLarge, [], 'error', { max: LIBRARY_LIMITS.fileBytes }),
					]),
				});
			}
			let text: unknown;
			try {
				text = await readText(file);
			} catch {
				text = null;
			}
			if (typeof text !== 'string') {
				return freeze({
					opened: false,
					issues: freeze([issue(LIBRARY_KEYS.unreadable, [], 'error')]),
				});
			}
			const parsed = parseLibraryFile(text, rules);
			if (parsed.library === null)
				return freeze({ opened: false, issues: freeze([...parsed.issues]) });
			designs = shelfOf(parsed.library.designs);
			kits = shelfOf(parsed.library.kits);
			unsaved = false;
			return freeze({ opened: true, issues: freeze([...parsed.issues]) });
		},
		hasUnsavedChanges(): boolean {
			return unsaved;
		},
	});
}
