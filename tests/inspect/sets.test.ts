/**
 * Structured append sets put back together from their parts, in every
 * order, with parts missing, repeated or from two printings mixed up.
 */

import { describe, expect, it } from 'vitest';
import { encodeStructuredAppend } from '../../src/encode/structured-append.js';
import { assembleSets } from '../../src/inspect/sets.js';
import type { SetPart } from '../../src/inspect/sets.js';
import { registries } from './helpers.js';

function partsOf(message: string, maxVersion = '3'): SetPart[] {
	return encodeStructuredAppend(message, { maxVersion }).map((symbol) => {
		const read = registries.symbologies.require('qr').read(symbol.matrix, { strict: true });
		const header = read.bitstream.structuredAppend as {
			index: number;
			total: number;
			parity: number;
		};
		return { ...header, text: read.bitstream.text, bytes: read.bitstream.bytes };
	});
}

function permutations<T>(items: readonly T[]): T[][] {
	if (items.length <= 1) return [[...items]];
	return items.flatMap((item, i) =>
		permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [item, ...rest]),
	);
}

const MESSAGE = `Example set: ${'日本 '.repeat(10)}${'parts '.repeat(12)}end`;

describe('assembleSets', () => {
	const parts = partsOf(MESSAGE);

	it('makes a test set of four or more', () => {
		expect(parts.length).toBeGreaterThanOrEqual(4);
	});

	it('joins the parts in index order whatever order they arrive in', () => {
		const four = parts.slice(0, 4);
		const total = parts.length;
		for (const order of permutations(parts.length === 4 ? four : parts.slice(0, 4))) {
			const sets = assembleSets(total === 4 ? order : [...order, ...parts.slice(4)]);
			expect(sets).toHaveLength(1);
			expect(sets[0]).toEqual({
				parity: parts[0]?.parity,
				total,
				complete: true,
				text: MESSAGE,
				missing: [],
				parityMatches: true,
			});
		}
	});

	it('lists the parts not found', () => {
		const [set] = assembleSets([parts[3] as SetPart, parts[1] as SetPart]);
		expect(set).toMatchObject({ complete: false, text: null, parityMatches: null });
		expect(set?.missing).toEqual([
			0,
			2,
			...Array.from({ length: parts.length - 4 }, (_, i) => i + 4),
		]);
	});

	it('counts a part seen twice once, and refuses one that differs', () => {
		expect(assembleSets([...parts, parts[0] as SetPart])[0]?.complete).toBe(true);
		const changed = { ...(parts[0] as SetPart), bytes: Uint8Array.from([1, 2, 3]) };
		const [clash] = assembleSets([...parts, changed]);
		expect(clash).toMatchObject({ complete: false, text: null, parityMatches: false, missing: [] });
	});

	it('refuses parts whose bytes do not add up to the parity they carry', () => {
		const tampered = parts.map((part, i) =>
			i === 1
				? { ...part, bytes: Uint8Array.from(part.bytes, (b, j) => (j === 0 ? b ^ 1 : b)) }
				: part,
		);
		expect(assembleSets(tampered)[0]).toMatchObject({
			complete: false,
			parityMatches: false,
			text: null,
		});
	});

	it('keeps two sets apart', () => {
		const other = partsOf(`Another set entirely, ${'with its own parts '.repeat(8)}`);
		const sets = assembleSets([...other, ...parts]);
		expect(sets).toHaveLength(2);
		expect(sets.map((set) => set.complete)).toEqual([true, true]);
		expect(sets[1]?.text).toBe(MESSAGE);
		expect(assembleSets([])).toEqual([]);
	});
});
