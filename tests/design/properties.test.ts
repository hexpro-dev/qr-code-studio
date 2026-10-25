/**
 * Designs generated from the schema validate, survive JSON and design links
 * unchanged, and give one link however their keys were ordered; anything
 * else thrown at the validator or the link reader comes back as issues or a
 * QrStudioError, never a crash.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { isQrStudioError } from '../../src/core/errors.js';
import { canonicalJson } from '../../src/design/canonical.js';
import { MAX_LINK_LENGTH, decodeDesignLink, encodeDesignLink } from '../../src/design/link.js';
import { migrateDesign } from '../../src/design/migrate.js';
import { createDesignRegistries } from '../../src/design/registries.js';
import type {
	DesignPaint,
	EntryRef,
	ParamSchema,
	ParamValue,
	QrDesignV1,
	RegionStyle,
} from '../../src/design/types.js';
import { validateDesign } from '../../src/design/validate.js';

const registries = createDesignRegistries();

/** A double in a range with no negative zero, which JSON cannot spell. */
function number(min: number, max: number): fc.Arbitrary<number> {
	return fc.double({ min, max, noNaN: true, noDefaultInfinity: true }).map((value) => value + 0);
}

const colour = fc
	.integer({ min: 0, max: 0xffffff })
	.map((n) => `#${n.toString(16).padStart(6, '0')}`);
const ink = fc.oneof(
	colour,
	fc.record({
		srgb: colour,
		cmyk: fc.tuple(number(0, 1), number(0, 1), number(0, 1), number(0, 1)),
	}),
);
const stops = fc
	.array(fc.tuple(number(0, 1), ink), { minLength: 2, maxLength: 5 })
	.map((list) =>
		list.map(([offset, value]) => ({ offset, ink: value })).sort((a, b) => a.offset - b.offset),
	);
const space = fc.constantFrom('symbol' as const, 'module' as const);
const angle = number(0, 359.999);
const centre = number(-1, 2);

function param(schema: ParamSchema): fc.Arbitrary<ParamValue> {
	switch (schema.kind) {
		case 'boolean':
			return fc.boolean();
		case 'select':
			return fc.constantFrom(...(schema.options ?? []).map((option) => option.value));
		case 'colour':
			return colour;
		case 'integer':
			return fc.integer({ min: schema.min ?? 0, max: schema.max ?? 100 });
		default:
			return number(schema.min ?? 0, schema.max ?? 100);
	}
}

function ref(
	entries: readonly { id: string; params: readonly ParamSchema[] }[],
): fc.Arbitrary<EntryRef> {
	return fc.constantFrom(...entries).chain((entry) =>
		entry.params.length === 0
			? fc.constant({ id: entry.id })
			: fc
					.record(Object.fromEntries(entry.params.map((schema) => [schema.key, param(schema)])), {
						requiredKeys: [],
					})
					.map((params) => ({ id: entry.id, params })),
	);
}

const paint: fc.Arbitrary<DesignPaint> = fc.oneof(
	fc.record({ kind: fc.constant('solid' as const), ink }),
	fc.record({ kind: fc.constant('linear' as const), angle, stops, space }),
	fc.record({
		kind: fc.constant('radial' as const),
		cx: centre,
		cy: centre,
		radius: number(0.01, 4),
		stops,
		space,
	}),
	fc.record({ kind: fc.constant('conic' as const), cx: centre, cy: centre, angle, stops, space }),
	ref(registries.fills.list()).map((found) => ({ kind: 'entry' as const, ref: found })),
);

const outers = registries.regionShapes.list().filter((shape) => shape.part === 'outer');
const inners = registries.regionShapes.list().filter((shape) => shape.part === 'inner');
const regionStyle: fc.Arbitrary<RegionStyle> = fc.record(
	{ outer: ref(outers), inner: ref(inners), outerPaint: paint, innerPaint: paint },
	{ requiredKeys: ['outer', 'inner'] },
);

const captioned = registries.frames.list().filter((frame) => frame.text !== null);
const frame: fc.Arbitrary<QrDesignV1['frame']> = fc.oneof(
	fc.constant(null),
	fc.record({ ref: ref(registries.frames.list()), paint }, { requiredKeys: ['ref'] }),
	fc.record(
		{
			ref: ref(captioned),
			paint,
			text: fc.record(
				{
					content: fc.stringMatching(/^[A-Za-z0-9 ]{0,16}$/),
					fontId: fc.constantFrom('plex-sans-regular', 'plex-sans-bold', 'inter'),
					paint,
				},
				{ requiredKeys: ['content', 'fontId'] },
			),
		},
		{ requiredKeys: ['ref', 'text'] },
	),
);

const logo: fc.Arbitrary<QrDesignV1['logo']> = fc.oneof(
	fc.constant(null),
	fc.record(
		{
			source: fc
				.constantFrom(...registries.icons.ids())
				.map((id) => ({ kind: 'icon' as const, id })),
			size: number(0.05, 0.4),
			clear: fc.constantFrom('none' as const, 'box' as const, 'shape' as const),
			padding: number(0, 4),
			plate: fc.oneof(
				fc.constant(null),
				fc.record({
					paint,
					shape: fc.constantFrom('square' as const, 'rounded' as const, 'circle' as const),
				}),
			),
			paint,
		},
		{ requiredKeys: ['source', 'size', 'clear', 'padding', 'plate'] },
	),
);

const design: fc.Arbitrary<QrDesignV1> = fc.record(
	{
		schema: fc.constant('qr-design' as const),
		version: fc.constant(1 as const),
		symbol: fc.record(
			{
				symbology: fc.constant('qr'),
				ecLevel: fc.constantFrom('L' as const, 'M' as const, 'Q' as const, 'H' as const),
				boostEc: fc.boolean(),
				minVersion: fc.integer({ min: 1, max: 10 }).map(String),
				maxVersion: fc.integer({ min: 10, max: 40 }).map(String),
				mask: fc.oneof(fc.integer({ min: 0, max: 7 }), fc.constant('auto' as const)),
				segmentation: fc.record(
					{
						kanji: fc.constantFrom('never' as const, 'when-smaller' as const, 'always' as const),
						eci: fc.constantFrom('auto' as const, 'never' as const, 'utf-8' as const),
					},
					{ requiredKeys: [] },
				),
			},
			{ requiredKeys: ['symbology'] },
		),
		quietZone: fc.integer({ min: 0, max: 20 }),
		background: fc.oneof(fc.constant(null), paint),
		modules: fc.record({
			shape: ref(registries.moduleShapes.list()),
			paint,
			light: fc.oneof(
				fc.constant(null),
				fc.record({ shape: ref(registries.moduleShapes.list()), paint }),
			),
		}),
		regions: fc.record(
			{ finder: regionStyle, 'sub-finder': regionStyle, 'corner-finder': regionStyle },
			{ requiredKeys: [] },
		),
		logo,
		frame,
		output: fc.record(
			{
				sizeMm: number(5, 2000),
				sizeBasis: fc.constantFrom('artwork' as const, 'symbol' as const),
				dpi: fc.integer({ min: 72, max: 2400 }),
				colourSpace: fc.constantFrom('srgb' as const, 'cmyk' as const),
			},
			{ requiredKeys: ['colourSpace'] },
		),
		name: fc.stringMatching(/^[A-Za-z0-9 .,'-]{0,40}$/),
	},
	{
		requiredKeys: [
			'schema',
			'version',
			'symbol',
			'quietZone',
			'background',
			'modules',
			'regions',
			'logo',
			'frame',
			'output',
		],
	},
);

/** The same object with every key list reversed, recursively. */
function reversed(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(reversed);
	if (typeof value === 'object' && value !== null) {
		return Object.fromEntries(
			Object.entries(value)
				.reverse()
				.map(([key, inner]) => [key, reversed(inner)]),
		);
	}
	return value;
}

describe('designs from the schema', () => {
	it('validate unchanged, with no error', () => {
		fc.assert(
			fc.property(design, (generated) => {
				const { design: valid, issues } = validateDesign(generated, registries);
				expect(issues.filter((found) => found.severity === 'error')).toEqual([]);
				expect(valid).toEqual(generated);
			}),
			{ numRuns: 150, seed: 20261026 },
		);
	});

	it('survive JSON, migration and design links, and give one link whatever the key order', () => {
		fc.assert(
			fc.property(design, (generated) => {
				const json = JSON.parse(JSON.stringify(generated)) as unknown;
				expect(validateDesign(json, registries).design).toEqual(generated);
				const migrated = migrateDesign(json);
				expect(migrateDesign(migrated)).toEqual(migrated);
				const link = encodeDesignLink(generated);
				expect(link.length).toBeLessThanOrEqual(MAX_LINK_LENGTH);
				expect(encodeDesignLink(reversed(generated) as QrDesignV1)).toBe(link);
				expect(canonicalJson(reversed(generated))).toBe(canonicalJson(generated));
				expect(decodeDesignLink(link, registries)).toEqual(generated);
			}),
			{ numRuns: 100, seed: 1026 },
		);
	});
});

/** Run `fn`, and fail on anything thrown that is not a QrStudioError. */
function survives(fn: () => unknown): void {
	try {
		fn();
	} catch (error) {
		if (!isQrStudioError(error)) throw error;
	}
}

describe('anything else', () => {
	it('comes back from the validator as issues, never as a crash', () => {
		fc.assert(
			fc.property(fc.jsonValue({ maxDepth: 6 }), (value) => {
				const { design: valid, issues } = validateDesign(value, registries);
				if (valid === null) expect(issues.length).toBeGreaterThan(0);
			}),
			{ numRuns: 400, seed: 7 },
		);
	});

	it('comes back as issues when a valid design has parts replaced with noise', () => {
		const paths = fc.array(
			fc.oneof(
				fc.constantFrom(
					'symbol',
					'modules',
					'regions',
					'logo',
					'frame',
					'output',
					'background',
					'shape',
					'paint',
					'stops',
					'finder',
					'outer',
					'params',
					'text',
					'source',
					'ink',
					'light',
					'ref',
					'assets',
				),
				fc.nat(3),
			),
			{ minLength: 1, maxLength: 5 },
		);
		fc.assert(
			fc.property(design, paths, fc.jsonValue({ maxDepth: 3 }), (generated, path, noise) => {
				const copy = JSON.parse(JSON.stringify(generated)) as Record<string, unknown>;
				let node: Record<string, unknown> = copy;
				for (const key of path.slice(0, -1)) {
					const next = node[key as string];
					if (typeof next !== 'object' || next === null) break;
					node = next as Record<string, unknown>;
				}
				node[path[path.length - 1] as string] = noise;
				validateDesign(copy, registries);
				survives(() => encodeDesignLink(copy as unknown as QrDesignV1));
			}),
			{ numRuns: 300, seed: 9 },
		);
	});

	it('throws only QrStudioError from the link reader', () => {
		fc.assert(
			fc.property(
				fc.oneof(
					fc.string(),
					fc
						.base64String()
						.map((text) => `v1.${text.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`),
					fc
						.uint8Array({ maxLength: 200 })
						.map((bytes) => `v1.${Buffer.from(bytes).toString('base64url')}`),
				),
				(fragment) => {
					survives(() => decodeDesignLink(fragment, registries));
				},
			),
			{ numRuns: 400, seed: 11 },
		);
	});
});
