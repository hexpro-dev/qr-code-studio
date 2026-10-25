import { describe, expect, it } from 'vitest';
import {
	ArchiveMalformedError,
	ArchiveTooLargeError,
	CancelledError,
	ERROR_CODES,
	QrStudioError,
	RsDecodeError,
	TooMuchDataError,
	UnknownEntryError,
	isQrStudioError,
} from '../../src/core/errors.js';

describe('the error codes', () => {
	it('are unique', () => {
		expect(new Set(ERROR_CODES).size).toBe(ERROR_CODES.length);
	});

	it('are written area/detail, lowercase', () => {
		// The website maps each code to a translation key by rewriting the slash,
		// so a code that broke the shape would map to a key nobody wrote.
		for (const code of ERROR_CODES) {
			expect(code, code).toMatch(/^(?:[a-z]+(?:-[a-z]+)*\/[a-z]+(?:-[a-z]+)*|cancelled)$/);
		}
	});
});

describe('QrStudioError', () => {
	it('carries its code, params and the name of the class that was built', () => {
		const error = new TooMuchDataError(4000, 2953 * 8);
		expect(error).toBeInstanceOf(QrStudioError);
		expect(error).toBeInstanceOf(Error);
		expect(error.code).toBe('encode/too-much-data');
		expect(error.name).toBe('TooMuchDataError');
		expect(error.params).toEqual({ bitsNeeded: 4000, bitsAvailable: 23624 });
		expect(error.bitsNeeded).toBe(4000);
		expect(error.bitsAvailable).toBe(23624);
	});

	it('defaults params to an empty object and keeps a cause', () => {
		const cause = new Error('underneath');
		const error = new QrStudioError('decode/unreadable', 'That could not be read.', undefined, {
			cause,
		});
		expect(error.params).toEqual({});
		expect(error.cause).toBe(cause);
		expect(error.name).toBe('QrStudioError');
	});

	it('says cancellation plainly', () => {
		const error = new CancelledError();
		expect(error.code).toBe('cancelled');
		expect(error.message).toMatch(/stopped/);
	});

	it('is recognised by the guard and nothing else is', () => {
		expect(isQrStudioError(new CancelledError())).toBe(true);
		expect(isQrStudioError(new Error('no'))).toBe(false);
		expect(isQrStudioError({ code: 'cancelled' })).toBe(false);
		expect(isQrStudioError(undefined)).toBe(false);
	});

	it('writes messages without a dash, a curly quote or a template hole', () => {
		for (const error of [
			new CancelledError(),
			new TooMuchDataError(1, 1),
			new RsDecodeError('no-solution'),
			new ArchiveMalformedError('deflate'),
			new ArchiveTooLargeError(10),
			new UnknownEntryError('module-shape', 'rounded'),
		]) {
			expect(error.message).not.toMatch(/[–—‘’“”]/);
			expect(error.message).not.toContain('${');
			expect(error.message).toMatch(/^[A-Z].*\.$/);
		}
	});
});

describe('the core subclasses', () => {
	it('carry the codes and params their callers rely on', () => {
		const rs = new RsDecodeError('over-limit');
		expect(rs.code).toBe('decode/unreadable');
		expect(rs.params).toEqual({ stage: 'reed-solomon' });
		expect(rs.reason).toBe('over-limit');
		expect(rs.name).toBe('RsDecodeError');

		const malformed = new ArchiveMalformedError('zlib');
		expect(malformed.code).toBe('archive/malformed');
		expect(malformed.params).toEqual({ format: 'zlib' });

		const tooLarge = new ArchiveTooLargeError(65535, 'entries');
		expect(tooLarge.code).toBe('archive/too-large');
		expect(tooLarge.params).toEqual({ limit: 65535, unit: 'entries' });
		expect(tooLarge.limit).toBe(65535);
		expect(new ArchiveTooLargeError(1024).params).toEqual({ limit: 1024, unit: 'bytes' });

		const unknown = new UnknownEntryError('module-shape', 'rounded');
		expect(unknown.code).toBe('design/unknown-entry');
		expect(unknown.params).toEqual({ kind: 'module-shape', id: 'rounded' });
	});

	it('keep registry identifiers out of the sentence a person reads', () => {
		// The website words this in seven languages from the params; the message
		// is the offline app's, and an identifier in it would read as noise.
		const error = new UnknownEntryError('module-shape', 'rounded-heavy');
		expect(error.message).not.toContain('rounded-heavy');
		expect(error.message).not.toContain('module-shape');
	});
});
