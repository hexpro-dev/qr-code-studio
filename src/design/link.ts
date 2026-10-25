/**
 * Design links: a whole design in the fragment of a URL.
 *
 * `v1.` and then base64url of the raw DEFLATE of the design's canonical JSON,
 * compressed by this package's own deflate so the same design gives the same
 * link in every browser. The fragment never reaches a server, and a design
 * never holds the content of a code, so a link shares a look and nothing
 * else.
 *
 * Embedded images are never put in a link: a logo picture is tens of
 * kilobytes, past what a link can carry, so it is left out with an issue
 * saying so, along with the logo that used it. Size limits hold both ways: a
 * design too large to link is refused when the link is made, and a fragment
 * longer than any link this makes, or one that inflates past the limit, is
 * refused before it is parsed.
 */

import { QrStudioError } from '../core/errors.js';
import { deflateRaw, inflateRaw } from '../core/deflate.js';
import { issue } from '../core/issue.js';
import type { Issue } from '../core/issue.js';
import { base64UrlDecode, base64UrlEncode } from './base64.js';
import { canonicalJson } from './canonical.js';
import { migrateDesign } from './migrate.js';
import { createDesignRegistries } from './registries.js';
import type { DesignRegistries, QrDesignV1 } from './types.js';
import { validateDesign } from './validate.js';

export const LINK_PREFIX = 'v1.';
/** The longest link this makes or reads, in characters, prefix included. */
export const MAX_LINK_LENGTH = 4096;
/** The most bytes of JSON a link may carry. */
export const MAX_LINK_JSON = 32768;

function invalid(reason: string, params: Readonly<Record<string, number>> = {}): QrStudioError {
	return new QrStudioError('design/invalid', 'This design link is damaged or incomplete.', {
		reason,
		...params,
	});
}

/**
 * A link for the design, with an issue for whatever had to be left out of it.
 * Throws 'design/invalid' when the design is too large to put in a link.
 */
export function designLink(design: QrDesignV1): {
	readonly link: string;
	readonly issues: readonly Issue[];
} {
	if (typeof design !== 'object' || design === null) {
		throw new TypeError('designLink: design is a design document.');
	}
	const issues: Issue[] = [];
	const { assets, ...rest } = design;
	let linked: QrDesignV1 = rest;
	// Read defensively: a link is often made from a design still being
	// edited, and a half-formed one should give a link that refuses to open,
	// not a crash here.
	if (typeof assets === 'object' && assets !== null && Object.keys(assets).length > 0) {
		issues.push(issue('design.issue.link-assets-dropped', ['assets'], 'warning'));
	}
	const source: unknown = (design.logo as { source?: { kind?: unknown } } | null)?.source;
	if (
		typeof source === 'object' &&
		source !== null &&
		(source as { kind?: unknown }).kind === 'asset'
	) {
		linked = { ...linked, logo: null };
		if (issues.length === 0) {
			issues.push(issue('design.issue.link-assets-dropped', ['assets'], 'warning'));
		}
	}
	const json = new TextEncoder().encode(canonicalJson(linked));
	if (json.length > MAX_LINK_JSON) {
		throw new QrStudioError('design/invalid', 'This design is too large to put in a link.', {
			reason: 'size',
			bytes: json.length,
			limit: MAX_LINK_JSON,
		});
	}
	const link = LINK_PREFIX + base64UrlEncode(deflateRaw(json, { level: 9 }));
	if (link.length > MAX_LINK_LENGTH) {
		throw new QrStudioError('design/invalid', 'This design is too large to put in a link.', {
			reason: 'size',
			length: link.length,
			limit: MAX_LINK_LENGTH,
		});
	}
	return { link, issues };
}

/** A design link: `v1.` followed by base64url(deflate(JSON)). Content is never included. */
export function encodeDesignLink(design: QrDesignV1): string {
	return designLink(design).link;
}

/**
 * The design a link holds, migrated and validated against `registries` (the
 * built-ins by default). Throws 'design/invalid' for a damaged link or one
 * whose design does not validate, and 'design/unsupported-schema' for a link
 * from a later version.
 */
export function decodeDesignLink(
	fragment: string,
	registries: DesignRegistries = createDesignRegistries(),
): QrDesignV1 {
	if (typeof fragment !== 'string') throw new TypeError('decodeDesignLink: fragment is a string.');
	const text = fragment.startsWith('#') ? fragment.slice(1) : fragment;
	if (text.length > MAX_LINK_LENGTH) throw invalid('length', { limit: MAX_LINK_LENGTH });
	if (!text.startsWith(LINK_PREFIX)) {
		if (/^v[0-9]{1,3}\./.test(text)) {
			throw new QrStudioError(
				'design/unsupported-schema',
				'This design link was made by a different version of the studio and cannot be opened here.',
			);
		}
		throw invalid('prefix');
	}
	const bytes = base64UrlDecode(text.slice(LINK_PREFIX.length));
	if (bytes === null) throw invalid('encoding');
	let json: Uint8Array;
	try {
		json = inflateRaw(bytes, { maxOutput: MAX_LINK_JSON });
	} catch (error) {
		throw withCause(invalid('compression', { limit: MAX_LINK_JSON }), error);
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(json));
	} catch (error) {
		throw withCause(invalid('json'), error);
	}
	const migrated = migrateDesign(parsed);
	const { design, issues } = validateDesign(migrated, registries);
	if (design === null) {
		throw invalid('content', {
			issues: issues.filter((found) => found.severity === 'error').length,
		});
	}
	return design;
}

function withCause(error: QrStudioError, cause: unknown): QrStudioError {
	return new QrStudioError(error.code, error.message, error.params, { cause });
}
