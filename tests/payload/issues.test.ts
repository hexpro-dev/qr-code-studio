import { describe, expect, it } from 'vitest';
import { hasErrors } from '../../src/core/issue.js';
import { createPayloadRegistry } from '../../src/payload/registry.js';
import { ISSUE_CASES, VALID } from './cases.js';

const registry = createPayloadRegistry();

describe('each type validates its valid example cleanly', () => {
	for (const [id, value] of Object.entries(VALID)) {
		it(id, () => {
			const issues = registry.require(id).validate(value);
			expect(hasErrors(issues), JSON.stringify(issues)).toBe(false);
		});
	}
});

describe('each specification rule reports its issue', () => {
	for (const [id, change, expected] of ISSUE_CASES) {
		it(`${id}: ${JSON.stringify(change).slice(0, 80)}`, () => {
			const value = { ...VALID[id], ...change };
			const codes = registry
				.require(id)
				.validate(value as never)
				.map((found) => found.code);
			for (const code of new Set(expected)) {
				expect(codes.filter((c) => c === code).length, `${code} in ${JSON.stringify(codes)}`).toBe(
					expected.filter((c) => c === code).length,
				);
			}
		});
	}
});

describe('every issue carries numbers rather than the value', () => {
	it('never repeats the offending text in params', () => {
		for (const [id, change] of ISSUE_CASES) {
			const value = { ...VALID[id], ...change };
			for (const found of registry.require(id).validate(value as never)) {
				for (const param of Object.values(found.params ?? {})) {
					for (const field of Object.values(change)) {
						if (typeof field === 'string' && field.length > 3)
							expect(String(param)).not.toContain(field);
					}
				}
			}
		}
	});
});
