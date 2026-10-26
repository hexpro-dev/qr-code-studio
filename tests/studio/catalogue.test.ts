/**
 * The catalogue: everything the registries hold, as a view lists it, with
 * thumbnails drawn once and only when asked for.
 */

import { describe, expect, it } from 'vitest';
import { presetSizeMm } from '../../src/design/preset-size.js';
import { regionPairConforms } from '../../src/design/finder.js';
import { resolveParams } from '../../src/design/params.js';
import { createRegistries } from '../../src/registries.js';
import { sceneToSvg } from '../../src/render/svg.js';
import {
	buildCatalogue,
	presetThumbnails,
	registryVersions,
	sampleSymbol,
} from '../../src/studio/catalogue.js';
import { studioWith, studioWithCode } from './helpers.js';

describe('the catalogue', () => {
	const registries = createRegistries();
	const catalogue = buildCatalogue(registries);

	it('groups the content types by category, in a fixed order, the read-only ones marked', () => {
		const categories = catalogue.payloadTypes.map((group) => group.category);
		expect(categories[0]).toBe('link');
		expect(categories[categories.length - 1]).toBe('text');
		const all = catalogue.payloadTypes.flatMap((group) => group.types.map((type) => type.id));
		expect(all.sort()).toEqual(registries.payloads.ids().slice().sort());
		const zatca = catalogue.payloadTypes
			.flatMap((group) => group.types)
			.find((type) => type.id === 'zatca');
		expect(zatca?.generate).toBe(false);
		const bill = catalogue.payloadTypes
			.flatMap((group) => group.types)
			.find((type) => type.id === 'swiss-qr-bill');
		expect(bill?.designLocked).toBe(true);
		for (const group of catalogue.payloadTypes)
			expect(group.labelKey).toBe(`studio.category.${group.category}`);
	});

	it('lists the symbologies with the note for the ones most phones cannot read', () => {
		expect(catalogue.symbologies.map((entry) => [entry.id, entry.noteKey, entry.ecLevels])).toEqual(
			[
				['qr', null, ['L', 'M', 'Q', 'H']],
				['micro', 'symbology.micro.not-phone-readable', ['L', 'M', 'Q']],
				['rmqr', 'symbology.rmqr.not-phone-readable', ['M', 'H']],
			],
		);
	});

	it('lists every shape, fill, frame, icon and preset, with its params', () => {
		const ids = (list: readonly { id: string }[]) => list.map((entry) => entry.id);
		expect(ids(catalogue.moduleShapes)).toEqual(registries.design.moduleShapes.ids());
		expect([...ids(catalogue.rings), ...ids(catalogue.centres)].sort()).toEqual(
			registries.design.regionShapes.ids().slice().sort(),
		);
		expect(ids(catalogue.fills)).toEqual(registries.design.fills.ids());
		expect(ids(catalogue.frames)).toEqual(registries.design.frames.ids());
		expect(ids(catalogue.icons)).toEqual(registries.design.icons.ids());
		for (const entry of catalogue.presets.flatMap((group) => group.presets)) {
			const preset = registries.design.presets.require(entry.id);
			expect(entry.sizesMm, entry.id).toEqual(
				Object.fromEntries(preset.ecLevels.map((level) => [level, presetSizeMm(preset, level)])),
			);
			expect(entry.sizesMm[preset.design.symbol.ecLevel ?? 'M'], entry.id).toBe(entry.minSizeMm);
		}
		expect(catalogue.presets.flatMap((group) => ids(group.presets)).sort()).toEqual(
			registries.design.presets.ids().slice().sort(),
		);
		const rounded = catalogue.moduleShapes.find((entry) => entry.id === 'rounded');
		expect(rounded?.params).toBe(registries.design.moduleShapes.require('rounded').params);
		const banner = catalogue.frames.find((entry) => entry.id === 'banner-bottom');
		expect(banner?.text).toEqual({ maxLines: 1, maxChars: 24 });
	});

	const ring = (id: string) => catalogue.rings.find((entry) => entry.id === id)!;

	it('gives each ring and centre the partners it makes a conforming finder with', () => {
		for (const ring of catalogue.rings) {
			for (const centre of catalogue.centres) {
				if (!ring.kinds.includes('concentric-7') || !centre.kinds.includes('concentric-7'))
					continue;
				const outer = registries.design.regionShapes.require(ring.id);
				const inner = registries.design.regionShapes.require(centre.id);
				const conforms = regionPairConforms(
					outer,
					resolveParams(outer.params, undefined),
					inner,
					resolveParams(inner.params, undefined),
					'concentric-7',
				);
				expect(ring.pairs.includes(centre.id), `${ring.id} with ${centre.id}`).toBe(conforms);
				expect(centre.pairs.includes(ring.id), `${centre.id} with ${ring.id}`).toBe(conforms);
				for (const family of ['square', 'dot', 'hex'] as const) {
					const there = regionPairConforms(
						outer,
						resolveParams(outer.params, undefined),
						inner,
						resolveParams(inner.params, undefined),
						'concentric-7',
						family,
					);
					expect(ring.pairsByFamily[family].includes(centre.id), `${ring.id}, ${family}`).toBe(
						there,
					);
					expect(centre.pairsByFamily[family].includes(ring.id), `${centre.id}, ${family}`).toBe(
						there,
					);
				}
			}
		}
		expect(ring('square').pairsByFamily.square).toContain('octagon-centre');
		expect(ring('square').pairsByFamily.dot).not.toContain('octagon-centre');
		expect(catalogue.moduleShapes.find((entry) => entry.id === 'dot')?.family).toBe('dot');
		expect(catalogue.moduleShapes.find((entry) => entry.id === 'hex')?.family).toBe('hex');
		expect(catalogue.moduleShapes.find((entry) => entry.id === 'rounded')?.family).toBe('square');
		const square = catalogue.rings.find((ring) => ring.id === 'square');
		expect(square?.pairs).toContain('square-centre');
		expect(square?.pairs).toBe(square?.pairs);
	});

	it('draws each thumbnail once, as an SVG with ids of its own', () => {
		const entries = [
			...catalogue.moduleShapes,
			...catalogue.rings,
			...catalogue.centres,
			...catalogue.fills,
			...catalogue.frames,
			...catalogue.icons,
			...catalogue.presets.flatMap((group) => group.presets),
		];
		const ids = new Set<string>();
		for (const entry of entries) {
			const svg = entry.thumbnail();
			expect(svg.startsWith('<svg'), entry.id).toBe(true);
			expect(entry.thumbnail()).toBe(svg);
			for (const match of svg.matchAll(/id="([^"]+)"/g)) {
				expect(ids.has(match[1] as string), match[1]).toBe(false);
				ids.add(match[1] as string);
			}
		}
	});

	it("draws a blank thumbnail for an entry of somebody else's that throws", () => {
		const own = createRegistries();
		own.design.moduleShapes.register({
			id: 'throws',
			labelKey: 'design.module.square',
			params: [],
			connects: false,
			path() {
				throw new Error('broken shape');
			},
		});
		own.design.regionShapes.register({
			id: 'odd-ring',
			labelKey: 'design.region.square',
			params: [],
			kinds: ['corner-l'],
			part: 'outer',
			path(_ctx, out) {
				out.rect(0, 0, 1, 1);
			},
		});
		own.design.regionShapes.register({
			id: 'broken-centre',
			labelKey: 'design.region.square-centre',
			params: [],
			kinds: ['concentric-7'],
			part: 'inner',
			path() {
				throw new Error('broken centre');
			},
		});
		const theirs = buildCatalogue(own);
		const entry = theirs.moduleShapes.find((candidate) => candidate.id === 'throws');
		expect(entry?.thumbnail()).toBe(
			sceneToSvg({ width: 1, height: 1, background: null, layers: [] }),
		);
		const odd = theirs.rings.find((ring) => ring.id === 'odd-ring');
		expect(odd?.pairs).toEqual([]);
		expect(odd?.thumbnail().startsWith('<svg')).toBe(true);
		const broken = theirs.centres.find((centre) => centre.id === 'broken-centre');
		expect(broken?.pairs).toEqual([]);
	});

	it('draws a centre with no square ring to pair it with on its own', () => {
		const own = createRegistries();
		const shapes = own.design.regionShapes;
		const lonely = {
			...own.design,
			regionShapes: new (
				shapes.constructor as new (kind: string, entries: unknown[]) => typeof shapes
			)('region-shape', [shapes.require('circle-centre')]),
		};
		const theirs = buildCatalogue({ ...own, design: lonely });
		expect(theirs.centres[0]?.thumbnail().startsWith('<svg')).toBe(true);
		expect(theirs.rings).toEqual([]);
	});
});

describe('the catalogue in the snapshot', () => {
	it('keeps its identity until a registry changes', () => {
		const { studio } = studioWithCode();
		const catalogue = studio.getSnapshot().catalogue;
		studio.dispatch({ type: 'design/shuffle', seed: 2 });
		studio.dispatch({ type: 'payload/field', key: 'url', value: 'https://example.com/z' });
		expect(studio.getSnapshot().catalogue).toBe(catalogue);
	});

	it("changes its key with every registry's version", () => {
		const registries = createRegistries();
		const before = registryVersions(registries);
		registries.payloads.register({ ...registries.payloads.require('text'), id: 'another-text' });
		expect(registryVersions(registries)).not.toBe(before);
	});

	it("draws preset thumbnails with the visitor's own code once there is one", () => {
		const { studio } = studioWith();
		const sample = studio.getSnapshot().presetThumbnails;
		const catalogue = studio.getSnapshot().catalogue;
		const first = catalogue.presets[0]?.presets[0];
		expect(sample.get(first?.id as string)).toBe(first?.thumbnail());
		expect(sample.get('no-such-preset')).toBeNull();
		studio.dispatch({
			type: 'payload/field',
			key: 'url',
			value: `https://example.com/${'v'.repeat(60)}`,
		});
		const own = studio.getSnapshot().presetThumbnails;
		expect(own).not.toBe(sample);
		const drawn = own.get(first?.id as string);
		expect(drawn).not.toBe(first?.thumbnail());
		expect(own.get(first?.id as string)).toBe(drawn);
		expect(own.get('no-such-preset')).toBeNull();
		// Unchanged code, unchanged pictures.
		studio.dispatch({ type: 'mode', mode: 'scan' });
		expect(studio.getSnapshot().presetThumbnails).toBe(own);
	});

	it('has none for a preset the catalogue was built before', () => {
		const registries = createRegistries();
		const catalogue = buildCatalogue(registries);
		const preset = registries.design.presets.list()[0];
		registries.design.presets.register({
			...(preset as NonNullable<typeof preset>),
			id: 'added-later',
		});
		expect(presetThumbnails(registries, catalogue, null).get('added-later')).toBeNull();
		expect(
			presetThumbnails(registries, catalogue, sampleSymbol(registries))
				.get('added-later')
				?.startsWith('<svg'),
		).toBe(true);
	});
});
