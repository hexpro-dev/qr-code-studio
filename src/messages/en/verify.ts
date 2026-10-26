/**
 * English for the scan check: what each check and capture axis is called,
 * the sentence for each check at pass, warn and fail, the fixes, and the
 * verdicts.
 *
 * Written for a person holding a print-out, not for someone who knows what
 * a module is: the small squares are squares, the corner patterns are corner
 * squares, and distances and sizes are in centimetres and millimetres.
 * Placeholders in braces come from the check's or fix's `params`, and
 * tests/verify/messages.test.ts checks every one is filled.
 */

export const VERIFY_MESSAGES: Readonly<Record<string, string>> = Object.freeze({
	// What each check is called.
	'verify.check-name.quiet-zone': 'Clear margin',
	'verify.check-name.contrast': 'Overall contrast',
	'verify.check-name.modulation': 'Clear squares',
	'verify.check-name.polarity': 'Dark on light',
	'verify.check-name.function-patterns': 'Patterns readers look for',
	'verify.check-name.logo-budget': 'Logo',
	'verify.check-name.module-size': 'Print size',
	'verify.check-name.finder-shape': 'Corner squares',
	'verify.check-name.colour-red-channel': 'Red light scanners',
	'verify.check-name.reader-support': 'Readers',

	'verify.status.pass': 'Passes',
	'verify.status.warn': 'Worth checking',
	'verify.status.fail': 'Will not scan reliably',

	'verify.verdict.pass': 'This should scan on the phones people carry, in everyday conditions.',
	'verify.verdict.warn':
		'This scans, but some people will have trouble with it. The checks below say when.',
	'verify.verdict.fail':
		'This is likely to fail for many people. Fix the problems below before printing it.',
	'verify.baseline.fail': 'Even a clean photograph of this design did not scan.',
	'verify.error.missing-entry':
		'This check needs a style or picture this copy of the studio does not have, so it was not run.',

	// Clear margin.
	'verify.check.quiet-zone.pass':
		'There is a clear margin {modules} squares wide all round the code.',
	'verify.check.quiet-zone.fail':
		'The clear margin round the code is only {modules} squares wide. Readers need at least {minimum}, with nothing printed in it.',

	// Contrast, as symbol contrast and as modulation.
	'verify.check.contrast.sc.pass':
		'The dark and light parts differ by {percent} percent, grade {grade}.',
	'verify.check.contrast.sc.warn':
		'The dark and light parts differ by only {percent} percent, grade {grade}. Some phones will struggle, more so in poor light.',
	'verify.check.contrast.sc.fail':
		'The dark and light parts differ by only {percent} percent, grade {grade}. That is too little for phones to tell them apart.',
	'verify.check.contrast.mod.pass': 'Every square reads clearly as dark or light, grade {grade}.',
	'verify.check.contrast.mod.warn':
		'Some squares are close to the middle shade, so they read less clearly, grade {grade}.',
	'verify.check.contrast.mod.fail':
		'Some squares are too close to the middle shade to read reliably, grade {grade}.',
	'verify.check.contrast.mod.wrong':
		'Some squares read as the wrong shade even in a clean photograph. Check the colours of the squares and any gradient.',

	// Polarity.
	'verify.check.polarity.pass': 'Dark squares on a light background, which every reader expects.',
	'verify.check.polarity.warn':
		'Light squares on a dark background. Some phone readers cannot read a code this way round.',

	// Patterns readers look for.
	'verify.check.function-patterns.pass':
		'Nothing covers the corner squares or the other patterns readers find the code by.',
	'verify.check.function-patterns.covered':
		'The logo or its background covers part of the patterns readers find the code by. Make the logo smaller.',
	'verify.check.function-patterns.finder':
		'The corner squares are drawn in a shape readers may not recognise.',
	'verify.check.function-patterns.alignment':
		'The logo covers one of the small alignment squares inside the code. Most readers manage without it, but not all.',

	// Logo.
	'verify.check.logo-budget.none':
		'Nothing covers the code, so all of its error correction is kept for wear and poor light.',
	'verify.check.logo-budget.pass':
		'The logo covers {codewords} pieces of the code, and enough error correction is left for wear and poor light.',
	'verify.check.logo-budget.warn':
		'The logo covers {codewords} pieces of the code. It reads, but little error correction is left for wear and poor light.',
	'verify.check.logo-budget.fail':
		'The logo covers too much of the code: repairing it would use up the error correction kept for wear and poor light.',

	// Print size.
	'verify.check.module-size.unknown':
		'Give the printed size to check how far away this scans from.',
	'verify.check.module-size.unread':
		'Printed {sizeMm} mm wide, this did not scan from any distance in the check.',
	'verify.check.module-size.fail':
		'Printed {sizeMm} mm wide, the squares are too small for a phone to focus on. Print it at least {minimumMm} mm wide.',
	'verify.check.module-size.short':
		'Scans from about {distanceCm} cm away when printed {sizeMm} mm wide, but people are expected to scan it from {expectedCm} cm. Print it at least {minimumMm} mm wide.',
	'verify.check.module-size.close':
		'Scans from about {distanceCm} cm away when printed {sizeMm} mm wide, so people will have to hold their phone close to it.',
	'verify.check.module-size.pass':
		'Scans from about {distanceCm} cm away when printed {sizeMm} mm wide.',

	// Corner squares.
	'verify.check.finder-shape.pass': 'The corner squares are a shape readers recognise.',
	'verify.check.finder-shape.fail':
		'The corner squares are drawn in a shape readers may not recognise. Choose another corner style.',

	// Red light.
	'verify.check.colour-red-channel.pass':
		'Also reads under the red light of shop and warehouse scanners.',
	'verify.check.colour-red-channel.warn':
		'Under the red light many shop and warehouse scanners use, these colours keep only {percent} percent of their contrast. Phones see colour and are not affected; those scanners may be.',

	// Readers.
	'verify.check.reader-support.pass': 'Phone cameras read this kind of code.',
	'verify.check.reader-support.micro':
		'Most phone cameras cannot read Micro QR codes. Use one only with a scanner you know reads them.',
	'verify.check.reader-support.rmqr':
		'Most phone cameras cannot read rectangular Micro QR codes. Use one only with a scanner you know reads them.',
	'verify.check.reader-support.kanji':
		'This code stores Japanese text in a compact form that some readers show wrongly.',
	'verify.check.reader-support.eci':
		'This code says which character set it uses. A few older readers ignore that and may show some characters wrongly.',

	// Capture axes.
	'verify.axis.distance': 'Distance',
	'verify.axis.distance.ok': 'Scans from as far away as people will hold their phone.',
	'verify.axis.distance.short': 'Does not scan from as far away as people will hold their phone.',
	'verify.axis.focus': 'Focus',
	'verify.axis.focus.ok': 'Scans while the camera is still finding its focus.',
	'verify.axis.focus.short': 'Needs the camera perfectly in focus.',
	'verify.axis.motion': 'Movement',
	'verify.axis.motion.ok': 'Scans with a slightly unsteady hand.',
	'verify.axis.motion.short': 'Needs a very steady hand.',
	'verify.axis.noise': 'Grain',
	'verify.axis.noise.ok': 'Scans through the grain a phone camera adds indoors.',
	'verify.axis.noise.short': 'Struggles with the grain a phone camera adds indoors.',
	'verify.axis.angle': 'Angle',
	'verify.axis.angle.ok': 'Scans with the phone held at an angle.',
	'verify.axis.angle.short': 'Needs the phone held almost straight on.',
	'verify.axis.light': 'Dim light',
	'verify.axis.light.ok': 'Scans in dim, uneven light.',
	'verify.axis.light.short': 'Needs good, even light.',
	'verify.axis.glare': 'Glare',
	'verify.axis.glare.ok': 'Scans with a reflection across it.',
	'verify.axis.glare.short': 'A reflection on glossy paper or a screen stops it scanning.',
	'verify.axis.ink': 'Ink spread',
	'verify.axis.ink.ok': 'Scans when the ink spreads a little or prints thin.',
	'verify.axis.ink.short':
		'Needs crisp printing: ink that spreads or prints thin stops it scanning.',
	'verify.axis.contrast': 'Fading',
	'verify.axis.contrast.ok': 'Scans after the print has faded.',
	'verify.axis.contrast.short': 'Stops scanning as the print fades.',

	// Fixes.
	'verify.fix.raise-ec': 'Use error correction level {level}',
	'verify.fix.shrink-logo': 'Make the logo smaller, {percent} percent of the width',
	'verify.fix.logo-clear-shape': 'Clear only the space the logo itself takes',
	'verify.fix.dark-on-light': 'Swap to dark squares on a light background',
	'verify.fix.darken-modules': 'Use the darkest colour in the design for every square',
	'verify.fix.black-modules': 'Print the squares in black',
	'verify.fix.low-red-ink': 'Use the colour red light scanners see best',
	'verify.fix.widen-quiet-zone': 'Widen the clear margin to {modules} squares',
	'verify.fix.square-finders': 'Use plain square corners',
	'verify.fix.solid-modules': 'Draw the code with plain squares',
	'verify.fix.print-larger': 'Print it at least {sizeMm} mm wide',
});
