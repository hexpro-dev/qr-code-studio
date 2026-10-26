/**
 * The house register, checked over a message catalogue: no en or em dashes,
 * no curly quotes, none of the marketing words, a sentence or a label, and
 * keys that are dotted lowercase.
 */

import { expect } from 'vitest';
import { shownForms } from '../messages/forms.js';

export function checkRegister(sentences: Readonly<Record<string, string>>): void {
	for (const [key, sentence] of Object.entries(sentences)) {
		expect(sentence, key).not.toMatch(/[\u2013\u2014\u2018\u2019\u201c\u201d]/);
		expect(sentence, key).not.toMatch(/\b(unlock|seamless|robust|empower|effortless|leverage)/i);
		// Each plural branch as a person reads it.
		for (const shown of shownForms(sentence)) {
			expect(shown, key).toMatch(/^[A-Z].*[.]$|^[A-Z][A-Za-z ]+$/);
		}
		expect(key, key).toMatch(/^[a-z0-9-]+(\.[a-z0-9-]+)+$/);
	}
}
