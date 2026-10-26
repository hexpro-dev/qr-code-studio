/**
 * The message keys the studio hands to a view, and how an error becomes one.
 *
 * A view never shows an error's `message`: the website translates, and the
 * offline app looks the key up in its English catalogue. So every error that
 * reaches a person goes through `studioError`, which picks the most specific
 * sentence there is. An encoding failure has its own keys in the encode
 * layer's catalogue, found by the param that says why; a reading failure has
 * the reader's, by `decodeFailureKey`; the library's, by the reason a store
 * gives; a spreadsheet the batch layer cannot
 * read has that layer's, by its reason; a font or a print refusal has the
 * text layer's; anything else has the generic sentence for its code,
 * `error.<area>.<detail>`.
 */

import { QrStudioError } from '../core/errors.js';
import { decodeFailureKey } from '../decode/failure.js';
import type { QrStudioErrorCode } from '../core/errors.js';
import { issue } from '../core/issue.js';
import type { Issue, MessageKey } from '../core/issue.js';
import type { PayloadCategory } from '../payload/types.js';
import type { PresetCategory } from '../design/types.js';
import { checkNameKey } from '../verify/keys.js';
import type { CaptureAxis, CheckId, VerifyCheck } from './seams.js';
import type { StudioError } from './types.js';

/** Everything the studio says in its own words. */
export const STUDIO_KEYS = Object.freeze({
	/** The code on screen is the last one that worked; the content as it stands cannot be made. */
	contentInvalid: 'studio.issue.content-invalid',
	/** Nothing to make a code from yet. */
	contentEmpty: 'studio.issue.content-empty',
	designLocked: 'studio.issue.design-locked',
	constrained: 'studio.issue.constrained',
	unknownType: 'studio.issue.unknown-type',
	readOnlyType: 'studio.issue.read-only-type',
	unknownField: 'studio.issue.unknown-field',
	fieldValue: 'studio.issue.field-value',
	unknownPreset: 'studio.issue.unknown-preset',
	patchPath: 'studio.issue.patch-path',
	designFile: 'studio.issue.design-file',
	designLink: 'studio.issue.design-link',
	rawTooLong: 'studio.issue.raw-too-long',
	unknownFix: 'studio.issue.unknown-fix',
	conditions: 'studio.issue.conditions',
	quietZoneBelowMinimum: 'studio.issue.quiet-zone-below-minimum',
	exportSizeConstrained: 'studio.issue.export-size-constrained',
	exportOption: 'studio.issue.export-option',
	documentRepaired: 'studio.issue.document-repaired',
} as const);

/** A content category's heading. */
export function categoryKey(category: PayloadCategory): MessageKey {
	return `studio.category.${category}`;
}

/** A preset category's heading. */
export function presetCategoryKey(category: PresetCategory): MessageKey {
	return `studio.preset-category.${category}`;
}

/** A field group's heading: 'address', 'utm' and the rest. */
export function groupKey(group: string): MessageKey {
	return `studio.group.${group}`;
}

/**
 * A scan check's name, for the row a view shows its result in: verify's own
 * (`checkNameKey`), so the studio, the report and every view call a check by
 * one name. Contrast is checked twice, as symbol contrast and as modulation
 * (`grade` 'MOD'), and each has a name of its own.
 */
export function checkKey(id: CheckId, grade?: VerifyCheck['grade']): MessageKey {
	return checkNameKey({ id, grade });
}

/** What the scan check is doing, for its progress. */
export function axisKey(axis: CaptureAxis | 'static'): MessageKey {
	return `studio.axis.${axis}`;
}

/** The generic sentence for an error code: 'encode/too-much-data' is 'error.encode.too-much-data'. */
export function errorMessageKey(code: QrStudioErrorCode): MessageKey {
	return `error.${code.replace('/', '.')}`;
}

function param(error: QrStudioError, name: string): string | undefined {
	const value = error.params[name];
	return typeof value === 'string' && /^[a-z0-9-]+$/.test(value) ? value : undefined;
}

/**
 * The library's specific sentences, by code and reason: a delete another tab
 * holds up, an item that has gone, a library file that is full, a brand kit
 * the studio cannot keep. Both stores give these reasons
 * (src/dom/file-library.ts, src/dom/library); keyed by code as well, so the
 * same reason from another layer means nothing here.
 */
export const LIBRARY_REASON_KEYS: Readonly<Record<string, MessageKey>> = Object.freeze({
	'library/unavailable:blocked': 'dom.library.error.blocked',
	'library/corrupt:missing': 'dom.library.error.missing',
	'library/quota:file-full': 'dom.library.error.file-full',
	'design/invalid:kit': 'dom.library.error.kit',
});

/** The most specific key there is for an error. */
export function errorKey(error: QrStudioError): MessageKey {
	const reasoned = `${error.code}:${String(error.params.reason)}`;
	if (Object.prototype.hasOwnProperty.call(LIBRARY_REASON_KEYS, reasoned)) {
		return LIBRARY_REASON_KEYS[reasoned] as MessageKey;
	}
	switch (error.code) {
		case 'encode/too-much-data':
			return 'encode.too-much-data';
		case 'encode/unsupported-feature': {
			const feature = param(error, 'feature');
			return feature === undefined
				? errorMessageKey(error.code)
				: `encode.unsupported-feature.${feature}`;
		}
		case 'encode/unsupported-content': {
			const reason = param(error, 'reason');
			return reason === undefined
				? errorMessageKey(error.code)
				: `encode.unsupported-content.${reason}`;
		}
		case 'decode/not-found':
		case 'decode/unreadable':
		case 'decode/unsupported':
			return decodeFailureKey(error);
		case 'batch/malformed-csv': {
			const reason = param(error, 'reason');
			return reason === undefined ? errorMessageKey(error.code) : `batch.malformed-csv.${reason}`;
		}
		case 'batch/too-many-rows':
			return 'batch.too-many-rows';
		case 'batch/unknown-column':
			return 'batch.unknown-column';
		case 'font/malformed':
			return 'text.font.malformed';
		case 'font/missing-glyphs':
			return 'text.font.missing-glyphs';
		case 'render/surface-too-large':
			// The PDF writer's page limit says so by its maxMm; a raster's by its pixels.
			return error.params.maxMm === undefined
				? errorMessageKey(error.code)
				: 'render.print.too-large';
		case 'render/format-unavailable':
			return param(error, 'format') === 'eps' && param(error, 'reason') === 'transparency'
				? 'render.eps.transparency'
				: errorMessageKey(error.code);
		default:
			return errorMessageKey(error.code);
	}
}

/** An error as a view shows it. Params are numbers and identifiers, never content, as the error classes promise. */
export function studioError(error: QrStudioError): StudioError {
	return { code: error.code, messageKey: errorKey(error), params: error.params };
}

/** An error as an issue at `path`, for the places a view shows issues. */
export function errorIssue(error: QrStudioError, path: readonly (string | number)[]): Issue {
	return issue(errorKey(error), path, 'error', error.params);
}

/**
 * The QrStudioError a thrown value amounts to.
 *
 * Anything that is not one (a TypeError from a third party's registry entry,
 * a RangeError from a malformed file deep in a parser) is reported as the
 * generic failure for `fallback`, because a person caused it by what they
 * typed or opened, and the studio promises not to throw for that.
 */
export function asStudioError(thrown: unknown, fallback: QrStudioErrorCode): QrStudioError {
	if (thrown instanceof QrStudioError) return thrown;
	return new QrStudioError(fallback, 'That could not be done.', {}, { cause: thrown });
}
