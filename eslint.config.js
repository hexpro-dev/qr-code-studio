// ESLint 9 flat config. Mirrors the shape of the other Hex Pro packages, with
// two additions: a single named exception for the opt-in library, and a
// determinism zone.
//
// Flat config replaces a rule's options wholesale when a later block matches the
// same file, it does not merge them. So every block below that restricts
// globals, properties or syntax is built from the same functions and carries
// the privacy bans with it. A block that set `no-restricted-globals` to the
// determinism list alone would quietly lift the network ban for every file it
// matched.

import js from '@eslint/js';
import tseslint from 'typescript-eslint';

const SEE = 'See eslint.config.js.';

/**
 * The names that would let a QR code, or anything about it, leave the tab or
 * outlive it.
 *
 * `global` marks the ones that are also bare globals. `sendBeacon` and
 * `cookie` can only be reached as properties. `tests/build/no-network.test.ts`
 * reads the effective configuration back through ESLint itself and fails if
 * this list and its own drift apart.
 */
export const BANNED = [
	{
		name: 'fetch',
		global: true,
		message: `Nothing here makes a request. A QR code is made, checked and read in the tab, and there is no server at the other end of any of it. ${SEE}`,
	},
	{
		name: 'XMLHttpRequest',
		global: true,
		message: `The older spelling of fetch, and the same answer: nothing in this package sends anything anywhere. ${SEE}`,
	},
	{
		name: 'WebSocket',
		global: true,
		message: `No connection is opened from this package. A socket carrying somebody's Wi-Fi password is the exact thing the offline file promises is not in there. ${SEE}`,
	},
	{
		name: 'EventSource',
		global: true,
		message: `No connection is opened from this package, including one that only listens. ${SEE}`,
	},
	{
		name: 'Request',
		global: true,
		message: `Request is the fetch API, and nothing here is addressed to a server. ${SEE}`,
	},
	{
		name: 'Response',
		global: true,
		message: `Response is the fetch API. To read a Blob, blob.arrayBuffer() does it without reaching for a network type. ${SEE}`,
	},
	{
		name: 'sendBeacon',
		global: false,
		message: `navigator.sendBeacon is the one call built to leave as the page does. This package reports nothing, anywhere, ever. ${SEE}`,
	},
	{
		name: 'localStorage',
		global: true,
		message: `Nothing this package touches outlives the tab unless the person has switched the library on, and the library lives in src/dom/library/indexeddb.ts and nowhere else. ${SEE}`,
	},
	{
		name: 'sessionStorage',
		global: true,
		message: `Same as localStorage. A shorter life is still a copy of somebody's code left on the machine. ${SEE}`,
	},
	{
		name: 'indexedDB',
		global: true,
		message: `The opt-in library is the only thing that writes to disk, and it does so from src/dom/library/indexeddb.ts alone, after the person has asked for it. Nowhere else. ${SEE}`,
	},
	{
		name: 'caches',
		global: true,
		message: `The Cache API stores responses on disk and exists to serve requests. There are neither of those here. ${SEE}`,
	},
	{
		name: 'cookie',
		global: false,
		message: `document.cookie is storage that travels with a request. This package writes neither. ${SEE}`,
	},
];

/** The one file allowed to reach the one store, and the one name it may use. */
export const LIBRARY_FILE = 'src/dom/library/indexeddb.ts';
export const LIBRARY_ALLOWS = ['indexedDB'];

/**
 * Members of `Math` whose results are not specified bit for bit.
 *
 * ECMAScript fixes `+ - * /` and `Math.sqrt` to IEEE 754 exactly. The
 * transcendental functions are "implementation-approximated", and V8,
 * JavaScriptCore and SpiderMonkey really do disagree in the last place. One
 * disagreement in a curve flattening step moves an anti-aliased edge by a
 * level, the strict reader thresholds that edge, and the scan check reports a
 * different verdict in Safari than in Chrome for the same design. `core/math.ts`
 * provides what is needed from basic arithmetic only.
 */
const UNSPECIFIED_MATH = [
	'sin',
	'cos',
	'tan',
	'asin',
	'acos',
	'atan',
	'atan2',
	'sinh',
	'cosh',
	'tanh',
	'asinh',
	'acosh',
	'atanh',
	'exp',
	'expm1',
	'log',
	'log1p',
	'log2',
	'log10',
	'pow',
	'hypot',
	'cbrt',
	'random',
];

/** Directories whose output must be identical in Node and every browser. */
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
];

function privacyGlobals(allow) {
	return BANNED.filter((entry) => entry.global && !allow.includes(entry.name)).map(
		({ name, message }) => ({ name, message }),
	);
}

function privacyProperties(allow) {
	return BANNED.filter((entry) => !allow.includes(entry.name)).map(({ name, message }) => ({
		property: name,
		message,
	}));
}

const DYNAMIC_IMPORT_SYNTAX = [
	{
		// Neither name rule can see this one: the specifier is a string. A remote
		// specifier is a request the bundler cannot inline and the offline file
		// cannot contain, so it would break the single file build as well as the
		// promise.
		selector:
			"ImportExpression[source.type='Literal'][source.value=/^([A-Za-z][A-Za-z0-9+.-]*:)?\\/\\//]",
		message: `A dynamic import of a URL fetches code from somewhere else at runtime. Everything this package runs is in the file the person already has. ${SEE}`,
	},
	{
		selector: "ImportExpression:not([source.type='Literal'])",
		message: `A dynamic import whose specifier is worked out at runtime cannot be checked, and nothing here is loaded lazily. Import the module at the top of the file. ${SEE}`,
	},
];

const DETERMINISM_SYNTAX = [
	{
		selector: "BinaryExpression[operator='**']",
		message: `The ** operator is Math.pow, whose result is not specified bit for bit. Multiply, or use core/math.ts. This directory must give the same answer in every engine. ${SEE}`,
	},
	{
		selector: "AssignmentExpression[operator='**=']",
		message: `**= is Math.pow. Multiply, or use core/math.ts. ${SEE}`,
	},
];

const DETERMINISM_GLOBALS = [
	{
		name: 'Date',
		message: `Time is injected, never read, in this directory: a clock is a parameter so a result can be reproduced from its inputs. ${SEE}`,
	},
	{
		name: 'performance',
		message: `Time is injected, never read, in this directory. Pass a clock. ${SEE}`,
	},
	{
		name: 'Intl',
		message: `Locale data differs between engines and machines. Nothing in this directory may depend on where it runs. ${SEE}`,
	},
];

const DETERMINISM_PROPERTIES = [
	...UNSPECIFIED_MATH.map((property) => ({
		object: 'Math',
		property,
		message:
			property === 'random'
				? `Randomness here is seeded so a verdict can be reproduced. Use createPrng from core/prng.ts. ${SEE}`
				: `Math.${property} is not specified bit for bit, and engines differ in the last place. Use core/math.ts. ${SEE}`,
	})),
	{
		property: 'toLocaleString',
		message: `Locale formatting differs between machines. Format in the view, never here. ${SEE}`,
	},
	{
		property: 'localeCompare',
		message: `Collation differs between engines. Compare code units, or sort in the view. ${SEE}`,
	},
];

/**
 * The full restriction rules for a set of files.
 *
 * Built here rather than written per block because flat config replaces a
 * rule's options wholesale, so every block that touches these rules has to
 * carry all of them.
 */
function restrictions({ allow = [], deterministic = false } = {}) {
	return {
		'no-restricted-globals': [
			'error',
			...privacyGlobals(allow),
			...(deterministic ? DETERMINISM_GLOBALS : []),
		],
		'no-restricted-properties': [
			'error',
			...privacyProperties(allow),
			...(deterministic ? DETERMINISM_PROPERTIES : []),
		],
		'no-restricted-syntax': [
			'error',
			...DYNAMIC_IMPORT_SYNTAX,
			...(deterministic ? DETERMINISM_SYNTAX : []),
		],
	};
}

/**
 * Every layer under `src/`, lowest first.
 *
 * The table in CLAUDE.md is the reasoning. In short: a lower layer never
 * imports a higher one, so the codec at the bottom stays liftable into its own
 * package, and a registry entry can be tested without the studio standing
 * behind it.
 */
const LAYERS = {
	core: [],
	messages: ['core'],
	segment: ['core'],
	symbology: ['core', 'segment'],
	encode: ['core', 'segment', 'symbology'],
	decode: ['core', 'segment', 'symbology'],
	payload: ['core'],
	geometry: ['core'],
	text: ['core', 'geometry'],
	render: ['core', 'geometry'],
	design: ['core', 'geometry', 'text', 'symbology', 'render', 'segment', 'encode'],
	conformance: ['core', 'geometry', 'render', 'design', 'symbology', 'segment'],
	verify: [
		'core',
		'segment',
		'symbology',
		'encode',
		'decode',
		'design',
		'geometry',
		'render',
		'text',
	],
	inspect: ['core', 'segment', 'symbology', 'decode', 'payload'],
	batch: [
		'core',
		'segment',
		'symbology',
		'payload',
		'encode',
		'design',
		'render',
		'geometry',
		'text',
		'verify',
	],
	'own-link': ['core'],
	studio: [
		'core',
		'messages',
		'segment',
		'symbology',
		'encode',
		'decode',
		'payload',
		'geometry',
		'text',
		'render',
		'design',
		'verify',
		'inspect',
		'batch',
		'own-link',
	],
	dom: ['core', 'decode', 'render', 'studio', 'symbology', 'segment'],
};

const ALL_LAYERS = [...Object.keys(LAYERS), 'app'];

function fence(layer) {
	const allowed = LAYERS[layer];
	const forbidden = ALL_LAYERS.filter((other) => other !== layer && !allowed.includes(other));
	return {
		files: [`src/${layer}/**/*.ts`],
		rules: {
			'no-restricted-imports': [
				'error',
				{
					patterns: [
						{
							group: forbidden.map((other) => `**/${other}/**`),
							message: `src/${layer} may import only from ${allowed.length ? allowed.map((a) => `src/${a}`).join(', ') : 'itself'}. ${SEE}`,
						},
					],
				},
			],
		},
	};
}

export default tseslint.config(
	{
		ignores: [
			'node_modules/**',
			'dist/**',
			'coverage/**',
			'reports/**',
			'.stryker-tmp/**',
			'test-results/**',
			'playwright-report/**',
			// Measurement rigs and photographs of real codes. Gitignored and never
			// shipped, so linting them only makes a working tree disagree with a
			// clean checkout about whether the gate passes.
			'scratch/**',
			'**/*.config.js',
			'**/*.config.ts',
		],
	},
	js.configs.recommended,
	...tseslint.configs.recommended,
	{
		files: ['src/**/*.ts', 'tests/**/*.ts', 'scripts/**/*.ts', 'e2e/**/*.ts'],
		rules: {
			'@typescript-eslint/no-explicit-any': 'error',
			'@typescript-eslint/ban-ts-comment': 'error',
			'@typescript-eslint/explicit-module-boundary-types': 'off',
			'@typescript-eslint/no-unused-vars': [
				'error',
				{ argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
			],
		},
	},
	{
		// "Nothing leaves the tab" is the product. These rules are the gate a
		// patch passes on the way in; the build tests check the other end, the
		// finished offline file. `src/app/` is covered rather than exempt: it is
		// the one file a stranger downloads and opens, so it is the last place an
		// exception would belong.
		files: ['src/**/*.ts'],
		rules: restrictions(),
	},
	{
		files: DETERMINISM_ZONE.map((dir) => `src/${dir}/**/*.ts`),
		rules: restrictions({ deterministic: true }),
	},
	{
		// The single exception, and it is for one name. The opt-in library may
		// open its own database, after the person has switched it on. It may not
		// make a request, and it may not use any other store: a localStorage flag
		// saying "the library is on" would itself be something left behind
		// before anybody agreed to anything.
		files: [LIBRARY_FILE],
		rules: restrictions({ allow: LIBRARY_ALLOWS }),
	},
	...Object.keys(LAYERS).map(fence),
	{
		// The offline application may use anything except the library, which
		// needs a stable origin and so is offered on the website only. A file
		// opened from disk has no origin worth trusting with storage: see
		// src/dom/library/indexeddb.ts.
		files: ['src/app/**/*.ts'],
		rules: {
			'no-restricted-imports': [
				'error',
				{
					patterns: [
						{
							group: ['**/dom/library/**'],
							message: `The offline file stores nothing in the browser. Its library is a file the person saves. ${SEE}`,
						},
					],
				},
			],
		},
	},
);
