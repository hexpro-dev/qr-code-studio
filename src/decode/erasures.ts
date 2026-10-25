/**
 * Uncertain modules as Reed-Solomon erasures.
 *
 * An error costs a block two of its check symbols, one to find it and one to
 * fix it; an erasure, a codeword already known to be unreliable, costs one.
 * So a reader that knows which modules it could not see clearly, under a
 * mid-grey logo or past the edge of the picture, repairs up to twice as much
 * of them. It only pays when the flags are mostly right: a codeword flagged
 * that was read correctly costs one where it would have cost nothing, which
 * is why the lenient reader tries with erasures and then without.
 *
 * The symbology's `read` takes the flags per module and marks a codeword
 * erased when any of its modules is flagged. This picks the modules: uncertain
 * ones, and only those the layout maps to a codeword, through `dataBits`.
 */

import type { SymbolLayout } from '../symbology/types.js';
import type { SampledGrid } from './sample.js';

export interface ErasureFlags {
	/** One byte per module, row major, 1 on an uncertain data module. */
	readonly flags: Uint8Array;
	/** How many distinct codewords those modules belong to. */
	readonly codewords: number;
}

/** The flags for a grid, or null when no data module is uncertain and there is nothing to try. */
export function erasureFlags(grid: SampledGrid, layout: SymbolLayout): ErasureFlags | null {
	const { uncertain } = grid;
	if (uncertain.length !== layout.dataBits.length) return null;
	const flags = new Uint8Array(uncertain.length);
	const codewords = new Set<number>();
	for (let i = 0; i < uncertain.length; i += 1) {
		if (uncertain[i] === 0) continue;
		const bit = layout.dataBits[i] as number;
		if (bit < 0) continue;
		flags[i] = 1;
		codewords.add(bit >> 3);
	}
	return codewords.size === 0 ? null : { flags, codewords: codewords.size };
}
