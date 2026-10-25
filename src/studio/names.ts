/**
 * The file name an export is saved under.
 *
 * Never the content. A code's file name is the one piece of it that shows in
 * a downloads list, a shared folder and an email attachment, and a name made
 * from a Wi-Fi password or a private link would publish exactly what the code
 * was made to keep. So a name comes from the design's own name, which the
 * person gave it to tell their designs apart, or is the generic
 * `qr-code.<ext>`.
 */

const GENERIC = 'qr-code';
/** Characters kept from a design's name; long enough to tell designs apart. */
const MAX_STEM = 64;

/**
 * A file stem from a design's name: letters and digits of any script, with
 * spaces, hyphens and underscores between them, and nothing a file system or
 * a shell would read as structure.
 */
export function fileStem(name: string | undefined): string {
	if (typeof name !== 'string') return GENERIC;
	const cleaned = name
		.normalize('NFC')
		// Path separators, the characters Windows reserves, controls and
		// punctuation all become a space, so "A/B" is "A B" rather than "AB".
		.replace(/[^\p{L}\p{N} _-]+/gu, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.replace(/^[-_ .]+|[-_ .]+$/g, '');
	const stem = [...cleaned].slice(0, MAX_STEM).join('').trim();
	return stem === '' ? GENERIC : stem;
}

export function exportName(name: string | undefined, extension: string): string {
	return `${fileStem(name)}.${extension}`;
}
