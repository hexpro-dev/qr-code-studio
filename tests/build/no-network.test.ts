/**
 * The offline document reaches nothing and keeps nothing, and the lint rule
 * that guards the source agrees with the scan that guards the artefact.
 *
 * `eslint.config.js` forbids the names that would break the promise inside
 * `src/`, which is the gate a patch passes on the way in. This file checks the
 * other end: the built document, assembled in memory from source on every run
 * by the same function `standalone-html.test.ts` uses, so nothing sitting in
 * `dist/` from weeks ago can satisfy it.
 *
 * The drift check asks ESLint itself what it would enforce for every source
 * file, rather than reading the configuration as text. The configuration now
 * builds its rules from functions and has one per-file exception, so a regular
 * expression over the file would be checking how it is written rather than
 * what it does. Asking ESLint is checking what it does.
 *
 * What this cannot see, said plainly: a name assembled at runtime.
 * `globalThis['fet' + 'ch']` passes every scan of this kind. Behind the scan for
 * that case sit `default-src 'none'` and `connect-src 'none'` in the document's
 * own policy, which refuse the connection however it was spelled, and the
 * absence of `eval` and the Function constructor, which are the general way to
 * turn a string into code.
 */

import { readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildStandaloneHtml } from '../../scripts/build-html.js';
import type { StandaloneBuildResult } from '../../scripts/build-html.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** Every name the lint rule forbids inside `src/`, written out again on purpose. */
const FORBIDDEN = [
	'fetch',
	'XMLHttpRequest',
	'WebSocket',
	'EventSource',
	'Request',
	'Response',
	'sendBeacon',
	'localStorage',
	'sessionStorage',
	'indexedDB',
	'caches',
	'cookie',
] as const;

/** The one file allowed one of those names, and the name. */
const LIBRARY_FILE = 'src/dom/library/indexeddb.ts';
const LIBRARY_ALLOWS = ['indexedDB'];

/** The ways a program can acquire code, or a name, after it has started. */
const RUNTIME_LOADERS = ['import(', 'eval(', 'Function(', 'importScripts'] as const;

/** Members of Math that must not be called where results have to agree across engines. */
const UNSPECIFIED_MATH = ['sin', 'cos', 'atan2', 'exp', 'pow', 'hypot', 'random'] as const;
const DETERMINISM_ZONE = [
	'core',
	'segment',
	'symbology',
	'encode',
	'decode',
	'geometry',
	'text',
	'render',
	'design',
	'verify',
] as const;

let build: StandaloneBuildResult;
let script = '';
let style = '';
let markup = '';
let csp = '';

function part(html: string, pattern: RegExp, what: string): string {
	const found = pattern.exec(html);
	if (!found?.[1]) throw new Error(`the built document has no ${what}`);
	return found[1];
}

function sourceFiles(dir: string): string[] {
	const out: string[] = [];
	for (const name of readdirSync(dir)) {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
		else if (name.endsWith('.ts')) out.push(path);
	}
	return out;
}

interface RestrictedEntry {
	readonly name?: string;
	readonly object?: string;
	readonly property?: string;
}

function entries(rule: unknown): RestrictedEntry[] {
	if (!Array.isArray(rule)) return [];
	return rule.slice(1).filter((entry): entry is RestrictedEntry => typeof entry === 'object');
}

beforeAll(async () => {
	build = await buildStandaloneHtml();
	script = part(build.html, /<script>([\s\S]*)<\/script>/, 'script element');
	style = part(build.html, /<style>([\s\S]*?)<\/style>/, 'style element');
	markup = build.html.replace(script, '').replace(style, '');
	csp = part(
		build.html,
		/<meta http-equiv="Content-Security-Policy" content="([^"]*)"/,
		'security policy',
	);
}, 120_000);

describe('the program inside the built document', () => {
	it('names nothing that opens a connection or writes a store', () => {
		// Whole substrings rather than whole words. The program is minified, so
		// every identifier in it that survives is a property name or a string,
		// and a substring search also catches the name buried in a longer one.
		for (const name of FORBIDDEN) {
			expect(script, `${name} in the program`).not.toContain(name);
			expect(style, `${name} in the stylesheet`).not.toContain(name);
		}
	});

	it('names nowhere to send anything', () => {
		expect(script, 'a scheme and host in the program').not.toContain('://');
		expect(style, 'a scheme and host in the stylesheet').not.toContain('://');
	});

	it('acquires no code once it is running', () => {
		// Stricter than the lint rule can be in the source. By this point every
		// module is flattened into one scope, so an `import(` in the built program
		// is not a module boundary any more. It is a fetch.
		for (const loader of RUNTIME_LOADERS) {
			expect(script, `${loader} in the program`).not.toContain(loader);
		}
	});

	it('was built without the opt-in library anywhere in it', () => {
		// The library is offered on the website, where it has a stable origin.
		// A file opened from disk has none worth trusting with storage, so the
		// offline build must not carry it even unused. The metafile names every
		// source file that contributed bytes; the library must not be one.
		const inputs = Object.keys(build.inputs);
		expect(inputs.length, 'the metafile listed no inputs').toBeGreaterThan(0);
		expect(inputs.filter((path) => path.includes('dom/library'))).toEqual([]);
	});
});

describe('the markup inside the built document', () => {
	it('uses these names only in the prose that promises they are absent', () => {
		const facts = [...markup.matchAll(/<dd\b[^>]*>[\s\S]*?<\/dd>/g)].map((found) => found[0]);
		expect(facts.length, 'the facts list is missing from the page').toBeGreaterThan(0);
		let rest = markup;
		for (const fact of facts) rest = rest.replace(fact, '');
		for (const name of FORBIDDEN) {
			expect(rest, `${name} in the markup outside the facts list`).not.toContain(name);
		}
	});
});

describe('what the scan cannot see', () => {
	it('is refused by the policy the document carries anyway', () => {
		expect(csp).toContain("default-src 'none'");
		expect(csp).toContain("connect-src 'none'");
		expect(csp).not.toContain('unsafe-eval');
	});
});

describe('the lint rule and this file', () => {
	let eslint: ESLint;
	let files: string[];

	beforeAll(() => {
		eslint = new ESLint({ cwd: root });
		files = sourceFiles(resolve(root, 'src'));
	});

	it('forbid the same names in every source file, with the one exception', async () => {
		// Asked of ESLint for every file, because the configuration is built from
		// functions and an exception block that replaced the wrong rule would
		// lift the ban for a whole directory without changing a word of the list.
		expect(files.length).toBeGreaterThan(0);
		for (const file of files) {
			const path = relative(root, file);
			const config = (await eslint.calculateConfigForFile(file)) as {
				rules?: Record<string, unknown>;
			};
			const rules = config.rules ?? {};
			const properties = new Set(
				entries(rules['no-restricted-properties'])
					.filter((entry) => entry.object === undefined)
					.map((entry) => entry.property),
			);
			const globals = new Set(entries(rules['no-restricted-globals']).map((entry) => entry.name));
			const allowed = path === LIBRARY_FILE ? LIBRARY_ALLOWS : [];
			const expected = FORBIDDEN.filter((name) => !allowed.includes(name));
			for (const name of expected) {
				expect(properties.has(name), `${path} does not forbid .${name}`).toBe(true);
			}
			for (const name of allowed) {
				expect(properties.has(name), `${path} forbids its own exception`).toBe(false);
			}
			for (const name of ['fetch', 'localStorage', 'WebSocket']) {
				expect(globals.has(name), `${path} does not forbid the global ${name}`).toBe(true);
			}
		}
	}, 120_000);

	it('forbids nothing this file does not know about', async () => {
		// The reverse direction: a name added to the rule and not to the scan.
		const config = (await eslint.calculateConfigForFile(resolve(root, 'src/index.ts'))) as {
			rules?: Record<string, unknown>;
		};
		const named = entries(config.rules?.['no-restricted-properties'])
			.filter((entry) => entry.object === undefined)
			.map((entry) => entry.property)
			.filter((name): name is string => typeof name === 'string')
			.filter((name) => !['toLocaleString', 'localeCompare'].includes(name));
		expect([...new Set(named)].sort()).toEqual([...FORBIDDEN].sort());
	});

	it('holds the determinism zone to specified arithmetic', async () => {
		for (const file of files) {
			const path = relative(root, file);
			const dir = path.split('/')[1] ?? '';
			if (!(DETERMINISM_ZONE as readonly string[]).includes(dir)) continue;
			const config = (await eslint.calculateConfigForFile(file)) as {
				rules?: Record<string, unknown>;
			};
			const banned = new Set(
				entries(config.rules?.['no-restricted-properties'])
					.filter((entry) => entry.object === 'Math')
					.map((entry) => entry.property),
			);
			for (const member of UNSPECIFIED_MATH) {
				expect(banned.has(member), `${path} may call Math.${member}`).toBe(true);
			}
		}
	}, 120_000);
});
