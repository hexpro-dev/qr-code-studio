/**
 * What some decoded text is and whether to trust where it goes.
 *
 * The content type that claims the text most strongly reads it, checks it
 * and says what in it deserves caution. Any http or https link is also put
 * through the URL analyser as written, even when a more specific type (a GS1
 * Digital Link, say) outranked the plain link type, because the person needs
 * to see the host a browser would really open whatever else the link is.
 *
 * Nothing is opened, resolved or fetched. Every type's methods are someone's
 * code, possibly a third party's registered at runtime, so each call is
 * fenced: a type that throws is treated as not claiming the text, and the
 * text is explained as plain text instead, with a note. An inspector that
 * fails on the code it was asked about is no use to the person holding it.
 */

import { issue } from '../core/issue.js';
import type { Issue } from '../core/issue.js';
import type { Registry } from '../core/registry.js';
import { textType } from '../payload/content/text.js';
import { detectPayload } from '../payload/detect.js';
import { analyseUrl, isDangerousScheme } from '../payload/url-safety.js';
import type { PayloadType, PayloadValue, SafetyFinding, UrlAnalysis } from '../payload/types.js';
import type { InspectPayload } from './types.js';

/** True for text a browser would open as an http or https link, after the trimming WHATWG does. */
export function isWebLink(text: string): boolean {
	// eslint-disable-next-line no-control-regex -- C0 controls and space are what the URL parser trims.
	return /^[\u0000-\u0020]*https?:/i.test(text);
}

/**
 * True for text the URL parser reads as a scheme that runs code, however it
 * is disguised: a tab inside "javascript:" is removed by the parser, so the
 * text looks like nothing in particular and still runs as script.
 */
export function isDangerousLink(text: string): boolean {
	try {
		return isDangerousScheme(new URL(text).protocol.slice(0, -1));
	} catch {
		return false;
	}
}

function attemptCall<T>(fn: () => T): { ok: true; value: T } | { ok: false } {
	try {
		return { ok: true, value: fn() };
	} catch {
		return { ok: false };
	}
}

function findingKey(finding: SafetyFinding): string {
	return `${finding.code}|${finding.severity}|${JSON.stringify(finding.params ?? {})}`;
}

export interface Explained {
	readonly payload: InspectPayload;
	readonly safety: UrlAnalysis;
}

export function explainText(text: string, payloads: Registry<PayloadType>): Explained {
	// detectPayload fences every type's detect itself, scoring one that throws
	// as not claiming the text.
	const issues: Issue[] = [];
	let type: PayloadType = detectPayload(text, payloads).type;
	let parsed = attemptCall(() => type.parse(text));
	if (!parsed.ok) {
		// Detected, but not readable as that type after all: explained as text.
		issues.push(issue('inspect.issue.unreadable-as-type', [], 'warning', { typeId: type.id }));
		type = (payloads.get('text') ?? textType) as PayloadType;
		parsed = attemptCall(() => type.parse(text));
	}
	const value: PayloadValue = parsed.ok ? parsed.value : { text };
	const validated = attemptCall(() => type.validate(value));
	if (validated.ok) issues.push(...validated.value);

	// The link as written comes first: it is what the code holds, and where a
	// type reports the same kind of finding about its own reading of the link
	// (a link with its tracking tags moved into fields, say), the raw text's
	// is the one shown.
	const findings: SafetyFinding[] = [];
	let displayHost: string | null = null;
	let unicodeHost: string | null = null;
	const raw = new Set<string>();
	if (isWebLink(text) || isDangerousLink(text)) {
		const analysis = analyseUrl(text);
		findings.push(...analysis.findings);
		for (const finding of analysis.findings) raw.add(finding.code);
		displayHost = analysis.displayHost;
		unicodeHost = analysis.unicodeHost;
	}
	const seen = new Set(findings.map(findingKey));
	const own =
		type.safety === undefined
			? undefined
			: attemptCall(() => (type.safety as (v: PayloadValue) => readonly SafetyFinding[])(value));
	if (own !== undefined && own.ok) {
		for (const finding of own.value) {
			const key = findingKey(finding);
			if (raw.has(finding.code) || seen.has(key)) continue;
			seen.add(key);
			findings.push(finding);
		}
	}
	return {
		payload: Object.freeze({ typeId: type.id, value, issues: Object.freeze(issues) }),
		safety: Object.freeze({ findings: Object.freeze(findings), displayHost, unicodeHost }),
	};
}
