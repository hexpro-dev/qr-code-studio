/**
 * The one way a font file is refused.
 *
 * A font reaches the parser from a file somebody chose on the website, so
 * anything in it can be wrong: a table that runs past the end, an offset that
 * points back into itself, a glyph that is its own component. Every one of
 * those is the same thing to the person who chose the file, so there is one
 * error, and the params say which table and which check refused it for the
 * developer reading a log. Neither is content: they are facts about the
 * file's structure.
 */

import { QrStudioError } from '../core/errors.js';

/** Which check refused the file. Kept short and closed so a log can be grouped by it. */
export type FontFailure =
	/** A read went past the end of the file or of a table. */
	| 'truncated'
	/** A table the outlines cannot do without is not there. */
	| 'missing-table'
	/** A value is outside the range the format allows. */
	| 'out-of-range'
	/** A list the format requires in order is not in order. */
	| 'unsorted'
	/** A format or version this reader does not know. */
	| 'unsupported'
	/** More of something than this reader will spend time on. */
	| 'too-large';

export class FontMalformedError extends QrStudioError {
	readonly table: string;
	readonly reason: FontFailure;

	constructor(table: string, reason: FontFailure) {
		super(
			'font/malformed',
			'This font file is damaged, or is not a TrueType font this tool can read.',
			{ table, reason },
		);
		this.table = table;
		this.reason = reason;
	}
}

/** Throw the error for `table`. Returns never, so a check can sit in an expression. */
export function malformed(table: string, reason: FontFailure): never {
	throw new FontMalformedError(table, reason);
}
