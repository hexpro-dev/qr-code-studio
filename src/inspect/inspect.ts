/**
 * The inspector: what a scanned code says, and whether to trust it.
 *
 * `inspectImage` reads every code in a picture with the scanner (the
 * lenient profile, several codes allowed), reports how well each one read,
 * puts structured append sets back together, and explains the content of
 * the first code, or of the set it completes. `inspectText` explains text a
 * person pasted or a camera already read.
 *
 * Neither ever opens, resolves or fetches anything. The report says where a
 * code goes, the host a browser would really connect to included, and the
 * person decides. That is the inspector's whole promise, and it is why the
 * report's link analysis comes from the parser alone.
 */

import { QrStudioError } from '../core/errors.js';
import { err, ok } from '../core/result.js';
import type { Result } from '../core/result.js';
import type { RgbaImage } from '../core/image.js';
import { decodeImage } from '../decode/decoder.js';
import type { DecodeOptions, DecodedSymbol } from '../decode/types.js';
import { explainText } from './explain.js';
import { parseGs1 } from './gs1.js';
import { assembleSets } from './sets.js';
import type { InspectRegistries, InspectReport, InspectedSymbol } from './types.js';

function checkRegistries(registries: InspectRegistries): void {
	if (
		typeof registries !== 'object' ||
		registries === null ||
		typeof registries.symbologies !== 'object' ||
		typeof registries.payloads !== 'object'
	) {
		throw new TypeError('inspect: registries gives the symbologies and the content types.');
	}
}

/** One decoded symbol as the inspector reports it. */
export function inspectedSymbol(symbol: DecodedSymbol): InspectedSymbol {
	const { read } = symbol;
	const { bitstream } = read;
	return Object.freeze({
		symbology: symbol.symbology,
		version: read.version,
		ecLevel: read.ecLevel,
		mask: read.mask,
		corners: symbol.corners,
		segments: bitstream.segments,
		text: bitstream.text,
		textSource: bitstream.textSource,
		structuredAppend: bitstream.structuredAppend,
		gs1: bitstream.fnc1 === 'gs1' ? Object.freeze(parseGs1(bitstream.text)) : null,
		quality: Object.freeze({
			errorsPerBlock: read.errorsPerBlock,
			capacityPerBlock: read.capacityPerBlock,
			erasuresUsed: read.erasuresUsed,
			formatErrors: read.formatErrors,
			mirrored: read.mirrored,
			inverted: symbol.inverted,
			minConfidence: symbol.minConfidence,
		}),
	});
}

/** Explain text a person pasted or a reader already gave. Never throws for any string. */
export function inspectText(text: string, registries: InspectRegistries): InspectReport {
	if (typeof text !== 'string') throw new TypeError('inspectText: text is a string.');
	checkRegistries(registries);
	const { payload, safety } = explainText(text, registries.payloads);
	return Object.freeze({ symbols: Object.freeze([]), sets: Object.freeze([]), payload, safety });
}

/**
 * Read every code in a picture and explain the first, or the set it
 * completes. A picture with no code that reads is a failed result, with the
 * decoder's reason.
 */
export function inspectImage(
	image: RgbaImage,
	registries: InspectRegistries,
	options: DecodeOptions = {},
): Result<InspectReport> {
	checkRegistries(registries);
	const decoded = decodeImage(
		image,
		{ ...options, profile: options.profile ?? 'lenient' },
		registries.symbologies,
	);
	if (!decoded.ok) return err(decoded.error);
	const found = decoded.value;
	// The decoder reports finding nothing as a failure, never as an empty
	// success; this keeps that promise from becoming a crash here if it ever
	// changes.
	/* v8 ignore next 3 */
	if (found.length === 0) {
		return err(new QrStudioError('decode/not-found', 'No code was found in this picture.'));
	}
	const symbols = found.map(inspectedSymbol);
	const sets = assembleSets(
		found.flatMap((symbol) => {
			const header = symbol.read.bitstream.structuredAppend;
			return header === null
				? []
				: [{ ...header, text: symbol.read.bitstream.text, bytes: symbol.read.bitstream.bytes }];
		}),
	);
	// The first code, or the whole message when the first code is part of a set that is complete.
	const first = symbols[0] as InspectedSymbol;
	const header = first.structuredAppend;
	const set =
		header === null
			? undefined
			: sets.find(
					(candidate) => candidate.parity === header.parity && candidate.total === header.total,
				);
	const text = set?.text ?? first.text;
	const { payload, safety } = explainText(text, registries.payloads);
	return ok(
		Object.freeze({ symbols: Object.freeze(symbols), sets: Object.freeze(sets), payload, safety }),
	);
}
