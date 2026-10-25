/**
 * English for the message keys the browser adapters emit: what happened to a
 * logo picture on its way into a design. Everything else they can fail with
 * is an error code, whose sentence is in studio.ts.
 *
 * `design.issue.svg-logo-later` is in the design area because a view shows it
 * beside the design's logo control, but it is the dom layer's `importLogo`
 * that emits it, so its sentence lives here.
 */

export const DOM_MESSAGES: Readonly<Record<string, string>> = Object.freeze({
	'design.issue.svg-logo-later':
		'SVG logos are not supported yet. Save the logo as a PNG and choose that instead.',
	'dom.issue.logo-downscaled':
		'The picture was made smaller, to {width} by {height} pixels, so the design can hold it.',
});
