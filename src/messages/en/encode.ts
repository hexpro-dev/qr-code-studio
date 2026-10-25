/**
 * English sentences for the encode layer: why content could not be made into
 * a code.
 *
 * An encoding failure is a QrStudioError. 'encode/too-much-data' has one
 * sentence; the others are found by the param that says why:
 * `encode.unsupported-feature.<feature>` (params.feature) and
 * `encode.unsupported-content.<reason>` (params.reason).
 * `tests/encode/messages.test.ts` provokes every one of them and fails on a
 * key missing here.
 */

export const ENCODE_MESSAGES: Readonly<Record<string, string>> = Object.freeze({
	'encode.too-much-data':
		'That is too much to fit in one code at these settings. Shorten it, lower the error correction, or allow a larger code.',
	'encode.unsupported-feature.eci':
		'This kind of code cannot say which character set it uses. Choose a QR code, or turn that option off.',
	'encode.unsupported-feature.fnc1': 'This kind of code cannot carry GS1 data. Choose a QR code.',
	'encode.unsupported-feature.structured-append':
		'This kind of code cannot be split across several codes. Choose a QR code.',
	'encode.unsupported-content.lone-surrogate':
		'This text has a broken character in it and cannot be put into a code as it is.',
	'encode.unsupported-content.mode':
		'This code size cannot hold some of these characters. Choose a larger kind of code.',
});
