/**
 * The single file offline application.
 *
 * Built here in memory, from source, on every run. Nothing is read from `dist/`
 * and nothing is written, so this suite passes on a clean checkout and, more to
 * the point, cannot be satisfied by an artefact somebody built weeks ago. That
 * matters more here than anywhere else in the package: this file is what makes
 * the privacy claim checkable rather than something a reader has to believe,
 * and an assertion about a stale copy of it checks nothing at all.
 *
 * Where a check can be anchored to something outside this package it is: the
 * SHA-256 digests below come from FIPS 180-2 rather than from a second call to
 * the same function the build uses, the format constants come from the format
 * specifications, and the encoding and policy placement rules come from the
 * HTML and CSP specifications. A test that only compares the build against
 * itself would stay green through every one of the failures those catch.
 *
 * The hook below runs esbuild, so it takes a couple of seconds.
 */

import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Script } from 'node:vm';
import ts from 'typescript';
import { beforeAll, describe, expect, it } from 'vitest';
import { OUTPUT_NAME, buildStandaloneHtml } from '../../scripts/build-html.js';
import type { StandaloneBuildResult } from '../../scripts/build-html.js';

/** Named in the footer as plain text: no scheme, and inside no attribute. */
const REPOSITORY = 'github.com/hexpro-dev/qr-code-studio';

/** Every way this page could start a request. */
const NETWORK_APIS = [
	'fetch(',
	'XMLHttpRequest',
	'WebSocket',
	'EventSource',
	'sendBeacon',
] as const;

/** Every way this page could leave something behind on the machine. */
const STORAGE_APIS = ['localStorage', 'sessionStorage', 'indexedDB', 'document.cookie'] as const;

/** Elements that can pull in a second file, or send one somewhere. */
const REMOTE_ELEMENTS = ['link', 'iframe', 'object', 'embed', 'form', 'source', 'track'] as const;

/**
 * Attributes that name another file.
 *
 * `ping` is here because it is the one attribute that sends a request without
 * naming a document to load, which is exactly the shape of thing that gets
 * added without anybody thinking of it as a network call.
 */
const REMOTE_ATTRIBUTES = [
	'src',
	'href',
	'action',
	'srcset',
	'poster',
	'formaction',
	'ping',
] as const;

/**
 * Published SHA-256 digests, base64 encoded the way a CSP hash source is.
 *
 * The build and this file both reach for `node:crypto`, so comparing one
 * against the other proves only that they agree with each other. These two are
 * the FIPS 180-2 vectors, and they are what ties the digest to the function a
 * browser computes rather than to whatever this package happens to compute.
 */
const SHA256_VECTORS: readonly (readonly [string, string])[] = [
	['abc', 'ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0='],
	['', '47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU='],
];

/**
 * Punctuation the house style forbids in anything a person reads.
 *
 * As escapes rather than as literal characters, so that a search of this
 * repository for an em dash does not find one in the file that bans it. The
 * error messages are in the bundle and the page copy is in the markup, so this
 * is the one place both are covered at once.
 */
const FORBIDDEN_PUNCTUATION: readonly (readonly [string, string])[] = [
	['\u2014', 'an em dash'],
	['\u2013', 'an en dash'],
	['\u2018', 'a curly opening quote'],
	['\u2019', 'a curly apostrophe'],
	['\u201c', 'a curly opening double quote'],
	['\u201d', 'a curly closing double quote'],
	['\u2192', 'an arrow used as punctuation'],
	['\u2022', 'a bullet character'],
];

/** The register the house style forbids, in the copy and in error messages. */
const MARKETING_REGISTER = [
	'unlock',
	'unleash',
	'empower',
	'supercharge',
	'seamless',
	'effortless',
	'robust',
	'cutting-edge',
	'best-in-class',
	'world-class',
	'game-changer',
	'take it to the next level',
] as const;

/** What a browser computes over an inline element to check a CSP hash. */
function sha256(text: string): string {
	return createHash('sha256').update(text, 'utf8').digest('base64');
}

/** The policy as a browser reads it: a directive name, then its source list. */
function directives(policy: string): ReadonlyMap<string, readonly string[]> {
	const parsed = new Map<string, readonly string[]>();
	for (const clause of policy.split(';')) {
		const parts = clause.trim().split(/\s+/).filter(Boolean);
		const name = parts.shift();
		if (name) parsed.set(name.toLowerCase(), parts);
	}
	return parsed;
}

/**
 * The ids the program looks up, read out of its own source.
 *
 * `$()` throws `missing element` when a lookup misses, and it runs while the
 * module is still evaluating, so an id renamed in the template on its own
 * leaves a page that draws and then does nothing at all. Nothing else in this
 * suite notices: the markup is still self contained, the hashes still match
 * and the size is still in range.
 */
function elementIds(source: string): readonly string[] {
	const ids = new Set<string>();
	for (const found of source.matchAll(/\$<[^>]+>\('([^']+)'\)/g)) ids.add(found[1]);
	for (const found of source.matchAll(/getElementById\('([^']+)'\)/g)) ids.add(found[1]);
	for (const found of source.matchAll(/byId(?:<[^>]+>)?\('([^']+)'\)/g)) ids.add(found[1]);
	return [...ids];
}

/**
 * The class names the program puts on elements it creates: assigned, passed
 * to the element helper as `className`, or added to a class list.
 */
function scriptedClasses(source: string): readonly string[] {
	const names = new Set<string>();
	const patterns = [
		/className = '([^']+)'/g,
		/className: '([^']+)'/g,
		/classList\.(?:add|toggle|remove)\('([^']+)'/g,
		/\bclass: '([^']+)'/g,
	];
	for (const pattern of patterns) {
		for (const found of source.matchAll(pattern)) {
			for (const name of found[1].split(/\s+/)) if (name) names.add(name);
		}
	}
	return [...names];
}

/**
 * Every string the program carries, read with the TypeScript parser rather
 * than a regular expression, so a quote inside a regular expression literal
 * or a template cannot start a string that is not there. These are what a
 * person can be shown; an identifier never is.
 */
function stringLiterals(program: string): readonly string[] {
	const out: string[] = [];
	const source = ts.createSourceFile(
		'program.js',
		program,
		ts.ScriptTarget.Latest,
		false,
		ts.ScriptKind.JS,
	);
	const visit = (node: ts.Node): void => {
		if (
			ts.isStringLiteral(node) ||
			ts.isNoSubstitutionTemplateLiteral(node) ||
			ts.isTemplateHead(node) ||
			ts.isTemplateMiddle(node) ||
			ts.isTemplateTail(node)
		) {
			out.push(node.text);
		}
		ts.forEachChild(node, visit);
	};
	visit(source);
	return out;
}

/** The application's source: every module under src/app, read together. */
async function readAppSource(): Promise<string> {
	const dir = fileURLToPath(new URL('../../src/app/', import.meta.url));
	const names = (await readdir(dir)).filter((name) => name.endsWith('.ts')).sort();
	const texts = await Promise.all(names.map((name) => readFile(`${dir}${name}`, 'utf8')));
	return texts.join('\n');
}

/** The `data-` attributes the program sets to carry a state. */
function scriptedStates(source: string): readonly string[] {
	const names = new Set<string>();
	for (const found of source.matchAll(/dataset\.(\w+)\s*=/g)) names.add(found[1]);
	return [...names];
}

/** A rule for exactly this class, rather than for one that only starts the same way. */
function stylesClass(stylesheet: string, name: string): boolean {
	// `.result` is a prefix of `.result__thumb`, so a plain `includes` would
	// report a rule for a class that has none.
	return new RegExp(`\\.${name.replace(/[^\w-]/g, '\\$&')}(?![\\w-])`).test(stylesheet);
}

let build: StandaloneBuildResult;
let html = '';
/** The contents of the one script element, without its tags. */
let script = '';
/** The contents of the one style element, without its tags. */
let style = '';
/**
 * The document with the program and the stylesheet lifted out of it.
 *
 * The markup is searched separately from the program on purpose. The bundle
 * contains `.src=` and `.href=` as a matter of course, because attaching the
 * preview and saving the result are exactly what those two lines of the
 * application do, so a search of the whole document for `src=` finds them and
 * proves nothing.
 */
let markup = '';
let csp = '';
/** The application's source, every module of it, for the contracts it has with the template. */
let appSource = '';
/** The version the package declares, read from the manifest and not from the build. */
let version = '';

function part(pattern: RegExp, what: string): string {
	const found = pattern.exec(html);
	if (!found?.[1]) throw new Error(`the built document has no ${what}`);
	return found[1];
}

beforeAll(async () => {
	build = await buildStandaloneHtml();
	html = build.html;
	script = part(/<script>([\s\S]*)<\/script>/, 'script element');
	style = part(/<style>([\s\S]*?)<\/style>/, 'style element');
	markup = html.replace(script, '').replace(style, '');
	csp = part(/<meta http-equiv="Content-Security-Policy" content="([^"]*)"/, 'security policy');
	appSource = await readAppSource();
	const manifest = JSON.parse(
		await readFile(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf8'),
	) as { version: string };
	version = manifest.version;
}, 120_000);

describe('the built document is a program', () => {
	it('compiles as one complete script', () => {
		// Compiled, never run. There is no DOM here and nothing to exercise; what
		// is being checked is that the bundle survived being pasted into an HTML
		// document intact. A file that parses as a document but not as a program
		// is a failure this build has already had once, and it is invisible until
		// somebody opens the file.
		const program = new Script(script, { filename: OUTPUT_NAME });
		expect(program).toBeInstanceOf(Script);
	});

	it('carries the version it was built with rather than the placeholder', () => {
		// `__VERSION__` is an esbuild define, and a define that stops matching
		// does not fail the build: it leaves a bare identifier that throws a
		// ReferenceError the moment the footer is written, which is after
		// everything else has already run. The script here is compiled and never
		// executed, so nothing else in this file would see it.
		expect(version).toMatch(/^\d+\.\d+\.\d+/);
		expect(html).not.toContain('__VERSION__');
		expect(script, 'the manifest version is not in the program').toContain(version);
	});

	it('leaves no template placeholder behind', () => {
		for (const placeholder of ['<!--STYLE-->', '<!--SCRIPT-->', '<!--CSP-->']) {
			expect(html, `${placeholder} in the document`).not.toContain(placeholder);
		}
		// Any placeholder added later as well, so writing one into the template
		// and forgetting to substitute it fails here rather than shipping as a
		// comment where a stylesheet should be.
		expect(html).not.toMatch(/<!--[A-Z][A-Z_]*-->/);
	});

	it('lets no comment delimiter into the script body', () => {
		// Inside a classic script element the HTML parser still recognises
		// `<!--`, `-->` and `</script`, so a minifier that emitted any of them
		// would move the browser's idea of where the program ends. This is the
		// same family of trap as the `$&` expansion the build guards against by
		// substituting with functions instead of strings.
		expect(script).not.toContain('<!--');
		expect(script).not.toContain('-->');
		expect(script).not.toContain('</script');
	});

	it('lets no closing delimiter into the stylesheet either', () => {
		// A style element is raw text, so `</style` is the one sequence that ends
		// it early. `<!--` is not in this list because, unlike inside a script,
		// it means nothing to the parser here.
		//
		// A `content: "</style>"` rule reaches the document as `<\/style>`,
		// because that is what esbuild does with it while minifying, and the rest
		// of the stylesheet would otherwise become visible text in the page. This
		// is the assertion that notices if that ever stops being true.
		expect(style).not.toContain('</style');
	});
});

describe('the built document is self contained', () => {
	it('has exactly one script element and it has no src', () => {
		// Pinned to the exact tag rather than to the absence of a `src`, because
		// `type="module"` is just as fatal here and would pass a `src` check.
		// Chrome refuses to load a module from `file://`, which is the only way
		// this document is ever opened.
		const tags = html.match(/<script\b[^>]*>/gi) ?? [];
		expect(tags).toEqual(['<script>']);
	});

	it('has no element that could pull in a second file', () => {
		for (const tag of REMOTE_ELEMENTS) {
			expect(markup, `<${tag}> in the document`).not.toMatch(new RegExp(`<${tag}\\b`, 'i'));
		}
	});

	it('has no attribute anywhere that names another file', () => {
		// The leading whitespace is what makes this an attribute rather than a
		// substring. Without it, `form-action 'none'` in the policy matches
		// `action`, and a base64 hash ending in `src=` would match too, which
		// would make the check fail on some builds and not others.
		for (const attribute of REMOTE_ATTRIBUTES) {
			expect(markup, `${attribute}= in the markup`).not.toMatch(
				new RegExp(`\\s${attribute}\\s*=`, 'i'),
			);
		}
	});

	it('declares no base element and no meta that navigates', () => {
		// Neither carries an attribute the check above looks for, and neither is
		// stopped by this policy. A `<meta http-equiv="refresh">` sends the tab
		// somewhere with no script and no request the CSP can refuse, and a
		// `<base>` quietly changes what every relative reference in the document
		// resolves to.
		expect(markup).not.toMatch(/<base\b/i);
		const equivs = [...markup.matchAll(/http-equiv="([^"]*)"/gi)].map((found) => found[1]);
		expect(equivs).toEqual(['Content-Security-Policy']);
	});

	it('depends on nothing the policy will refuse to run', () => {
		// A hash policy with no `unsafe-inline` and no `unsafe-hashes` runs
		// neither an inline handler nor a `style` attribute. Either one is
		// therefore dead on arrival: the page renders, the control does nothing,
		// and there is no error anywhere that says why.
		expect(markup, 'an inline event handler in the markup').not.toMatch(/\son[a-z]+\s*=/i);
		expect(markup, 'a style attribute in the markup').not.toMatch(/\sstyle\s*=/i);
		expect(html, 'a javascript: URL').not.toMatch(/javascript:/i);
	});

	it('has a stylesheet that fetches nothing', () => {
		expect(style).not.toMatch(/@import/i);
		expect(style).not.toMatch(/@font-face/i);
		// A url() is only ever acceptable inline here. Anything else is a request
		// the moment the page opens, and with the network off a web font would
		// fail and fall back anyway, so there is nothing to gain by allowing one.
		expect(style).not.toMatch(/url\(\s*(?!['"]?data:)/i);
	});

	it('names the repository as text rather than as a link, and carries no other address', () => {
		// Somebody reading the file should be able to find the source, so the
		// address is allowed to appear. It appears with no scheme and outside any
		// attribute, so nothing in the document can turn it into a request.
		//
		// The markup and the stylesheet only: the program carries addresses as
		// data (the SVG namespace, the links content types build, the font
		// licence), and tests/build/no-network.test.ts holds each of those to
		// where it came from.
		expect(markup).toContain(REPOSITORY);
		for (const url of `${markup}\n${style}`.match(/https?:\/\/[^\s"'<>]+/g) ?? []) {
			expect(url.replace(/[.,)]+$/, '')).toBe(`https://${REPOSITORY}`);
		}
	});
});

describe('the built document cannot reach a network', () => {
	it('names no network API in anything that executes', () => {
		// Not a formality. The bundled studio genuinely contains none of these,
		// so this fails the day one is introduced rather than passing because the
		// search was written to be satisfiable.
		for (const api of NETWORK_APIS) {
			expect(script, `${api} in the program`).not.toContain(api);
			expect(style, `${api} in the stylesheet`).not.toContain(api);
		}
	});

	it('names them in the markup only inside the sentence that promises they are absent', () => {
		// The page tells the reader there is no fetch, XMLHttpRequest, WebSocket,
		// EventSource or sendBeacon in the file, which puts all five words in the
		// document as prose. Cutting that one sentence out is what keeps the
		// check above from being weakened to fit it.
		const claim = /<dd id="fact-network">[\s\S]*?<\/dd>/.exec(markup)?.[0] ?? '';
		expect(claim).toContain('sendBeacon');
		const rest = markup.replace(claim, '');
		for (const api of NETWORK_APIS) {
			expect(rest, `${api} in the markup`).not.toContain(api);
		}
	});
});

describe('the built document cannot persist anything', () => {
	it('reaches for no storage API at all', () => {
		// The page makes the same promise about storage as it does about the
		// network, but in prose that spells the names out with spaces, so unlike
		// the network check this one can be made over the whole document.
		for (const api of STORAGE_APIS) {
			expect(html, `${api} in the document`).not.toContain(api);
		}
	});
});

describe('what a browser reads before it runs anything', () => {
	it('declares its encoding inside the first 1024 bytes', () => {
		// The HTML specification stops looking for an encoding declaration after
		// 1024 bytes and falls back to a guess. That is not cosmetic here: the
		// CSP hash is computed over the element's text as decoded, so a document
		// decoded as windows-1252 hashes differently from the same document
		// decoded as UTF-8, and the script is refused. Anything added ahead of
		// the charset in the head pushes it towards that line, and the policy
		// itself is already several hundred bytes long.
		const declaration = '<meta charset="utf-8"';
		const at = Buffer.from(html, 'utf8').indexOf(declaration);
		expect(at, 'the document declares no character encoding').toBeGreaterThanOrEqual(0);
		expect(at + Buffer.byteLength(declaration, 'utf8')).toBeLessThan(1024);
	});

	it('declares the policy ahead of the stylesheet and the program it covers', () => {
		// A policy in a meta element applies to what the parser sees after it and
		// to nothing before it. Move the element below the stylesheet and the
		// style hash stops meaning anything, while every other assertion in this
		// file still passes: the directive is still there, the digest is still
		// right, and the browser simply never applies it to that element.
		const policy = html.indexOf('<meta http-equiv="Content-Security-Policy"');
		expect(policy).toBeGreaterThanOrEqual(0);
		expect(policy, 'the policy is outside the head').toBeLessThan(html.indexOf('</head>'));
		expect(policy, 'the stylesheet comes first').toBeLessThan(html.indexOf('<style>'));
		expect(policy, 'the program comes first').toBeLessThan(html.indexOf('<script>'));
	});
});

describe('the Content-Security-Policy', () => {
	it('is declared in the document itself', () => {
		// There is no server to send a header. A file opened from a disc has only
		// the meta element, and without it the policy is decoration.
		expect(html).toContain('<meta http-equiv="Content-Security-Policy"');
		expect(csp.length).toBeGreaterThan(0);
	});

	it('computes its digests the way a browser does', () => {
		// Everything else about the hashes compares this package against itself.
		// These are the FIPS 180-2 vectors, base64 encoded as a hash source is,
		// so a change of algorithm or of encoding fails here by name rather than
		// producing two matching wrong answers.
		for (const [input, digest] of SHA256_VECTORS) {
			expect(sha256(input), `sha256(${JSON.stringify(input)})`).toBe(digest);
		}
	});

	it('names the hash of the script and of the stylesheet it built', () => {
		expect(csp).toContain(`script-src 'sha256-${build.scriptSha256}'`);
		expect(csp).toContain(`style-src 'sha256-${build.styleSha256}'`);
	});

	it('names a hash of what landed in the document, not of the bundle', () => {
		// A CSP hash covers the element's child text content byte for byte,
		// whitespace and all. The template puts each placeholder on its own
		// indented line, so hashing the bundle rather than the element describes
		// something that is not in the document and the browser refuses to run
		// the only script in the file. That is not hypothetical: it is what
		// running the formatter over the template did, and every other assertion
		// in this suite still passed while it was broken.
		//
		// Deliberately says nothing about how the build avoids it. Stripping the
		// whitespace and hashing the element back out of the finished document
		// are both correct, and this is the assertion either one has to satisfy.
		expect(sha256(script)).toBe(build.scriptSha256);
		expect(sha256(style)).toBe(build.styleSha256);
	});

	it('names nothing in any directive beyond those two hashes', () => {
		// `toContain` on the whole policy string cannot see what follows the
		// hash. `script-src 'sha256-...' https:` contains the same substring and
		// would satisfy the check above while allowing every host on the
		// internet. So the policy is read the way a browser reads it, one
		// directive at a time, and every source in it has to be one of four
		// things.
		const policy = directives(csp);
		expect(policy.get('script-src')).toEqual([`'sha256-${build.scriptSha256}'`]);
		expect(policy.get('style-src')).toEqual([`'sha256-${build.styleSha256}'`]);
		const closed = [
			'default-src',
			'base-uri',
			'form-action',
			'connect-src',
			'frame-src',
			'object-src',
		];
		for (const name of closed) {
			expect(policy.get(name), `${name} is missing or has been widened`).toEqual(["'none'"]);
		}
		for (const [name, sources] of policy) {
			for (const source of sources) {
				// The preview, the save and the camera are the only reasons a
				// scheme appears anywhere in this policy.
				if (name === 'img-src' && (source === 'data:' || source === 'blob:')) continue;
				// The camera stream, attached to a video element.
				if (name === 'media-src' && (source === 'blob:' || source === 'mediastream:')) continue;
				expect(source, `${name} names ${source}`).toMatch(/^'(none|self|sha256-[A-Za-z0-9+/=]+)'$/);
			}
		}
	});

	it('forbids every default source and every connection', () => {
		expect(csp).toContain("default-src 'none'");
		expect(csp).toContain("connect-src 'none'");
	});

	it('allows neither unsafe-inline nor unsafe-eval', () => {
		// Either one would make the two hashes decorative. The point of naming
		// them is that nothing else can run, including anything appended to the
		// file after somebody downloaded it.
		expect(csp).not.toContain('unsafe-inline');
		expect(csp).not.toContain('unsafe-eval');
		expect(html).not.toContain('unsafe-');
	});

	it('still allows a blob: image, which the result preview needs', () => {
		// The preview is the converted file itself, handed to an img element as
		// an object URL. A policy tightened to img-src 'none' would leave every
		// result with a broken thumbnail and nothing on screen to explain it.
		expect(csp).toMatch(/img-src[^;]*\bblob:/);
	});
});

describe('the document and the program agree', () => {
	it('has every element the program looks up by id', () => {
		const ids = elementIds(appSource);
		// The list is read out of the source with a regular expression, so it is
		// worth knowing it found something. Without this the check quietly
		// becomes an assertion about an empty list the day the source is written
		// a little differently.
		expect(ids, 'the id lookups could not be read out of the app source').toContain('version');
		for (const id of ids) {
			expect(markup, `the program looks up ${id} and the document has no such element`).toContain(
				`id="${id}"`,
			);
		}
	});

	it('styles every class and state the program sets from JavaScript', () => {
		// The result cards are built in JavaScript and styled in CSS, and the
		// only thing holding the two together is a string. Rename one side and
		// the studio still works and renders as unstyled text in a column.
		const classes = scriptedClasses(appSource);
		for (const name of classes) {
			expect(stylesClass(style, name), `.${name} is set by the program and never styled`).toBe(
				true,
			);
		}
		const states = scriptedStates(appSource);
		for (const state of states) {
			expect(style, `data-${state} is set by the program and never styled`).toContain(
				`data-${state}`,
			);
		}
	});
});

describe('the copy the built document ships', () => {
	it('uses none of the punctuation the house style forbids', () => {
		// The rule covers the offline application's copy and every error message,
		// and both are in this one file: the copy in the markup, the messages in
		// the bundle. Checking the built document is the only way to cover them
		// together.
		for (const [character, name] of FORBIDDEN_PUNCTUATION) {
			expect(html, `${name} in the built document`).not.toContain(character);
		}
	});

	it('uses none of the marketing register the house style forbids', () => {
		// Over what a person can read: the markup, and every string the program
		// carries. Not over the program's identifiers, which nobody reads and
		// which the decoder is entitled to name as it likes.
		const strings = stringLiterals(script);
		expect(strings.length, 'no strings were read out of the program').toBeGreaterThan(1000);
		const lowered = [markup, ...strings].join('\n').toLowerCase();
		for (const word of MARKETING_REGISTER) {
			expect(lowered, `"${word}" in the built document`).not.toContain(word);
		}
	});
});

describe('the size of the built document', () => {
	// Wide on purpose, so a new shape or content type does not mean editing
	// this. The floor catches a build that dropped the studio and shipped the
	// page shell on its own; the ceiling catches something arriving that was
	// never meant to, such as an inlined source map, a fixture or a dependency.
	// tests/build/budget.test.ts holds each area to its own share, which is
	// where growth gets attributed.
	//
	// The floor is the studio's: a build that ships less has lost it. The
	// ceiling is the finished application (690 kB at M8b) with about 15% room
	// for the scan check and the inspector, which are still to merge. Raise it
	// only after reading the diff: the failure it exists to catch looks exactly
	// like a feature until you look at what grew.
	const FLOOR = 150_000;
	const CEILING = 800_000;

	it('is large enough to hold the studio and small enough to be a download', () => {
		expect(build.bytes).toBeGreaterThan(FLOOR);
		expect(build.bytes).toBeLessThan(CEILING);
	});

	it('reports the byte count of the document it returned', () => {
		// The number a release note quotes, so it should be the file's size and
		// not the bundle's.
		expect(build.bytes).toBe(Buffer.byteLength(html, 'utf8'));
	});

	it('builds the same bytes twice', async () => {
		// The publish workflow records the sha256 of this file in the run summary
		// so that somebody who downloads it can check what they got. That promise
		// is only worth making if two builds of the same commit agree, and a
		// build that reached for a timestamp, a temporary path or an unordered
		// set would break it without breaking anything else here.
		const again = await buildStandaloneHtml();
		expect(again.scriptSha256).toBe(build.scriptSha256);
		expect(again.styleSha256).toBe(build.styleSha256);
		expect(again.html).toBe(html);
	}, 120_000);
});
