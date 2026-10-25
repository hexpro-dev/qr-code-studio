/**
 * Snapshots are immutable and structurally shared, and their expensive parts
 * are built only when read.
 *
 * Reference equality is the whole point of structural sharing: a slice that
 * did not change must be the same object, so a memoised React component and
 * the offline app's own diffing both skip it.
 */

import { describe, expect, it } from 'vitest';
import type { ModuleShape } from '../../src/design/types.js';
import { createRegistries } from '../../src/registries.js';
import { studioWith, studioWithCode } from './helpers.js';

const UNTOUCHED_BY_SETTINGS = [
	'form',
	'payloadIssues',
	'symbol',
	'preview',
	'design',
	'catalogue',
	'presetThumbnails',
	'history',
	'verify',
	'inspect',
	'batch',
	'library',
] as const;

describe('structural sharing', () => {
	it('hands back the same snapshot until something changes', () => {
		const { studio } = studioWithCode();
		const first = studio.getSnapshot();
		expect(studio.getSnapshot()).toBe(first);
		expect(Object.isFrozen(first)).toBe(true);
		expect(Object.isFrozen(first.document)).toBe(true);
	});

	it('keeps every slice a settings change does not touch', () => {
		const { studio } = studioWithCode();
		for (const action of [
			{ type: 'conditions', conditions: { sizeMm: 40 } },
			{ type: 'mode', mode: 'scan' },
		] as const) {
			const before = studio.getSnapshot();
			// Read every lazy slice first, so the comparison is of built values.
			for (const key of UNTOUCHED_BY_SETTINGS) void before[key];
			studio.dispatch(action);
			const after = studio.getSnapshot();
			expect(after).not.toBe(before);
			expect(after.revision).toBe(before.revision + 1);
			for (const key of UNTOUCHED_BY_SETTINGS) expect(after[key], key).toBe(before[key]);
			expect(after.document.design).toBe(before.document.design);
			expect(after.document.fields).toBe(before.document.fields);
		}
	});

	it('keeps the design and the catalogue while the content changes', () => {
		const { studio } = studioWithCode();
		const before = studio.getSnapshot();
		void before.catalogue;
		studio.dispatch({ type: 'payload/field', key: 'url', value: 'https://example.com/two' });
		const after = studio.getSnapshot();
		expect(after.design).toBe(before.design);
		expect(after.catalogue).toBe(before.catalogue);
		expect(after.document.design).toBe(before.document.design);
		expect(after.symbol).not.toBe(before.symbol);
		expect(after.form).not.toBe(before.form);
	});

	it('keeps the parts of the design a patch did not reach', () => {
		const { studio } = studioWithCode();
		const before = studio.getSnapshot().document.design;
		studio.dispatch({
			type: 'design/patch',
			patch: {
				path: ['logo'],
				value: {
					source: { kind: 'icon', id: 'star' },
					size: 0.2,
					clear: 'box',
					padding: 1,
					plate: null,
				},
			},
		});
		const after = studio.getSnapshot().document.design;
		expect(after).not.toBe(before);
		expect(after.modules).toBe(before.modules);
		expect(after.symbol).toBe(before.symbol);
		expect(after.background).toBe(before.background);
		expect(after.output).toBe(before.output);
		// And the design as drawn shares the same way.
		expect(studio.getSnapshot().design.effective.modules).toBe(before.modules);
	});

	it('keeps the symbol when the content changes but the text it makes does not', () => {
		const { studio } = studioWithCode();
		const before = studio.getSnapshot().symbol;
		// A campaign field set and cleared again: new fields, same text.
		studio.dispatch({ type: 'payload/field', key: 'utmTerm', value: 'x' });
		studio.dispatch({ type: 'payload/field', key: 'utmTerm', value: '' });
		const after = studio.getSnapshot().symbol;
		expect(after.status).toBe('ok');
		expect(after.status === 'ok' && before.status === 'ok' && after.view).toBe(
			before.status === 'ok' && before.view,
		);
	});
});

describe('laziness', () => {
	function countingShape(): { shape: ModuleShape; drawn: () => number } {
		let drawn = 0;
		return {
			drawn: () => drawn,
			shape: {
				id: 'counted',
				labelKey: 'design.module.square',
				params: [],
				connects: false,
				path(_ctx, out) {
					drawn += 1;
					out.rect(0, 0, 1, 1);
				},
			},
		};
	}

	it('draws no preview for keystrokes nobody reads, and one for the one that is', () => {
		const registries = createRegistries();
		const counting = countingShape();
		registries.design.moduleShapes.register(counting.shape);
		const { studio } = studioWithCode({ registries });
		studio.dispatch({
			type: 'design/patch',
			patch: { path: ['modules', 'shape'], value: { id: 'counted' } },
		});
		expect(studio.getSnapshot().refusal).toBeNull();
		const start = counting.drawn();
		let url = 'https://example.com/';
		for (let i = 0; i < 20; i += 1) {
			url += 'a';
			studio.dispatch({ type: 'payload/field', key: 'url', value: url });
			// A view that reads only the form and the symbol.
			void studio.getSnapshot().form;
			void studio.getSnapshot().symbol;
		}
		expect(counting.drawn()).toBe(start);
		const preview = studio.getSnapshot().preview;
		expect(preview?.svg.startsWith('<svg')).toBe(true);
		const drawn = counting.drawn();
		expect(drawn).toBeGreaterThan(start);
		expect(studio.getSnapshot().preview).toBe(preview);
		expect(counting.drawn()).toBe(drawn);
	});

	it('draws no preview when there is no code, and no catalogue until it is read', () => {
		const { studio } = studioWith();
		expect(studio.getSnapshot().preview).toBeNull();
		expect(studio.getSnapshot().symbol.status).toBe('empty');
	});
});

describe('subscribing', () => {
	it('tells every listener about each change, and stops when asked', () => {
		const { studio } = studioWith();
		const heard: string[] = [];
		const stopA = studio.subscribe(() => heard.push('a'));
		studio.subscribe(() => heard.push('b'));
		studio.dispatch({ type: 'payload/field', key: 'url', value: 'https://example.com/' });
		stopA();
		studio.dispatch({ type: 'payload/field', key: 'url', value: 'https://example.com/x' });
		expect(heard).toEqual(['a', 'b', 'b']);
	});

	it('tells the others before rethrowing what a broken listener threw', () => {
		const { studio } = studioWith();
		const heard: string[] = [];
		studio.subscribe(() => {
			throw new Error('broken view');
		});
		studio.subscribe(() => {
			throw new Error('second broken view');
		});
		studio.subscribe(() => heard.push('later'));
		expect(() => studio.dispatch({ type: 'mode', mode: 'bulk' })).toThrow('broken view');
		expect(heard).toEqual(['later']);
		expect(studio.getSnapshot().document.mode).toBe('bulk');
	});

	it('refuses a listener that is not a function', () => {
		const { studio } = studioWith();
		expect(() => studio.subscribe('nope' as never)).toThrow(TypeError);
	});

	it('says nothing for an action that changes nothing', () => {
		const { studio } = studioWithCode();
		let heard = 0;
		studio.subscribe(() => (heard += 1));
		studio.dispatch({ type: 'mode', mode: 'create' });
		studio.dispatch({ type: 'payload/field', key: 'url', value: 'https://example.com/' });
		studio.dispatch({ type: 'payload/type', typeId: 'url' });
		studio.dispatch({ type: 'conditions', conditions: { sizeMm: 25 } });
		expect(heard).toBe(0);
	});
});

describe('registries that grow', () => {
	it('shows an entry registered after the studio was made, with no other change', () => {
		const registries = createRegistries();
		const { studio } = studioWith({ registries });
		const before = studio.getSnapshot();
		const catalogue = before.catalogue;
		expect(studio.getSnapshot()).toBe(before);
		registries.design.moduleShapes.register({
			id: 'late-square',
			labelKey: 'design.module.square',
			params: [],
			connects: false,
			path(_ctx, out) {
				out.rect(0, 0, 1, 1);
			},
		});
		const after = studio.getSnapshot();
		expect(after).not.toBe(before);
		expect(after.catalogue).not.toBe(catalogue);
		expect(after.catalogue.moduleShapes.map((entry) => entry.id)).toContain('late-square');
		expect(studio.getSnapshot()).toBe(after);
	});
});
