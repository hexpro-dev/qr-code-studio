/**
 * English sentences for the symbology layer: labels, and why a code could not
 * be read.
 *
 * A reading failure is a QrStudioError whose code is 'decode/unreadable' or
 * 'decode/unsupported'. The sentence for it is found by the param that says
 * which step refused: `symbology.read.<stage>` for 'decode/unreadable'
 * (params.stage), `symbology.read.unsupported.<feature>` for
 * 'decode/unsupported' (params.feature). `tests/symbology/qr/messages.test.ts`
 * provokes every one of them and fails on a key missing here.
 */

export const SYMBOLOGY_MESSAGES: Readonly<Record<string, string>> = Object.freeze({
	'symbology.qr.label': 'QR code',
	'symbology.read.version':
		'This code is not a size its kind of code comes in, or it says it is a different version from its size.',
	'symbology.read.format':
		'The part of this code that says how it was made is too damaged to read.',
	'symbology.read.reed-solomon':
		'Part of this code is too damaged to read, even with its error correction.',
	'symbology.read.segments': 'This code was not made correctly, so what it holds cannot be read.',
	'symbology.read.unsupported.eci': 'This code uses a character set this tool cannot read.',
	'symbology.read.unsupported.kanji':
		'This code holds Japanese text, and this browser cannot read the character set it uses.',
});
