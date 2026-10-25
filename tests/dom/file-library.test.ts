/**
 * The offline app's library: a collection in memory that the person saves
 * as a `.qrlibrary.json` file and opens again. It keeps nothing in the
 * browser, holds no content, and reads a file a stranger made with strict
 * checks that end in issues, never in a throw.
 */

import { build } from 'esbuild';
import fc from 'fast-check';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QrStudioError } from '../../src/core/errors.js';
import { hasErrors } from '../../src/core/issue.js';
import type { Issue } from '../../src/core/issue.js';
import { err, ok } from '../../src/core/result.js';
import type { Result } from '../../src/core/result.js';
import {
	LIBRARY_EXTENSION,
	LIBRARY_KEYS,
	LIBRARY_LIMITS,
	LIBRARY_MIME,
	cleanName,
	createFileLibrary,
	libraryErrorKey,
	libraryRecords,
	parseLibraryFile,
	recordKey,
	serialiseLibrary,
	stamp,
} from '../../src/dom/file-library.js';
import type {
	FileLibrary,
	FileLibraryDeps,
	LibraryDownload,
	LibraryFileParse,
} from '../../src/dom/file-library.js';
import { EN_MESSAGES } from '../../src/messages/en/index.js';
import { LIBRARY_MESSAGES } from '../../src/messages/en/library.js';
import { DEFAULT_CONDITIONS } from '../../src/studio/document.js';
import { createStudio } from '../../src/studio/studio.js';
import {
	NETWORK,
	SECRET,
	assetOf,
	brandKit,
	designs,
	normalised,
	picture,
	registries,
	wifiDocument,
} from './library/helpers.js';

const NOW = 1_761_436_800_000;

interface Saved {
	readonly bytes: Uint8Array;
	readonly filename: string;
	readonly type: string;
}

function harness(overrides: Partial<FileLibraryDeps> = {}): {
	library: FileLibrary;
	saved: Saved[];
} {
	const saved: Saved[] = [];
	const download: LibraryDownload = (bytes, filename, type) => {
		saved.push({ bytes, filename, type });
		return ok(null);
	};
	return {
		library: createFileLibrary({ registries, now: () => NOW, download, ...overrides }),
		saved,
	};
}

function value<T>(result: Result<T>): T {
	if (!result.ok) throw new Error(`expected ok, got ${result.error.code}`);
	return result.value;
}

function code(result: Result<unknown>): string {
	return result.ok ? 'ok' : result.error.code;
}

function text(saved: Saved): string {
	return new TextDecoder().decode(saved.bytes);
}

function parse(source: string): LibraryFileParse {
	return parseLibraryFile(source, { registries });
}

/** A valid file, as the store writes one, as a plain object to damage. */
function validFile(): Record<string, unknown> {
	const entry = {
		name: 'Office',
		savedAt: NOW,
		typeId: 'wifi',
		design: normalised(wifiDocument().design),
		conditions: DEFAULT_CONDITIONS,
	};
	const kit = { name: 'Brand', savedAt: NOW, ...brandKit() };
	return JSON.parse(serialiseLibrary({ designs: [entry], kits: [kit] })) as Record<string, unknown>;
}

function codes(issues: readonly Issue[]): string[] {
	return issues.map((found) => found.code);
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe('the file library', () => {
	it('is always on, says so as a file, and holds what is saved for the page', async () => {
		const { library } = harness();
		expect(value(await library.probe())).toEqual({ available: true, enabled: true, state: 'file' });
		expect(code(await library.enable())).toBe('ok');
		expect(library.hasUnsavedChanges()).toBe(false);
		const office = value(await library.save({ name: ' Office\tWi-Fi ', document: wifiDocument() }));
		expect(office).toEqual({ id: '1', name: 'Office Wi-Fi', savedAt: NOW, typeId: 'wifi' });
		expect(library.hasUnsavedChanges()).toBe(true);
		const kit = value(await library.saveKit({ name: 'Brand', kit: brandKit() }));
		expect(kit).toEqual({ id: '1', name: 'Brand', savedAt: NOW });
		expect(value(await library.list())).toEqual([office]);
		expect(value(await library.listKits())).toEqual([kit]);
		expect(value(await library.contents())).toEqual({
			designs: [office],
			kits: [kit],
			skipped: [],
		});
		expect(value(await library.load('1')).document).toEqual({
			mode: 'create',
			typeId: 'wifi',
			fields: {},
			design: normalised(wifiDocument().design),
			conditions: DEFAULT_CONDITIONS,
		});
		expect(value(await library.loadKit('1'))).toEqual({ ...kit, kit: brandKit() });
		const missing = await library.load('9');
		expect(!missing.ok && libraryErrorKey(missing.error)).toBe(LIBRARY_KEYS.missing);
		expect(code(await library.loadKit('9'))).toBe('library/corrupt');
		expect(code(await library.removeKit('1'))).toBe('ok');
		expect(code(await library.remove('1'))).toBe('ok');
		expect(code(await library.remove('1'))).toBe('ok');
		expect(value(await library.contents())).toEqual({ designs: [], kits: [], skipped: [] });
	});

	it('refuses a design that does not validate, and a kit a design would not take', async () => {
		const { library } = harness();
		const broken = { ...wifiDocument(), design: { schema: 'qr-design', version: 1 } };
		expect(code(await library.save({ name: 'x', document: broken as never }))).toBe(
			'design/invalid',
		);
		const kit = await library.saveKit({ name: 'x', kit: brandKit({ palette: ['nope'] }) });
		expect(!kit.ok && libraryErrorKey(kit.error)).toBe(LIBRARY_KEYS.kit);
		expect(library.hasUnsavedChanges()).toBe(false);
	});

	it('forgets everything the page holds when it is switched off', async () => {
		const { library } = harness();
		await library.save({ name: 'One', document: wifiDocument() });
		await library.saveKit({ name: 'One', kit: brandKit() });
		expect(code(await library.disable())).toBe('ok');
		expect(library.hasUnsavedChanges()).toBe(false);
		expect(value(await library.contents())).toEqual({ designs: [], kits: [], skipped: [] });
		// Ids start again, as they do for a file just opened.
		expect(value(await library.save({ name: 'Two', document: wifiDocument() })).id).toBe('1');
	});

	it('works as the studio library', async () => {
		const { library } = harness();
		const studio = createStudio({ registries, library });
		await new Promise((resolve) => setTimeout(resolve, 0));
		// The file library is always there: Save and Open, not a switch.
		expect(studio.getSnapshot().library).toEqual({
			status: 'file',
			unsaved: false,
			items: [],
			kits: [],
			skipped: [],
			kit: null,
		});
		studio.dispatch({ type: 'design/preset', id: 'hex-pro-blue' });
		const saved = await studio.run({ type: 'library/save', name: 'Blue' });
		expect(value(saved).name).toBe('Blue');
		expect(studio.getSnapshot().library).toMatchObject({
			status: 'file',
			unsaved: true,
			items: [{ name: 'Blue' }],
		});
		studio.dispose();
	});

	it('holds a library to what one file can carry', async () => {
		const { library } = harness();
		for (let i = 0; i < LIBRARY_LIMITS.kits; i += 1) {
			value(await library.saveKit({ name: `Kit ${i}`, kit: brandKit({ logo: null }) }));
		}
		const full = await library.saveKit({ name: 'One more', kit: brandKit() });
		expect(code(full)).toBe('library/quota');
		expect(!full.ok && libraryErrorKey(full.error)).toBe(LIBRARY_KEYS.fileFull);
		const design = { name: 'x', document: wifiDocument() };
		for (let i = 0; i < LIBRARY_LIMITS.designs; i += 1) value(await library.save(design));
		expect(code(await library.save(design))).toBe('library/quota');
	});

	it('throws TypeError for a caller mistake', async () => {
		expect(() => createFileLibrary(null as never)).toThrow(TypeError);
		expect(() => createFileLibrary({} as never)).toThrow(TypeError);
		expect(() => libraryRecords({ registries: null } as never)).toThrow(TypeError);
		expect(() => parseLibraryFile(42 as never, { registries })).toThrow(TypeError);
		const { library } = harness({ now: () => -1 });
		await expect(library.save({ name: 'x', document: wifiDocument() })).rejects.toThrow(TypeError);
		await expect(library.saveKit({ name: 'x', kit: brandKit() })).rejects.toThrow(TypeError);
		for (const call of [
			() => library.load(1 as never),
			() => library.remove(1 as never),
			() => library.loadKit(1 as never),
			() => library.removeKit(1 as never),
			() => library.openFile(null as never),
			() => library.openFile('a file' as never),
			() => library.openFile({} as never),
		])
			await expect(call()).rejects.toThrow(TypeError);
	});
});

describe('saving and opening the file', () => {
	it('round trips a whole library through a file', async () => {
		const { library, saved } = harness();
		const logoDesign = registries.design.presets.require('hex-pro-blue').design;
		await library.save({ name: 'Office', document: wifiDocument() });
		await library.save({ name: 'Logo', document: wifiDocument(logoDesign) });
		await library.saveKit({ name: 'Brand', kit: brandKit() });
		await library.saveKit({
			name: 'Bare',
			kit: brandKit({ logo: null, palette: [], presets: [] }),
		});
		const before = value(await library.contents());

		const result = library.saveFile();
		expect(value(result)).toEqual({ filename: `qr-library${LIBRARY_EXTENSION}` });
		expect(library.hasUnsavedChanges()).toBe(false);
		expect(saved).toHaveLength(1);
		const file = saved[0] as Saved;
		expect(file.type).toBe(LIBRARY_MIME);
		expect(text(file).endsWith('}\n')).toBe(true);
		expect(JSON.parse(text(file))).toMatchObject({ schema: 'qr-library', version: 1 });

		const { library: next } = harness();
		const opened = await next.openFile(new Blob([file.bytes as BlobPart]));
		expect(opened).toEqual({ opened: true, issues: [] });
		expect(value(await next.contents())).toEqual(before);
		for (const id of ['1', '2']) {
			expect(value(await next.load(id))).toEqual(value(await library.load(id)));
			expect(value(await next.loadKit(id))).toEqual(value(await library.loadKit(id)));
		}
		expect(value(library.saveFile('Hex Pro: codes/2026')).filename).toBe(
			`Hex Pro codes 2026${LIBRARY_EXTENSION}`,
		);
	});

	it('hands back every design exactly as the design layer reads it', async () => {
		await fc.assert(
			fc.asyncProperty(fc.array(designs, { minLength: 1, maxLength: 4 }), async (list) => {
				const { library, saved } = harness();
				for (const design of list)
					await library.save({ name: 'x', document: wifiDocument(design) });
				value(library.saveFile());
				const { library: next } = harness();
				const file = saved[0] as Saved;
				expect((await next.openFile(new Blob([file.bytes as BlobPart]))).opened).toBe(true);
				const loaded = await Promise.all(list.map((_, index) => next.load(String(index + 1))));
				expect(loaded.map((item) => value(item).document.design)).toEqual(list);
			}),
			{ numRuns: 40, seed: 26102026 },
		);
	});

	it('writes no content into the file', async () => {
		const { library, saved } = harness();
		await library.save({ name: 'Office', document: wifiDocument() });
		value(library.saveFile());
		const written = text(saved[0] as Saved);
		expect(written).not.toContain(SECRET);
		expect(written).not.toContain(NETWORK);
		for (const key of ['fields', 'content', 'password', 'ssid'])
			expect(written).not.toContain(`"${key}"`);
	});

	it('replaces what the page holds with what the file holds, or changes nothing', async () => {
		const { library, saved } = harness();
		await library.save({ name: 'In the file', document: wifiDocument() });
		value(library.saveFile());
		const file = new Blob([(saved[0] as Saved).bytes as BlobPart]);
		await library.save({ name: 'Not yet saved', document: wifiDocument() });
		expect(library.hasUnsavedChanges()).toBe(true);

		const refused = await library.openFile(new Blob(['{"schema":"something-else"}']));
		expect(refused).toEqual({
			opened: false,
			issues: [{ code: LIBRARY_KEYS.notLibrary, path: [], severity: 'error' }],
		});
		expect(value(await library.list()).map((item) => item.name)).toEqual([
			'In the file',
			'Not yet saved',
		]);
		expect(library.hasUnsavedChanges()).toBe(true);

		expect((await library.openFile(file)).opened).toBe(true);
		expect(value(await library.list()).map((item) => item.name)).toEqual(['In the file']);
		expect(library.hasUnsavedChanges()).toBe(false);
	});

	it('reports a download that did not happen, and stays unsaved', async () => {
		const library = createFileLibrary({ registries, now: () => NOW });
		await library.save({ name: 'x', document: wifiDocument() });
		// Node has no document, so the default download cannot happen here.
		expect(code(library.saveFile())).toBe('platform/unavailable');
		expect(library.hasUnsavedChanges()).toBe(true);
		const failing = harness({
			download: () => err(new QrStudioError('platform/unavailable', 'no')),
		});
		await failing.library.save({ name: 'x', document: wifiDocument() });
		expect(code(failing.library.saveFile())).toBe('platform/unavailable');
	});

	it('refuses to write a file larger than it could open again', async () => {
		// The largest picture a design may embed: noise, so it does not compress.
		const side = 360;
		const noisy = picture(side, side - 4);
		let state = 0x9e3779b9;
		for (let i = 0; i < noisy.data.length; i += 1) {
			state ^= state << 13;
			state ^= state >>> 17;
			state ^= state << 5;
			noisy.data[i] = state & 0xff;
		}
		const logo = assetOf(noisy);
		const base = registries.design.presets.require('hex-pro-blue').design;
		const design = {
			...base,
			symbol: { ...base.symbol, ecLevel: 'H' as const },
			logo: {
				source: { kind: 'asset' as const, id: 'big' },
				size: 0.2,
				clear: 'box' as const,
				padding: 1,
				plate: null,
			},
			assets: { big: logo },
		};
		const { library, saved } = harness();
		const each = logo.png.length;
		const count = Math.ceil(LIBRARY_LIMITS.fileBytes / each) + 1;
		for (let i = 0; i < count; i += 1)
			value(await library.save({ name: 'Big', document: wifiDocument(design) }));
		const refused = library.saveFile();
		expect(!refused.ok && libraryErrorKey(refused.error)).toBe(LIBRARY_KEYS.fileFull);
		expect(saved).toEqual([]);
	}, 60_000);

	it('uses the file own text() unless given a reader', async () => {
		const library = createFileLibrary({ registries });
		const opened = await library.openFile(new Blob([serialiseLibrary({ designs: [], kits: [] })]));
		expect(opened).toEqual({ opened: true, issues: [] });
		const before = Date.now();
		const saved = value(await library.save({ name: 'Now', document: wifiDocument() }));
		expect(saved.savedAt).toBeGreaterThanOrEqual(before);
	});
});

describe('a file a stranger made', () => {
	it('is refused by its size before a byte of it is read', async () => {
		const readText = vi.fn(async () => '');
		const { library } = harness({ readText });
		const huge = { size: LIBRARY_LIMITS.fileBytes + 1 } as Blob;
		expect(await library.openFile(huge)).toEqual({
			opened: false,
			issues: [
				{
					code: LIBRARY_KEYS.tooLarge,
					path: [],
					severity: 'error',
					params: { max: LIBRARY_LIMITS.fileBytes },
				},
			],
		});
		expect(readText).not.toHaveBeenCalled();
		// And by its length, when the reader hands back more than the size said.
		const lying = harness({ readText: async () => ' '.repeat(LIBRARY_LIMITS.fileBytes + 1) });
		expect(codes((await lying.library.openFile(new Blob(['{}']))).issues)).toEqual([
			LIBRARY_KEYS.tooLarge,
		]);
	});

	it('is refused when it cannot be read', async () => {
		for (const readText of [
			async () => {
				throw new DOMException('gone', 'NotReadableError');
			},
			async () => new Uint8Array(4) as unknown as string,
		]) {
			const { library } = harness({ readText });
			expect(await library.openFile(new Blob(['x']))).toEqual({
				opened: false,
				issues: [{ code: LIBRARY_KEYS.unreadable, path: [], severity: 'error' }],
			});
		}
	});

	it('is refused, with an issue saying why, for each thing a library file is not', () => {
		const file = validFile();
		const cases: [string, string, unknown[]?][] = [
			['not json at all', LIBRARY_KEYS.notJson],
			['', LIBRARY_KEYS.notJson],
			['[]', LIBRARY_KEYS.notLibrary],
			['null', LIBRARY_KEYS.notLibrary],
			[JSON.stringify({ ...file, schema: 'qr-design' }), LIBRARY_KEYS.notLibrary],
			[JSON.stringify({ ...file, version: 2 }), LIBRARY_KEYS.version, ['version']],
			[JSON.stringify({ ...file, version: '1' }), LIBRARY_KEYS.version, ['version']],
			[JSON.stringify({ schema: 'qr-library' }), LIBRARY_KEYS.version, ['version']],
			[JSON.stringify({ ...file, fields: {} }), LIBRARY_KEYS.content, ['fields']],
			[JSON.stringify({ ...file, owner: 'x' }), LIBRARY_KEYS.unknownKey, ['owner']],
			[JSON.stringify({ ...file, 'a key with spaces': 1 }), LIBRARY_KEYS.unknownKey, []],
			['{"__proto__":{"admin":true},"schema":"qr-library","version":1}', LIBRARY_KEYS.unknownKey],
			[JSON.stringify({ ...file, designs: {} }), LIBRARY_KEYS.notLibrary, ['designs']],
			[JSON.stringify({ ...file, kits: undefined }), LIBRARY_KEYS.notLibrary, ['kits']],
			[`${'['.repeat(41)}${']'.repeat(41)}`, LIBRARY_KEYS.tooDeep],
			[
				JSON.stringify({
					...file,
					designs: [{ deep: JSON.parse(`${'['.repeat(40)}${']'.repeat(40)}`) }],
				}),
				LIBRARY_KEYS.tooDeep,
			],
		];
		for (const [source, expected, path] of cases) {
			const parsed = parse(source);
			expect(parsed.library, source.slice(0, 60)).toBeNull();
			expect(codes(parsed.issues), source.slice(0, 60)).toEqual([expected]);
			if (path !== undefined) expect(parsed.issues[0]?.path).toEqual(path);
		}
		const tooMany = parse(
			JSON.stringify({ ...file, kits: Array(LIBRARY_LIMITS.kits + 1).fill(0) }),
		);
		expect(tooMany.issues).toEqual([
			{
				code: LIBRARY_KEYS.tooMany,
				path: ['kits'],
				severity: 'error',
				params: { count: LIBRARY_LIMITS.kits + 1, max: LIBRARY_LIMITS.kits },
			},
		]);
		expect(codes(parse(JSON.stringify({ ...file, designs: Array(501).fill(0) })).issues)).toEqual([
			LIBRARY_KEYS.tooMany,
		]);
	});

	it('counts brackets inside strings as text, and reads a file that starts with a byte order mark', () => {
		const file = validFile();
		const designs = file.designs as Record<string, unknown>[];
		const named = { ...file, designs: [{ ...designs[0], name: `[{"\\${'['.repeat(60)}` }] };
		const parsed = parse(`\ufeff${JSON.stringify(named)}`);
		expect(parsed.issues).toEqual([]);
		expect(parsed.library?.designs[0]?.name).toBe(`[{"\\${'['.repeat(60)}`);
	});

	it('leaves out each entry that cannot be used and keeps the rest', () => {
		const file = validFile();
		const [design] = file.designs as Record<string, unknown>[];
		const [kit] = file.kits as Record<string, unknown>[];
		const d = design as Record<string, unknown>;
		const k = kit as Record<string, unknown>;
		const tooBigPng = 'A'.repeat(Math.ceil((512 * 1024) / 3) * 4 + 4);
		const parsed = parse(
			JSON.stringify({
				...file,
				designs: [
					d,
					{ ...d, fields: { password: SECRET } },
					{ ...d, text: SECRET },
					{ ...d, payload: 'x' },
					{ ...d, id: 7 },
					{
						...d,
						design: {
							...(d.design as object),
							assets: { a: assetOf(), b: assetOf(), c: assetOf(), d: assetOf(), e: assetOf() },
						},
					},
					{
						...d,
						design: {
							...(d.design as object),
							logo: {
								source: { kind: 'asset', id: 'big' },
								size: 0.2,
								clear: 'box',
								padding: 1,
								plate: null,
							},
							assets: { big: { png: tooBigPng, width: 1, height: 1 } },
						},
					},
					{
						...d,
						design: {
							...(d.design as object),
							logo: {
								source: { kind: 'asset', id: 'big' },
								size: 0.2,
								clear: 'box',
								padding: 1,
								plate: null,
							},
							assets: { big: { ...assetOf(), width: 2000 } },
						},
					},
					42,
				],
				kits: [
					k,
					{ ...k, content: SECRET },
					{ ...k, logo: { png: tooBigPng, width: 1, height: 1 } },
					{ ...k, logo: { png: 'iVBORw0KGgo=', width: 1, height: 1 } },
					{ ...k, palette: Array(33).fill('#000000') },
					{ ...k, presets: ['from-a-newer-build', 'hex-pro-blue'] },
					{ ...k, presets: [1] },
				],
			}),
		);
		expect(parsed.library?.designs).toHaveLength(1);
		expect(parsed.library?.kits.map((entry) => entry.presets)).toEqual([
			['hex-pro-blue', 'rounded-ocean'],
			['hex-pro-blue'],
		]);
		expect(parsed.issues).toEqual([
			...[1, 2, 3].map((at) => ({
				code: LIBRARY_KEYS.content,
				path: ['designs', at],
				severity: 'warning',
			})),
			...[4, 5, 6, 7, 8].map((at) => ({
				code: LIBRARY_KEYS.corrupt,
				path: ['designs', at],
				severity: 'warning',
			})),
			{ code: LIBRARY_KEYS.content, path: ['kits', 1], severity: 'warning' },
			...[2, 3, 4, 6].map((at) => ({
				code: LIBRARY_KEYS.corrupt,
				path: ['kits', at],
				severity: 'warning',
			})),
		]);
		expect(hasErrors(parsed.issues)).toBe(false);
	});

	it('only ever answers with issues, whatever the text', () => {
		const known = new Set(Object.keys(EN_MESSAGES));
		const file = validFile();
		const mutated = fc
			.tuple(
				fc.constantFrom('designs', 'kits', 'schema', 'version', 'extra'),
				fc.nat(3),
				fc.constantFrom(
					'name',
					'savedAt',
					'typeId',
					'design',
					'conditions',
					'palette',
					'logo',
					'presets',
					'fields',
				),
				fc.jsonValue({ maxDepth: 4 }),
			)
			.map(([top, index, key, replacement]) => {
				const copy = structuredClone(file);
				const list = copy[top];
				if (Array.isArray(list) && index < list.length)
					(list[index] as Record<string, unknown>)[key] = replacement;
				else copy[top] = replacement;
				return JSON.stringify(copy);
			});
		const inputs = fc.oneof(
			fc.string({ maxLength: 200 }),
			fc.jsonValue({ maxDepth: 6 }).map((found) => JSON.stringify(found)),
			mutated,
		);
		fc.assert(
			fc.property(inputs, (source) => {
				const parsed = parse(source);
				expect(parsed.library === null).toBe(hasErrors(parsed.issues));
				for (const found of parsed.issues) expect(known.has(found.code), found.code).toBe(true);
			}),
			{ numRuns: 600, seed: 1026 },
		);
	});

	it('never rejects an open, whatever the bytes', async () => {
		const { library } = harness();
		await fc.assert(
			fc.asyncProperty(fc.uint8Array({ maxLength: 300 }), async (bytes) => {
				const opened = await library.openFile(new Blob([bytes as BlobPart]));
				expect(typeof opened.opened).toBe('boolean');
			}),
			{ numRuns: 200, seed: 7 },
		);
	});
});

describe('the rules for a record', () => {
	it('cleans a name to something safe to show and keep', () => {
		expect(cleanName('  Office \n\t Wi-Fi  ')).toBe('Office Wi-Fi');
		expect(cleanName('A\u0000B\u0085C\u2028D\u2029E\u007fF')).toBe('A B C D E F');
		expect(cleanName('broken \ud800 surrogate')).toBe('broken surrogate');
		expect(cleanName('invoice\u202egnp.exe\u2066x\u2069')).toBe('invoice gnp.exe x');
		expect(cleanName('\u{1f600}'.repeat(100))).toBe('\u{1f600}'.repeat(LIBRARY_LIMITS.name));
		expect([...cleanName(`${'a'.repeat(79)} b`)]).toHaveLength(79);
		expect(cleanName(`${'a'.repeat(78)} b`)).toBe(`${'a'.repeat(78)} b`);
		expect(cleanName('')).toBe('');
	});

	it('gives out ids as counters and reads only those back', () => {
		expect(recordKey('1')).toBe(1);
		expect(recordKey('123456789012345')).toBe(123456789012345);
		for (const id of ['0', '01', '-1', '1.5', '1e3', '1234567890123456', '', ' 1'])
			expect(recordKey(id)).toBeNull();
	});

	it('takes the time from the clock, and refuses a clock that gives anything else', () => {
		expect(stamp(() => 12.9)).toBe(12);
		for (const bad of [Number.NaN, -1, Number.POSITIVE_INFINITY, '5' as unknown as number])
			expect(() => stamp(() => bad)).toThrow(TypeError);
	});
});

describe('what it says', () => {
	it('has a sentence for every key it uses, and none it does not', () => {
		expect(Object.keys(LIBRARY_MESSAGES).sort()).toEqual(Object.values(LIBRARY_KEYS).sort());
		for (const key of Object.values(LIBRARY_KEYS)) expect(EN_MESSAGES[key], key).toBeDefined();
	});

	it('fills every placeholder from the params its issue carries', async () => {
		const issues: Issue[] = [];
		const { library } = harness();
		issues.push(...(await library.openFile({ size: LIBRARY_LIMITS.fileBytes + 1 } as Blob)).issues);
		issues.push(...parse(JSON.stringify({ ...validFile(), kits: Array(101).fill(0) })).issues);
		const reached = new Set<string>();
		for (const found of issues) {
			const sentence = LIBRARY_MESSAGES[found.code] as string;
			for (const match of sentence.matchAll(/\{(\w+)\}/g)) {
				reached.add(found.code);
				expect(found.params ?? {}, `${found.code} uses {${match[1]}}`).toHaveProperty(
					match[1] as string,
				);
			}
		}
		const placeholders = Object.entries(LIBRARY_MESSAGES)
			.filter(([, sentence]) => /\{\w+\}/.test(sentence))
			.map(([key]) => key);
		expect(placeholders.filter((key) => !reached.has(key))).toEqual([]);
	});

	it('picks the specific sentence by code and reason, and the studio one otherwise', () => {
		expect(libraryErrorKey(new QrStudioError('library/quota', 'x'))).toBe('error.library.quota');
		expect(libraryErrorKey(new QrStudioError('library/quota', 'x', { reason: 'blocked' }))).toBe(
			'error.library.quota',
		);
		expect(
			libraryErrorKey(new QrStudioError('library/unavailable', 'x', { reason: 'blocked' })),
		).toBe(LIBRARY_KEYS.blocked);
		expect(libraryErrorKey(new QrStudioError('encode/too-much-data', 'x'))).toBe(
			'encode.too-much-data',
		);
	});
});

describe('what the offline app gets', () => {
	it('keeps nothing in the browser, through a whole session', async () => {
		const names = ['indexedDB', 'localStorage', 'sessionStorage', 'caches'] as const;
		const installed: string[] = [];
		for (const name of names) {
			if (name in globalThis) continue;
			Object.defineProperty(globalThis, name, {
				configurable: true,
				get() {
					throw new Error(`${name} was read by the file library`);
				},
			});
			installed.push(name);
		}
		try {
			const { library, saved } = harness();
			await library.probe();
			await library.enable();
			await library.save({ name: 'x', document: wifiDocument() });
			await library.saveKit({ name: 'x', kit: brandKit() });
			await library.contents();
			value(library.saveFile());
			await library.openFile(new Blob([(saved[0] as Saved).bytes as BlobPart]));
			await library.disable();
			expect(installed.length).toBeGreaterThan(0);
		} finally {
			for (const name of installed) delete (globalThis as Record<string, unknown>)[name];
		}
	});

	it('bundles without the opt-in library or any storage name in it', async () => {
		const entry = fileURLToPath(new URL('../../src/dom/file-library.ts', import.meta.url));
		const result = await build({
			entryPoints: [entry],
			bundle: true,
			format: 'esm',
			minify: true,
			write: false,
			metafile: true,
			target: ['es2022'],
		});
		const inputs = Object.keys(result.metafile.inputs);
		expect(inputs.some((path) => path.endsWith('dom/file-library.ts'))).toBe(true);
		expect(inputs.filter((path) => path.includes('dom/library'))).toEqual([]);
		const script = result.outputFiles[0]?.text ?? '';
		for (const name of ['indexedDB', 'localStorage', 'sessionStorage', 'caches', 'cookie'])
			expect(script, name).not.toContain(name);
	});
});
