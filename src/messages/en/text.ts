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
 * `textToPaths`. A page too large for PDF is 'render/surface-too-large' with
 * params.maxMm, shown as `render.print.too-large`; EPS refusing a translucent
 * design is 'render/format-unavailable' with params.format 'eps', shown as
 * `render.eps.transparency`, which is also the key of each issue
 * `epsIssues` lists. Sheet templates are labelled `sheet.template.<id>`, and
 * a code larger than its label is the issue `sheet.cell-too-small`.
 * `tests/text/messages.test.ts` provokes every one of these and fails on a
 * key missing here.
 */

export const TEXT_MESSAGES: Readonly<Record<string, string>> = Object.freeze({
	'text.font.plex-sans-regular': 'Sans',
	'text.font.plex-sans-bold': 'Sans bold',
	'text.font.registered': 'Your font',
	'text.font.malformed': 'This font file is damaged, or is not a TrueType font this tool can read.',
	'text.font.missing-glyphs':
		'This font cannot draw some of these characters. Choose another font, or change the text.',
	'render.print.too-large': 'That page is larger than a PDF can be. Choose a smaller size.',
	'render.eps.transparency':
		'EPS cannot carry transparency. Save this design as a PDF, or make every colour in it opaque.',
	'sheet.cell-too-small':
		'This code is larger than the labels on this sheet. Make it smaller, or choose a sheet with larger labels.',
	'sheet.template.a4-21-63x38': 'A4, 21 labels 63.5 x 38.1 mm',
	'sheet.template.a4-24-63x34': 'A4, 24 labels 63.5 x 33.9 mm',
	'sheet.template.a4-14-99x38': 'A4, 14 labels 99.1 x 38.1 mm',
	'sheet.template.a4-8-99x68': 'A4, 8 labels 99.1 x 67.7 mm',
	'sheet.template.a4-65-38x21': 'A4, 65 labels 38.1 x 21.2 mm',
	'sheet.template.a4-12-round-64': 'A4, 12 round labels 63.5 mm',
	'sheet.template.a4-10-cards-85x54': 'A4, 10 business cards 85 x 54 mm',
	'sheet.template.letter-30-67x25': 'US Letter, 30 labels 2 5/8 x 1 in',
	'sheet.template.letter-10-102x51': 'US Letter, 10 labels 4 x 2 in',
	'sheet.template.letter-80-44x13': 'US Letter, 80 labels 1 3/4 x 1/2 in',
	'sheet.template.letter-12-round-51': 'US Letter, 12 round labels 2 in',
	'sheet.template.letter-12-square-51': 'US Letter, 12 square labels 2 x 2 in',
	'sheet.template.letter-10-cards-89x51': 'US Letter, 10 business cards 3 1/2 x 2 in',
	'sheet.template.print-a4': 'A4, copies with crop marks',
	'sheet.template.print-letter': 'US Letter, copies with crop marks',
});
