/**
 * Undo and redo, as laws over the studio and over the pure history value.
 *
 * Undo after an action that starts a step is the identity on the work (type,
 * fields, design); redo after undo puts it back; a run that coalesces is one
 * step; history keeps no more than its limit; and mode and conditions are
 * never steps.
 */

import { describe, expect, it } from 'vitest';
import {
	EMPTY_HISTORY,
	beginGroup,
	breakRun,
	cancelGroup,
	commitGroup,
	recordChange,
	redo,
	sameWork,
	undo,
} from '../../src/studio/history.js';
import type { Work } from '../../src/studio/history.js';
import type { StudioAction, StudioDocument } from '../../src/studio/types.js';
import { defaultDesign } from '../../src/design/document.js';
import { studioWith, studioWithCode } from './helpers.js';

function work(doc: StudioDocument): Pick<StudioDocument, 'typeId' | 'fields' | 'design'> {
	return { typeId: doc.typeId, fields: doc.fields, design: doc.design };
}

/** Actions that each start a step of their own from the state the previous left. */
const STEPS: readonly StudioAction[] = [
	{ type: 'payload/field', key: 'url', value: 'https://example.com/one' },
	{ type: 'design/patch', patch: { path: ['modules', 'shape'], value: { id: 'dot' } } },
	{ type: 'design/preset', id: 'classic-black' },
	{ type: 'design/shuffle', seed: 7 },
	{ type: 'payload/type', typeId: 'text' },
	{ type: 'payload/raw', text: 'WIFI:T:WPA;S:Example Network;P:example-pass;;' },
	{ type: 'design/replace', design: JSON.stringify({ ...defaultDesign(), quietZone: 6 }) },
	{ type: 'payload/field', key: 'ssid', value: 'Example Network 2' },
];

describe('undo and redo over the studio', () => {
	it('undo after each action restores the work exactly as it was', () => {
		const { studio } = studioWith();
		for (const action of STEPS) {
			const before = studio.getSnapshot().document;
			studio.dispatch(action);
			const after = studio.getSnapshot().document;
			expect(after, action.type).not.toBe(before);
			studio.dispatch({ type: 'history/undo' });
			expect(work(studio.getSnapshot().document), action.type).toEqual(work(before));
			// And the same objects, so a memoised view does not even redraw.
			expect(studio.getSnapshot().document.design).toBe(before.design);
			studio.dispatch({ type: 'history/redo' });
			expect(work(studio.getSnapshot().document), action.type).toEqual(work(after));
		}
	});

	it('walks the whole way back and forward again', () => {
		const { studio } = studioWith();
		const states = [work(studio.getSnapshot().document)];
		for (const action of STEPS) {
			studio.dispatch(action);
			states.push(work(studio.getSnapshot().document));
		}
		for (let i = states.length - 2; i >= 0; i -= 1) {
			studio.dispatch({ type: 'history/undo' });
			expect(work(studio.getSnapshot().document)).toEqual(states[i]);
		}
		expect(studio.getSnapshot().history).toEqual({ canUndo: false, canRedo: true });
		studio.dispatch({ type: 'history/undo' });
		expect(work(studio.getSnapshot().document)).toEqual(states[0]);
		for (let i = 1; i < states.length; i += 1) {
			studio.dispatch({ type: 'history/redo' });
			expect(work(studio.getSnapshot().document)).toEqual(states[i]);
		}
		expect(studio.getSnapshot().history).toEqual({ canUndo: true, canRedo: false });
		const top = studio.getSnapshot();
		studio.dispatch({ type: 'history/redo' });
		expect(studio.getSnapshot()).toBe(top);
	});

	it('forgets what could be redone once something new is done', () => {
		const { studio } = studioWithCode();
		studio.dispatch({ type: 'design/shuffle', seed: 1 });
		studio.dispatch({ type: 'history/undo' });
		expect(studio.getSnapshot().history.canRedo).toBe(true);
		studio.dispatch({ type: 'design/shuffle', seed: 2 });
		expect(studio.getSnapshot().history.canRedo).toBe(false);
	});

	it('makes typing in one field one step, and a second field another', () => {
		const { studio } = studioWith();
		const start = studio.getSnapshot().document;
		for (const value of ['h', 'ht', 'htt', 'https://example.com/']) {
			studio.dispatch({ type: 'payload/field', key: 'url', value });
		}
		studio.dispatch({ type: 'payload/field', key: 'utmSource', value: 'poster' });
		studio.dispatch({ type: 'payload/field', key: 'utmSource', value: 'posters' });
		studio.dispatch({ type: 'history/undo' });
		expect(studio.getSnapshot().document.fields.url).toBe('https://example.com/');
		expect(studio.getSnapshot().document.fields.utmSource).toBe('');
		studio.dispatch({ type: 'history/undo' });
		expect(work(studio.getSnapshot().document)).toEqual(work(start));
		expect(studio.getSnapshot().history.canUndo).toBe(false);
	});

	it('makes patches with one coalesce key one step, as a colour picker being dragged', () => {
		const { studio } = studioWithCode();
		const before = studio.getSnapshot().document.design;
		for (const ink of ['#111111', '#222222', '#333333']) {
			studio.dispatch({
				type: 'design/patch',
				patch: { path: ['modules', 'paint'], value: { kind: 'solid', ink } },
				coalesce: 'modules-ink',
			});
		}
		// A different key starts a new step.
		studio.dispatch({
			type: 'design/patch',
			patch: { path: ['quietZone'], value: 5 },
			coalesce: 'quiet',
		});
		studio.dispatch({ type: 'history/undo' });
		expect(studio.getSnapshot().document.design.modules.paint).toEqual({
			kind: 'solid',
			ink: '#333333',
		});
		studio.dispatch({ type: 'history/undo' });
		expect(studio.getSnapshot().document.design).toBe(before);
	});

	it('makes a group one step, and a cancelled group no step at all', () => {
		const { studio } = studioWithCode();
		const before = studio.getSnapshot().document.design;
		studio.dispatch({ type: 'history/begin', key: 'slider' });
		for (const size of [0.1, 0.15, 0.2]) {
			studio.dispatch({
				type: 'design/patch',
				patch: {
					path: ['logo'],
					value: {
						source: { kind: 'icon', id: 'star' },
						size,
						clear: 'box',
						padding: 1,
						plate: null,
					},
				},
			});
		}
		expect(studio.getSnapshot().document.design.logo?.size).toBe(0.2);
		expect(studio.getSnapshot().history.canUndo).toBe(true);
		studio.dispatch({ type: 'history/commit', key: 'slider' });
		studio.dispatch({ type: 'history/undo' });
		expect(studio.getSnapshot().document.design).toBe(before);

		studio.dispatch({ type: 'history/begin', key: 'slider' });
		studio.dispatch({ type: 'design/patch', patch: { path: ['quietZone'], value: 9 } });
		studio.dispatch({ type: 'history/cancel' });
		expect(studio.getSnapshot().document.design).toBe(before);
		studio.dispatch({ type: 'history/undo' });
		// The cancelled group left nothing to undo but the step before the slider.
		expect(studio.getSnapshot().document.fields.url).toBe('');
	});

	it('commits an open group when undo arrives mid-drag, so the drag is what is undone', () => {
		const { studio } = studioWithCode();
		const before = studio.getSnapshot().document.design;
		studio.dispatch({ type: 'history/begin', key: 'drag' });
		studio.dispatch({ type: 'design/patch', patch: { path: ['quietZone'], value: 7 } });
		studio.dispatch({ type: 'history/undo' });
		expect(studio.getSnapshot().document.design).toBe(before);
		studio.dispatch({ type: 'history/redo' });
		expect(studio.getSnapshot().document.design.quietZone).toBe(7);
	});

	it('ignores a commit for a group that is not open, and a begin for the open one', () => {
		const { studio } = studioWithCode();
		const snapshot = studio.getSnapshot();
		studio.dispatch({ type: 'history/commit', key: 'nothing-open' });
		studio.dispatch({ type: 'history/cancel' });
		expect(studio.getSnapshot()).toBe(snapshot);
		studio.dispatch({ type: 'history/begin', key: 'a' });
		const opened = studio.getSnapshot();
		studio.dispatch({ type: 'history/begin', key: 'a' });
		expect(studio.getSnapshot()).toBe(opened);
		// An unchanged cancelled group says so without a new revision.
		studio.dispatch({ type: 'history/cancel' });
		expect(studio.getSnapshot().revision).toBe(opened.revision);
	});

	it('keeps no more steps than its limit', () => {
		const { studio } = studioWith({ historyLimit: 3 });
		for (let seed = 1; seed <= 6; seed += 1) studio.dispatch({ type: 'design/shuffle', seed });
		let undone = 0;
		while (studio.getSnapshot().history.canUndo) {
			studio.dispatch({ type: 'history/undo' });
			undone += 1;
		}
		expect(undone).toBe(3);
	});

	it('records nothing at a limit of zero', () => {
		const { studio } = studioWith({ historyLimit: 0 });
		studio.dispatch({ type: 'design/shuffle', seed: 1 });
		expect(studio.getSnapshot().history.canUndo).toBe(false);
	});

	it('never makes the mode or the conditions a step, and leaves them where they are on undo', () => {
		const { studio } = studioWithCode();
		studio.dispatch({ type: 'design/shuffle', seed: 3 });
		studio.dispatch({ type: 'mode', mode: 'scan' });
		studio.dispatch({ type: 'conditions', conditions: { sizeMm: 40, distanceMm: 500 } });
		studio.dispatch({ type: 'history/undo' });
		const doc = studio.getSnapshot().document;
		expect(doc.mode).toBe('scan');
		expect(doc.conditions).toEqual({ sizeMm: 40, dpi: null, distanceMm: 500 });
		expect(doc.design).toEqual(defaultDesign());
	});
});

describe('the history value', () => {
	const base: Work = { typeId: 'url', fields: {}, design: defaultDesign() };
	const other: Work = { ...base, fields: { url: 'x' } };

	it('compares work by identity', () => {
		expect(sameWork(base, { ...base })).toBe(true);
		expect(sameWork(base, other)).toBe(false);
		expect(sameWork(base, { ...base, typeId: 'text' })).toBe(false);
		expect(sameWork(base, { ...base, design: defaultDesign() })).toBe(false);
	});

	it('has nothing to undo or redo when empty', () => {
		expect(undo(EMPTY_HISTORY, base)).toBeNull();
		expect(redo(EMPTY_HISTORY, base, 10)).toBeNull();
		expect(cancelGroup(EMPTY_HISTORY)).toBeNull();
	});

	it('coalesces a run, and breakRun ends one', () => {
		let history = recordChange(EMPTY_HISTORY, base, 'k', 10);
		history = recordChange(history, other, 'k', 10);
		expect(history.past).toHaveLength(1);
		expect(breakRun(history).coalescing).toBeNull();
		expect(breakRun(breakRun(history))).toEqual(breakRun(history));
		history = recordChange(breakRun(history), other, 'k', 10);
		expect(history.past).toHaveLength(2);
	});

	it('clears the future when a coalesced change lands after an undo', () => {
		let history = recordChange(EMPTY_HISTORY, base, 'k', 10);
		history = { ...history, future: [other] };
		expect(recordChange(history, other, 'k', 10).future).toEqual([]);
	});

	it('records nothing inside a group, and a group that changed nothing is no step', () => {
		let history = beginGroup(EMPTY_HISTORY, 'g', base, 10);
		expect(recordChange(history, base, null, 10)).toBe(history);
		history = commitGroup(history, 'g', base, 10);
		expect(history.past).toHaveLength(0);
		expect(history.group).toBeNull();
	});

	it('commits an open group when another opens', () => {
		let history = beginGroup(EMPTY_HISTORY, 'a', base, 10);
		history = beginGroup(history, 'b', other, 10);
		expect(history.past).toEqual([base]);
		expect(history.group?.key).toBe('b');
	});
});
