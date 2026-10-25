/**
 * English for every message key the design layer emits: the names of the
 * built-in shapes, fills, frames, icons and presets, their parameters and
 * options, and the issues from validating, constraining, linking and
 * building a design.
 *
 * Placeholders in braces are filled from an issue's `params`, and
 * `tests/design/messages.test.ts` checks every placeholder a sentence uses
 * is one its issues carry. Names are plain descriptions of what a thing
 * looks like.
 */

export const DESIGN_MESSAGES: Readonly<Record<string, string>> = Object.freeze({
	// Module shapes.
	'design.module.square': 'Square',
	'design.module.rounded': 'Rounded',
	'design.module.dot': 'Dot',
	'design.module.diamond': 'Diamond',
	'design.module.squircle': 'Squircle',
	'design.module.hex': 'Hexagon',
	'design.module.bars-horizontal': 'Horizontal bars',
	'design.module.bars-vertical': 'Vertical bars',
	'design.module.fluid': 'Fluid',
	'design.module.classy': 'Classy',
	'design.module.cross': 'Cross',
	'design.module.tiny-square': 'Small square',
	'design.module.mosaic': 'Mosaic',
	'design.module.star': 'Star',

	// Finder rings.
	'design.region.square': 'Square',
	'design.region.rounded': 'Rounded',
	'design.region.extra-rounded': 'Extra rounded',
	'design.region.circle': 'Circle',
	'design.region.squircle': 'Squircle',
	'design.region.leaf': 'Leaf',
	'design.region.cushion': 'Cushion',
	'design.region.dot-ring': 'Ring of dots',
	'design.region.octagon': 'Octagon',
	'design.region.scooped': 'Scooped corners',

	// Finder centres.
	'design.region.square-centre': 'Square',
	'design.region.rounded-centre': 'Rounded',
	'design.region.circle-centre': 'Circle',
	'design.region.squircle-centre': 'Squircle',
	'design.region.leaf-centre': 'Leaf',
	'design.region.octagon-centre': 'Octagon',
	'design.region.scooped-centre': 'Scooped corners',
	'design.region.star-centre': 'Star',
	'design.region.flower-centre': 'Flower',

	// Fills.
	'design.fill.palette-scatter': 'Scattered colours',
	'design.fill.two-tone-diagonal': 'Two colours, split',

	// Frames.
	'design.frame.none': 'No frame',
	'design.frame.banner-bottom': 'Banner below',
	'design.frame.banner-top': 'Banner above',
	'design.frame.rounded-card': 'Rounded card',
	'design.frame.speech-bubble': 'Speech bubble',
	'design.frame.ticket': 'Ticket',
	'design.frame.polaroid': 'Instant photo',
	'design.frame.badge-circle': 'Round badge',
	'design.frame.phone': 'Phone',
	'design.frame.hang-tag': 'Hang tag',
	'design.frame.corner-brackets': 'Corner brackets',
	'design.frame.stamp': 'Stamp',

	// Logo icons.
	'design.icon.link': 'Link',
	'design.icon.wifi': 'Wi-Fi',
	'design.icon.mail': 'Email',
	'design.icon.phone': 'Phone',
	'design.icon.chat': 'Chat',
	'design.icon.location-pin': 'Location pin',
	'design.icon.calendar': 'Calendar',
	'design.icon.contact-card': 'Contact card',
	'design.icon.cart': 'Shopping cart',
	'design.icon.food': 'Knife and fork',
	'design.icon.star': 'Star',
	'design.icon.heart': 'Heart',
	'design.icon.play': 'Play',
	'design.icon.music': 'Music',
	'design.icon.shop': 'Shop',
	'design.icon.info': 'Information',

	// Presets.
	'design.preset.classic-black': 'Classic black',
	'design.preset.classic-navy': 'Classic navy',
	'design.preset.classic-soft-corners': 'Soft corners',
	'design.preset.classic-ink-blue': 'Ink blue',
	'design.preset.classic-octagon': 'Octagon eyes',
	'design.preset.rounded-graphite': 'Rounded graphite',
	'design.preset.rounded-ocean': 'Rounded ocean',
	'design.preset.rounded-forest': 'Forest squircles',
	'design.preset.rounded-plum': 'Rounded plum',
	'design.preset.rounded-terracotta': 'Terracotta leaves',
	'design.preset.rounded-link': 'Rounded with link icon',
	'design.preset.midnight-dots': 'Midnight dots',
	'design.preset.charcoal-dots': 'Charcoal dots',
	'design.preset.teal-dots': 'Teal dots',
	'design.preset.berry-dots': 'Berry dots',
	'design.preset.confetti-dots': 'Confetti dots',
	'design.preset.hex-pro-blue': 'Hex blue',
	'design.preset.hex-graphite': 'Hex graphite',
	'design.preset.hex-honey': 'Honeycomb',
	'design.preset.hex-night': 'Hex night',
	'design.preset.fluid-ink': 'Fluid ink',
	'design.preset.fluid-lagoon': 'Fluid lagoon',
	'design.preset.fluid-aubergine': 'Fluid aubergine',
	'design.preset.classy-slate': 'Classy slate',
	'design.preset.cobalt-bars': 'Cobalt bars',
	'design.preset.poster-yellow': 'Yellow poster',
	'design.preset.bold-tomato': 'Tomato card',
	'design.preset.bold-crosses': 'Crosses',
	'design.preset.slate-bars': 'Slate bars',
	'design.preset.red-badge': 'Red badge',
	'design.preset.chat-bubble': 'Speech bubble',
	'design.preset.minimal-tiny': 'Small squares',
	'design.preset.minimal-diamond': 'Diamonds',
	'design.preset.minimal-brackets': 'Corner brackets',
	'design.preset.minimal-stars': 'Stars',
	'design.preset.sunset-gradient': 'Sunset gradient',
	'design.preset.deep-sea-gradient': 'Deep sea gradient',
	'design.preset.two-tone': 'Two tone',
	'design.preset.violet-glow': 'Violet glow',
	'design.preset.mosaic-tiles': 'Mosaic tiles',
	'design.preset.teal-and-rust': 'Teal and rust',
	'design.preset.shop-tag': 'Shop tag',
	'design.preset.print-black': 'Print black',
	'design.preset.print-navy': 'Print navy',
	'design.preset.print-ticket': 'Print ticket',
	'design.preset.print-stamp': 'Print stamp',

	// Parameters.
	'design.param.radius': 'Corner radius',
	'design.param.size': 'Size',
	'design.param.orientation': 'Orientation',
	'design.param.thickness': 'Thickness',
	'design.param.scale': 'Scale',
	'design.param.jitter': 'Variation',
	'design.param.inner': 'Inner depth',
	'design.param.cut': 'Corner cut',
	'design.param.bite': 'Corner scoop',
	'design.param.petal': 'Petal size',
	'design.param.colour-1': 'First colour',
	'design.param.colour-2': 'Second colour',
	'design.param.colour-3': 'Third colour',
	'design.param.colour-4': 'Fourth colour',
	'design.param.count': 'Colours used',
	'design.param.angle': 'Angle',
	'design.param.split': 'Split position',
	'design.param.border': 'Border',
	'design.param.band': 'Band depth',
	'design.param.padding': 'Padding',
	'design.param.caption': 'Caption space',
	'design.param.tail': 'Tail size',
	'design.param.stub': 'Stub depth',
	'design.param.notch': 'Notch size',
	'design.param.bezel': 'Bezel',
	'design.param.gap': 'Gap',
	'design.param.arm': 'Arm length',

	// Options.
	'design.option.pointy': 'Point at the top',
	'design.option.flat': 'Flat at the top',

	// Issues: the shape of the document.
	'design.issue.not-an-object': 'This should be a group of settings.',
	'design.issue.not-a-list': 'This should be a list.',
	'design.issue.not-a-number': 'Enter a number.',
	'design.issue.not-an-integer': 'Enter a whole number.',
	'design.issue.not-a-boolean': 'This should be on or off.',
	'design.issue.not-text': 'This should be text.',
	'design.issue.out-of-range': 'This is outside the range from {min} to {max}.',
	'design.issue.invalid-option': 'Choose one of the options.',
	'design.issue.invalid-colour':
		'Colours are written as a # and three, four, six or eight hex digits.',
	'design.issue.cmyk':
		'A print colour is four values from 0 to 1, for cyan, magenta, yellow and black.',
	'design.issue.required': 'This is required.',
	'design.issue.unknown-key': 'This setting is not part of a design, so it was left out.',
	'design.issue.filled-default': 'This was missing, so the usual setting was used.',
	'design.issue.angle-normalised': 'This angle was brought round to between 0 and 360 degrees.',
	'design.issue.schema': 'This is not a design file.',
	'design.issue.unsupported-version':
		'This design was made by a different version of the studio. This one reads version {supported}.',
	'design.issue.symbology': 'Choose one of the kinds of code this studio makes.',
	'design.issue.version-name': 'This is not a size this kind of code comes in.',
	'design.issue.version-range': 'The largest size allowed is smaller than the smallest.',
	'design.issue.mask': 'Choose a mask from 0 to {max}, or let one be chosen.',

	// Issues: paints and entries.
	'design.issue.stop-count': 'A gradient has from {min} to {max} colour stops.',
	'design.issue.stop-order': 'Each colour stop must come at or after the one before it.',
	'design.issue.unknown-entry':
		'This refers to a style this version of the studio does not include.',
	'design.issue.param-ignored':
		'This setting does not suit the style it is on, so the usual value was used.',
	'design.issue.region-part':
		'This shape is for the other part of the position marks, the ring or the centre.',
	'design.issue.region-kind':
		"This shape cannot draw one of this code's position marks, so that mark is drawn with squares.",
	'design.issue.region-corners':
		'Readers find this kind of code by the corners of its position marks, so they are drawn square and only the centre of the main one takes the style.',
	'design.issue.region-pair':
		'Strict readers may not find position marks with this ring and this centre. Choose a different centre or ring.',
	'design.issue.quiet-zone':
		'The margin round the code was not a usable width, so the usual width was used.',
	'design.issue.quiet-zone-small':
		'The margin round the code is narrower than the {min} modules this kind of code needs, and some readers will miss it.',

	// Issues: logos and images.
	'design.issue.asset-missing': 'This logo refers to an image the design does not hold.',
	'design.issue.asset-unavailable':
		'The logo image could not be loaded, so the code is shown without it.',
	'design.issue.asset-id': 'Image names use lowercase letters, digits and hyphens.',
	'design.issue.asset-encoding': 'This image is damaged.',
	'design.issue.asset-not-png': 'Images in a design are PNG files.',
	'design.issue.asset-too-large': 'This image is larger than the {max} bytes a design can hold.',
	'design.issue.asset-mismatch': 'This image is not the size the design says it is.',
	'design.issue.too-many-assets': 'A design holds at most {max} images, and this one has {count}.',
	'design.issue.unused-asset': 'Nothing in the design uses this image, so it was left out.',
	'design.issue.logo-paint-ignored':
		'A picture logo keeps its own colours, so this colour was left out.',
	'design.issue.logo-too-small': 'The logo is too small to draw at this size of code.',
	'design.issue.logo-shrunk':
		'The logo was made smaller to keep it off the patterns a reader uses to find and line up the code.',

	// Issues: frames and captions.
	'design.issue.frame-unsupported':
		'Readers lose rectangular Micro QR codes inside a frame, so this code is shown without its frame.',
	'design.issue.caption-unsupported':
		'This frame has no space for a caption, so the caption was left out.',
	'design.issue.caption-missing-glyphs':
		'This font cannot draw {count} of the characters in the caption, so they were left out. Choose another font, or change the text.',
	'design.issue.caption-overflow':
		'The caption does not fit this frame even at its smallest size, so it is cut off. Shorten it, or choose a frame with more room.',
	'design.issue.font-unavailable':
		'This font is not available here, so the caption cannot be drawn.',
	'design.issue.too-long': 'This is {length} characters and the limit is {max}.',
	'design.issue.too-many-lines': 'This has {lines} lines and the frame holds {max}.',
	'design.issue.control-character':
		'This contains a control character at position {position}, which would not be shown.',
	'design.issue.font-id': 'Font names use lowercase letters, digits and hyphens.',

	// Issues: content constraints.
	'design.issue.design-locked': 'This content has a fixed design, so the design was set to it.',
	'design.issue.colours-constrained':
		'This content is printed in black on white, so the colours were changed.',
	'design.issue.symbology-constrained':
		'This content needs a different kind of code, so it was changed.',
	'design.issue.ec-level-constrained':
		'This content needs error correction level {level}, so that level is used.',
	'design.issue.boost-constrained':
		'Raising the error correction is switched off, because this content allows only certain levels.',
	'design.issue.version-constrained': 'This content allows a code no larger than version {max}.',
	'design.issue.eci-constrained':
		'This content names its own character set, so no character set marker is added.',
	'design.issue.size-constrained':
		'This content is printed with the code itself {size} mm wide, not counting its margin, so that size is used.',
	'design.issue.overlay-unsupported':
		'The Swiss cross this content needs is printed over QR codes only, so it was left out.',

	// Issues: links.
	'design.issue.link-assets-dropped':
		'Images are too large to put in a link, so the logo picture was left out of it.',
});
