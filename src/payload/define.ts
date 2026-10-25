/**
 * The shared machinery behind every content type.
 *
 * A type supplies its fields, the rules its specification adds, a writer and a
 * reader. This file turns that into a `PayloadType`: validation that reports
 * every issue at once, a `build` that refuses a value with errors rather than
 * writing a code that scans and then fails at the bank, and errors that never
 * carry content.
 */

import { QrStudioError } from '../core/errors.js';
import { hasErrors } from '../core/issue.js';
import type { Issue } from '../core/issue.js';
import { validateFields } from './fields.js';
import type {
	CompatibilityNote,
	FieldKind,
	FieldSchema,
	PayloadCategory,
	PayloadConstraints,
	PayloadType,
	PayloadValue,
	PayloadVector,
	SafetyFinding,
} from './types.js';

export interface PayloadDefinition<V extends PayloadValue> {
	readonly id: string;
	readonly category: PayloadCategory;
	readonly fields: readonly FieldSchema[];
	readonly constraints?: PayloadConstraints;
	readonly compatibility?: readonly CompatibilityNote[];
	readonly generate?: boolean;
	/**
	 * The issues the specification adds to the schema's. `flagged` says which
	 * fields the schema already found a problem with, so a rule about a field's
	 * meaning stays quiet about one that is not even well formed.
	 */
	readonly rules?: (value: V, flagged: (key: string) => boolean) => readonly Issue[];
	/** The text, for a value already known to have no error issues. */
	readonly write: (value: V) => string;
	readonly detect: (text: string) => number;
	readonly parse: (text: string) => V;
	readonly safety?: (value: V) => readonly SafetyFinding[];
	/** The built-in types leave this out: their vectors are in ./vectors, off the runtime path. */
	readonly vectors?: readonly PayloadVector<V>[];
}

export function definePayload<V extends PayloadValue>(
	definition: PayloadDefinition<V>,
): PayloadType<V> {
	const { id, rules, write } = definition;
	const validate = (value: V): readonly Issue[] => {
		const base = validateFields(definition.fields, value);
		if (rules === undefined || typeof value !== 'object' || value === null) return base;
		const flaggedKeys = new Set(base.map((found) => found.path[1]));
		return [...base, ...rules(value, (key) => flaggedKeys.has(key))];
	};
	const type: PayloadType<V> = {
		id,
		labelKey: `payload.${id}.label`,
		descriptionKey: `payload.${id}.description`,
		actionKey: `payload.${id}.action`,
		category: definition.category,
		fields: definition.fields,
		validate,
		build(value: V) {
			if (hasErrors(validate(value))) {
				throw new TypeError(
					`This ${id} value has error issues, so it cannot be built. Call validate first and fix what it reports.`,
				);
			}
			return { text: write(value) };
		},
		detect: definition.detect,
		parse: definition.parse,
	};
	return Object.freeze({
		...type,
		...(definition.constraints ? { constraints: definition.constraints } : {}),
		...(definition.compatibility ? { compatibility: definition.compatibility } : {}),
		...(definition.generate === false ? { generate: false } : {}),
		...(definition.safety ? { safety: definition.safety } : {}),
		...(definition.vectors ? { vectors: definition.vectors } : {}),
	});
}

type FieldExtras = Omit<FieldSchema, 'key' | 'kind' | 'labelKey' | 'options'> & {
	/** Option values, lower case; each gets the label key `payload.<id>.option.<key>.<value>`. */
	readonly options?: readonly string[];
	/** True to give the field a hint at `payload.<id>.hint.<key>`. */
	readonly hint?: boolean;
};

/** A field key as it appears in a message key: 'givenName' is 'given-name', because keys are lower case. */
export function keySegment(key: string): string {
	return key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

/**
 * A field whose message keys follow the catalogue's naming:
 * `payload.<id>.field.<key>`, with the key in kebab case.
 */
export function field(
	id: string,
	key: string,
	kind: FieldKind,
	extras: FieldExtras = {},
): FieldSchema {
	const { options, hint, ...rest } = extras;
	const segment = keySegment(key);
	return {
		key,
		kind,
		labelKey: `payload.${id}.field.${segment}`,
		...(hint ? { hintKey: `payload.${id}.hint.${segment}` } : {}),
		...(options
			? {
					options: options.map((value) => ({
						value,
						labelKey: `payload.${id}.option.${segment}.${value}`,
					})),
				}
			: {}),
		...rest,
	};
}

/**
 * The text is not this kind of content, or is too damaged to read as it.
 * `reason` is an identifier for a developer and a translated message, never
 * a piece of the text.
 */
export function unparseable(type: string, reason: string): QrStudioError {
	return new QrStudioError(
		'payload/unparseable',
		'That text could not be read as this kind of content.',
		{ type, reason },
	);
}

/** The text is this kind of content, but a check over the whole of it fails. */
export function invalidPayload(type: string, reason: string): QrStudioError {
	return new QrStudioError(
		'payload/invalid',
		'That code is damaged or was made incorrectly: its own check does not match what it holds.',
		{ type, reason },
	);
}
