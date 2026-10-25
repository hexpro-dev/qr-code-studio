import { describe, expect, it } from 'vitest';
import { hasErrors, issue } from '../../src/core/issue.js';

describe('issue', () => {
	it('defaults to an error with no params', () => {
		expect(issue('payload.wifi.ssid-missing', ['fields', 'ssid'])).toEqual({
			code: 'payload.wifi.ssid-missing',
			path: ['fields', 'ssid'],
			severity: 'error',
		});
	});

	it('keeps params when given', () => {
		expect(
			issue('payload.wifi.password-long', ['fields', 'password'], 'warning', { limit: 63 }),
		).toEqual({
			code: 'payload.wifi.password-long',
			path: ['fields', 'password'],
			severity: 'warning',
			params: { limit: 63 },
		});
	});
});

describe('hasErrors', () => {
	it('counts errors and ignores warnings and notes', () => {
		expect(hasErrors([])).toBe(false);
		expect(hasErrors([issue('a.b', [], 'warning'), issue('a.c', [], 'info')])).toBe(false);
		expect(hasErrors([issue('a.b', [], 'warning'), issue('a.c', [])])).toBe(true);
	});
});
