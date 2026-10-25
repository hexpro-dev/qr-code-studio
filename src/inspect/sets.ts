/**
 * Putting structured append sets back together (ISO/IEC 18004 8).
 *
 * Each symbol of a set says which part it is, how many parts there are, and
 * the parity of the whole message: the XOR of every byte of it as encoded.
 * Symbols are grouped by parity and count, so two sets photographed together
 * stay apart, and a group is a message only when every part is there and the
 * parts' bytes really XOR to the parity. A part seen twice counts once; a
 * second part at the same index that differs is a sign of two printings
 * mixed up, and the parity check is what catches it.
 *
 * Parts are joined by their text, in index order. The encoder cuts a message
 * between code points, never inside one, so each part's text is whole on its
 * own and the join is the message.
 */

import type { InspectSet } from './types.js';

export interface SetPart {
	readonly index: number;
	readonly total: number;
	readonly parity: number;
	readonly text: string;
	/** The part's bytes as stored, which the parity is taken over. */
	readonly bytes: Uint8Array;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
	return a.length === b.length && a.every((byte, i) => byte === b[i]);
}

/** Every set among `parts`, in the order their first part was seen. */
export function assembleSets(parts: readonly SetPart[]): InspectSet[] {
	const groups = new Map<
		string,
		{ parity: number; total: number; byIndex: Map<number, SetPart>; clash: boolean }
	>();
	for (const part of parts) {
		const key = `${part.parity}/${part.total}`;
		let group = groups.get(key);
		if (group === undefined) {
			group = { parity: part.parity, total: part.total, byIndex: new Map(), clash: false };
			groups.set(key, group);
		}
		const seen = group.byIndex.get(part.index);
		if (seen === undefined) group.byIndex.set(part.index, part);
		else if (!sameBytes(seen.bytes, part.bytes)) group.clash = true;
	}
	const sets: InspectSet[] = [];
	for (const group of groups.values()) {
		const missing: number[] = [];
		for (let i = 0; i < group.total; i += 1) if (!group.byIndex.has(i)) missing.push(i);
		let parityMatches: boolean | null = null;
		let text: string | null = null;
		if (missing.length === 0) {
			let parity = 0;
			for (let i = 0; i < group.total; i += 1) {
				for (const byte of (group.byIndex.get(i) as SetPart).bytes) parity ^= byte;
			}
			parityMatches = parity === group.parity && !group.clash;
			if (parityMatches) {
				text = '';
				for (let i = 0; i < group.total; i += 1) text += (group.byIndex.get(i) as SetPart).text;
			}
		}
		sets.push(
			Object.freeze({
				parity: group.parity,
				total: group.total,
				complete: parityMatches === true,
				text,
				missing: Object.freeze(missing),
				parityMatches,
			}),
		);
	}
	return sets;
}
