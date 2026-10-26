/**
 * English for the inspector: labels for what was read and how well, the
 * sentences about structured append sets and about where a code goes, and
 * the names of the GS1 application identifiers it reads by name (from the
 * GS1 General Specifications, section 3.2, in plain words).
 *
 * The safety findings themselves are explained by the payload layer's
 * sentences (`payload.safety.*`). Placeholders in braces come from an
 * issue's or a set's numbers, and tests/inspect/messages.test.ts checks
 * every key the inspector uses has a sentence here.
 */

export const INSPECT_MESSAGES: Readonly<Record<string, string>> = Object.freeze({
	'inspect.label.symbology': 'Kind of code',
	'inspect.label.version': 'Size',
	'inspect.label.error-correction': 'Error correction',
	'inspect.label.mask': 'Mask',
	'inspect.label.text-source': 'Character set',
	'inspect.label.segments': 'Encoding',
	'inspect.label.structured-append': 'Part of a set',
	'inspect.label.gs1': 'GS1 data',
	'inspect.label.quality': 'How well it read',
	'inspect.label.errors-corrected': 'Errors repaired',
	'inspect.label.format-errors': 'Format bits repaired',
	'inspect.label.mirrored': 'Read as a mirror image',
	'inspect.label.inverted': 'Read light on dark',
	'inspect.label.confidence': 'Least certain square',
	'inspect.label.content': 'What it holds',
	'inspect.label.destination': 'Where it goes',
	'inspect.label.unicode-host': 'Address as written',

	'inspect.text-source.utf-8': 'Unicode',
	'inspect.text-source.latin1-fallback': 'Western European, guessed',
	'inspect.text-source.shift-jis': 'Japanese',
	'inspect.text-source.eci': 'Declared by the code',

	'inspect.set.complete':
		'{total, plural, one {The one part of this set was found and read.} other {All # parts were found and put together.}}',
	'inspect.set.incomplete':
		'This is one part of a set of {total}. Scan the other parts too to see the whole message.',
	'inspect.set.parity-mismatch':
		'These parts do not belong to the same message, so they were not put together.',

	'inspect.not-opened':
		'Nothing has been opened. This is where the code goes, so you can decide whether to.',
	'inspect.issue.unreadable-as-type':
		'This looked like a particular kind of content but could not be read as one, so it is shown as plain text.',

	// GS1 application identifiers.
	'inspect.gs1.00': 'Shipping container code',
	'inspect.gs1.01': 'Product number',
	'inspect.gs1.02': 'Product number of contents',
	'inspect.gs1.10': 'Batch or lot',
	'inspect.gs1.11': 'Production date',
	'inspect.gs1.12': 'Due date',
	'inspect.gs1.13': 'Packaging date',
	'inspect.gs1.15': 'Best before',
	'inspect.gs1.16': 'Sell by',
	'inspect.gs1.17': 'Use by or expiry',
	'inspect.gs1.20': 'Variant',
	'inspect.gs1.21': 'Serial number',
	'inspect.gs1.22': 'Consumer product variant',
	'inspect.gs1.240': 'Additional product identification',
	'inspect.gs1.241': 'Customer part number',
	'inspect.gs1.250': 'Secondary serial number',
	'inspect.gs1.251': 'Reference to source entity',
	'inspect.gs1.253': 'Document type identifier',
	'inspect.gs1.254': 'Location number extension',
	'inspect.gs1.30': 'Variable count',
	'inspect.gs1.37': 'Count of items contained',
	'inspect.gs1.400': 'Order number',
	'inspect.gs1.401': 'Consignment number',
	'inspect.gs1.402': 'Shipment number',
	'inspect.gs1.403': 'Routing code',
	'inspect.gs1.410': 'Ship to location',
	'inspect.gs1.411': 'Bill to location',
	'inspect.gs1.412': 'Purchased from',
	'inspect.gs1.413': 'Ship for location',
	'inspect.gs1.414': 'Physical location',
	'inspect.gs1.415': 'Invoicing party',
	'inspect.gs1.416': 'Production or service location',
	'inspect.gs1.420': 'Ship to postcode',
	'inspect.gs1.421': 'Ship to postcode with country',
	'inspect.gs1.422': 'Country of origin',
	'inspect.gs1.7003': 'Expiry date and time',
	'inspect.gs1.8003': 'Returnable asset identifier',
	'inspect.gs1.8004': 'Individual asset identifier',
	'inspect.gs1.8020': 'Payment slip reference',
	'inspect.gs1.90': 'Agreed between trading partners',
	'inspect.gs1.measure': 'Measurement',
	'inspect.gs1.amount': 'Amount or price',
	'inspect.gs1.unknown': 'Other GS1 data',
});
