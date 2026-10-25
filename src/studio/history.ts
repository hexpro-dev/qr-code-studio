/**
 * Undo and redo, as a pure value.
 *
 * What is undone is the part of the document that is the person's work: the
 * content type, its fields and the design. The mode and the scan conditions
 * are settings about how they are looking at it, so changing them is never a
 * step, and undoing a step leaves them as they are.
 *
 * Three things make a run of changes one step rather than many:
 *
 * - typing into one field: consecutive edits of the same field coalesce, so
 *   undo takes back the word, not the last letter;
 * - a coalesce key on a design patch: consecutive patches with the same key
 *   (a colour picker being dragged) are one step;
 * - an explicit group, `begin` to `commit`, for a slider: every patch in
 *   between is one step, and `cancel` puts the design back as it was at
 *   `begin`, with nothing recorded.
 */

import type { FieldValue } from '../payload/types.js';
import type { QrDesignV1 } from '../design/types.js';

/** The undoable part of a document. */
export interface Work {
	readonly typeId: string;
	readonly fields: Readonly<Record<string, FieldValue>>;
	readonly design: QrDesignV1;
}

export interface History {
	readonly past: readonly Work[];
	readonly future: readonly Work[];
	/** The open group's key and the work as it was when it opened. */
	readonly group: { readonly key: string; readonly base: Work } | null;
	/** The coalesce key of the step at the top of `past`, while it may still grow. */
	readonly coalescing: string | null;
}

export const EMPTY_HISTORY: History = Object.freeze({
	past: Object.freeze([]) as readonly Work[],
	future: Object.freeze([]) as readonly Work[],
	group: null,
	coalescing: null,
});

function trimmed(past: readonly Work[], limit: number): readonly Work[] {
	return past.length > limit ? past.slice(past.length - limit) : past;
}

/**
 * The history after a change from `before`. `coalesce` names a run of
 * changes that make one step together; consecutive changes with the same name
 * record only the first `before`.
 */
export function recordChange(
	history: History,
	before: Work,
	coalesce: string | null,
	limit: number,
): History {
	if (history.group !== null) return history;
	if (coalesce !== null && coalesce === history.coalescing && history.past.length > 0) {
		return history.future.length === 0 ? history : { ...history, future: [] };
	}
	return {
		past: trimmed([...history.past, before], limit),
		future: [],
		group: null,
		coalescing: coalesce,
	};
}

/** Ends any run of coalescing changes, so the next change is a step of its own. */
export function breakRun(history: History): History {
	return history.coalescing === null ? history : { ...history, coalescing: null };
}

/** Opens a group. A group already open under another key is committed first. */
export function beginGroup(history: History, key: string, current: Work, limit: number): History {
	if (history.group?.key === key) return history;
	const closed =
		history.group === null ? history : commitGroup(history, history.group.key, current, limit);
	return { ...closed, group: { key, base: current }, coalescing: null };
}

/** Closes the group as one step, if anything in it changed the work. A key that is not the open group's is ignored. */
export function commitGroup(history: History, key: string, current: Work, limit: number): History {
	const group = history.group;
	if (group === null || group.key !== key) return history;
	if (sameWork(group.base, current)) return { ...history, group: null };
	return {
		past: trimmed([...history.past, group.base], limit),
		future: [],
		group: null,
		coalescing: null,
	};
}

/** Closes the group and says what to restore, or null when no group is open. */
export function cancelGroup(history: History): { history: History; restore: Work } | null {
	if (history.group === null) return null;
	return { history: { ...history, group: null }, restore: history.group.base };
}

export function undo(history: History, current: Work): { history: History; restore: Work } | null {
	const previous = history.past[history.past.length - 1];
	if (previous === undefined) return null;
	return {
		history: {
			past: history.past.slice(0, -1),
			future: [...history.future, current],
			group: null,
			coalescing: null,
		},
		restore: previous,
	};
}

export function redo(
	history: History,
	current: Work,
	limit: number,
): { history: History; restore: Work } | null {
	const next = history.future[history.future.length - 1];
	if (next === undefined) return null;
	return {
		history: {
			past: trimmed([...history.past, current], limit),
			future: history.future.slice(0, -1),
			group: null,
			coalescing: null,
		},
		restore: next,
	};
}

/** Identity is enough: every change makes new objects and an unchanged part keeps its own. */
export function sameWork(a: Work, b: Work): boolean {
	return a.typeId === b.typeId && a.fields === b.fields && a.design === b.design;
}
