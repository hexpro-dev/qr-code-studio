/**
 * The built-in types' specification vectors live in `./payload/vectors`, all
 * of them, and nothing a page runs carries them or reaches for them.
 *
 * They used to sit on each type, which put every vector, and the address of
 * every document one cites, into any bundle that offers a content type. The
 * move is only worth something while it holds, so this suite checks both
 * ends: the vectors are all still here, in the numbers recorded when they
 * moved, and the runtime side neither carries nor imports them.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import { describe, expect, it } from 'vitest';
import { BUILT_IN_PAYLOAD_TYPES } from '../../src/payload/registry.js';
import { BUILT_IN_VECTORS } from '../../src/payload/vectors/index.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const VECTORS_DIR = resolve(root, 'src/payload/vectors');

/**
 * How many vectors each type had on the day they moved off the types: 48 in
 * all. A vector lost in a later edit shows up here by name rather than as a
 * test that quietly stopped existing.
 */
const RECORDED_COUNTS: Readonly<Record<string, number>> = {
	wifi: 5,
	vcard: 1,
	mecard: 1,
	event: 2,
	email: 7,
	phone: 1,
	sms: 2,
	whatsapp: 2,
	telegram: 2,
	signal: 1,
	facetime: 2,
	geo: 3,
	bitcoin: 7,
	lightning: 2,
	epc: 2,
	'swiss-qr-bill': 1,
	pix: 1,
	upi: 1,
	zatca: 1,
	'gs1-digital-link': 1,
	url: 2,
	text: 1,
};

/**
 * The addresses the payload layer writes into codes, by scheme and host, and
 * nothing else: wa.me, t.me and signal.me for the chat links, a bare
 * `https://` for a GS1 Digital Link on the resolver a person names, and a
 * bare `http://` for the link type's guess at a scheme the text left out.
 */
const BUILT_ADDRESSES = [
	'http://',
	'https://',
	'https://signal.me',
	'https://t.me',
	'https://wa.me',
];

function sourceFiles(dir: string): string[] {
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		return statSync(path).isDirectory() ? sourceFiles(path) : path.endsWith('.ts') ? [path] : [];
	});
}

describe('BUILT_IN_VECTORS', () => {
	it('holds a list for every built-in type, in the registry order, and for nothing else', () => {
		expect(Object.keys(BUILT_IN_VECTORS)).toEqual(BUILT_IN_PAYLOAD_TYPES.map((type) => type.id));
		expect(Object.isFrozen(BUILT_IN_VECTORS)).toBe(true);
	});

	it('has every vector there was when they moved, and none of the lists is empty', () => {
		// No built-in type had an empty list before the move, so none is exempt.
		const counts = Object.fromEntries(
			Object.entries(BUILT_IN_VECTORS).map(([id, vectors]) => [id, vectors.length]),
		);
		expect(counts).toEqual(RECORDED_COUNTS);
		for (const [id, vectors] of Object.entries(BUILT_IN_VECTORS)) {
			expect(vectors.length, id).toBeGreaterThan(0);
		}
		expect(Object.values(BUILT_IN_VECTORS).flat()).toHaveLength(48);
	});
});

describe('the runtime content types', () => {
	it('carry no vectors', () => {
		for (const type of BUILT_IN_PAYLOAD_TYPES) {
			expect('vectors' in type, type.id).toBe(false);
		}
	});

	it('carry no citation on a compatibility note: each is a comment beside its note', () => {
		for (const type of BUILT_IN_PAYLOAD_TYPES) {
			for (const note of type.compatibility ?? []) {
				expect('source' in note, note.noteKey).toBe(false);
			}
		}
	});

	it('are never the way to the vectors: nothing under src imports them but themselves', () => {
		// Static, so it covers the studio and the offline app as well as the
		// payload barrel and the registry, without building either.
		const reaching: string[] = [];
		for (const file of sourceFiles(resolve(root, 'src'))) {
			if (file.startsWith(VECTORS_DIR + sep)) continue;
			const text = readFileSync(file, 'utf8');
			for (const match of text.matchAll(/(?:\bfrom|\bimport\s*\()\s*['"](\.{1,2}\/[^'"]+)['"]/g)) {
				const target = resolve(dirname(file), match[1] as string);
				if (target === VECTORS_DIR || target.startsWith(VECTORS_DIR + sep)) {
					reaching.push(`${relative(root, file)} -> ${match[1]}`);
				}
			}
		}
		expect(reaching).toEqual([]);
	});

	it('bundle without the vectors module, and with no address but the ones they build', async () => {
		const result = await esbuild.build({
			entryPoints: [resolve(root, 'src/payload/index.ts')],
			bundle: true,
			minify: true,
			write: false,
			metafile: true,
			format: 'esm',
			platform: 'browser',
			legalComments: 'none',
		});
		const inputs = Object.keys(result.metafile.inputs).map((path) => resolve(root, path));
		expect(inputs.filter((path) => path.startsWith(VECTORS_DIR + sep))).toEqual([]);
		const output = result.outputFiles[0]?.text ?? '';
		const addresses = new Set(
			[...output.matchAll(/https?:\/\/[a-z0-9.-]*/gi)].map((match) => match[0]),
		);
		expect([...addresses].sort()).toEqual(BUILT_ADDRESSES);
	}, 30_000);
});
