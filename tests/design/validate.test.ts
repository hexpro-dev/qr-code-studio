import { describe, expect, it } from 'vitest';
import { defaultDesign } from '../../src/design/document.js';
import { createDesignRegistries } from '../../src/design/registries.js';
import type { QrDesignV1 } from '../../src/design/types.js';
import { validateDesign } from '../../src/design/validate.js';
import { assetOf, discImage } from './helpers.js';

const registries = createDesignRegistries();

type Ink = string | { srgb: string; cmyk: [number, number, number, number] };

/** Fresh stops each time, so a test that changes one paint's stops changes no other. */
function stopsOf(): { offset: number; ink: Ink }[] {
	return [
		{ offset: 0, ink: '#101820' },
		{ offset: 1, ink: { srgb: '#0b3d91', cmyk: [1, 0.6, 0, 0.3] } },
	];
}

/** A design using every optional part, valid as it stands. */
function full(): QrDesignV1 {
	return {
		schema: 'qr-design',
		version: 1,
		symbol: {
			symbology: 'qr',
			ecLevel: 'Q',
			boostEc: true,
			minVersion: '2',
			maxVersion: '10',
			mask: 3,
			segmentation: { kanji: 'never', eci: 'utf-8' },
		},
		quietZone: 4,
		background: {
			kind: 'linear',
			angle: 30,
			space: 'symbol',
			stops: [
				{ offset: 0, ink: '#ffffff' },
				{ offset: 1, ink: '#f4f4f4' },
			],
		},
		modules: {
			shape: { id: 'rounded', params: { radius: 0.2 } },
			paint: { kind: 'radial', cx: 0.5, cy: 0.5, radius: 0.7, space: 'module', stops: stopsOf() },
			light: { shape: { id: 'dot' }, paint: { kind: 'solid', ink: '#ffffff' } },
		},
		regions: {
			finder: {
				outer: { id: 'circle' },
				inner: { id: 'circle-centre' },
				outerPaint: {
					kind: 'conic',
					cx: 0.5,
					cy: 0.5,
					angle: 90,
					space: 'symbol',
					stops: stopsOf(),
				},
				innerPaint: { kind: 'entry', ref: { id: 'two-tone-diagonal', params: { angle: 45 } } },
			},
			'sub-finder': { outer: { id: 'square' }, inner: { id: 'square-centre' } },
			'corner-finder': { outer: { id: 'square' }, inner: { id: 'square-centre' } },
		},
		logo: {
			source: { kind: 'asset', id: 'mark' },
			size: 0.2,
			clear: 'shape',
			padding: 1,
			plate: { paint: { kind: 'solid', ink: '#ffffff' }, shape: 'circle' },
		},
		frame: {
			ref: { id: 'rounded-card', params: { radius: 0.1 } },
			paint: { kind: 'solid', ink: '#0b3d91' },
			text: {
				content: 'Scan me\nfor the menu',
				fontId: 'plex-sans-bold',
				paint: { kind: 'solid', ink: '#ffffff' },
			},
		},
		output: { sizeMm: 30, dpi: 300, colourSpace: 'cmyk' },
		assets: { mark: assetOf(discImage()) },
		name: 'Example design',
	};
}

type Mutable = Record<string, unknown>;

/** The issues for `full()` changed by `change`, as `severity code path`. */
function issuesAfter(change: (design: Mutable) => void, start: () => QrDesignV1 = full): string[] {
	const design = structuredClone(start()) as unknown as Mutable;
	change(design);
	return validateDesign(design, registries).issues.map(
		(found) => `${found.severity} ${found.code} ${found.path.join('.')}`,
	);
}

function at(design: Mutable, ...path: (string | number)[]): Mutable {
	let node: unknown = design;
	for (const key of path) node = (node as Mutable)[key as string];
	return node as Mutable;
}

describe('validateDesign', () => {
	it('passes the default and a design using every part, unchanged', () => {
		for (const design of [defaultDesign(), full()]) {
			const result = validateDesign(design, registries);
			expect(result.issues).toEqual([]);
			expect(result.design).toEqual(design);
			expect(result.design).not.toBe(design);
		}
	});

	it('refuses what is not a design at all', () => {
		for (const input of [null, 7, 'design', [], undefined]) {
			const result = validateDesign(input, registries);
			expect(result.design).toBeNull();
			expect(result.issues.map((found) => found.code)).toEqual(['design.issue.not-an-object']);
		}
		expect(validateDesign({ schema: 'other', version: 1 }, registries).issues[0]?.code).toBe(
			'design.issue.schema',
		);
		const later = validateDesign({ schema: 'qr-design', version: 2 }, registries);
		expect(later.design).toBeNull();
		expect(later.issues).toEqual([
			{
				code: 'design.issue.unsupported-version',
				path: ['version'],
				severity: 'error',
				params: { supported: 1 },
			},
		]);
	});

	it('throws a TypeError without registries', () => {
		expect(() => validateDesign(defaultDesign(), null as never)).toThrow(TypeError);
	});

	const cases: [string, (design: Mutable) => void, string[]][] = [
		['an unknown top-level key', (d) => (d.extra = 1), ['warning design.issue.unknown-key extra']],
		[
			'a key too odd to repeat',
			(d) => (d['a key with spaces'] = 1),
			['warning design.issue.unknown-key '],
		],
		['a missing symbol', (d) => delete d.symbol, ['error design.issue.required symbol']],
		[
			'a symbol that is not an object',
			(d) => (d.symbol = 3),
			['error design.issue.not-an-object symbol'],
		],
		[
			'a bad symbology',
			(d) => (at(d, 'symbol').symbology = 'QR Code'),
			['error design.issue.symbology symbol.symbology'],
		],
		[
			'a bad level, boost, versions and mask',
			(d) => {
				Object.assign(at(d, 'symbol'), {
					ecLevel: 'X',
					boostEc: 'yes',
					minVersion: '41',
					maxVersion: 'M2',
					mask: 9,
				});
			},
			[
				'error design.issue.invalid-option symbol.ecLevel',
				'error design.issue.not-a-boolean symbol.boostEc',
				'error design.issue.version-name symbol.minVersion',
				'error design.issue.version-name symbol.maxVersion',
				'error design.issue.mask symbol.mask',
			],
		],
		[
			'versions the wrong way round',
			(d) => Object.assign(at(d, 'symbol'), { minVersion: '12', maxVersion: '3' }),
			['error design.issue.version-range symbol.maxVersion'],
		],
		[
			'a mask Micro QR does not have, and segmentation that is wrong',
			(d) => {
				Object.assign(at(d, 'symbol'), {
					symbology: 'micro',
					minVersion: 'M2',
					maxVersion: 'M4',
					mask: 5,
					segmentation: { kanji: 'sometimes', eci: 'latin' },
				});
				d.quietZone = 2;
			},
			[
				'error design.issue.mask symbol.mask',
				'error design.issue.invalid-option symbol.segmentation.kanji',
				'error design.issue.invalid-option symbol.segmentation.eci',
			],
		],
		[
			'segmentation that is not an object',
			(d) => (at(d, 'symbol').segmentation = []),
			['error design.issue.not-an-object symbol.segmentation'],
		],
		[
			'a symbology of its own with its own version names',
			(d) => {
				Object.assign(at(d, 'symbol'), {
					symbology: 'aztec',
					minVersion: 'C3',
					maxVersion: 'C9',
					mask: 'auto',
				});
			},
			[],
		],
		[
			'a quiet zone that is not a whole number, or too narrow',
			(d) => (d.quietZone = 2.5),
			['error design.issue.not-an-integer quietZone'],
		],
		[
			'a narrow quiet zone',
			(d) => (d.quietZone = 2),
			['warning design.issue.quiet-zone-small quietZone'],
		],
		['a wide quiet zone', (d) => (d.quietZone = 21), ['error design.issue.out-of-range quietZone']],
		['no quiet zone', (d) => delete d.quietZone, ['error design.issue.required quietZone']],
		['no background', (d) => delete d.background, ['error design.issue.required background']],
		['a transparent background', (d) => (d.background = null), []],
		[
			'a paint of no kind',
			(d) => (d.background = { kind: 'pattern' }),
			['error design.issue.invalid-option background.kind'],
		],
		[
			'a paint that is a string',
			(d) => (d.background = '#fff'),
			['error design.issue.not-an-object background'],
		],
		[
			'a bad colour and print value',
			(d) => {
				at(d, 'modules', 'paint', 'stops', 0).ink = 'red';
				at(d, 'modules', 'paint', 'stops', 1).ink = { srgb: 7, cmyk: [0, 2, 0] };
			},
			[
				'error design.issue.invalid-colour modules.paint.stops.0.ink',
				'error design.issue.invalid-colour modules.paint.stops.1.ink.srgb',
				'error design.issue.cmyk modules.paint.stops.1.ink.cmyk',
			],
		],
		[
			'a print value out of range',
			(d) => (at(d, 'modules', 'paint', 'stops', 1).ink = { srgb: '#000', cmyk: [0, 0, 0, 1.5] }),
			['error design.issue.out-of-range modules.paint.stops.1.ink.cmyk.3'],
		],
		[
			'a print colour with a bad screen value',
			(d) => (at(d, 'modules', 'paint', 'stops', 1).ink = { srgb: 'navy', cmyk: [0, 0, 0, 1] }),
			['error design.issue.invalid-colour modules.paint.stops.1.ink.srgb'],
		],
		[
			'stops out of order, of the wrong count, and not a list',
			(d) => {
				at(d, 'modules', 'paint', 'stops', 1).offset = -0.5;
				at(d, 'background').stops = [{ offset: 0, ink: '#fff' }];
				at(d, 'regions', 'finder', 'outerPaint').stops = 'none';
			},
			[
				'error design.issue.out-of-range modules.paint.stops.1.offset',
				'error design.issue.stop-count background.stops',
				'error design.issue.not-a-list regions.finder.outerPaint.stops',
			],
		],
		[
			'a stop before the one before it',
			(d) => {
				at(d, 'modules', 'paint', 'stops', 0).offset = 0.8;
				at(d, 'modules', 'paint', 'stops', 1).offset = 0.2;
			},
			['error design.issue.stop-order modules.paint.stops.1.offset'],
		],
		[
			'a stop that is not an object',
			(d) => (at(d, 'modules', 'paint').stops = [1, { offset: 1, ink: '#000' }]),
			['error design.issue.not-an-object modules.paint.stops.0'],
		],
		[
			'centres and radius out of range',
			(d) => Object.assign(at(d, 'modules', 'paint'), { cx: 3, cy: -2, radius: 0 }),
			[
				'error design.issue.out-of-range modules.paint.cx',
				'error design.issue.out-of-range modules.paint.cy',
				'error design.issue.out-of-range modules.paint.radius',
			],
		],
		[
			'conic centres out of range and an angle that is not a number',
			(d) => Object.assign(at(d, 'regions', 'finder', 'outerPaint'), { cx: 9, angle: 'up' }),
			[
				'error design.issue.out-of-range regions.finder.outerPaint.cx',
				'error design.issue.not-a-number regions.finder.outerPaint.angle',
			],
		],
		[
			'angles past a turn, brought round',
			(d) => {
				at(d, 'background').angle = 390;
				at(d, 'regions', 'finder', 'outerPaint').angle = -90;
			},
			[
				'warning design.issue.angle-normalised background.angle',
				'warning design.issue.angle-normalised regions.finder.outerPaint.angle',
			],
		],
		[
			'a gradient with no space, or the wrong one',
			(d) => {
				delete at(d, 'background').space;
				at(d, 'modules', 'paint').space = 'page';
			},
			[
				'warning design.issue.filled-default background.space',
				'error design.issue.invalid-option modules.paint.space',
			],
		],
		[
			'a solid paint with no ink',
			(d) => (d.background = { kind: 'solid' }),
			['error design.issue.not-an-object background.ink'],
		],
		[
			'a fill this registry lacks, and one with bad parameters',
			(d) => {
				at(d, 'regions', 'finder').innerPaint = { kind: 'entry', ref: { id: 'plaid' } };
				at(d, 'regions', 'finder').outerPaint = {
					kind: 'entry',
					ref: { id: 'palette-scatter', params: { count: 9, 'colour-1': 'blue', extra: 1 } },
				};
			},
			[
				'error design.issue.unknown-entry regions.finder.innerPaint.ref.id',
				'warning design.issue.unknown-key regions.finder.outerPaint.ref.params.extra',
				'error design.issue.invalid-colour regions.finder.outerPaint.ref.params.colour-1',
				'error design.issue.out-of-range regions.finder.outerPaint.ref.params.count',
			],
		],
		[
			'an entry reference that is not an object, and one with params that are not',
			(d) => {
				at(d, 'modules').shape = 'square';
				at(d, 'modules', 'light').shape = { id: 'dot', params: [] };
			},
			[
				'error design.issue.not-an-object modules.shape',
				'error design.issue.not-an-object modules.light.shape.params',
			],
		],
		[
			'module shape parameters of the wrong kind',
			(d) => {
				at(d, 'modules').shape = { id: 'hex', params: { size: 'big', orientation: 'sideways' } };
				at(d, 'modules', 'light').shape = { id: 'mosaic', params: { jitter: Number.NaN } };
			},
			[
				'error design.issue.not-a-number modules.shape.params.size',
				'error design.issue.invalid-option modules.shape.params.orientation',
				'error design.issue.not-a-number modules.light.shape.params.jitter',
			],
		],
		[
			'an integer and a boolean parameter given the wrong kind of value',
			(d) =>
				(at(d, 'regions', 'finder').innerPaint = {
					kind: 'entry',
					ref: { id: 'palette-scatter', params: { count: 2.5, 'colour-2': 3 } },
				}),
			[
				'error design.issue.invalid-colour regions.finder.innerPaint.ref.params.colour-2',
				'error design.issue.not-an-integer regions.finder.innerPaint.ref.params.count',
			],
		],
		[
			'an unknown module shape, with an id worth naming and one not',
			(d) => {
				at(d, 'modules').shape = { id: 'sparkle' };
				at(d, 'modules', 'light').shape = { id: 'Not An Id' };
			},
			[
				'error design.issue.unknown-entry modules.shape.id',
				'error design.issue.unknown-entry modules.light.shape.id',
			],
		],
		[
			'modules with no shape or paint',
			(d) => (d.modules = { light: null }),
			['error design.issue.required modules.shape', 'error design.issue.required modules.paint'],
		],
		[
			'light modules with no shape or paint, and modules that are not an object',
			(d) => (at(d, 'modules').light = {}),
			[
				'error design.issue.required modules.light.shape',
				'error design.issue.required modules.light.paint',
			],
		],
		[
			'light modules that are not an object',
			(d) => (at(d, 'modules').light = 4),
			['error design.issue.not-an-object modules.light'],
		],
		[
			'missing light modules, filled in',
			(d) => delete at(d, 'modules').light,
			['warning design.issue.filled-default modules.light'],
		],
		['missing modules', (d) => delete d.modules, ['error design.issue.required modules']],
		[
			'modules that are not an object',
			(d) => (d.modules = 1),
			['error design.issue.not-an-object modules'],
		],
		[
			'missing regions, filled in',
			(d) => delete d.regions,
			['warning design.issue.filled-default regions'],
		],
		[
			'regions that are not an object',
			(d) => (d.regions = 1),
			['error design.issue.not-an-object regions'],
		],
		[
			'a region style that is not an object, and one missing its parts',
			(d) => {
				at(d, 'regions').finder = 'round';
				at(d, 'regions')['sub-finder'] = {};
			},
			[
				'error design.issue.not-an-object regions.finder',
				'error design.issue.required regions.sub-finder.outer',
				'error design.issue.required regions.sub-finder.inner',
			],
		],
		[
			'a ring used as a centre and a centre as a ring',
			(d) =>
				(at(d, 'regions')['corner-finder'] = {
					outer: { id: 'circle-centre' },
					inner: { id: 'circle' },
				}),
			[
				'error design.issue.region-part regions.corner-finder.outer.id',
				'error design.issue.region-part regions.corner-finder.inner.id',
			],
		],
		[
			'an unknown ring',
			(d) => (at(d, 'regions', 'finder').outer = { id: 'blob' }),
			['error design.issue.unknown-entry regions.finder.outer.id'],
		],
		[
			'a pair the strict reader would miss',
			(d) =>
				(at(d, 'regions').finder = { outer: { id: 'circle' }, inner: { id: 'square-centre' } }),
			['warning design.issue.region-pair regions.finder'],
		],
		[
			'a centre with no one-module form, used for the sub-finder',
			(d) =>
				(at(d, 'regions')['sub-finder'] = {
					outer: { id: 'square' },
					inner: { id: 'star-centre' },
				}),
			['info design.issue.region-kind regions.sub-finder.inner'],
		],
		[
			'a bad region paint',
			(d) => (at(d, 'regions', 'finder').innerPaint = 5),
			['error design.issue.not-an-object regions.finder.innerPaint'],
		],
		[
			'missing logo, filled in',
			(d) => delete d.logo,
			['warning design.issue.filled-default logo', 'warning design.issue.unused-asset assets.mark'],
		],
		[
			'a logo that is not an object',
			(d) => (d.logo = 'mark'),
			['error design.issue.not-an-object logo', 'warning design.issue.unused-asset assets.mark'],
		],
		[
			'a logo with every field wrong',
			(d) =>
				(d.logo = {
					source: { kind: 'emoji', id: 'x' },
					size: 0.9,
					clear: 'all',
					padding: -1,
					plate: { paint: 1, shape: 'star' },
				}),
			[
				'error design.issue.invalid-option logo.source.kind',
				'error design.issue.out-of-range logo.size',
				'error design.issue.invalid-option logo.clear',
				'error design.issue.out-of-range logo.padding',
				'error design.issue.not-an-object logo.plate.paint',
				'error design.issue.invalid-option logo.plate.shape',
				'warning design.issue.unused-asset assets.mark',
			],
		],
		[
			'a logo naming an image that is not there, an icon that is not, and a plate that is not an object',
			(d) => {
				at(d, 'logo').source = { kind: 'asset', id: 'other' };
				at(d, 'logo').plate = 'white';
			},
			[
				'error design.issue.asset-missing logo.source.id',
				'error design.issue.not-an-object logo.plate',
				'warning design.issue.unused-asset assets.mark',
			],
		],
		[
			'an unknown icon',
			(d) => (at(d, 'logo').source = { kind: 'icon', id: 'rocket' }),
			[
				'error design.issue.unknown-entry logo.source.id',
				'warning design.issue.unused-asset assets.mark',
			],
		],
		[
			'an icon with an id not worth naming, and a source that is not an object',
			(d) => {
				at(d, 'logo').source = { kind: 'icon', id: 12 };
			},
			[
				'error design.issue.unknown-entry logo.source.id',
				'warning design.issue.unused-asset assets.mark',
			],
		],
		[
			'a logo source that is not an object',
			(d) => (at(d, 'logo').source = 'icon'),
			[
				'error design.issue.not-an-object logo.source',
				'warning design.issue.unused-asset assets.mark',
			],
		],
		[
			'a paint on a picture logo, dropped',
			(d) => (at(d, 'logo').paint = { kind: 'solid', ink: '#000' }),
			['warning design.issue.logo-paint-ignored logo.paint'],
		],
		[
			'an icon logo with a paint, and without a plate',
			(d) => {
				d.logo = {
					source: { kind: 'icon', id: 'wifi' },
					size: 0.2,
					clear: 'box',
					padding: 1,
					paint: 'bad',
				};
			},
			[
				'warning design.issue.filled-default logo.plate',
				'error design.issue.not-an-object logo.paint',
				'warning design.issue.unused-asset assets.mark',
			],
		],
		[
			'missing frame, filled in',
			(d) => delete d.frame,
			['warning design.issue.filled-default frame'],
		],
		[
			'a frame that is not an object',
			(d) => (d.frame = []),
			['error design.issue.not-an-object frame'],
		],
		[
			'an unknown frame and a bad frame paint',
			(d) => {
				at(d, 'frame').ref = { id: 'neon' };
				at(d, 'frame').paint = { kind: 'solid', ink: '#12' };
			},
			[
				'error design.issue.unknown-entry frame.ref.id',
				'error design.issue.invalid-colour frame.paint.ink',
			],
		],
		[
			'a caption on a frame with no room for one, dropped',
			(d) => (at(d, 'frame').ref = { id: 'none' }),
			['warning design.issue.caption-unsupported frame.text'],
		],
		[
			'a caption too long, too many lines, a control character, a bad font and paint',
			(d) => {
				at(d, 'frame').text = { content: 'x'.repeat(41), fontId: 'Inter Bold', paint: 2 };
			},
			[
				'error design.issue.too-long frame.text.content',
				'error design.issue.font-id frame.text.fontId',
				'error design.issue.not-an-object frame.text.paint',
			],
		],
		[
			'a caption with too many lines',
			(d) => (at(d, 'frame', 'text').content = 'one\ntwo\nthree'),
			['error design.issue.too-many-lines frame.text.content'],
		],
		[
			'a caption with a control character',
			(d) => (at(d, 'frame', 'text').content = 'Scan\u0007me'),
			['error design.issue.control-character frame.text.content'],
		],
		[
			'a caption that is not text, and text that is not an object',
			(d) => (at(d, 'frame', 'text').content = 5),
			['error design.issue.not-text frame.text.content'],
		],
		[
			'caption text that is not an object',
			(d) => (at(d, 'frame').text = 'Scan me'),
			['error design.issue.not-an-object frame.text'],
		],
		['a caption with no paint of its own', (d) => delete at(d, 'frame', 'text').paint, []],
		[
			'missing output, filled in',
			(d) => delete d.output,
			['warning design.issue.filled-default output'],
		],
		[
			'output that is not an object',
			(d) => (d.output = 'print'),
			['error design.issue.not-an-object output'],
		],
		[
			'output out of range',
			(d) => (d.output = { sizeMm: 1, dpi: 72.5, colourSpace: 'rgb' }),
			[
				'error design.issue.out-of-range output.sizeMm',
				'error design.issue.not-an-integer output.dpi',
				'error design.issue.invalid-option output.colourSpace',
			],
		],
		['a size measured over the symbol alone', (d) => (at(d, 'output').sizeBasis = 'symbol'), []],
		[
			'a size basis it does not know',
			(d) => (at(d, 'output').sizeBasis = 'page'),
			['error design.issue.invalid-option output.sizeBasis'],
		],
		[
			'output with no colour space, filled in',
			(d) => (d.output = {}),
			['warning design.issue.filled-default output.colourSpace'],
		],
		[
			'assets that are not an object',
			(d) => (d.assets = []),
			[
				'error design.issue.not-an-object assets',
				'error design.issue.asset-missing logo.source.id',
			],
		],
		[
			'too many assets',
			(d) => {
				const asset = at(d, 'assets').mark as Mutable;
				d.assets = { a: asset, b: asset, c: asset, d: asset, e: asset };
			},
			[
				'error design.issue.too-many-assets assets',
				'error design.issue.asset-missing logo.source.id',
			],
		],
		[
			'asset ids that are not kebab-case',
			(d) => {
				const asset = at(d, 'assets').mark as Mutable;
				d.assets = { mark: asset, Logo: asset, 'a b': asset };
			},
			['error design.issue.asset-id assets.Logo', 'error design.issue.asset-id assets'],
		],
		[
			'an asset that is not an object, and one whose sizes are wrong',
			(d) => {
				const asset = at(d, 'assets').mark as Mutable;
				d.assets = { mark: { ...asset, width: 17 }, other: 1 };
			},
			[
				'error design.issue.asset-mismatch assets.mark.png',
				'error design.issue.not-an-object assets.other',
			],
		],
		[
			'an asset whose png is not text, not base64, not a PNG, or too large',
			(d) => {
				const asset = at(d, 'assets').mark as Mutable;
				d.assets = {
					mark: asset,
					a: { ...asset, png: 5 },
					b: { ...asset, png: 'not base64!' },
					c: { ...asset, png: 'aGVsbG8gd29ybGQgaGVsbG8gd29ybGQgaGVsbG8gd29y' },
				};
			},
			[
				'error design.issue.asset-encoding assets.a.png',
				'error design.issue.asset-encoding assets.b.png',
				'error design.issue.asset-not-png assets.c.png',
			],
		],
		[
			'an asset too large, and one with impossible sizes',
			(d) => {
				const asset = at(d, 'assets').mark as Mutable;
				d.assets = {
					mark: asset,
					big: { ...asset, png: 'A'.repeat(700_000) },
					odd: { ...asset, width: 0, height: 2000 },
				};
			},
			[
				'error design.issue.asset-too-large assets.big.png',
				'error design.issue.out-of-range assets.odd.width',
				'error design.issue.out-of-range assets.odd.height',
			],
		],
		[
			'a module shape named by something other than text',
			(d) => (at(d, 'modules').shape = { id: 5 }),
			['error design.issue.unknown-entry modules.shape.id'],
		],
		[
			'an image too short to be a PNG, and one whose first chunk is not its header',
			(d) => {
				const asset = at(d, 'assets').mark as Mutable;
				const header = Buffer.from(asset.png as string, 'base64');
				header.write('IDAT', 12, 'latin1');
				d.assets = {
					mark: asset,
					short: { ...asset, png: Buffer.from(header.subarray(0, 20)).toString('base64') },
					odd: { ...asset, png: header.toString('base64') },
				};
			},
			[
				'error design.issue.asset-not-png assets.short.png',
				'error design.issue.asset-not-png assets.odd.png',
			],
		],
		[
			'a styled finder on Micro QR, with no other region styled',
			(d) => {
				d.symbol = { symbology: 'micro' };
				d.quietZone = 2;
				d.regions = { finder: { outer: { id: 'circle' }, inner: { id: 'circle-centre' } } };
			},
			['info design.issue.region-corners regions.finder'],
		],
		['a name that is not text', (d) => (d.name = 3), ['error design.issue.not-text name']],
		['a name too long', (d) => (d.name = 'n'.repeat(81)), ['error design.issue.too-long name']],
		[
			'a name with a control character',
			(d) => (d.name = 'tab\there'),
			['error design.issue.control-character name'],
		],
		[
			'a frame on an rMQR symbol, and styled patterns there',
			(d) => {
				Object.assign(at(d, 'symbol'), {
					symbology: 'rmqr',
					minVersion: 'R11x43',
					maxVersion: 'R17x139',
					mask: 0,
				});
				at(d, 'regions')['sub-finder'] = {
					outer: { id: 'square' },
					inner: { id: 'rounded-centre' },
				};
				at(d, 'regions')['corner-finder'] = {
					outer: { id: 'rounded' },
					inner: { id: 'square-centre' },
				};
			},
			[
				'info design.issue.region-corners regions.finder',
				'info design.issue.region-corners regions.sub-finder',
				'info design.issue.region-corners regions.corner-finder',
				'warning design.issue.frame-unsupported frame',
			],
		],
	];

	for (const [label, change, expected] of cases) {
		it(`reports ${label}`, () => {
			expect(issuesAfter(change).sort()).toEqual([...expected].sort());
		});
	}

	it('counts a caption in characters a person sees, not code units', () => {
		const emoji = '\u{1F600}';
		const caption = (content: string) => {
			const design = structuredClone(full()) as unknown as Mutable;
			at(design, 'frame', 'text').content = content;
			return validateDesign(design, registries).issues.map((found) => found.code);
		};
		expect(caption(emoji.repeat(40))).toEqual([]);
		expect(caption(emoji.repeat(41))).toEqual(['design.issue.too-long']);
		// A lone high surrogate still counts as one character.
		expect(caption('\ud83d'.repeat(40))).toEqual([]);
		expect(caption('\ud83dx'.repeat(20))).toEqual([]);
	});

	it('never repeats a value in an issue, only numbers and identifiers', () => {
		const result = validateDesign(
			{
				...full(),
				name: 'secret name\u0001',
				frame: {
					ref: { id: 'rounded-card' },
					text: { content: 'my password 1234\u0002', fontId: 'x' },
				},
			},
			registries,
		);
		const text = JSON.stringify(result.issues);
		expect(text).not.toContain('secret');
		expect(text).not.toContain('password');
	});

	it('drops what it repairs and returns the repaired design', () => {
		const input = structuredClone(full()) as unknown as Mutable;
		input.extra = true;
		at(input, 'modules', 'shape').params = { radius: 0.2, wobble: 3 };
		at(input, 'background').angle = 400;
		delete at(input, 'background').space;
		at(input, 'logo').paint = { kind: 'solid', ink: '#000' };
		at(input, 'frame').ref = { id: 'none' };
		const result = validateDesign(input, registries);
		expect(result.design).not.toBeNull();
		const design = result.design as QrDesignV1;
		expect(design).not.toHaveProperty('extra');
		expect(design.modules.shape).toEqual({ id: 'rounded', params: { radius: 0.2 } });
		expect(design.background).toMatchObject({ angle: 40, space: 'symbol' });
		expect(design.logo).not.toHaveProperty('paint');
		expect(design.frame).toEqual({ ref: { id: 'none' }, paint: { kind: 'solid', ink: '#0b3d91' } });
		// Nothing a repair touched is an error.
		expect(result.issues.every((found) => found.severity === 'warning')).toBe(true);
	});

	it('fills in the parts whose absence means none', () => {
		const sparse = {
			schema: 'qr-design',
			version: 1,
			symbol: { symbology: 'qr' },
			quietZone: 4,
			background: null,
			modules: { shape: { id: 'square' }, paint: { kind: 'solid', ink: '#000' } },
		};
		const result = validateDesign(sparse, registries);
		expect(result.design).toEqual({
			...sparse,
			modules: { ...sparse.modules, light: null },
			regions: {},
			logo: null,
			frame: null,
			output: { colourSpace: 'srgb' },
		});
	});
});
