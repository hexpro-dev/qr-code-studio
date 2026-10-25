/**
 * The public shape of a content type, as docs/CONTRACTS.md (`payload`) gives it.
 *
 * Three additions to the contract, all listed in the branch report:
 *
 * - `FieldSchema.multiple` and `maxItems`. A contact card has several phone
 *   numbers and an email has several recipients, and `FieldValue` already
 *   allows `readonly string[]`, but nothing in the schema said which fields
 *   hold one. A field with `multiple: true` holds a `readonly string[]` whose
 *   every item is checked as `kind`.
 * - `PayloadType.generate`. A Saudi e-invoice code can be read and explained
 *   but not made honestly here: phase 2 codes carry a signature over the
 *   invoice made with the seller's own certificate. `generate: false` tells a
 *   view to offer the type in the inspector only. Absent means true.
 * - The safety code 'payload/service-code', for a tel: link that dials a
 *   star or hash code (call forwarding, settings), which the contract's
 *   union had no code for.
 */

import type { Issue, MessageKey } from '../core/issue.js';

/**
 * Error correction levels.
 *
 * The same union as `segment`'s `EcLevel`, repeated because this layer may
 * import only from core. Content types name the levels a specification
 * requires; the encoder owns what they mean.
 */
export type EcLevel = 'L' | 'M' | 'Q' | 'H';

export type FieldValue = string | number | boolean | null | readonly string[];

export type FieldKind =
	| 'text'
	| 'multiline'
	| 'url'
	| 'email'
	| 'tel'
	| 'number'
	| 'integer'
	| 'select'
	| 'boolean'
	| 'date'
	| 'datetime'
	| 'iban'
	| 'bic'
	| 'amount'
	| 'currency'
	| 'country'
	| 'latitude'
	| 'longitude'
	| 'secret';

export interface FieldOption {
	readonly value: string;
	readonly labelKey: MessageKey;
}

export interface FieldSchema {
	readonly key: string;
	readonly kind: FieldKind;
	readonly labelKey: MessageKey;
	readonly hintKey?: MessageKey;
	readonly required?: boolean;
	/** In characters (code points), for each item when the field is `multiple`. */
	readonly maxLength?: number;
	readonly min?: number;
	readonly max?: number;
	readonly options?: readonly FieldOption[];
	readonly default?: FieldValue;
	/** Fields shown together, such as 'address'. */
	readonly group?: string;
	/** Behind a disclosure. */
	readonly advanced?: boolean;
	/** Holds a `readonly string[]`, each item checked as `kind`. A contract addition. */
	readonly multiple?: boolean;
	/** The most items a `multiple` field may hold. */
	readonly maxItems?: number;
}

export type PayloadCategory =
	'link' | 'contact' | 'message' | 'network' | 'event' | 'place' | 'payment' | 'commerce' | 'text';

export interface PayloadConstraints {
	readonly ecLevels?: readonly EcLevel[];
	readonly maxVersion?: string;
	readonly symbologies?: readonly string[];
	readonly sizeMm?: number;
	readonly colours?: 'black-on-white';
	readonly designLocked?: boolean;
	readonly overlay?: 'swiss-cross';
}

export interface CompatibilityNote {
	readonly reader: string;
	readonly noteKey: MessageKey;
	readonly source: string;
}

export type PayloadValue = Readonly<Record<string, FieldValue>>;

export interface PayloadVector<V extends PayloadValue = PayloadValue> {
	readonly text: string;
	readonly value: V;
	readonly source: string;
}

export interface PayloadType<V extends PayloadValue = PayloadValue> {
	readonly id: string;
	readonly labelKey: MessageKey;
	readonly descriptionKey: MessageKey;
	readonly category: PayloadCategory;
	readonly fields: readonly FieldSchema[];
	readonly constraints?: PayloadConstraints;
	/**
	 * What a phone does with it, in plain words and without any content:
	 * "Joins a Wi-Fi network", never "Joins the network {ssid}".
	 */
	readonly actionKey: MessageKey;
	readonly compatibility?: readonly CompatibilityNote[];
	/** False when this type can be read and explained but not made. A contract addition; absent means true. */
	readonly generate?: boolean;
	validate(value: V): readonly Issue[];
	/** Call only on a value with no error issues; throws TypeError otherwise. */
	build(value: V): { readonly text: string };
	/** 0 when the text is certainly not this type, 1 when it certainly is. */
	detect(text: string): number;
	/** Throws QrStudioError 'payload/unparseable', or 'payload/invalid' when an integrity check over the whole text fails. */
	parse(text: string): V;
	safety?(value: V): readonly SafetyFinding[];
	/** Spec vectors, run by the conformance suite. `source` cites where each came from. */
	readonly vectors: readonly PayloadVector<V>[];
}

export type SafetyCode =
	| 'scheme/dangerous'
	| 'scheme/unusual'
	| 'host/ip-literal'
	| 'host/mixed-script'
	| 'host/punycode'
	| 'host/lookalike'
	| 'url/userinfo'
	| 'host/shortener'
	| 'host/dynamic-qr'
	| 'url/tracking-params'
	| 'url/insecure'
	| 'url/very-long'
	| 'payload/open-wifi'
	| 'payload/payment'
	| 'payload/sends-message'
	// A contract addition: a tel: link that dials a star or hash service code.
	| 'payload/service-code';

export type SafetySeverity = 'danger' | 'caution' | 'note';

export interface SafetyFinding {
	readonly code: SafetyCode;
	readonly severity: SafetySeverity;
	/** Host names may appear here: they are what the person needs to see. Never in an error message. */
	readonly params?: Readonly<Record<string, number | string>>;
}

export interface UrlAnalysis {
	readonly findings: readonly SafetyFinding[];
	/** The host a browser will connect to, after WHATWG normalisation, in its ASCII form. */
	readonly displayHost: string | null;
	/** The same host with any punycode labels decoded, when that differs from `displayHost`. */
	readonly unicodeHost: string | null;
}

/** What `detectPayload` returns: the best type for some text and how sure it is. */
export interface PayloadDetection {
	readonly type: PayloadType;
	readonly confidence: number;
}
