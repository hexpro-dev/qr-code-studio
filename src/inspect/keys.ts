/**
 * The message keys a view needs to show an inspection: labels for what was
 * read, the sentences about sets and about where a code goes, and a name for
 * each GS1 application identifier the inspector reads by name. Safety
 * findings are the payload layer's own keys (`safetyMessageKey`). The
 * English is src/messages/en/inspect.ts.
 */

import { GS1_AIS } from './gs1.js';

export const INSPECT_MESSAGE_KEYS = Object.freeze({
	labels: Object.freeze({
		symbology: 'inspect.label.symbology',
		version: 'inspect.label.version',
		ecLevel: 'inspect.label.error-correction',
		mask: 'inspect.label.mask',
		textSource: 'inspect.label.text-source',
		segments: 'inspect.label.segments',
		structuredAppend: 'inspect.label.structured-append',
		gs1: 'inspect.label.gs1',
		quality: 'inspect.label.quality',
		errorsCorrected: 'inspect.label.errors-corrected',
		formatErrors: 'inspect.label.format-errors',
		mirrored: 'inspect.label.mirrored',
		inverted: 'inspect.label.inverted',
		confidence: 'inspect.label.confidence',
		content: 'inspect.label.content',
		destination: 'inspect.label.destination',
		unicodeHost: 'inspect.label.unicode-host',
	}),
	textSources: Object.freeze({
		'utf-8': 'inspect.text-source.utf-8',
		'latin1-fallback': 'inspect.text-source.latin1-fallback',
		'shift-jis': 'inspect.text-source.shift-jis',
		eci: 'inspect.text-source.eci',
	}),
	sets: Object.freeze({
		complete: 'inspect.set.complete',
		incomplete: 'inspect.set.incomplete',
		parityMismatch: 'inspect.set.parity-mismatch',
	}),
	/** Shown beside every destination: nothing has been opened, and the person decides. */
	notOpened: 'inspect.not-opened',
	/** When a code scored as one kind of content but did not read as it. */
	unreadableAsType: 'inspect.issue.unreadable-as-type',
	gs1Measure: 'inspect.gs1.measure',
	gs1Amount: 'inspect.gs1.amount',
	gs1Unknown: 'inspect.gs1.unknown',
});

/**
 * The name of a GS1 application identifier: `inspect.gs1.<ai>` for those
 * read by name, one key for the measures (31 to 36) and one for the amounts
 * (390 to 393), whose fourth digit places the decimal point, and
 * `inspect.gs1.unknown` for the rest.
 */
export function gs1MessageKey(ai: string): string {
	if (Object.prototype.hasOwnProperty.call(GS1_AIS, ai)) return `inspect.gs1.${ai}`;
	if (/^3[1-6]\d\d$/.test(ai)) return INSPECT_MESSAGE_KEYS.gs1Measure;
	if (/^39[0-3]\d$/.test(ai)) return INSPECT_MESSAGE_KEYS.gs1Amount;
	return INSPECT_MESSAGE_KEYS.gs1Unknown;
}
