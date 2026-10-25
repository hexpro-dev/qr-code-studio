/**
 * English for every message key the reader emits: why a picture gave no code.
 *
 * Keys come from `decodeFailureKey` in `src/decode/failure.ts`, by the
 * failure's code and the furthest stage it reached. None of these says
 * anything about the content, which the reader never puts in an error.
 */

export const DECODE_MESSAGES: Readonly<Record<string, string>> = Object.freeze({
	'decode.not-found': 'No code was found in this picture.',
	'decode.not-found.geometry':
		'Part of a code may be here, but no whole code could be found. Make sure all of it is in the picture, with some space around it.',
	'decode.unreadable': 'A code was found here, but it could not be read.',
	'decode.unreadable.format':
		'A code was found here, but the part that says how it was made could not be read.',
	'decode.unreadable.version':
		'A code was found here, but its size could not be worked out. Try a sharper or straighter picture.',
	'decode.unreadable.reed-solomon':
		'A code was found here, but too much of it is damaged or unclear to read, even with its error correction.',
	'decode.unreadable.segments':
		'A code was found here, but it was not made correctly, so what it holds cannot be read.',
	'decode.unreadable.margin':
		'This code reads here, but without enough to spare for every phone. The picture may be too coarse, taken at too steep an angle, smeared by a moving camera, or too noisy or washed out in places. The corner squares may be dotted, or too round or too cut away at the corners for some phones to follow. Or something else in the picture may look like them.',
	'decode.unsupported': 'This code uses a feature this tool cannot read.',
	'decode.unsupported.eci': 'This code uses a character set this tool cannot read.',
	'decode.unsupported.kanji':
		'This code holds Japanese text, and this browser cannot read the character set it uses.',
});
