/**
 * The English sentences behind every message key rMQR hands to a view.
 *
 * The keys are `RMQR_MESSAGE_KEYS` in src/symbology/rmqr/entry.ts, and
 * tests/symbology/rmqr/messages.test.ts fails on a key used there that has no
 * sentence here. The website keeps its own catalogue in seven languages.
 */

export const RMQR_MESSAGES: Readonly<Record<string, string>> = Object.freeze({
	'symbology.rmqr.label': 'Rectangular Micro QR',
	'symbology.rmqr.not-phone-readable':
		'Most phone cameras cannot read rectangular Micro QR codes. Use one only where you know the scanner that will read it supports rMQR, and test it with that scanner before printing.',
});
