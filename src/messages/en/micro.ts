/**
 * The English sentences behind every message key Micro QR hands to a view.
 *
 * The keys are `MICRO_MESSAGE_KEYS` in src/symbology/micro/entry.ts, and
 * tests/symbology/micro/messages.test.ts fails on a key used there that has
 * no sentence here. The website keeps its own catalogue in seven languages.
 */

export const MICRO_MESSAGES: Readonly<Record<string, string>> = Object.freeze({
	'symbology.micro.label': 'Micro QR',
	'symbology.micro.not-phone-readable':
		'Most phone cameras cannot read Micro QR codes. Use one only where you know the scanner that will read it supports Micro QR, and test it with that scanner before printing.',
	'symbology.micro.detection-only':
		'The smallest size, M1, can tell when it has been damaged but cannot repair any of the damage.',
});
