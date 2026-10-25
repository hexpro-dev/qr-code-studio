/**
 * Where a studio starts: nothing, a design link, or a whole document, each
 * checked and repaired part by part; and the options a caller can get wrong.
 */

import { describe, expect, it } from 'vitest';
import { QrStudioError } from '../../src/core/errors.js';
import { defaultDesign } from '../../src/design/document.js';
import { encodeDesignLink } from '../../src/design/link.js';
import { createPayloadRegistry } from '../../src/payload/registry.js';
import { createRegistries } from '../../src/registries.js';
import {
	conditionsFrom,
	defaultDocument,
	designFrom,
	documentFrom,
	documentFromLink,
} from '../../src/studio/document.js';
import {
	asStudioError,
	axisKey,
	categoryKey,
	checkKey,
	errorIssue,
	errorKey,
	errorMessageKey,
	groupKey,
	presetCategoryKey,
	studioError,
} from '../../src/studio/keys.js';
import { createStudio } from '../../src/studio/studio.js';
import type { StudioDocument } from '../../src/studio/types.js';

const registries = createRegistries();

describe('the start', () => {
	it('is a web link with nothing in it, the standard design and 25 mm', () => {
		const { document, refusal } = createStudio().getSnapshot();
		expect(document).toEqual({
			mode: 'create',
			typeId: 'url',
			fields: {
				url: '',
				utmSource: '',
				utmMedium: '',
				utmCampaign: '',
				utmTerm: '',
				utmContent: '',
			},
			design: defaultDesign(),
			conditions: { sizeMm: 25, dpi: null, distanceMm: null },
		});
		expect(refusal).toBeNull();
	});

	it('opens a design link with the standard content, since a link never carries any', () => {
		const design = { ...defaultDesign(), quietZone: 6, name: 'Linked' };
		const studio = createStudio({ initial: `#${encodeDesignLink(design)}` });
		expect(studio.getSnapshot().document.design).toEqual(design);
		expect(studio.getSnapshot().document.fields.url).toBe('');
	});

	it('opens a damaged link with the standard design, saying so', () => {
		const studio = createStudio({ initial: 'v1.not-a-real-link!!' });
		expect(studio.getSnapshot().document.design).toEqual(defaultDesign());
		expect(studio.getSnapshot().refusal).toEqual({
			action: 'initial',
			issues: [
				{
					code: 'studio.issue.design-link',
					path: [],
					severity: 'warning',
					params: { code: 'design/invalid' },
				},
			],
		});
		expect(documentFromLink('v9.abc', registries).issues[0]?.params).toEqual({
			code: 'design/unsupported-schema',
		});
	});

	it('opens a whole document, repairing each part that is wrong', () => {
		const given = {
			mode: 'bulk',
			typeId: 'wifi',
			fields: { ssid: 'Example Network', hidden: 'not a boolean', extra: { nested: true } },
			design: { ...defaultDesign(), quietZone: 8 },
			conditions: { sizeMm: 40, dpi: 300, distanceMm: null },
		};
		const studio = createStudio({ initial: given as unknown as StudioDocument });
		const { document, refusal } = studio.getSnapshot();
		expect(document.mode).toBe('bulk');
		expect(document.typeId).toBe('wifi');
		expect(document.fields.ssid).toBe('Example Network');
		expect(document.fields).not.toHaveProperty('extra');
		expect(document.design.quietZone).toBe(8);
		expect(document.conditions).toEqual({ sizeMm: 40, dpi: 300, distanceMm: null });
		expect(refusal).toBeNull();

		const broken = documentFrom(
			{
				mode: 'sideways',
				typeId: 'zatca',
				fields: 'none',
				design: 5,
				conditions: { sizeMm: 'big', dpi: -1, distanceMm: undefined },
			},
			registries,
		);
		expect(broken.document.mode).toBe('create');
		expect(broken.document.typeId).toBe('url');
		expect(broken.issues.map((found) => found.path.join('.'))).toEqual([
			'mode',
			'typeId',
			'design',
			'conditions.sizeMm',
			'conditions.dpi',
		]);
		expect(documentFrom('nonsense', registries).issues).toHaveLength(1);
		expect(
			documentFrom({ conditions: 'x' }, registries).issues.map((found) => found.path.join('.')),
		).toContain('conditions');
	});

	it('repairs conditions part by part', () => {
		const base = { sizeMm: 25, dpi: null, distanceMm: null };
		expect(conditionsFrom(undefined, base)).toEqual({ conditions: base, bad: [] });
		expect(conditionsFrom({ dpi: 0 }, base).bad).toEqual([['conditions', 'dpi']]);
		expect(conditionsFrom('x', base).bad).toEqual([['conditions']]);
		expect(conditionsFrom({ sizeMm: null }, base).conditions.sizeMm).toBeNull();
	});

	it('reports a design whose registry entries throw, rather than throwing', () => {
		const own = createRegistries();
		own.design.moduleShapes.register({
			id: 'odd',
			labelKey: 'design.module.square',
			get params(): never {
				throw new RangeError('a third party entry that throws when asked about itself');
			},
			connects: false,
			path() {},
		});
		const checked = designFrom(
			{
				...defaultDesign(),
				modules: { ...defaultDesign().modules, shape: { id: 'odd', params: { size: 1 } } },
			},
			own,
		);
		expect(checked.design).toBeNull();
		expect(checked.issues[0]?.code).toBe('error.design.invalid');
	});

	it('refuses a payload registry with nothing in it', () => {
		const empty = new (
			createPayloadRegistry().constructor as new (
				kind: string,
			) => ReturnType<typeof createPayloadRegistry>
		)('payload-type');
		expect(() => defaultDocument({ ...registries, payloads: empty })).toThrow(TypeError);
	});

	it('starts with any type when the registry has no web link', () => {
		const payloads = createPayloadRegistry();
		const only = new (
			payloads.constructor as new (kind: string, entries: unknown[]) => typeof payloads
		)('payload-type', [payloads.require('text')]);
		expect(defaultDocument({ ...registries, payloads: only }).typeId).toBe('text');
	});
});

describe('options', () => {
	it('refuse what a caller can only get wrong by mistake', () => {
		expect(() => createStudio(null as never)).toThrow(TypeError);
		expect(() => createStudio({ historyLimit: -1 })).toThrow(TypeError);
		expect(() => createStudio({ historyLimit: 1.5 })).toThrow(TypeError);
		expect(() => createStudio({ verifyDebounceMs: -1 })).toThrow(TypeError);
		expect(() => createStudio({ verifyDebounceMs: Number.NaN })).toThrow(TypeError);
		expect(() => createStudio({ seed: -1 })).toThrow(TypeError);
		expect(() => createStudio({ seed: 2 ** 32 })).toThrow(TypeError);
	});

	it('refuse an action that is not one', () => {
		const studio = createStudio();
		expect(() => studio.dispatch(null as never)).toThrow(TypeError);
		expect(() => studio.dispatch({ type: 'nope' } as never)).toThrow(TypeError);
		expect(() => studio.dispatch({ type: 'mode', mode: 'sideways' } as never)).toThrow(TypeError);
		expect(() => studio.dispatch({ type: 'history/begin', key: 4 } as never)).toThrow(TypeError);
		expect(() => studio.dispatch({ type: 'history/commit' } as never)).toThrow(TypeError);
	});

	it('refuse conditions that are not sizes, with the field that is wrong', () => {
		const studio = createStudio();
		studio.dispatch({ type: 'conditions', conditions: { sizeMm: -3, dpi: 300 } });
		expect(studio.getSnapshot().refusal?.issues).toEqual([
			{ code: 'studio.issue.conditions', path: ['conditions', 'sizeMm'], severity: 'error' },
		]);
		expect(studio.getSnapshot().document.conditions.dpi).toBeNull();
	});

	it('use the default clock and scheduler when none is given', () => {
		const studio = createStudio();
		studio.dispatch({ type: 'payload/field', key: 'url', value: 'https://example.com/' });
		studio.dispatch({ type: 'verify/request' });
		studio.dispose();
	});
});

describe('message keys', () => {
	it('name headings, checks and stages', () => {
		expect(categoryKey('payment')).toBe('studio.category.payment');
		expect(presetCategoryKey('print')).toBe('studio.preset-category.print');
		expect(groupKey('address')).toBe('studio.group.address');
		expect(checkKey('quiet-zone')).toBe('studio.check.quiet-zone');
		expect(axisKey('static')).toBe('studio.axis.static');
		expect(errorMessageKey('encode/too-much-data')).toBe('error.encode.too-much-data');
		expect(errorMessageKey('cancelled')).toBe('error.cancelled');
	});

	it('pick the most specific sentence there is for an error', () => {
		const key = (code: QrStudioError['code'], params: Record<string, string | number> = {}) =>
			errorKey(new QrStudioError(code, 'x', params));
		expect(key('encode/too-much-data')).toBe('encode.too-much-data');
		expect(key('encode/unsupported-feature', { feature: 'eci' })).toBe(
			'encode.unsupported-feature.eci',
		);
		expect(key('encode/unsupported-feature')).toBe('error.encode.unsupported-feature');
		expect(key('encode/unsupported-content', { reason: 'mode' })).toBe(
			'encode.unsupported-content.mode',
		);
		expect(key('encode/unsupported-content', { reason: 'Not A Key' })).toBe(
			'error.encode.unsupported-content',
		);
		expect(key('decode/not-found', { stage: 'geometry' })).toBe('decode.not-found.geometry');
		expect(key('decode/unreadable', { stage: 'format' })).toBe('decode.unreadable.format');
		expect(key('decode/unsupported', { feature: 'kanji' })).toBe('decode.unsupported.kanji');
		expect(key('font/malformed')).toBe('text.font.malformed');
		expect(key('font/missing-glyphs')).toBe('text.font.missing-glyphs');
		expect(key('render/surface-too-large', { maxMm: 5080 })).toBe('render.print.too-large');
		expect(key('render/surface-too-large', { maxPixels: 5 })).toBe(
			'error.render.surface-too-large',
		);
		expect(key('render/format-unavailable', { format: 'eps', reason: 'transparency' })).toBe(
			'render.eps.transparency',
		);
		expect(key('render/format-unavailable', { format: 'webp' })).toBe(
			'error.render.format-unavailable',
		);
		expect(key('camera/in-use')).toBe('error.camera.in-use');
		expect(key('batch/malformed-csv', { reason: 'stray-quote' })).toBe(
			'batch.malformed-csv.stray-quote',
		);
		expect(key('batch/malformed-csv')).toBe('error.batch.malformed-csv');
		expect(key('batch/too-many-rows', { max: 5 })).toBe('batch.too-many-rows');
		expect(key('batch/unknown-column')).toBe('batch.unknown-column');
	});

	it('carry an error into an issue and a view without its message', () => {
		const error = new QrStudioError('image/too-large', 'a sentence for developers', {
			maxPixels: 9,
		});
		expect(studioError(error)).toEqual({
			code: 'image/too-large',
			messageKey: 'error.image.too-large',
			params: { maxPixels: 9 },
		});
		expect(errorIssue(error, ['logo'])).toEqual({
			code: 'error.image.too-large',
			path: ['logo'],
			severity: 'error',
			params: { maxPixels: 9 },
		});
		expect(asStudioError(error, 'cancelled')).toBe(error);
		const wrapped = asStudioError(new Error('x'), 'platform/unavailable');
		expect(wrapped.code).toBe('platform/unavailable');
		expect(wrapped.cause).toBeInstanceOf(Error);
	});
});
