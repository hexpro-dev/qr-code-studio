/**
 * The result type used by every attempt-shaped operation in this package.
 *
 * The rule, which is the same one the sibling packages use: pure parsers and
 * programmer-error guards throw, and attempt-shaped operations return a
 * `Result`. Reading a QR code from a camera frame is attempt-shaped and fails
 * thirty times a second while somebody lines the phone up, so it must not
 * allocate a stack trace to say "not yet". Discovering that a ZIP entry claims
 * a length of four gigabytes is a parse failure and throws.
 */

import { QrStudioError } from './errors.js';

export type Result<T, E = QrStudioError> =
	{ readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };

export function ok<T>(value: T): Result<T, never> {
	return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
	return { ok: false, error };
}

/** Unwrap or rethrow. For callers that would rather have the exception. */
export function unwrap<T>(result: Result<T, QrStudioError>): T {
	if (result.ok) return result.value;
	throw result.error;
}

/**
 * Run `fn` and convert a thrown `QrStudioError` into a failed result.
 *
 * Anything that is not a `QrStudioError` is rethrown rather than wrapped. A
 * `TypeError` from calling this wrongly is a bug in the caller, and swallowing
 * it into a `Result` would hide it behind a message about QR codes.
 */
export function attempt<T>(fn: () => T): Result<T, QrStudioError> {
	try {
		return ok(fn());
	} catch (error) {
		if (error instanceof QrStudioError) return err(error);
		throw error;
	}
}

/** `attempt` for work that awaits. */
export async function attemptAsync<T>(fn: () => T | Promise<T>): Promise<Result<T, QrStudioError>> {
	try {
		return ok(await fn());
	} catch (error) {
		if (error instanceof QrStudioError) return err(error);
		throw error;
	}
}
