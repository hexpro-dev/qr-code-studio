import { describe, expect, it } from 'vitest';
import { CancelledError } from '../../src/core/errors.js';
import { attempt, attemptAsync, err, ok, unwrap } from '../../src/core/result.js';

describe('Result', () => {
	it('builds both arms', () => {
		expect(ok(3)).toEqual({ ok: true, value: 3 });
		const error = new CancelledError();
		expect(err(error)).toEqual({ ok: false, error });
	});

	it('unwraps a success and rethrows a failure', () => {
		expect(unwrap(ok('x'))).toBe('x');
		const error = new CancelledError();
		expect(() => unwrap(err(error))).toThrow(error);
	});
});

describe('attempt', () => {
	it('wraps a value and a package error', () => {
		expect(attempt(() => 5)).toEqual({ ok: true, value: 5 });
		const error = new CancelledError();
		expect(
			attempt(() => {
				throw error;
			}),
		).toEqual({ ok: false, error });
	});

	it('rethrows anything that is not a package error', () => {
		// A TypeError is a bug in the caller, and a Result would hide it.
		expect(() =>
			attempt(() => {
				throw new TypeError('wrong');
			}),
		).toThrow(TypeError);
	});
});

describe('attemptAsync', () => {
	it('wraps a resolved value and a package error', async () => {
		await expect(attemptAsync(async () => 7)).resolves.toEqual({ ok: true, value: 7 });
		const error = new CancelledError();
		await expect(
			attemptAsync(async () => {
				throw error;
			}),
		).resolves.toEqual({ ok: false, error });
	});

	it('rethrows anything that is not a package error', async () => {
		await expect(
			attemptAsync(async () => {
				throw new RangeError('wrong');
			}),
		).rejects.toThrow(RangeError);
	});
});
