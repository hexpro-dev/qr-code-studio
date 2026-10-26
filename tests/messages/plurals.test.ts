/**
 * No sentence reads "1 squares". Where a count before a plural noun can be
 * 1, the sentence chooses its words with a plural block; where it cannot, it
 * is listed here with the reason, so a new sentence of that shape is a
 * decision someone wrote down rather than a translator's bug report.
 */

import { describe, expect, it } from 'vitest';
import { EN_MESSAGES, message } from '../../src/messages/en/index.js';
import { formatMessage, messageArguments } from '../../src/messages/format.js';

/** Counts written before a plural noun with no block, because they are never 1: why, by key. */
const NEVER_ONE: Readonly<Record<string, string>> = {
	'app.capacity.value': "a symbol's capacity, 20 bits or more",
	'app.frame.caption-hint': "a frame's caption limit, 20 characters or more",
	'app.scan.found-many': 'two codes or more; one has app.scan.found-one',
	'batch.csv.long-row': 'more cells than the header, which has one at least',
	'design.issue.quiet-zone-small': "a symbology's minimum margin, 2 or 4 modules",
	'design.issue.asset-too-large': 'a fixed limit, 512 KiB',
	'design.issue.too-many-assets': 'a fixed limit, 4 images',
	'design.issue.too-long': 'over a limit of 20 characters or more',
	'design.issue.too-many-lines': 'more lines than the frame holds, which is one at least',
	'dom.issue.logo-downscaled': 'width by height, which reads the same at any size',
	'dom.library.issue.too-large': 'a fixed limit in bytes',
	'dom.library.issue.too-many': 'more entries than a fixed limit',
	'payload.issue.too-long': "over a field's limit",
	'payload.issue.iban-length': 'measured only once a country and check digits are there, 5 or more',
	'payload.safety.url.very-long': 'only over a long threshold',
	'payload.wifi.issue.ssid-too-long': 'over 32 bytes',
	'payload.epc.issue.too-long': 'over a fixed limit',
	'payload.swiss-qr-bill.issue.bytes': 'over a fixed limit',
	'payload.swiss-qr-bill.issue.message-too-long': 'over a fixed limit',
	'payload.swiss-qr-bill.issue.too-long': 'over a fixed limit',
	'payload.pix.issue.account-too-long': 'over a fixed limit',
	'studio.issue.raw-too-long': 'over 16384 characters',
	'studio.issue.quiet-zone-below-minimum': "a symbology's minimum margin, 2 or 4 modules",
	'verify.check.quiet-zone.pass': "at the symbology's minimum or more, 2 squares at least",
	'verify.check.quiet-zone.fail': 'the minimum after the block, 2 or 4 squares',
	'verify.fix.widen-quiet-zone': "the symbology's minimum or more, 2 squares at least",
};

/** "1 squares", "1 more rows": a count of 1 before a word ending in s, verbs aside. */
const ONE_BEFORE_PLURAL = /\b1 (?:more )?(?!(?:has|is|mixes|needs)\b)[a-z]+s\b/;

function withOnes(sentence: string): string {
	return formatMessage(
		sentence,
		Object.fromEntries(messageArguments(sentence).map((name) => [name, 1])),
	);
}

describe('counts in the English catalogue', () => {
	it('read in the singular at 1, or are listed as never 1', () => {
		const found = Object.entries(EN_MESSAGES)
			.filter(([, sentence]) => ONE_BEFORE_PLURAL.test(withOnes(sentence)))
			.map(([key]) => key)
			.sort();
		expect(found).toEqual(Object.keys(NEVER_ONE).sort());
	});

	it('choose their words with a block where the count can be 1', () => {
		expect(message('app.bulk.make', { count: 1 })).toBe('Make 1 code');
		expect(message('app.bulk.make', { count: 3 })).toBe('Make 3 codes');
		expect(message('verify.check.quiet-zone.fail', { modules: 0, minimum: 4 })).toBe(
			'There is no clear margin round the code. Readers need one at least 4 squares wide, with nothing printed in it.',
		);
		expect(message('verify.check.quiet-zone.fail', { modules: 1, minimum: 4 })).toMatch(
			/^The clear margin round the code is only 1 square wide\./,
		);
		expect(message('inspect.set.complete', { total: 1 })).toBe(
			'The one part of this set was found and read.',
		);
		expect(message('design.issue.caption-missing-glyphs', { count: 1 })).toMatch(
			/one of the characters in the caption, so it was left out\./,
		);
	});
});
