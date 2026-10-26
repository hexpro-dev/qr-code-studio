/**
 * A sentence as a person can be shown it, for the house style checks: as
 * written when it reads no param, and otherwise with every param at 0, at 1
 * and at 2, so each branch of a plural block is checked as the sentence it
 * becomes, a block that starts the sentence included.
 */

import { formatMessage, messageArguments } from '../../src/messages/format.js';

export function shownForms(sentence: string): readonly string[] {
	const names = messageArguments(sentence);
	if (names.length === 0) return [sentence];
	return [0, 1, 2].map((n) =>
		formatMessage(sentence, Object.fromEntries(names.map((name) => [name, n]))),
	);
}
