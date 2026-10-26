/**
 * The public shape of the inspector, as docs/CONTRACTS.md (`inspect`) gives
 * it.
 *
 * Additions to the contract, each listed in the branch report:
 *
 * - `InspectRegistries` is what inspect needs from the root
 *   `createRegistries()` bag: the symbologies and the content types, under
 *   `symbologies` and `payloads`. The root bag satisfies it structurally.
 * - `InspectSet.total` and `parityMatches`: how many parts the set says it
 *   has, and whether the parts found add up to the parity they all carry. A
 *   set can have every index and still not be one message (two printings
 *   mixed up), and a view has to be able to say so.
 */

import type { Issue } from '../core/issue.js';
import type { Registry } from '../core/registry.js';
import type { Point } from '../decode/types.js';
import type { FieldValue, PayloadType, UrlAnalysis } from '../payload/types.js';
import type { DecodedBitstream, DecodedSegment, EcLevel } from '../segment/types.js';
import type { SymbologyEntry } from '../symbology/types.js';

export interface InspectRegistries {
	readonly symbologies: Registry<SymbologyEntry>;
	readonly payloads: Registry<PayloadType>;
}

export interface Gs1Element {
	/** The application identifier, two to four digits. */
	readonly ai: string;
	readonly value: string;
}

export interface InspectedSymbol {
	readonly symbology: string;
	readonly version: string;
	readonly ecLevel: EcLevel;
	readonly mask: number;
	readonly corners: readonly Point[];
	readonly segments: readonly DecodedSegment[];
	readonly text: string;
	readonly textSource: DecodedBitstream['textSource'];
	readonly structuredAppend: {
		readonly index: number;
		readonly total: number;
		readonly parity: number;
	} | null;
	/** Element strings, for a code that starts with FNC1 in the first position (GS1); null otherwise. */
	readonly gs1: readonly Gs1Element[] | null;
	readonly quality: {
		readonly errorsPerBlock: readonly number[];
		readonly capacityPerBlock: readonly number[];
		readonly erasuresUsed: number;
		readonly formatErrors: number;
		readonly mirrored: boolean;
		readonly inverted: boolean;
		readonly minConfidence: number;
	};
}

export interface InspectSet {
	readonly parity: number;
	/** The number of parts each symbol of the set says there are. */
	readonly total: number;
	/** Every part found and the parity checks. */
	readonly complete: boolean;
	/** The message, parts joined in order, when complete. */
	readonly text: string | null;
	/** Indexes, from 0, of the parts not found. */
	readonly missing: readonly number[];
	/** Whether the parts found add up to the set's parity; null until every part is found. */
	readonly parityMatches: boolean | null;
}

export interface InspectPayload {
	readonly typeId: string;
	readonly value: Readonly<Record<string, FieldValue>>;
	readonly issues: readonly Issue[];
}

export interface InspectReport {
	readonly symbols: readonly InspectedSymbol[];
	readonly sets: readonly InspectSet[];
	/** For the first symbol, or the completed set: what kind of content it is and what it says. */
	readonly payload: InspectPayload | null;
	readonly safety: UrlAnalysis | null;
}
