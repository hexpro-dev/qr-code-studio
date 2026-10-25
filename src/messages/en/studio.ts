/**
 * English for every message key the studio emits in its own words: why an
 * action changed nothing, why the code on screen is not the latest, the
 * headings it gives the catalogue and the form, the names of the scan
 * check's rows and stages, and the generic sentence for every error code.
 *
 * Error sentences are `error.<area>.<detail>` for the code `<area>/<detail>`
 * (`errorMessageKey` in src/studio/keys.ts). The studio uses a more specific
 * key where a layer has one (an encoding failure's reason, a reading
 * failure's stage), and these where it does not. Placeholders in braces are
 * filled from an issue's or an error's params, and
 * `tests/messages/catalogue.test.ts` checks each one is a param its key is
 * given.
 */

export const STUDIO_MESSAGES: Readonly<Record<string, string>> = Object.freeze({
	// Why the code on screen is not the latest, or why there is none.
	'studio.issue.content-invalid':
		'The code shown is the last one that worked. Fix what is highlighted to update it.',
	'studio.issue.content-empty': 'Fill in the details and the code appears here.',

	// Why an action changed nothing.
	'studio.issue.design-locked':
		'This kind of code has a fixed design that its specification sets, so the design cannot be changed.',
	'studio.issue.constrained':
		'This kind of code does not allow that change. Its specification sets this part of the design.',
	'studio.issue.unknown-type': 'This version of the studio does not include that kind of content.',
	'studio.issue.read-only-type':
		'This kind of code can be read and explained here, but not made: it has to come from the system that issues it.',
	'studio.issue.unknown-field': 'This kind of content has no such field.',
	'studio.issue.field-value': 'That value is the wrong kind of thing for this field.',
	'studio.issue.unknown-preset': 'This version of the studio does not include that preset.',
	'studio.issue.patch-path': 'That change does not refer to a part of a design.',
	'studio.issue.design-file':
		'This file is not a design, or it is damaged. Design files are saved from this studio as JSON.',
	'studio.issue.design-link':
		'The design in this link could not be opened, so the studio started with the standard design.',
	'studio.issue.raw-too-long':
		'This is {length} characters, and no code holds more than {max}. Shorten it to make a code from it.',
	'studio.issue.unknown-fix': 'That suggestion no longer applies. Run the scan check again.',
	'studio.issue.conditions': 'Enter a number greater than zero, or leave this empty.',
	'studio.issue.document-repaired':
		'Part of this saved code could not be used as it was, so the standard setting was used instead.',

	// Exports.
	'studio.issue.quiet-zone-below-minimum':
		'This leaves less than {min} modules of space round the code, which some phones need to find it.',
	'studio.issue.export-size-constrained':
		'This kind of code is printed at {size} mm, which its specification sets, so that size was used.',
	'studio.issue.export-option': 'This setting is out of range, so it was left out.',

	// Content categories.
	'studio.category.link': 'Links',
	'studio.category.contact': 'Contact details',
	'studio.category.message': 'Messages',
	'studio.category.network': 'Networks',
	'studio.category.event': 'Events',
	'studio.category.place': 'Places',
	'studio.category.payment': 'Payments',
	'studio.category.commerce': 'Products',
	'studio.category.text': 'Text',

	// Preset categories.
	'studio.preset-category.classic': 'Classic',
	'studio.preset-category.rounded': 'Rounded',
	'studio.preset-category.dots': 'Dots',
	'studio.preset-category.hex': 'Hexagons',
	'studio.preset-category.fluid': 'Fluid',
	'studio.preset-category.bold': 'Bold',
	'studio.preset-category.minimal': 'Minimal',
	'studio.preset-category.colour': 'Colour',
	'studio.preset-category.print': 'For print',

	// Field groups.
	'studio.group.address': 'Address',
	'studio.group.creditor': 'Payable to',
	'studio.group.debtor': 'Payable by',
	'studio.group.eap': 'Enterprise sign in',
	'studio.group.name': 'Name',
	'studio.group.phones': 'Phone numbers',
	'studio.group.time': 'Date and time',
	'studio.group.utm': 'Campaign tracking',

	// The scan check's rows.
	'studio.check.quiet-zone': 'Quiet zone',
	'studio.check.contrast': 'Contrast',
	'studio.check.polarity': 'Dark on light',
	'studio.check.function-patterns': 'Corner and timing patterns',
	'studio.check.logo-budget': 'Logo size',
	'studio.check.module-size': 'Module size',
	'studio.check.finder-shape': 'Corner square shape',
	'studio.check.colour-red-channel': 'Colours under red light',
	'studio.check.reader-support': 'Phone support',

	// What the scan check is doing.
	'studio.axis.static': 'Checking the design',
	'studio.axis.distance': 'Checking from further away',
	'studio.axis.focus': 'Checking out of focus',
	'studio.axis.motion': 'Checking with a moving phone',
	'studio.axis.noise': 'Checking in a grainy picture',
	'studio.axis.angle': 'Checking at an angle',
	'studio.axis.light': 'Checking in poor light',
	'studio.axis.glare': 'Checking with glare',
	'studio.axis.ink': 'Checking with ink spread',
	'studio.axis.contrast': 'Checking at low contrast',

	// Every error code, where no layer has a more specific sentence.
	'error.encode.too-much-data':
		'That is too much to fit in one code at these settings. Shorten it, lower the error correction, or allow a larger code.',
	'error.encode.unsupported-content': 'This content cannot be put into this kind of code as it is.',
	'error.encode.unsupported-feature': 'This kind of code cannot do that. Choose a QR code.',
	'error.design.invalid': 'This design is damaged or incomplete.',
	'error.design.unsupported-schema':
		'This design was made by a different version of the studio and cannot be opened here.',
	'error.design.unknown-entry':
		'This design uses something this version of the studio does not include.',
	'error.payload.invalid': 'The content has problems to fix before the code can be made.',
	'error.payload.unparseable': 'That text could not be read as this kind of content.',
	'error.decode.not-found': 'No code was found in this picture.',
	'error.decode.unreadable': 'A code was found here, but it could not be read.',
	'error.decode.unsupported': 'This code uses a feature this tool cannot read.',
	'error.decode.incomplete-set':
		'This code is one of a set, and some of the set is missing. Scan every code in the set.',
	'error.decode.conflicting-set':
		'These codes say they are one set, but they do not fit together. Scan the codes of one set only.',
	'error.image.unreadable':
		'This picture could not be opened. Try a PNG or JPEG, or take a screenshot of it.',
	'error.image.too-large': 'This picture is larger than this tool will open. Try a smaller one.',
	'error.font.malformed': 'This font file is damaged, or is not a font this tool can read.',
	'error.font.missing-glyphs': 'This font cannot draw some of these characters.',
	'error.render.surface-too-large':
		'That picture is too large to draw here. Choose a smaller size.',
	'error.render.format-unavailable': 'This browser cannot save in that format. Choose PNG or SVG.',
	'error.archive.too-large': 'This is larger than this tool will handle in one go.',
	'error.archive.malformed': 'This file is damaged and cannot be opened.',
	'error.batch.malformed-csv':
		'This spreadsheet file could not be read. Save it as CSV from your spreadsheet and try again.',
	'error.batch.too-many-rows': 'This file has more rows than can be made into codes at once.',
	'error.batch.unknown-column': 'A column this needs is not in the file.',
	'error.library.unavailable': 'Saved codes are not available in this browser.',
	'error.library.not-enabled':
		'The library is switched off. Switch it on to save codes in this browser.',
	'error.library.quota':
		'This browser has no more room for saved codes. Remove some and try again.',
	'error.library.corrupt': 'A saved code is damaged and cannot be opened.',
	'error.camera.permission-denied':
		'The camera is not allowed for this page. Allow it in the browser settings, or choose a picture instead.',
	'error.camera.unavailable': 'No camera could be opened. Choose a picture instead.',
	'error.camera.in-use':
		'The camera is in use by another app or tab. Close it there, then try again.',
	'error.camera.insecure-context':
		'The camera only works on a secure page. Open this page over https, or choose a picture instead.',
	'error.verify.missing-entry':
		'The scan check could not run, because this design uses something it does not include.',
	'error.platform.unavailable': 'This browser cannot do that.',
	'error.cancelled': 'That was stopped before it finished.',
});
