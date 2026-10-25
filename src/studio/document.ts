/**
 * Studio documents: the defaults, the empty fields of a content type, and
 * making a document out of something that arrived from outside (a design
 * link, a saved document, a file from the library).
 *
 * Anything from outside is checked here and repaired where the repair is
 * plain, with an issue saying so. A document never fails to load because one
 * part of it is wrong: an unknown content type falls back to a web link, a
 * design that does not validate falls back to the default, and a field of the
 * wrong kind is left for the form to show as wrong.
 */

import { issue } from '../core/issue.js';
import type { Issue } from '../core/issue.js';
import { defaultDesign } from '../design/document.js';
import { decodeDesignLink } from '../design/link.js';
import { migrateDesign } from '../design/migrate.js';
import type { QrDesignV1 } from '../design/types.js';
import { validateDesign } from '../design/validate.js';
import type { FieldSchema, FieldValue, PayloadType } from '../payload/types.js';
import type { Registries } from '../registries.js';
import { STUDIO_KEYS, asStudioError, errorIssue } from './keys.js';
import type { VerifyConditions } from './seams.js';
import type { StudioDocument, StudioMode } from './types.js';

export const DEFAULT_TYPE = 'url';
export const DEFAULT_CONDITIONS: VerifyConditions = Object.freeze({
	sizeMm: 25,
	dpi: null,
	distanceMm: null,
});

const MODES: readonly StudioMode[] = ['create', 'scan', 'bulk'];

const NUMBER_KINDS = new Set(['number', 'integer', 'amount', 'latitude', 'longitude']);

/** What an untouched field holds: its schema default, or nothing of its kind. */
export function emptyValue(field: FieldSchema): FieldValue {
	if (field.default !== undefined) return field.default;
	if (field.multiple === true) return Object.freeze([]) as readonly string[];
	if (field.kind === 'boolean') return false;
	if (NUMBER_KINDS.has(field.kind)) return null;
	return '';
}

/** Whether `value` is the kind of thing `field` holds, so it can move from one type to another. */
export function fitsField(field: FieldSchema, value: FieldValue): boolean {
	if (value === null) return NUMBER_KINDS.has(field.kind);
	if (field.multiple === true) return Array.isArray(value);
	if (Array.isArray(value)) return false;
	if (field.kind === 'boolean') return typeof value === 'boolean';
	if (NUMBER_KINDS.has(field.kind)) return typeof value === 'number';
	if (typeof value !== 'string') return false;
	if (field.kind === 'select' && value !== '') {
		return (field.options ?? []).some((option) => option.value === value);
	}
	return true;
}

/** Whether a value is a FieldValue at all: a value from a file or a fuzzer may be anything. */
export function isFieldValue(value: unknown): value is FieldValue {
	if (value === null) return true;
	if (typeof value === 'string' || typeof value === 'boolean') return true;
	// Any number: one that is not finite is the form's to report, not this check's.
	if (typeof value === 'number') return true;
	return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

/**
 * The fields for `type`: every value in `from` whose key the type has and
 * whose kind it takes, and the empty value for the rest. Keys the type does
 * not have are dropped, so switching from Wi-Fi to a link does not carry the
 * password along unseen.
 */
export function fieldsFor(
	type: PayloadType,
	from: Readonly<Record<string, FieldValue>> = {},
): Readonly<Record<string, FieldValue>> {
	const out: Record<string, FieldValue> = {};
	for (const field of type.fields) {
		const value = Object.prototype.hasOwnProperty.call(from, field.key)
			? from[field.key]
			: undefined;
		out[field.key] = value !== undefined && fitsField(field, value) ? value : emptyValue(field);
	}
	return Object.freeze(out);
}

/** A design from anything: migrated and validated, or the default with the reasons it was refused. */
export function designFrom(
	input: unknown,
	registries: Registries,
): { readonly design: QrDesignV1 | null; readonly issues: readonly Issue[] } {
	let migrated: QrDesignV1;
	try {
		migrated = migrateDesign(input);
	} catch (thrown) {
		return { design: null, issues: [errorIssue(asStudioError(thrown, 'design/invalid'), [])] };
	}
	try {
		return validateDesign(migrated, registries.design);
	} catch (thrown) {
		// The validator reports problems as issues; this is for a registry
		// entry of somebody else's that throws while it is asked about itself.
		return { design: null, issues: [errorIssue(asStudioError(thrown, 'design/invalid'), [])] };
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function positiveOrNull(value: unknown): number | null | undefined {
	if (value === null) return null;
	if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
	return undefined;
}

/**
 * Conditions from anything, each part checked on its own. `bad` holds the
 * path of each part that was wrong, from the document's root.
 */
export function conditionsFrom(
	input: unknown,
	base: VerifyConditions,
): { readonly conditions: VerifyConditions; readonly bad: readonly (readonly string[])[] } {
	if (!isRecord(input)) {
		return { conditions: base, bad: input === undefined ? [] : [['conditions']] };
	}
	const bad: (readonly string[])[] = [];
	const out: Record<string, number | null> = { ...base };
	for (const key of ['sizeMm', 'dpi', 'distanceMm'] as const) {
		if (!Object.prototype.hasOwnProperty.call(input, key) || input[key] === undefined) continue;
		const value = positiveOrNull(input[key]);
		if (value === undefined) bad.push(['conditions', key]);
		else out[key] = value;
	}
	return { conditions: out as unknown as VerifyConditions, bad };
}

/** The document a studio starts with when it is given nothing. */
export function defaultDocument(registries: Registries): StudioDocument {
	const type = registries.payloads.get(DEFAULT_TYPE) ?? registries.payloads.list()[0];
	if (type === undefined) {
		throw new TypeError('createStudio: the payload registry has no content types.');
	}
	return Object.freeze({
		mode: 'create',
		typeId: type.id,
		fields: fieldsFor(type),
		design: defaultDesign(),
		conditions: DEFAULT_CONDITIONS,
	});
}

/**
 * A document from something outside: a whole document (from the library, or
 * a caller), checked and repaired part by part.
 */
export function documentFrom(
	input: unknown,
	registries: Registries,
): { readonly document: StudioDocument; readonly issues: readonly Issue[] } {
	const base = defaultDocument(registries);
	if (!isRecord(input)) {
		return { document: base, issues: [issue(STUDIO_KEYS.documentRepaired, [], 'warning')] };
	}
	const issues: Issue[] = [];
	const mode = MODES.includes(input.mode as StudioMode) ? (input.mode as StudioMode) : base.mode;
	if (input.mode !== undefined && mode !== input.mode) {
		issues.push(issue(STUDIO_KEYS.documentRepaired, ['mode'], 'warning'));
	}
	const found =
		typeof input.typeId === 'string' ? registries.payloads.get(input.typeId) : undefined;
	const type =
		found !== undefined && found.generate !== false
			? found
			: registries.payloads.require(base.typeId);
	if (type !== found) issues.push(issue(STUDIO_KEYS.documentRepaired, ['typeId'], 'warning'));
	const given: Record<string, FieldValue> = {};
	if (isRecord(input.fields)) {
		for (const [key, value] of Object.entries(input.fields)) {
			if (isFieldValue(value)) given[key] = value;
		}
	}
	const fields = fieldsFor(type, given);
	const checked = designFrom(input.design, registries);
	if (checked.design === null) {
		issues.push(issue(STUDIO_KEYS.documentRepaired, ['design'], 'warning'));
	}
	const { conditions, bad } = conditionsFrom(input.conditions, base.conditions);
	for (const path of bad) issues.push(issue(STUDIO_KEYS.documentRepaired, path, 'warning'));
	return {
		document: Object.freeze({
			mode,
			typeId: type.id,
			fields,
			design: checked.design ?? base.design,
			conditions,
		}),
		issues,
	};
}

/** The document a link opens: the default content with the link's design. */
export function documentFromLink(
	fragment: string,
	registries: Registries,
): { readonly document: StudioDocument; readonly issues: readonly Issue[] } {
	const base = defaultDocument(registries);
	try {
		const design = decodeDesignLink(fragment, registries.design);
		return { document: Object.freeze({ ...base, design }), issues: [] };
	} catch (thrown) {
		const error = asStudioError(thrown, 'design/invalid');
		return {
			document: base,
			issues: [issue(STUDIO_KEYS.designLink, [], 'warning', { code: error.code })],
		};
	}
}
