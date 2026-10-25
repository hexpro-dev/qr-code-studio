/**
 * English sentences for the text layer, and for the print writers and label
 * sheets that M9 added alongside it.
 *
 * Font labels are `text.font.<id>`. The built-in family is compiled from IBM
 * Plex Sans, and a compiled subset is a Modified Version under the SIL Open
 * Font Licence, which may not be presented under the Reserved Font Name
 * "Plex"; so its labels say Sans. A font the website registers at runtime is
 * labelled `text.font.registered` unless it brings its own key.
 *
 * A font that cannot be read is 'font/malformed', and a caption with
 * characters the font lacks is 'font/missing-glyphs' when it is drawn with
 * `textToPaths`. `tests/text/messages.test.ts` provokes every one of these
 * and fails on a key missing here.
 */

export const TEXT_MESSAGES: Readonly<Record<string, string>> = Object.freeze({
	'text.font.plex-sans-regular': 'Sans',
	'text.font.plex-sans-bold': 'Sans bold',
	'text.font.registered': 'Your font',
	'text.font.malformed': 'This font file is damaged, or is not a TrueType font this tool can read.',
	'text.font.missing-glyphs':
		'This font cannot draw some of these characters. Choose another font, or change the text.',
});
