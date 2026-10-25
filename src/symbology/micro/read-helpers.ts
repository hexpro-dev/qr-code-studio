/**
 * What reading a sampled matrix needs from every small symbology: the
 * refusal it throws, the erasure map checked and mirrored with the matrix, and
 * the second attempt at a reflection.
 */

import { BitMatrix, QrStudioError } from '../../core/index.js';

/**
 * Why a grid was refused before its codewords were read. 'size' and
 * 'mismatch' are both stage 'version', as in the QR reader: the grid is not
 * a size this symbology comes in, or its format names a different version
 * from its size.
 */
export type Refusal = 'size' | 'mismatch' | 'format';

const SENTENCES: Readonly<Record<Refusal, string>> = Object.freeze({
	size: 'This grid is not a size this kind of code comes in.',
	mismatch: 'The size of this code and the version it says it is do not match.',
	format: 'The part of this code that says how it was made is too damaged to read.',
});

/** A sampled matrix that is not this symbology, or not legibly. */
export function unreadable(why: Refusal): QrStudioError {
	return new QrStudioError('decode/unreadable', SENTENCES[why], {
		stage: why === 'format' ? 'format' : 'version',
	});
}

/** Throws TypeError for options that are not `{ strict: boolean, erasures? }` over this matrix. */
export function checkReadOptions(
	matrix: BitMatrix,
	options: { readonly strict: boolean; readonly erasures?: Uint8Array },
): void {
	if (!(matrix instanceof BitMatrix)) throw new TypeError('read takes a BitMatrix');
	if (typeof options?.strict !== 'boolean') throw new TypeError('read needs { strict: boolean }');
	checkErasures(matrix, options.erasures);
}

/** Throws TypeError unless `erasures` has one entry per module: a caller's mistake, not damage. */
function checkErasures(matrix: BitMatrix, erasures: Uint8Array | undefined): void {
	if (erasures === undefined) return;
	if (!(erasures instanceof Uint8Array) || erasures.length !== matrix.width * matrix.height) {
		throw new TypeError('erasures is a Uint8Array with one entry per module of the matrix');
	}
}

/** The erasure map moved the same way `BitMatrix.mirrored` moves the modules. */
function mirrorErasures(matrix: BitMatrix, erasures: Uint8Array): Uint8Array {
	const flags = new BitMatrix(
		matrix.width,
		matrix.height,
		erasures.map((value) => (value === 0 ? 0 : 1)),
	);
	return flags.mirrored().data;
}

/**
 * Read as sampled and, when that fails and the reading is lenient, as a
 * reflection. A symbol printed on film and read from the back, or a phone's
 * front camera, gives a mirror image, and once sampled a reflected symbol is
 * exactly `matrix.mirrored()` of a readable one. A strict reading never
 * tries it: the scan check must not pass a symbol on the strength of a
 * reflection phone readers do not attempt. The first failure is the one
 * reported, since it describes the symbol as it was given.
 */
export function readEitherWay<T>(
	matrix: BitMatrix,
	strict: boolean,
	erasures: Uint8Array | undefined,
	once: (matrix: BitMatrix, erasures: Uint8Array | undefined, mirrored: boolean) => T,
): T {
	try {
		return once(matrix, erasures, false);
	} catch (error) {
		if (strict || !(error instanceof QrStudioError)) throw error;
		try {
			return once(
				matrix.mirrored(),
				erasures === undefined ? undefined : mirrorErasures(matrix, erasures),
				true,
			);
		} catch (second) {
			// A bug on the second attempt must not hide behind the first refusal.
			if (!(second instanceof QrStudioError)) throw second;
			throw error;
		}
	}
}
