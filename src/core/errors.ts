/**
 * The error taxonomy.
 *
 * One base class carrying a code from a closed union, and a message written
 * to be shown to a person as it is. The website maps `code` to a translated
 * sentence and never prints `message`; the offline app prints `message`
 * directly, because it has no translation layer. Both have to be true at once,
 * so messages are written in the same plain register as the site copy.
 *
 * No message ever interpolates content. A QR code holds Wi-Fi passwords, phone
 * numbers, IBANs and links to private documents, and an error message is the
 * one string that gets screenshot and pasted into a bug report. Numbers about
 * the content (its length, a row and column in a CSV) are fine; the content is
 * not. `tests/core/errors.test.ts` constructs every subclass with recognisable
 * content and checks none of it reaches the message.
 *
 * Validation problems are not errors. A form with three bad fields is data,
 * reported as `Issue` values (see `issue.ts`), so a caller can show all three
 * at once rather than the first one thrown.
 *
 * The rule, the same one the sibling packages use: pure parsers and
 * programmer-error guards throw, attempt-shaped operations return a `Result`.
 * A mistake by the caller, such as an option of the wrong type, throws a plain
 * `TypeError` rather than one of these, because it is a bug to fix rather than
 * a situation to explain to somebody holding a phone.
 */

/**
 * Every code, in declaration order. The union below is derived from this list,
 * so the two cannot disagree, and a website that maps codes to translations can
 * enumerate them.
 */
export const ERROR_CODES = [
	'encode/too-much-data',
	'encode/unsupported-content',
	'encode/unsupported-feature',
	'design/invalid',
	'design/unsupported-schema',
	'design/unknown-entry',
	'payload/invalid',
	'payload/unparseable',
	'decode/not-found',
	'decode/unreadable',
	'decode/unsupported',
	'decode/incomplete-set',
	'decode/conflicting-set',
	'image/unreadable',
	'image/too-large',
	'font/malformed',
	'font/missing-glyphs',
	'render/surface-too-large',
	'render/format-unavailable',
	'archive/too-large',
	'archive/malformed',
	'batch/malformed-csv',
	'batch/too-many-rows',
	'batch/unknown-column',
	'library/unavailable',
	'library/not-enabled',
	'library/quota',
	'library/corrupt',
	'camera/permission-denied',
	'camera/unavailable',
	'camera/in-use',
	'camera/insecure-context',
	'verify/missing-entry',
	'platform/unavailable',
	'cancelled',
] as const;

export type QrStudioErrorCode = (typeof ERROR_CODES)[number];

/** Numbers about a failure that a caller may show or translate. Never content. */
export type ErrorParams = Readonly<Record<string, number | string>>;

export class QrStudioError extends Error {
	readonly code: QrStudioErrorCode;
	/**
	 * Facts a translated message can be built from: lengths, limits, positions,
	 * identifiers of registry entries. Never a field value, never decoded text.
	 */
	readonly params: ErrorParams;

	constructor(
		code: QrStudioErrorCode,
		message: string,
		params: ErrorParams = {},
		options?: ErrorOptions,
	) {
		super(message, options);
		this.code = code;
		this.params = params;
		// Set from the constructed class rather than repeated in each subclass.
		this.name = new.target.name;
	}
}

export function isQrStudioError(value: unknown): value is QrStudioError {
	return value instanceof QrStudioError;
}

/** The operation was stopped by its caller, through an AbortSignal or a newer request. */
export class CancelledError extends QrStudioError {
	constructor() {
		super('cancelled', 'That was stopped before it finished.');
	}
}

/**
 * The content does not fit in any symbol the caller allowed.
 *
 * Carries the numbers a person needs to decide what to do: how many bits the
 * content needs and how many the largest permitted symbol holds. The content
 * itself is not here.
 */
export class TooMuchDataError extends QrStudioError {
	readonly bitsNeeded: number;
	readonly bitsAvailable: number;

	constructor(bitsNeeded: number, bitsAvailable: number) {
		super(
			'encode/too-much-data',
			'That is too much to fit in one code at these settings. Shorten it, lower the error correction, or allow a larger code.',
			{ bitsNeeded, bitsAvailable },
		);
		this.bitsNeeded = bitsNeeded;
		this.bitsAvailable = bitsAvailable;
	}
}

/**
 * Why a Reed-Solomon block was refused. Kept on the error rather than in its
 * params, because the website translates the code and the reason is for a
 * developer reading a log: every one of them means the same thing to the
 * person holding the phone.
 */
export type RsFailure =
	/** More positions were flagged as erasures than the block has check symbols. */
	| 'too-many-erasures'
	/** The error locator needs more errors than the check symbols can pay for. */
	| 'too-many-errors'
	/** Within the code's reach, but past the `maxErrors` the caller allowed. */
	| 'over-limit'
	/** The algebra did not close: no consistent set of positions and values exists. */
	| 'no-solution';

/**
 * A Reed-Solomon block is damaged past what its check symbols can repair, or
 * the repair did not survive its own check.
 *
 * This is the outcome a reader most needs to get right. A block that is
 * refused costs one more camera frame; a block that is "corrected" into a
 * different, valid-looking codeword is a wrong Wi-Fi password or a wrong link,
 * delivered with confidence.
 */
export class RsDecodeError extends QrStudioError {
	readonly reason: RsFailure;

	constructor(reason: RsFailure) {
		super(
			'decode/unreadable',
			'Part of this code is too damaged to read, even with its error correction.',
			{ stage: 'reed-solomon' },
		);
		this.reason = reason;
	}
}

/**
 * A compressed stream or an archive does not follow its format.
 *
 * `format` says which layer refused it ('deflate' for the compressed data
 * itself, 'zlib' for the wrapper around it), which is a fact about the file and
 * not its content.
 */
export class ArchiveMalformedError extends QrStudioError {
	constructor(format: 'deflate' | 'zlib') {
		super('archive/malformed', 'This file is damaged and cannot be opened.', { format });
	}
}

/**
 * A compressed stream unpacks to more than the caller allowed, or an archive
 * being written would pass a limit of its format.
 *
 * The limit is checked before the memory is asked for, so a file built to
 * expand to gigabytes is refused at the size it claims rather than at the
 * size it reaches.
 */
export class ArchiveTooLargeError extends QrStudioError {
	readonly limit: number;

	constructor(limit: number, unit: 'bytes' | 'entries' = 'bytes') {
		super('archive/too-large', 'This is larger than this tool will handle in one go.', {
			limit,
			unit,
		});
		this.limit = limit;
	}
}

/**
 * A design, job or setting names a registry entry this copy does not have.
 *
 * `kind` and `id` are registry identifiers (kebab-case names of built-in
 * styles and content types), not anything a person typed, so they are safe to
 * carry in params. They are still kept out of the message, which a person
 * reads, because the website words this in their language.
 */
export class UnknownEntryError extends QrStudioError {
	constructor(kind: string, id: string) {
		super(
			'design/unknown-entry',
			'This refers to something this version of the studio does not include.',
			{ kind, id },
		);
	}
}
